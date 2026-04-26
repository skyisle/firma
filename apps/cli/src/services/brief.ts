import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { aggregateHoldings, getActiveTickers } from '@firma/db';
import { createFinnhubClient } from '@firma/finnhub';
import type { EarningsItem, NewsItem } from '@firma/finnhub';
import { createFredClient, FX_BY_CURRENCY, type MacroResult } from '@firma/fred';
import { getRepository } from '../db/index.ts';
import { readConfig, getDefaultCurrency } from '../config.ts';

const CACHE_DIR = join(homedir(), '.firma', 'cache');

export type BriefMacro = {
  home_currency: string;
  indicators: MacroResult[];                       // VIX, 10Y, FX
  fx_impact_home: number | null;                   // portfolio_usd × (current_fx - prior_fx); null if home=USD or unavailable
};

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
  macro: BriefMacro | null;
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

  const macro = await assembleBriefMacro(totalValue);

  const data: BriefData = {
    date,
    generated_at: new Date().toISOString(),
    portfolio: { total_value_usd: totalValue, holdings_count: holdings.size },
    movers: { winners, losers },
    news,
    earnings_upcoming,
    macro,
  };

  writeCachedBrief(data);
  return data;
};

const BRIEF_INDICATOR_IDS = ['vix', 'ust10', 'fx'] as const;

const fetchBriefIndicator = async (
  client: ReturnType<typeof createFredClient>,
  ind: { id: string; label: string; series_id: string; units: 'percent' | 'level' | 'price'; invert?: boolean },
): Promise<MacroResult> => {
  const fromDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const obs = await client.fetchObservations(ind.series_id, { from: fromDate });
  const valid = obs.filter((o): o is { date: string; value: number } => o.value != null);
  if (valid.length === 0) {
    return {
      ...ind,
      current: null, prior_1d: null, prior_30d: null, prior_90d: null,
      avg_5y: null, latest_date: null, prior_date: null,
    };
  }
  const apply = ind.invert ? (v: number) => 1 / v : (v: number) => v;
  const transformed = valid.map(o => ({ date: o.date, value: apply(o.value) }));
  const latest = transformed.at(-1)!;
  const prior = transformed.length > 1 ? transformed[transformed.length - 2] : null;
  return {
    ...ind,
    current:     latest.value,
    prior_1d:    prior?.value ?? null,
    prior_30d:   null,
    prior_90d:   null,
    avg_5y:      null,
    latest_date: latest.date,
    prior_date:  prior?.date ?? null,
  };
};

const assembleBriefMacro = async (portfolioUsd: number): Promise<BriefMacro | null> => {
  const apiKey = readConfig()?.fred_api_key;
  if (!apiKey) return null;

  const homeCurrency = getDefaultCurrency().toUpperCase();
  const fx = FX_BY_CURRENCY[homeCurrency];

  const indicators: { id: string; label: string; series_id: string; units: 'percent' | 'level' | 'price'; invert?: boolean }[] = [
    { id: 'vix',   label: 'VIX',                series_id: 'VIXCLS', units: 'level' },
    { id: 'ust10', label: '10Y Treasury Yield', series_id: 'DGS10',  units: 'percent' },
  ];
  if (fx) indicators.push(fx);

  const client = createFredClient(apiKey);
  const results = await Promise.all(indicators.map(ind => fetchBriefIndicator(client, ind))).catch(() => null);
  if (!results) return null;

  const fxResult = results.find(r => r.id === 'fx');
  const fx_impact_home = fxResult && fxResult.current != null && fxResult.prior_1d != null
    ? portfolioUsd * (fxResult.current - fxResult.prior_1d)
    : null;

  return {
    home_currency: homeCurrency,
    indicators: results,
    fx_impact_home,
  };
};
