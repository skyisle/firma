import { createFinnhubClient } from '@firma/finnhub';
import type { StockData } from '@firma/finnhub';

export type { StockData };

export type PriceProvider = {
  getStockData(ticker: string): Promise<StockData>;
  getStockDataBatch(tickers: string[]): Promise<StockData[]>;
};

// Factory — swap out the implementation here when Finnhub is unavailable
export const createPriceProvider = (apiKey: string): PriceProvider =>
  createFinnhubClient(apiKey);
