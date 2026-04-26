import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { aggregateHoldings, getActiveTickers } from '@firma/db';
import { createFinnhubClient } from '@firma/finnhub';
import type { EarningsItem, NewsItem } from '@firma/finnhub';
import { getRepository } from '../db/index.ts';
import { readConfig } from '../config.ts';

const CACHE_DIR = join(homedir(), '.firma', 'cache');

export type BriefData = {
  date: string;
  generated_at: string;
  portfolio: {
    total_value_usd: number;
    holdings_count: number;
  };
  movers: {
    winners: { ticker: string; change_percent: number; current_price: number }[];
    losers:  { ticker: string; change_percent: number; current_price: number }[];
  };
  news: { ticker: string; headline: string; source: string; published_at: number; url: string }[];
  earnings_upcoming: EarningsItem[];
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const futureStr = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const cachePath = (date: string) => join(CACHE_DIR, `brief-${date}.json`);

export const readCachedBrief = (date: string): BriefData | null => {
  const path = cachePath(date);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as BriefData; }
  catch { return null; }
};

const writeCachedBrief = (data: BriefData) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(data.date), JSON.stringify(data, null, 2));
};

export const assembleBrief = async ({ refresh = false, newsPerTicker = 2, moverCount = 3 } = {}): Promise<BriefData> => {
  const date = todayStr();
  if (!refresh) {
    const cached = readCachedBrief(date);
    if (cached) return cached;
  }

  const repo = getRepository();
  const txns = repo.transactions.getAll();
  const holdings = aggregateHoldings(txns);
  const tickers = getActiveTickers(txns);
  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p]));

  const positions = tickers.map(t => {
    const h = holdings.get(t)!;
    const p = priceMap.get(t);
    return {
      ticker: t,
      shares: h.shares,
      current_price:  p?.current_price  ?? 0,
      change_percent: p?.change_percent ?? 0,
      market_value:   (p?.current_price ?? 0) * h.shares,
    };
  });

  const totalValue = positions.reduce((s, p) => s + p.market_value, 0);
  const movables = positions.filter(p => p.current_price > 0);
  const winners = [...movables].sort((a, b) => b.change_percent - a.change_percent).slice(0, moverCount)
    .filter(p => p.change_percent > 0)
    .map(({ ticker, change_percent, current_price }) => ({ ticker, change_percent, current_price }));
  const losers  = [...movables].sort((a, b) => a.change_percent - b.change_percent).slice(0, moverCount)
    .filter(p => p.change_percent < 0)
    .map(({ ticker, change_percent, current_price }) => ({ ticker, change_percent, current_price }));

  const apiKey = readConfig()?.finnhub_api_key;
  let news: BriefData['news'] = [];
  let earnings_upcoming: EarningsItem[] = [];

  if (apiKey && tickers.length > 0) {
    const client = createFinnhubClient(apiKey);
    const yest = yesterdayStr();
    const today = date;
    const earningsHorizon = futureStr(14);

    const newsResults = await Promise.all(
      tickers.map(t =>
        client.getCompanyNews(t, yest, today)
          .then(items => items.slice(0, newsPerTicker).map((n: NewsItem) => ({
            ticker: t, headline: n.headline, source: n.source, published_at: n.datetime, url: n.url,
          })))
          .catch(() => [] as BriefData['news']),
      ),
    );
    news = newsResults.flat().sort((a, b) => b.published_at - a.published_at);

    const earningsResults = await Promise.all(
      tickers.map(t =>
        client.getEarningsCalendar(today, earningsHorizon, t)
          .then(r => r.earningsCalendar ?? [])
          .catch(() => [] as EarningsItem[]),
      ),
    );
    earnings_upcoming = earningsResults.flat().sort((a, b) => a.date.localeCompare(b.date));
  }

  const data: BriefData = {
    date,
    generated_at: new Date().toISOString(),
    portfolio: { total_value_usd: totalValue, holdings_count: holdings.size },
    movers: { winners, losers },
    news,
    earnings_upcoming,
  };

  writeCachedBrief(data);
  return data;
};
