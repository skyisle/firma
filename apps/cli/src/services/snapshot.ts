import { aggregateHoldings } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { syncPrices } from './sync.ts';

type SnapshotResult =
  | { ok: true; date: string; count: number }
  | { ok: false; reason: 'sync-failed'; syncReason: string; error?: string }
  | { ok: false; reason: 'no-prices' };

export const takeSnapshot = async (): Promise<SnapshotResult> => {
  const syncResult = await syncPrices();
  if (!syncResult.ok) {
    return { ok: false, reason: 'sync-failed', syncReason: syncResult.reason, error: syncResult.error };
  }

  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());
  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p]));

  const date = new Date().toISOString().slice(0, 10);
  let count = 0;

  for (const [ticker, holding] of holdings) {
    const price = priceMap.get(ticker);
    if (!price) continue;
    const avgPrice = holding.costShares > 0 ? holding.totalCost / holding.costShares : null;
    repo.snapshots.upsert({
      date,
      ticker,
      shares:        holding.shares,
      avg_price:     avgPrice,
      current_price: price.current_price,
      currency:      price.currency,
    });
    count++;
  }

  if (count === 0) return { ok: false, reason: 'no-prices' };
  return { ok: true, date, count };
};
