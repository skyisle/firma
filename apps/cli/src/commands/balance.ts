import { text, isCancel, cancel, log, note } from '@clack/prompts';
import pc from 'picocolors';
import { BALANCE_CATEGORIES } from '@firma/utils';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';
import { inputCategoryGroup, currentPeriod, periodEndDate, printSummary, type EntryResult } from './ledger-input.ts';

type PortfolioItem = { ticker: string; marketValue: number | null; currency: string };
type ExistingEntry = { category: string; amount: number };

const getOverseasStockKRW = async (token: string): Promise<number> => {
  const portfolio = await apiFetch<PortfolioItem[]>('/api/portfolio', { token });
  const totalUSD = portfolio.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  if (totalUSD === 0) return 0;

  log.message(pc.dim(`\n  Portfolio value: $${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`));

  const rateInput = await text({
    message: 'USD/KRW exchange rate',
    placeholder: '1380',
    validate: v => (!v.trim() || isNaN(Number(v))) ? 'Enter a valid rate' : undefined,
  });

  if (isCancel(rateInput)) { cancel('Cancelled'); process.exit(0); }
  const rate = Number(rateInput);
  return Math.round(totalUSD * rate);
};

export const balanceCommand = async (period?: string) => {
  const { token } = requireAuth();
  const targetPeriod = period ?? currentPeriod();
  const date = periodEndDate(targetPeriod);

  log.message(pc.dim(`  Period: ${targetPeriod}  (${date})\n`));

  // Load existing entries for this period
  const existing = await apiFetch<ExistingEntry[]>(`/api/balance?period=${targetPeriod}`, { token });
  const existingMap = new Map(existing.map(e => [e.category, e.amount]));

  // Auto-fill overseas stocks from portfolio
  const autoFillMap = new Map<string, number>();
  const overseasKRW = await getOverseasStockKRW(token);
  autoFillMap.set('overseas_stock', overseasKRW);

  const assets = BALANCE_CATEGORIES.filter(c => c.type === 'asset');
  const liabilities = BALANCE_CATEGORIES.filter(c => c.type === 'liability');

  log.message(pc.bold('── ASSETS ──────────────────────────────'));
  const assetEntries = await inputCategoryGroup(assets, existingMap, autoFillMap);

  log.message(pc.bold('\n── LIABILITIES ─────────────────────────'));
  const liabilityEntries = await inputCategoryGroup(liabilities, existingMap, autoFillMap);

  const allEntries: EntryResult[] = [...assetEntries, ...liabilityEntries];

  await apiFetch('/api/balance', {
    method: 'POST',
    token,
    body: { period: targetPeriod, date, entries: allEntries },
  });

  const totalAssets = assetEntries.reduce((s, e) => s + e.amount, 0);
  const totalLiabilities = liabilityEntries.reduce((s, e) => s + e.amount, 0);
  const netWorth = totalAssets - totalLiabilities;

  const summary = [
    `${'Assets'.padEnd(16)}${totalAssets.toLocaleString('en-US')} KRW`,
    `${'Liabilities'.padEnd(16)}${totalLiabilities.toLocaleString('en-US')} KRW`,
    pc.dim('─'.repeat(36)),
    `${'Net Worth'.padEnd(16)}${pc.bold(netWorth.toLocaleString('en-US'))} KRW`,
  ].join('\n');

  note(summary, `Balance Sheet  ${targetPeriod}`);
};
