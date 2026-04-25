export type {
  StockData, NewsItem, InsiderTransaction, InsiderTransactionsResponse,
  EarningsItem, EarningsCalendarResponse,
  FinancialLineItem, FinancialReport, FinancialPeriod, FinancialsReportedResponse,
} from './types.ts';

import type {
  Metric, Profile, Quote, StockData,
  NewsItem, InsiderTransactionsResponse, EarningsCalendarResponse, FinancialsReportedResponse,
} from './types.ts';

const BASE_URL = 'https://finnhub.io/api/v1';

const createFinnhubFetcher = (apiKey: string) => {
  const get = <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('token', apiKey);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return fetch(url.toString()).then(res => {
      if (!res.ok) throw new Error(`Finnhub error ${res.status}: ${path}`);
      return res.json() as Promise<T>;
    });
  };

  return {
    getQuote:   (ticker: string) => get<Quote>('/quote', { symbol: ticker }),
    getProfile: (ticker: string) => get<Profile>('/stock/profile2', { symbol: ticker }),
    getMetric:  (ticker: string) => get<Metric>('/stock/metric', { symbol: ticker, metric: 'all' }),

    getCompanyNews: (ticker: string, from: string, to: string) =>
      get<NewsItem[]>('/company-news', { symbol: ticker, from, to }),

    getInsiderTransactions: (ticker: string) =>
      get<InsiderTransactionsResponse>('/stock/insider-transactions', { symbol: ticker }),

    getEarningsCalendar: (from: string, to: string, symbol?: string) => {
      const params: Record<string, string> = { from, to };
      if (symbol) params.symbol = symbol;
      return get<EarningsCalendarResponse>('/calendar/earnings', params);
    },

    getFinancialsReported: (ticker: string, freq: 'annual' | 'quarterly' = 'quarterly') =>
      get<FinancialsReportedResponse>('/stock/financials-reported', { symbol: ticker, freq }),
  };
};

const mergeStockData = (
  ticker: string,
  quote: Quote,
  profile: Profile,
  metric: Metric,
): StockData => ({
  ticker,
  name: profile.name ?? ticker,
  exchange: profile.exchange,
  currency: profile.currency,
  currentPrice: quote.c,
  prevClose: quote.pc,
  changePercent: quote.dp,
  high52w: metric.metric['52WeekHigh'],
  low52w: metric.metric['52WeekLow'],
  pe: metric.metric.peBasicExclExtraTTM ?? null,
  eps: metric.metric.epsBasicExclExtraAnnual ?? null,
  marketCap: profile.marketCapitalization,
});

export const createFinnhubClient = (apiKey: string) => {
  const fetcher = createFinnhubFetcher(apiKey);

  const getStockData = async (ticker: string): Promise<StockData> => {
    const [quote, profile, metric] = await Promise.all([
      fetcher.getQuote(ticker),
      fetcher.getProfile(ticker),
      fetcher.getMetric(ticker),
    ]);
    return mergeStockData(ticker, quote, profile, metric);
  };

  return {
    getStockData,
    getStockDataBatch: (tickers: string[]): Promise<StockData[]> =>
      Promise.all(tickers.map(getStockData)),

    getCompanyNews: fetcher.getCompanyNews,
    getInsiderTransactions: fetcher.getInsiderTransactions,
    getEarningsCalendar: fetcher.getEarningsCalendar,
    getFinancialsReported: fetcher.getFinancialsReported,
  };
};
