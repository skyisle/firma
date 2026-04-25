import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { fetchFxRates } from '../services/fx.ts';
import type { BalanceEntry, FlowEntry } from '@firma/db';

type BalancePeriod = { period: string; assets: number; liabilities: number; netWorth: number };
type FlowPeriod    = { period: string; income: number; expenses: number; netFlow: number };

export type Currency = 'KRW' | 'USD' | 'EUR' | 'JPY' | 'CNY' | 'GBP';

const CURRENCY_SYMBOL: Record<Currency, string> = {
  KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥', GBP: '£',
};

const fmtAmount = (amountKrw: number, currency: Currency, rate: number): string => {
  const v = amountKrw * rate;
  const sym = CURRENCY_SYMBOL[currency];
  if (currency === 'KRW') return `${sym}${Math.round(v / 10000).toLocaleString('ko-KR')}만`;
  if (currency === 'JPY') return `${sym}${Math.round(v).toLocaleString('ja-JP')}`;
  return `${sym}${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};


const man = (n: number) => `₩${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
const delta = (n: number, fmt: (v: number) => string) => {
  if (n === 0) return pc.dim('─');
  const s = `${n >= 0 ? '+' : ''}${fmt(n)}`;
  return n >= 0 ? pc.green(s) : pc.red(s);
};
const colorNet = (n: number, s: string) => n >= 0 ? pc.green(s) : pc.red(s);

const BAR_W = 22;
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

export const fracBar = (ratio: number, width: number): string => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = clamped * width;
  const full = Math.floor(filled);
  const partial = EIGHTHS[Math.round((filled - full) * 8)] ?? '';
  return '█'.repeat(full) + partial;
};

const netWorthBar = (value: number, max: number): string => {
  const bar = fracBar(value / max, BAR_W);
  const empty = pc.dim('░'.repeat(BAR_W - Math.round((value / max) * BAR_W)));
  return pc.cyan(bar) + empty;
};

const savingsBar = (income: number, expenses: number): string => {
  if (income <= 0) return pc.dim('░'.repeat(BAR_W));
  const ratio = expenses / income;
  if (ratio >= 1) return pc.red('█'.repeat(BAR_W - 1) + '▶');
  const expFill = Math.round(ratio * BAR_W);
  return pc.red('█'.repeat(expFill)) + pc.green('█'.repeat(BAR_W - expFill));
};


const FLOW_LABEL: Record<string, string> = {
  salary: 'Salary', business: 'Business', dividends: 'Dividends',
  interest: 'Interest', income_other: 'Other Income',
  personal: 'Personal', insurance: 'Insurance', phone: 'Phone',
  utilities: 'Utilities', rent: 'Rent', maintenance: 'Maintenance',
  loan_repayment: 'Loan Repay', expense_other: 'Other Expense',
};

const BALANCE_LABEL: Record<string, string> = {
  cash: 'Cash', investment: 'Investments', other: 'Other Assets',
  short_term: 'Short-term Liab.', long_term: 'Long-term Liab.',
};


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


const BREAKDOWN_BAR_W = 16;

const breakdownBar = (ratio: number, color: (s: string) => string): string => {
  const bar = fracBar(ratio, BREAKDOWN_BAR_W);
  const empty = pc.dim('░'.repeat(BREAKDOWN_BAR_W - Math.round(ratio * BREAKDOWN_BAR_W)));
  return color(bar) + empty;
};

const renderGroupRows = (
  map: Map<string, number>,
  total: number,
  color: (s: string) => string,
  fmt: (v: number) => string,
): string[] =>
  [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key, amt]) => {
      const label = (FLOW_LABEL[key] ?? BALANCE_LABEL[key] ?? key).padEnd(14);
      const pct = `${((amt / total) * 100).toFixed(1)}%`.padStart(6);
      return `  ${pc.dim(label)}  ${breakdownBar(amt / total, color)}  ${fmt(amt)}${pc.dim(pct)}`;
    });


const COL = { P: 10, N: 14, D: 12 };

