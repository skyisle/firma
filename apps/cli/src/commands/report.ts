import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { fetchFxRates } from '../services/fx.ts';
import {
  fmtAmount, entryKrw, fracBar, FALLBACK_RATES, currentPeriod, pickDisplayCurrency, type Currency,
} from '../utils/index.ts';
import type { BalanceEntry, FlowEntry } from '@firma/db';

type BalancePeriod = { period: string; assets: number; liabilities: number; netWorth: number };
type FlowPeriod    = { period: string; income: number; expenses: number; netFlow: number };

const delta = (n: number, fmt: (v: number) => string) => {
  if (n === 0) return pc.dim('─');
  const s = `${n >= 0 ? '+' : ''}${fmt(n)}`;
  return n >= 0 ? pc.green(s) : pc.red(s);
};
const colorNet = (n: number, s: string) => n >= 0 ? pc.green(s) : pc.red(s);

const BAR_W = 22;

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


const aggregateBalance = (entries: BalanceEntry[], rates: Record<string, number>) =>
  [...entries.reduce((map, e) => {
    const krw = entryKrw(e.amount, e.currency, rates);
    const prev = map.get(e.period) ?? { assets: 0, liabilities: 0 };
    return map.set(e.period, {
      assets:      prev.assets      + (e.type === 'asset'     ? krw : 0),
      liabilities: prev.liabilities + (e.type === 'liability' ? krw : 0),
    });
  }, new Map<string, { assets: number; liabilities: number }>()).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { assets, liabilities }]) => ({ period, assets, liabilities, netWorth: assets - liabilities }));

const aggregateFlow = (entries: FlowEntry[], rates: Record<string, number>) =>
  [...entries.reduce((map, e) => {
    const krw = entryKrw(e.amount, e.currency, rates);
    const prev = map.get(e.period) ?? { income: 0, expenses: 0 };
    return map.set(e.period, {
      income:   prev.income   + (e.type === 'income'  ? krw : 0),
      expenses: prev.expenses + (e.type === 'expense' ? krw : 0),
    });
  }, new Map<string, { income: number; expenses: number }>()).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { income, expenses }]) => ({ period, income, expenses, netFlow: income - expenses }));


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

