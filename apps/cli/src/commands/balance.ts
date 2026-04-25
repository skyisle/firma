import { text, isCancel, cancel, log, note } from '@clack/prompts';
import pc from 'picocolors';
import { BALANCE_CATEGORIES } from '@firma/utils';
import { getRepository } from '../db/index.ts';
import { aggregateHoldings } from '../services/portfolio.ts';
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

export const balanceCommand = async ({ json = false, period }: { json?: boolean; period?: string } = {}) => {
  const repo = getRepository();
  const targetPeriod = period ?? currentPeriod();

  if (json) {
    const entries = repo.balance.getByPeriod(targetPeriod);
    const assets = entries.filter(e => e.type === 'asset');
    const liabilities = entries.filter(e => e.type === 'liability');
    const total_assets = assets.reduce((s, e) => s + e.amount, 0);
    const total_liabilities = liabilities.reduce((s, e) => s + e.amount, 0);
    process.stdout.write(JSON.stringify({
      period: targetPeriod,
      entries,
      total_assets,
      total_liabilities,
      net_worth: total_assets - total_liabilities,
    }, null, 2) + '\n');
    return;
  }

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
