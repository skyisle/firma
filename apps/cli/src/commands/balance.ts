import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { BALANCE_CATEGORIES } from '@firma/utils';
import { aggregateHoldings } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { fetchFxRates } from '../services/fx.ts';
import { inputCategoryGroup, type EntryResult } from './ledger-input.ts';
import {
  fmtAmount, entryKrw, FALLBACK_RATES, CURRENCY_SYMBOL,
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
    log.warn('No balance entries found. Run `firma add balance`.');
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);
  const rates = await fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>);
  const displayRate = (rates[cur] ?? FALLBACK_RATES[cur]) as number;
  const fmt = (amount: number, storedCurrency: string) =>
    fmtAmount(entryKrw(amount, storedCurrency, rates), cur, displayRate);

  const assets      = entries.filter(e => e.type === 'asset');
  const liabilities = entries.filter(e => e.type === 'liability');

  const sumKrw = (group: typeof entries) =>
    group.reduce((s, e) => s + entryKrw(e.amount, e.currency, rates), 0);

  const totalAssetsKrw = sumKrw(assets);
  const totalLiabKrw   = sumKrw(liabilities);
  const netWorthKrw    = totalAssetsKrw - totalLiabKrw;

  const renderRows = (group: typeof entries) =>
    group.length === 0 ? [pc.dim('  (none)')]
      : group.map(e => `  ${pc.dim(e.category.padEnd(20))}${fmt(e.amount, e.currency).padStart(14)}`);

  const body = [
    pc.bold('ASSETS'),
    ...renderRows(assets),
    '',
    pc.bold('LIABILITIES'),
    ...renderRows(liabilities),
    pc.dim('─'.repeat(40)),
    `${'Assets'.padEnd(20)}${fmtAmount(totalAssetsKrw, cur, displayRate).padStart(14)}`,
    `${'Liabilities'.padEnd(20)}${fmtAmount(totalLiabKrw, cur, displayRate).padStart(14)}`,
    `${pc.bold('Net Worth'.padEnd(20))}${pc.bold(fmtAmount(netWorthKrw, cur, displayRate).padStart(14))}`,
  ].join('\n');

  note(body, `Balance Sheet  ${targetPeriod}`);
};