const renderBalance = (rows: BalancePeriod[], fmt: (v: number) => string): { table: string; chart: string } => {
  const maxNetWorth = Math.max(...rows.map(r => r.netWorth));
  const header = [pc.dim('PERIOD'.padEnd(COL.P)), pc.dim('NET WORTH'.padEnd(COL.N)), pc.dim('MoM Δ')].join('  ');
  const divider = pc.dim('─'.repeat(COL.P + COL.N + COL.D + 4));

  const lines = rows.map((r, i) => {
    const prev = rows[i - 1];
    const d = prev != null ? r.netWorth - prev.netWorth : null;
    return [r.period.padEnd(COL.P), pc.bold(fmt(r.netWorth)).padEnd(COL.N), d != null ? delta(d, fmt) : pc.dim('─')].join('  ');
  });

  const latest = rows.at(-1);
  const tableFooter = latest ? `\n${pc.dim(`${rows.length} months  Net Worth ${fmt(latest.netWorth)}`)}` : '';
  const chartLines = rows.map(r =>
    `${pc.dim(r.period)}  ${netWorthBar(r.netWorth, maxNetWorth)}  ${pc.dim(fmt(r.netWorth))}`
  );
  return { table: `${header}\n${divider}\n${lines.join('\n')}${tableFooter}`, chart: chartLines.join('\n') };
};

const renderBalanceBreakdown = (entries: BalanceEntry[], year: string, fmt: (v: number) => string): string => {
  const yearEntries = entries.filter(e => e.period.startsWith(year));
  if (yearEntries.length === 0) return pc.dim(`No data for ${year}`);

  const latestPeriod = [...new Set(yearEntries.map(e => e.period))].sort().at(-1)!;
  const latest = yearEntries.filter(e => e.period === latestPeriod);

  const assetBySubType = new Map<string, number>();
  const liabBySubType  = new Map<string, number>();
  for (const e of latest) {
    const map = e.type === 'asset' ? assetBySubType : liabBySubType;
    map.set(e.sub_type, (map.get(e.sub_type) ?? 0) + e.amount);
  }

  const totalAssets = [...assetBySubType.values()].reduce((s, v) => s + v, 0);
  const totalLiab   = [...liabBySubType.values()].reduce((s, v) => s + v, 0);
  const netWorth    = totalAssets - totalLiab;

  return [
    `${pc.bold(pc.cyan('Assets'))}  ${pc.dim(`Total ${man(totalAssets)}`)}  ${pc.dim(`(${latestPeriod})`)}`,
    ...renderGroupRows(assetBySubType, totalAssets, pc.cyan, fmt),
    '',
    `${pc.bold(pc.yellow('Liabilities'))}  ${pc.dim(`Total ${man(totalLiab)}`)}`,
    ...(liabBySubType.size ? renderGroupRows(liabBySubType, totalLiab > 0 ? totalLiab : 1, pc.yellow, fmt) : [`  ${pc.dim('None')}`]),
    '',
    pc.dim(`Net Worth  ${man(netWorth)}`),
  ].join('\n');
};

const renderFlow = (rows: FlowPeriod[], fmt: (v: number) => string): { table: string; chart: string } => {
  const COL_F = { P: 10, I: 12, E: 12, S: 8 };
  const header = [pc.dim('PERIOD'.padEnd(COL_F.P)), pc.dim('INCOME'.padEnd(COL_F.I)), pc.dim('EXPENSES'.padEnd(COL_F.E)), pc.dim('SAVINGS')].join('  ');
  const divider = pc.dim('─'.repeat(COL_F.P + COL_F.I + COL_F.E + COL_F.S + 8));

  const lines = rows.map(r => {
    const savingsRate = r.income > 0 ? (r.netFlow / r.income) * 100 : null;
    return [r.period.padEnd(COL_F.P), fmt(r.income).padEnd(COL_F.I), fmt(r.expenses).padEnd(COL_F.E), savingsRate != null ? colorNet(r.netFlow, `${savingsRate.toFixed(1)}%`) : pc.dim('─')].join('  ');
  });

  const avgSavings = rows.filter(r => r.income > 0);
  const avgRate = avgSavings.length ? avgSavings.reduce((s, r) => s + r.netFlow / r.income, 0) / avgSavings.length * 100 : null;
  const tableFooter = avgRate != null ? `\n${pc.dim(`${rows.length} months  Avg savings rate ${avgRate.toFixed(1)}%`)}` : '';

  const chartLines = rows.map(r => {
    const rate = r.income > 0 ? (r.netFlow / r.income) * 100 : null;
    const rateStr = rate != null ? colorNet(r.netFlow, `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`).padEnd(10) : pc.dim('─').padEnd(10);
    return `${pc.dim(r.period)}  ${savingsBar(r.income, r.expenses)}  ${rateStr}`;
  });

  return { table: `${header}\n${divider}\n${lines.join('\n')}${tableFooter}`, chart: `${pc.dim('◀ expense · saving ▶')}\n${chartLines.join('\n')}` };
};

