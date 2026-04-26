import { getActiveTickers } from '@firma/db';
import { createFinnhubClient } from '@firma/finnhub';
import { getRepository } from '../db/index.ts';
import { readConfig } from '../config.ts';

type SyncResult =
  | { ok: true; count: number; tickers: string[] }
  | { ok: false; reason: 'no-key' | 'no-holdings' | 'fetch-failed'; error?: string };

export const syncPrices = async (): Promise<SyncResult> => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) return { ok: false, reason: 'no-key' };

  const repo = getRepository();
  const tickers = getActiveTickers(repo.transactions.getAll());
  if (tickers.length === 0) return { ok: false, reason: 'no-holdings' };

  try {
    const client = createFinnhubClient(apiKey);
    const results = await client.getStockDataBatch(tickers);
    const now = new Date().toISOString();

    const priceData = results
      .filter(r => r.currentPrice > 0)
      .map(d => ({
        ticker:         d.ticker,
        name:           d.name ?? d.ticker,
        exchange:       d.exchange ?? '',
        currency:       d.currency ?? 'USD',
        current_price:  d.currentPrice,
        prev_close:     d.prevClose ?? 0,
        change_percent: d.changePercent ?? 0,
        high_52w:       d.high52w ?? 0,
        low_52w:        d.low52w ?? 0,
        pe:             d.pe ?? null,
        eps:            d.eps ?? null,
        market_cap:     d.marketCap ?? 0,
        sector:             d.sector ?? null,
        country:            d.country ?? null,
        dividend_per_share: d.dividendPerShare ?? null,
        dividend_yield:     d.dividendYield ?? null,
        synced_at:          now,
      }));

    repo.prices.upsertBatch(priceData);
    return { ok: true, count: priceData.length, tickers };
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', error: err instanceof Error ? err.message : 'Sync failed' };
  }
};
