import { text, isCancel, cancel, log, note } from '@clack/prompts';
import pc from 'picocolors';
import { BALANCE_CATEGORIES } from '@firma/utils';
import { getRepository } from '../db/index.ts';
import { aggregateHoldings } from '@firma/db';
import { fetchFxRates } from '../services/fx.ts';
import { inputCategoryGroup, currentPeriod, periodEndDate, type EntryResult } from './ledger-input.ts';

const getOverseasStockKRW = async (): Promise<number> => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());
  if (holdings.size === 0) return 0;

  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p.current_price]));
  const totalUSD = [...holdings.entries()]
    .reduce((s, [ticker, h]) => s + h.shares * (priceMap.get(ticker) ?? 0), 0);
  if (totalUSD === 0) return 0;

  log.message(pc.dim(`\n  Portfolio value: $${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`));

  try {
    const rates = await fetchFxRates();
    const usdKrw = rates.USD ? 1 / rates.USD : null;
    if (usdKrw) {
      log.message(pc.dim(`  USD/KRW: ${usdKrw.toFixed(2)}  (auto)`));
      return Math.round(totalUSD * usdKrw);
    }
  } catch { /* fall through to manual entry */ }

  const rateInput = await text({
    message: 'USD/KRW exchange rate (auto-fetch failed)',
    placeholder: '1380',
    validate: v => (!v.trim() || isNaN(Number(v)) || Number(v) <= 0) ? 'Enter a valid rate' : undefined,
  });
  if (isCancel(rateInput)) { cancel('Cancelled'); process.exit(0); }
  return Math.round(totalUSD * Number(rateInput));
};

export const addBalanceCommand = async ({ period }: { period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  const existing = repo.balance.getByPeriod(targetPeriod);
  const existingMap = new Map(existing.map(e => [e.category, e.amount]));

  const autoFillMap = new Map<string, number>();
  autoFillMap.set('overseas_stock', await getOverseasStockKRW());

  const assets      = BALANCE_CATEGORIES.filter(c => c.type === 'asset');
  const liabilities = BALANCE_CATEGORIES.filter(c => c.type === 'liability');

  log.message(pc.bold('── ASSETS ──────────────────────────────'));
  const assetEntries = await inputCategoryGroup(assets, existingMap, autoFillMap);

  log.message(pc.bold('\n── LIABILITIES ─────────────────────────'));
  const liabilityEntries = await inputCategoryGroup(liabilities, existingMap, autoFillMap);

  const allEntries: EntryResult[] = [...assetEntries, ...liabilityEntries];
  for (const e of allEntries) {
    repo.balance.upsert({ period: targetPeriod, date, type: e.type, sub_type: e.sub_type, category: e.category, amount: e.amount, memo: e.memo ?? null });
  }

  const totalAssets      = assetEntries.reduce((s, e) => s + e.amount, 0);
  const totalLiabilities = liabilityEntries.reduce((s, e) => s + e.amount, 0);
  const netWorth         = totalAssets - totalLiabilities;

  const summary = [
    `${'Assets'.padEnd(16)}${totalAssets.toLocaleString('en-US')} KRW`,
    `${'Liabilities'.padEnd(16)}${totalLiabilities.toLocaleString('en-US')} KRW`,
    pc.dim('─'.repeat(36)),
    `${'Net Worth'.padEnd(16)}${pc.bold(netWorth.toLocaleString('en-US'))} KRW`,
  ].join('\n');

  note(summary, `Balance Sheet  ${targetPeriod}`);
};

export const showBalanceCommand = async ({ json = false, period }: { json?: boolean; period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();
  const entries = repo.balance.getByPeriod(targetPeriod);

  const assets            = entries.filter(e => e.type === 'asset');
  const liabilities       = entries.filter(e => e.type === 'liability');
  const total_assets      = assets.reduce((s, e) => s + e.amount, 0);
  const total_liabilities = liabilities.reduce((s, e) => s + e.amount, 0);
  const net_worth         = total_assets - total_liabilities;

  if (json) {
    process.stdout.write(JSON.stringify({
      period: targetPeriod, entries, total_assets, total_liabilities, net_worth,
    }, null, 2) + '\n');
    return;
  }

  if (entries.length === 0) {
    log.warn(`No balance entries for ${targetPeriod}. Run \`firma add balance\`.`);
    return;
  }

  const renderRows = (group: typeof entries) =>
    group.length === 0 ? [pc.dim('  (none)')]
      : group.map(e => `  ${pc.dim(e.category.padEnd(20))}${e.amount.toLocaleString('en-US').padStart(14)} KRW`);

  const body = [
    pc.bold('ASSETS'),
    ...renderRows(assets),
    '',
    pc.bold('LIABILITIES'),
    ...renderRows(liabilities),
    pc.dim('─'.repeat(40)),
    `${'Assets'.padEnd(20)}${total_assets.toLocaleString('en-US').padStart(14)} KRW`,
    `${'Liabilities'.padEnd(20)}${total_liabilities.toLocaleString('en-US').padStart(14)} KRW`,
    `${pc.bold('Net Worth'.padEnd(20))}${pc.bold(net_worth.toLocaleString('en-US').padStart(14))} KRW`,
  ].join('\n');

  note(body, `Balance Sheet  ${targetPeriod}`);
};