const renderFlowBreakdown = (entries: FlowEntry[], year: string, fmt: (v: number) => string): string => {
  const yearEntries = entries.filter(e => e.period.startsWith(year));
  if (yearEntries.length === 0) return pc.dim(`No data for ${year}`);

  const incomeMap  = new Map<string, number>();
  const expenseMap = new Map<string, number>();
  for (const e of yearEntries) {
    const map = e.type === 'income' ? incomeMap : expenseMap;
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  }

  const totalIncome  = [...incomeMap.values()].reduce((s, v) => s + v, 0);
  const totalExpense = [...expenseMap.values()].reduce((s, v) => s + v, 0);
  const savings      = totalIncome - totalExpense;
  const savingsRate  = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;

  return [
    `${pc.bold(pc.green('Income'))}  ${pc.dim(`Total ${fmt(totalIncome)}`)}`,
    ...renderGroupRows(incomeMap, totalIncome, pc.green, fmt),
    '',
    `${pc.bold(pc.red('Expenses'))}  ${pc.dim(`Total ${fmt(totalExpense)}`)}`,
    ...renderGroupRows(expenseMap, totalExpense, pc.red, fmt),
    '',
    pc.dim(`Savings  ${fmt(savings)}  (${savingsRate.toFixed(1)}%)`),
  ].join('\n');
};

export const reportCommand = async (target?: string, currency: Currency = 'KRW', { json = false } = {}) => {
  const showBalance = !target || target === 'balance';
  const showFlow    = !target || target === 'flow';

  if (target && target !== 'balance' && target !== 'flow') {
    log.error(`Unknown target "${target}". Use: balance, flow, or omit for combined.`);
    return;
  }

  const repo = getRepository();
  const [rates, balanceData, flowData] = await Promise.all([
    fetchFxRates().catch(() => ({ KRW: 1, USD: 0.00072, EUR: 0.00066, JPY: 0.107, CNY: 0.0052, GBP: 0.00057 })),
    showBalance ? Promise.resolve(repo.balance.getAll()) : Promise.resolve([]),
    showFlow    ? Promise.resolve(repo.flow.getAll())    : Promise.resolve([]),
  ]);

  const rate = (rates as Record<string, number>)[currency] ?? 1;
  const fmt = (v: number) => fmtAmount(v, currency, rate);
  const currentYear = new Date().getFullYear().toString();

  if (json) {
    process.stdout.write(JSON.stringify({ balance: balanceData, flow: flowData }, null, 2) + '\n');
    return;
  }

  if (showBalance) {
    const rows = aggregateBalance(balanceData).slice(-36);
    if (rows.length === 0) log.warn('No balance sheet data found.');
    else {
      const { table, chart } = renderBalance(rows, fmt);
      note(table, 'Balance Sheet');
      note(chart, 'Net Worth Trend');
      note(renderBalanceBreakdown(balanceData, currentYear, fmt), `${currentYear} Asset Breakdown`);
    }
  }

  if (showFlow) {
    const rows = aggregateFlow(flowData).slice(-36);
    if (rows.length === 0) log.warn('No cash flow data found.');
    else {
      const { table, chart } = renderFlow(rows, fmt);
      note(table, 'Cash Flow');
      note(chart, 'Savings Trend');
      note(renderFlowBreakdown(flowData, currentYear, fmt), `${currentYear} Breakdown`);
    }
  }
};
