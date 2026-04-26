import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { FLOW_CATEGORIES } from '@firma/utils';
import { getRepository } from '../db/index.ts';
import { fetchFxRates } from '../services/fx.ts';
import { inputCategoryGroup, type EntryResult } from './ledger-input.ts';
import {
  fmtAmount, entryKrw, FALLBACK_RATES, CURRENCY_SYMBOL, formatCurrencyValue, storedToUsdAtDate, usdToDisplayAtDate,
  currentPeriod, periodEndDate,
  pickDisplayCurrency, pickInputCurrency,
} from '../utils/index.ts';

export const addFlowCommand = async ({ period }: { period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  let ratesLive = true;
  const rates = await fetchFxRates().catch(() => { ratesLive = false; return FALLBACK_RATES as Record<string, number>; });
  const usdRate = (rates['USD'] ?? FALLBACK_RATES['USD']) as number;

  const inputCur = await pickInputCurrency();
  const inputRate = (rates[inputCur] ?? FALLBACK_RATES[inputCur]) as number;
  const sym = CURRENCY_SYMBOL[inputCur];

  if (inputCur !== 'USD') {
    const ratePerUSD = inputRate / usdRate;
    const rateStr = ratePerUSD >= 1
      ? `${sym}${Math.round(ratePerUSD).toLocaleString('en-US')}`
      : `${sym}${ratePerUSD.toFixed(2)}`;
    log.message(pc.dim(`  1 USD = ${rateStr}  (${ratesLive ? 'live' : 'fallback'})`));
  }

  const toInput = (amount: number, storedCurrency: string): number => {
    const fromRate = (rates[storedCurrency] ?? FALLBACK_RATES[storedCurrency] ?? 1) as number;
    return Math.round(amount * inputRate / fromRate);
  };

  const existing = repo.flow.getByPeriod(targetPeriod);
  const existingMap = new Map(existing.map(e => [e.category, toInput(e.amount, e.currency)]));

  const income  = FLOW_CATEGORIES.filter(c => c.type === 'income');
  const expense = FLOW_CATEGORIES.filter(c => c.type === 'expense');

  log.message(pc.bold('── INCOME ───────────────────────────────'));
  const incomeEntries = await inputCategoryGroup(income, existingMap, new Map(), sym);

  log.message(pc.bold('\n── EXPENSES ─────────────────────────────'));
  const expenseEntries = await inputCategoryGroup(expense, existingMap, new Map(), sym);

  const toUSD = (amount: number): number => Math.round(amount * usdRate / inputRate);

  const allEntries: EntryResult[] = [...incomeEntries, ...expenseEntries];
  for (const e of allEntries) {
    repo.flow.upsert({
      period: targetPeriod, date,
      type: e.type, sub_type: e.sub_type, category: e.category,
      amount: toUSD(e.amount), currency: 'USD',
      memo: e.memo ?? null,
    });
  }

  const totalIncome  = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const totalExpense = expenseEntries.reduce((s, e) => s + e.amount, 0);
  const netFlow      = totalIncome - totalExpense;
  const colorNet     = netFlow >= 0 ? pc.green : pc.red;

  const summary = [
    `${'Income'.padEnd(16)}${sym}${totalIncome.toLocaleString('en-US')} ${inputCur}`,
    `${'Expenses'.padEnd(16)}${sym}${totalExpense.toLocaleString('en-US')} ${inputCur}`,
    pc.dim('─'.repeat(36)),
    `${'Net Flow'.padEnd(16)}${colorNet(pc.bold(`${sym}${netFlow.toLocaleString('en-US')}`))} ${inputCur}`,
  ].join('\n');

  note(summary, `Cash Flow  ${targetPeriod}`);
};

export const showFlowCommand = async ({ json = false, period, currency }: { json?: boolean; period?: string; currency?: string } = {}) => {
  const repo = getRepository();
  let targetPeriod = period ?? currentPeriod();
  if (!period) {
    const entries = repo.flow.getByPeriod(targetPeriod);
    if (entries.length === 0) {
      const latest = repo.flow.getPeriods()[0];
      if (latest) targetPeriod = latest;
    }
  }
  const entries = repo.flow.getByPeriod(targetPeriod);

  if (json) {
    process.stdout.write(JSON.stringify({ period: targetPeriod, entries }, null, 2) + '\n');
    return;
  }

  if (entries.length === 0) {
    log.warn(`No flow entries for ${targetPeriod}. Run \`firma add flow\`.`);
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);
  const liveRates = await fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>);

  const displayValueAt = (amount: number, storedCurrency: string, date: string): number => {
    const usd = storedToUsdAtDate(amount, storedCurrency, date, repo.fx, liveRates) ?? 0;
    return usdToDisplayAtDate(usd, date, cur, repo.fx, liveRates) ?? 0;
  };

  const fmt = (amount: number, storedCurrency: string, date: string) =>
    formatCurrencyValue(displayValueAt(amount, storedCurrency, date), cur);

  const income   = entries.filter(e => e.type === 'income');
  const expenses = entries.filter(e => e.type === 'expense');

  const sumDisplay = (group: typeof entries) =>
    group.reduce((s, e) => s + displayValueAt(e.amount, e.currency, e.date), 0);

  const totalIncome  = sumDisplay(income);
  const totalExpense = sumDisplay(expenses);
  const netFlow      = totalIncome - totalExpense;
  const colorNet = netFlow >= 0 ? pc.green : pc.red;

  const renderRows = (group: typeof entries) =>
    group.length === 0 ? [pc.dim('  (none)')]
      : group.map(e => `  ${pc.dim(e.category.padEnd(20))}${fmt(e.amount, e.currency, e.date).padStart(14)}`);

  const periodDate = entries[0]?.date ?? targetPeriod;
  const fxRow = cur !== 'USD' ? repo.fx.getRateOnOrBefore(periodDate, cur) : null;
  const rateNote = fxRow
    ? pc.dim(`FX @ ${periodDate}: 1 USD = ${fxRow.rate_to_usd.toFixed(4)} ${cur}  (from ${fxRow.date})`)
    : null;

  const body = [
    pc.bold('INCOME'),
    ...renderRows(income),
    '',
    pc.bold('EXPENSES'),
    ...renderRows(expenses),
    pc.dim('─'.repeat(40)),
    `${'Income'.padEnd(20)}${formatCurrencyValue(totalIncome, cur).padStart(14)}`,
    `${'Expenses'.padEnd(20)}${formatCurrencyValue(totalExpense, cur).padStart(14)}`,
    `${pc.bold('Net Flow'.padEnd(20))}${colorNet(pc.bold(formatCurrencyValue(netFlow, cur).padStart(14)))}`,
    ...(rateNote ? ['', rateNote] : []),
  ].join('\n');

  note(body, `Cash Flow  ${targetPeriod}`);
};
