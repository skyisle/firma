import { log, spinner } from '@clack/prompts';
import { getRepository } from '../db/index.ts';
import { readConfig } from '../config.ts';
import { createPriceProvider } from '../providers/prices.ts';
import { getActiveTickers } from '@firma/db';

export const syncCommand = async ({ json = false } = {}) => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) {
    if (json) { process.stdout.write(JSON.stringify({ error: 'Finnhub API key not set. Run: firma config set finnhub-key <your-key>' }) + '\n'); process.exit(1); }
    log.error('Finnhub API key not set. Run: firma config set finnhub-key <your-key>');
    log.info('Get a free key at https://finnhub.io');
    return;
  }

  const repo = getRepository();
  const tickers = getActiveTickers(repo.transactions.getAll());
  if (tickers.length === 0) {
    if (json) { process.stdout.write(JSON.stringify({ count: 0, synced: [] }) + '\n'); return; }
    log.warn('No holdings to sync.');
    return;
  }

  const s = json ? null : spinner();
  s?.start(`Syncing ${tickers.length} stock${tickers.length > 1 ? 's' : ''}...`);

  try {
    const provider = createPriceProvider(apiKey);
    const results = await provider.getStockDataBatch(tickers);
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
        synced_at:      now,
      }));

    repo.prices.upsertBatch(priceData);

    if (json) {
      process.stdout.write(JSON.stringify({ count: priceData.length, synced: priceData }) + '\n');
    } else {
      s!.stop(`Updated ${priceData.length} stock${priceData.length !== 1 ? 's' : ''}`);
    }
  } catch (err) {
    if (json) { process.stdout.write(JSON.stringify({ error: err instanceof Error ? err.message : 'Sync failed' }) + '\n'); process.exit(1); }
    s!.stop('Sync failed');
    log.error(err instanceof Error ? err.message : 'Unknown error');
  }
};
