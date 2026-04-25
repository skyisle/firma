import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

type BalanceEntry = { period: string; type: string; amount: number };
type FlowEntry = { period: string; type: string; amount: number };

type BalancePeriod = { period: string; assets: number; liabilities: number; netWorth: number };
type FlowPeriod    = { period: string; income: number; expenses: number; netFlow: number };

// ── Formatters ──────────────────────────────────────────────────────────────────

const man = (n: number) => `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
const delta = (n: number) => {
  if (n === 0) return pc.dim('─');
  const s = `${n >= 0 ? '+' : ''}${man(n)}`;
  return n >= 0 ? pc.green(s) : pc.red(s);
};
const colorNet = (n: number, s: string) => n >= 0 ? pc.green(s) : pc.red(s);

// ── Aggregation ─────────────────────────────────────────────────────────────────

const aggregateBalance = (entries: BalanceEntry[]): BalancePeriod[] => {
  const map = new Map<string, { assets: number; liabilities: number }>();
  for (const e of entries) {
    const p = map.get(e.period) ?? { assets: 0, liabilities: 0 };
    if (e.type === 'asset') p.assets += e.amount;
    else if (e.type === 'liability') p.liabilities += e.amount;
    map.set(e.period, p);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, ...v, netWorth: v.assets - v.liabilities }));
};

const aggregateFlow = (entries: FlowEntry[]): FlowPeriod[] => {
  const map = new Map<string, { income: number; expenses: number }>();
  for (const e of entries) {
    const p = map.get(e.period) ?? { income: 0, expenses: 0 };
    if (e.type === 'income') p.income += e.amount;
    else if (e.type === 'expense') p.expenses += e.amount;
    map.set(e.period, p);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, v]) => ({ period, ...v, netFlow: v.income - v.expenses }));
};

// ── Renderers ───────────────────────────────────────────────────────────────────

const COL = { P: 10, A: 14, L: 14, N: 16, D: 14 };

const renderBalance = (rows: BalancePeriod[]): string => {
  const header = [
    pc.dim('PERIOD'.padEnd(COL.P)),
    pc.dim('ASSETS'.padEnd(COL.A)),
    pc.dim('LIABILITIES'.padEnd(COL.L)),
    pc.dim('NET WORTH'.padEnd(COL.N)),
    pc.dim('MoM Δ'),
  ].join('  ');

  const divider = pc.dim('─'.repeat(COL.P + COL.A + COL.L + COL.N + COL.D + 8));

  const lines = rows.map((r, i) => {
    const prev = rows[i - 1];
    const d = prev != null ? r.netWorth - prev.netWorth : null;
    return [
      r.period.padEnd(COL.P),
      man(r.assets).padEnd(COL.A),
      man(r.liabilities).padEnd(COL.L),
      pc.bold(man(r.netWorth)).padEnd(COL.N),
      d != null ? delta(d) : pc.dim('─'),
    ].join('  ');
  });

  const latest = rows.at(-1);
  const footer = latest
    ? `\n${pc.dim(`${rows.length}개월  순자산 ${man(latest.netWorth)}`)}`
    : '';

  return `${header}\n${divider}\n${lines.join('\n')}${footer}`;
};

const renderFlow = (rows: FlowPeriod[]): string => {
  const COL_F = { P: 10, I: 14, E: 14, N: 14, S: 8 };

  const header = [
    pc.dim('PERIOD'.padEnd(COL_F.P)),
    pc.dim('INCOME'.padEnd(COL_F.I)),
    pc.dim('EXPENSES'.padEnd(COL_F.E)),
    pc.dim('NET FLOW'.padEnd(COL_F.N)),
    pc.dim('저축률'),
  ].join('  ');

  const divider = pc.dim('─'.repeat(COL_F.P + COL_F.I + COL_F.E + COL_F.N + COL_F.S + 8));

  const lines = rows.map(r => {
    const savingsRate = r.income > 0 ? (r.netFlow / r.income) * 100 : null;
    return [
      r.period.padEnd(COL_F.P),
      man(r.income).padEnd(COL_F.I),
      man(r.expenses).padEnd(COL_F.E),
      colorNet(r.netFlow, pc.bold(man(r.netFlow))).padEnd(COL_F.N),
      savingsRate != null
        ? colorNet(r.netFlow, `${savingsRate.toFixed(1)}%`)
        : pc.dim('─'),
    ].join('  ');
  });

  const avgSavings = rows.filter(r => r.income > 0);
  const avgRate = avgSavings.length
    ? avgSavings.reduce((s, r) => s + r.netFlow / r.income, 0) / avgSavings.length * 100
    : null;

  const footer = avgRate != null
    ? `\n${pc.dim(`${rows.length}개월  평균 저축률 ${avgRate.toFixed(1)}%`)}`
    : '';

  return `${header}\n${divider}\n${lines.join('\n')}${footer}`;
};

// ── Command ─────────────────────────────────────────────────────────────────────

export const reportCommand = async (target?: string) => {
  const { token } = requireAuth();

  const showBalance = !target || target === 'balance';
  const showFlow    = !target || target === 'flow';

  if (target && target !== 'balance' && target !== 'flow') {
    log.error(`Unknown target "${target}". Use: balance, flow, or omit for combined.`);
    return;
  }

  const [balanceEntries, flowEntries] = await Promise.all([
    showBalance ? apiFetch<BalanceEntry[]>('/api/balance', { token }) : Promise.resolve([]),
    showFlow    ? apiFetch<FlowEntry[]>('/api/flow', { token })       : Promise.resolve([]),
  ]);

  if (showBalance) {
    const rows = aggregateBalance(balanceEntries).slice(-36);
    if (rows.length === 0) log.warn('No balance sheet data found.');
    else note(renderBalance(rows), 'Balance Sheet');
  }

  if (showFlow) {
    const rows = aggregateFlow(flowEntries).slice(-36);
    if (rows.length === 0) log.warn('No cash flow data found.');
    else note(renderFlow(rows), 'Cash Flow');
  }
};
