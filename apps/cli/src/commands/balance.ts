import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { BALANCE_CATEGORIES } from '@firma/utils';
import { aggregateHoldings } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { fetchFxRates } from '../services/fx.ts';
import { inputCategoryGroup, type EntryResult } from './ledger-input.ts';
import {
  FALLBACK_RATES, CURRENCY_SYMBOL, formatCurrencyValue, storedToUsdAtDate, usdToDisplayAtDate,
  currentPeriod, periodEndDate,
  pickDisplayCurrency, pickInputCurrency,
} from '../utils/index.ts';

const getPortfolioUSD = (): number | null => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());
  if (holdings.size === 0) return null;

  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p.current_price]));
  const totalUSD = [...holdings.entries()]
    .reduce((s, [ticker, h]) => s + h.shares * (priceMap.get(ticker) ?? 0), 0);
  return totalUSD > 0 ? totalUSD : null;
};

export const addBalanceCommand = async ({ period }: { period?: string } = {}) => {
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

  const existing = repo.balance.getByPeriod(targetPeriod);
  const existingMap = new Map(existing.map(e => [e.category, toInput(e.amount, e.currency)]));

  const autoFillMap = new Map<string, number>();
  const portfolioUSD = getPortfolioUSD();
  if (portfolioUSD != null) {
    const portfolioInInput = Math.round(portfolioUSD * inputRate / usdRate);
    log.message(pc.dim(`\n  Portfolio value: ${sym}${portfolioInInput.toLocaleString('en-US')}`));
    autoFillMap.set('overseas_stock', portfolioInInput);
  }

  const assets      = BALANCE_CATEGORIES.filter(c => c.type === 'asset');
  const liabilities = BALANCE_CATEGORIES.filter(c => c.type === 'liability');

  log.message(pc.bold('── ASSETS ──────────────────────────────'));
  const assetEntries = await inputCategoryGroup(assets, existingMap, autoFillMap, sym);

  log.message(pc.bold('\n── LIABILITIES ─────────────────────────'));
  const liabilityEntries = await inputCategoryGroup(liabilities, existingMap, autoFillMap, sym);

  const toUSD = (amount: number): number => Math.round(amount * usdRate / inputRate);

  const allEntries: EntryResult[] = [...assetEntries, ...liabilityEntries];
  for (const e of allEntries) {
    repo.balance.upsert({
      period: targetPeriod, date,
      type: e.type, sub_type: e.sub_type, category: e.category,
      amount: toUSD(e.amount), currency: 'USD',
      memo: e.memo ?? null,
    });
  }

  const totalAssets      = assetEntries.reduce((s, e) => s + e.amount, 0);
  const totalLiabilities = liabilityEntries.reduce((s, e) => s + e.amount, 0);
  const netWorth         = totalAssets - totalLiabilities;

  const summary = [
    `${'Assets'.padEnd(16)}${sym}${totalAssets.toLocaleString('en-US')} ${inputCur}`,
    `${'Liabilities'.padEnd(16)}${sym}${totalLiabilities.toLocaleString('en-US')} ${inputCur}`,
    pc.dim('─'.repeat(36)),
    `${'Net Worth'.padEnd(16)}${pc.bold(`${sym}${netWorth.toLocaleString('en-US')}`)} ${inputCur}`,
  ].join('\n');

  note(summary, `Balance Sheet  ${targetPeriod}`);
};

export const showBalanceCommand = async ({ json = false, period, currency }: { json?: boolean; period?: string; currency?: string } = {}) => {
  const repo = getRepository();
  let targetPeriod = period ?? currentPeriod();
  if (!period) {
    const entries = repo.balance.getByPeriod(targetPeriod);
    if (entries.length === 0) {
      const latest = repo.balance.getPeriods()[0];
      if (latest) targetPeriod = latest;
    }
  }
  const entries = repo.balance.getByPeriod(targetPeriod);

  if (json) {
    process.stdout.write(JSON.stringify({ period: targetPeriod, entries }, null, 2) + '\n');
    return;
  }

  if (entries.length === 0) {
    log.warn('No balance entries found.');
    log.info('Tell Claude to import a net-worth spreadsheet, or run `firma add balance` for one period.');
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);
  const liveRates = await fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>);

  // Convert each entry to display currency at its OWN date (historical rate when available).
  const displayValueAt = (amount: number, storedCurrency: string, date: string): number => {
    const usd = storedToUsdAtDate(amount, storedCurrency, date, repo.fx, liveRates) ?? 0;
    return usdToDisplayAtDate(usd, date, cur, repo.fx, liveRates) ?? 0;
  };

  const fmt = (amount: number, storedCurrency: string, date: string) =>
    formatCurrencyValue(displayValueAt(amount, storedCurrency, date), cur);

  const assets      = entries.filter(e => e.type === 'asset');
  const liabilities = entries.filter(e => e.type === 'liability');

  const sumDisplay = (group: typeof entries) =>
    group.reduce((s, e) => s + displayValueAt(e.amount, e.currency, e.date), 0);

  const totalAssets = sumDisplay(assets);
  const totalLiab   = sumDisplay(liabilities);
  const netWorth    = totalAssets - totalLiab;

  const renderRows = (group: typeof entries) =>
    group.length === 0 ? [pc.dim('  (none)')]
      : group.map(e => `  ${pc.dim(e.category.padEnd(20))}${fmt(e.amount, e.currency, e.date).padStart(14)}`);

  const periodDate = entries[0]?.date ?? targetPeriod;
  const fxRow = cur !== 'USD' ? repo.fx.getRateOnOrBefore(periodDate, cur) : null;
  const rateNote = fxRow
    ? pc.dim(`FX @ ${periodDate}: 1 USD = ${fxRow.rate_to_usd.toFixed(4)} ${cur}  (from ${fxRow.date})`)
    : null;

  const body = [
    pc.bold('ASSETS'),
    ...renderRows(assets),
    '',
    pc.bold('LIABILITIES'),
    ...renderRows(liabilities),
    pc.dim('─'.repeat(40)),
    `${'Assets'.padEnd(20)}${formatCurrencyValue(totalAssets, cur).padStart(14)}`,
    `${'Liabilities'.padEnd(20)}${formatCurrencyValue(totalLiab, cur).padStart(14)}`,
    `${pc.bold('Net Worth'.padEnd(20))}${pc.bold(formatCurrencyValue(netWorth, cur).padStart(14))}`,
    ...(rateNote ? ['', rateNote] : []),
  ].join('\n');

  note(body, `Balance Sheet  ${targetPeriod}`);
};
