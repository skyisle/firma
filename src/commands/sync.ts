import { log, spinner } from '@clack/prompts';
import pc from 'picocolors';
import type { Db } from '../db/index.ts';
import { prices } from '../db/schema.ts';
import { getActiveTickers } from '../db/queries.ts';
import { createFinnhubClient } from '../services/finnhub/index.ts';
import type { StockData } from '../services/finnhub/types.ts';

const upsertPrice = (db: Db, data: StockData) =>
  db
    .insert(prices)
    .values({ ...data, syncedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: prices.ticker,
      set: {
        currentPrice: data.currentPrice,
        prevClose: data.prevClose,
        changePercent: data.changePercent,
        high52w: data.high52w,
        low52w: data.low52w,
        pe: data.pe,
        eps: data.eps,
        marketCap: data.marketCap,
        syncedAt: new Date().toISOString(),
      },
    })
    .run();

const formatChange = (pct: number) => {
  const formatted = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return pct >= 0 ? pc.green(formatted) : pc.red(formatted);
};

const printStockRow = (data: StockData) => {
  log.info(
    `${pc.bold(data.ticker.padEnd(6))}  ${pc.bold(`$${data.currentPrice.toFixed(2)}`)}  ${formatChange(data.changePercent)}`
  );
};

export const syncCommand = async (db: Db, apiKey: string) => {
  const tickers = getActiveTickers(db);

  if (tickers.length === 0) {
    log.warn('No holdings found. Run `firma add` to add stocks first.');
    return;
  }

  const s = spinner();
  s.start(`Fetching prices for ${tickers.join(', ')}...`);

  try {
    const client = createFinnhubClient(apiKey);
    const stockDataList = await client.getStockDataBatch(tickers);
    stockDataList.forEach(data => upsertPrice(db, data));
    s.stop(`Updated ${stockDataList.length} stocks`);
    stockDataList.forEach(printStockRow);
  } catch (err) {
    s.stop('Failed to fetch prices');
    throw err;
  }
};