const renderBalanceBreakdown = (entries: BalanceEntry[], year: string, fmt: (v: number) => string, rates: Record<string, number>): string => {
  const yearEntries = entries.filter(e => e.period.startsWith(year));
  if (yearEntries.length === 0) return pc.dim(`No data for ${year}`);

  const latestPeriod = [...new Set(yearEntries.map(e => e.period))].sort().at(-1)!;
  const latest = yearEntries.filter(e => e.period === latestPeriod);

  const assetBySubType = new Map<string, number>();
  const liabBySubType  = new Map<string, number>();
  for (const e of latest) {
    const map = e.type === 'asset' ? assetBySubType : liabBySubType;
    const krw = entryKrw(e.amount, e.currency, rates);
    map.set(e.sub_type, (map.get(e.sub_type) ?? 0) + krw);
  }

  const totalAssets = [...assetBySubType.values()].reduce((s, v) => s + v, 0);
  const totalLiab   = [...liabBySubType.values()].reduce((s, v) => s + v, 0);
  const netWorth    = totalAssets - totalLiab;

  return [
    `${pc.bold(pc.cyan('Assets'))}  ${pc.dim(`Total ${fmt(totalAssets)}`)}  ${pc.dim(`(${latestPeriod})`)}`,
    ...renderGroupRows(assetBySubType, totalAssets, pc.cyan, fmt),
    '',
    `${pc.bold(pc.yellow('Liabilities'))}  ${pc.dim(`Total ${fmt(totalLiab)}`)}`,
    ...(liabBySubType.size ? renderGroupRows(liabBySubType, totalLiab > 0 ? totalLiab : 1, pc.yellow, fmt) : [`  ${pc.dim('None')}`]),
    '',
    pc.dim(`Net Worth  ${fmt(netWorth)}`),
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

const renderFlowBreakdown = (entries: FlowEntry[], year: string, fmt: (v: number) => string, rates: Record<string, number>): string => {
  const yearEntries = entries.filter(e => e.period.startsWith(year));
  if (yearEntries.length === 0) return pc.dim(`No data for ${year}`);

  const incomeMap  = new Map<string, number>();
  const expenseMap = new Map<string, number>();
  for (const e of yearEntries) {
    const map = e.type === 'income' ? incomeMap : expenseMap;
    const krw = entryKrw(e.amount, e.currency, rates);
    map.set(e.category, (map.get(e.category) ?? 0) + krw);
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

const reportSettle = async (period: string | undefined, json: boolean, currency: Currency) => {
  const repo = getRepository();

  let targetPeriod = period ?? currentPeriod();
  if (!period) {
    const has = (p: string) =>
      repo.balance.getByPeriod(p).length > 0 || repo.flow.getByPeriod(p).length > 0;
    if (!has(targetPeriod)) {
      const balPeriods = repo.balance.getPeriods();
      const flowPeriods = repo.flow.getPeriods();
      const latest = [...new Set([...balPeriods, ...flowPeriods])].sort().at(-1);
      if (latest) targetPeriod = latest;
    }
  }

  const balEntries = repo.balance.getByPeriod(targetPeriod);
  const flowEnts   = repo.flow.getByPeriod(targetPeriod);

  if (json) {
    process.stdout.write(JSON.stringify({
      period: targetPeriod,
      balance: { entries: balEntries },
      flow:    { entries: flowEnts },
    }, null, 2) + '\n');
    return;
  }

  if (balEntries.length === 0 && flowEnts.length === 0) {
    log.warn(`No data found. Run \`firma add monthly\`.`);
    return;
  }

  const rates = await fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>);
  const rate = (rates[currency] ?? FALLBACK_RATES[currency]) as number;
  const fmt = (krw: number) => fmtAmount(krw, currency, rate);

  const total_assets      = balEntries.filter(e => e.type === 'asset').reduce((s, e) => s + entryKrw(e.amount, e.currency, rates), 0);
  const total_liabilities = balEntries.filter(e => e.type === 'liability').reduce((s, e) => s + entryKrw(e.amount, e.currency, rates), 0);
  const total_income      = flowEnts.filter(e => e.type === 'income').reduce((s, e) => s + entryKrw(e.amount, e.currency, rates), 0);
  const total_expenses    = flowEnts.filter(e => e.type === 'expense').reduce((s, e) => s + entryKrw(e.amount, e.currency, rates), 0);
  const net_worth         = total_assets - total_liabilities;
  const net_flow          = total_income - total_expenses;

  const colorFlow = net_flow >= 0 ? pc.green : pc.red;
  const body = [
    pc.bold('BALANCE SHEET'),
    `  ${'Assets'.padEnd(16)}${fmt(total_assets).padStart(16)}`,
    `  ${'Liabilities'.padEnd(16)}${fmt(total_liabilities).padStart(16)}`,
    `  ${pc.bold('Net Worth'.padEnd(16))}${pc.bold(fmt(net_worth).padStart(16))}`,
    '',
    pc.bold('CASH FLOW'),
    `  ${'Income'.padEnd(16)}${fmt(total_income).padStart(16)}`,
    `  ${'Expenses'.padEnd(16)}${fmt(total_expenses).padStart(16)}`,
    `  ${pc.bold('Net Flow'.padEnd(16))}${colorFlow(pc.bold(fmt(net_flow).padStart(16)))}`,
  ].join('\n');

  note(body, `Settlement Summary  ${targetPeriod}`);
};

export const reportCommand = async (
  target?: string,
  currency?: string,
  { json = false, period }: { json?: boolean; period?: string } = {},
) => {
  if (target && target !== 'balance' && target !== 'flow' && target !== 'settle') {
    log.error(`Unknown target "${target}". Use: balance, flow, settle, or omit for combined.`);
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);
  if (target === 'settle') return reportSettle(period, json, cur);

  const showBalance = !target || target === 'balance';
  const showFlow    = !target || target === 'flow';

  const repo = getRepository();
  const [rates, balanceData, flowData] = await Promise.all([
    fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>),
    showBalance ? Promise.resolve(repo.balance.getAll()) : Promise.resolve([]),
    showFlow    ? Promise.resolve(repo.flow.getAll())    : Promise.resolve([]),
  ]);

  const rate = (rates[cur] ?? FALLBACK_RATES[cur]) as number;
  const fmt = (v: number) => fmtAmount(v, cur, rate);
  const currentYear = new Date().getFullYear().toString();

  if (json) {
    process.stdout.write(JSON.stringify({ balance: balanceData, flow: flowData }, null, 2) + '\n');
    return;
  }

  if (showBalance) {
    const rows = aggregateBalance(balanceData, rates).slice(-36);
    if (rows.length === 0) log.warn('No balance sheet data found.');
    else {
      const { table, chart } = renderBalance(rows, fmt);
      note(table, 'Balance Sheet');
      note(chart, 'Net Worth Trend');
      note(renderBalanceBreakdown(balanceData, currentYear, fmt, rates), `${currentYear} Asset Breakdown`);
    }
  }

  if (showFlow) {
    const rows = aggregateFlow(flowData, rates).slice(-36);
    if (rows.length === 0) log.warn('No cash flow data found.');
    else {
      const { table, chart } = renderFlow(rows, fmt);
      note(table, 'Cash Flow');
      note(chart, 'Savings Trend');
      note(renderFlowBreakdown(flowData, currentYear, fmt, rates), `${currentYear} Breakdown`);
    }
  }
};
