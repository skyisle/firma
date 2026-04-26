import { aggregateHoldings, getActiveTickers } from '@firma/db';
import type { Transaction, Price } from '@firma/db';
import { createFinnhubClient } from '@firma/finnhub';
import type { EarningsItem, NewsItem } from '@firma/finnhub';
import {
  createFredClient, FX_BY_CURRENCY, assembleStressIndex, assembleRegime,
  type MacroResult,
} from '@firma/fred';
import type {
  BriefData, BriefHolding, BriefConcentration, BriefMover, BriefNewsItem,
  BriefEarnings, BriefMacro, BriefSignals, BriefInsight,
} from './types.js';

export type BriefDeps = {
  transactions: Transaction[];
  prices: Price[];
  finnhubKey: string | null;
  fredKey: string | null;
  homeCurrency: string;
};

export type AssembleOptions = {
  newsPerTicker?: number;
  moverCount?: number;
  earningsHorizonDays?: number;
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const futureStr = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const computeHHI = (slices: { value: number }[]): number => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return 0;
  return Math.round(slices.reduce((s, { value }) => {
    const p = value / total;
    return s + p * p * 10000;
  }, 0));
};

const computeConcentration = (positions: BriefHolding[]): BriefConcentration | null => {
  if (positions.length === 0) return null;

  const groupBy = (keyOf: (p: BriefHolding) => string) => {
    const map = positions.reduce((m, p) => m.set(keyOf(p), (m.get(keyOf(p)) ?? 0) + p.market_value), new Map<string, number>());
    const slices = [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const total = slices.reduce((s, x) => s + x.value, 0);
    return {
      hhi: computeHHI(slices),
      top: slices.slice(0, 5).map(s => ({ label: s.label, pct: total > 0 ? (s.value / total) * 100 : 0 })),
    };
  };

  return {
    by_ticker:   groupBy(p => p.ticker),
    by_currency: groupBy(p => p.currency),
    by_sector:   groupBy(p => p.sector  ?? 'Unknown'),
    by_country:  groupBy(p => p.country ?? 'Unknown'),
  };
};

const generateInsights = (data: Omit<BriefData, 'insights' | 'generated_at'>): BriefInsight[] => {
  const insights: BriefInsight[] = [];
  const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

  const topGainer = data.movers.winners[0];
  const topLoser  = data.movers.losers[0];
  if (topGainer && topGainer.weight_pct >= 5) {
    insights.push({
      type: 'mover_weight',
      text: `${topGainer.ticker} +${topGainer.change_percent.toFixed(2)}% is your top gainer (${topGainer.weight_pct.toFixed(1)}% portfolio weight, ${fmtUsd(topGainer.pnl_today_usd)} today)`,
    });
  }
  if (topLoser && topLoser.weight_pct >= 5) {
    insights.push({
      type: 'mover_weight',
      text: `${topLoser.ticker} ${topLoser.change_percent.toFixed(2)}% is your top loser (${topLoser.weight_pct.toFixed(1)}% portfolio weight, ${fmtUsd(topLoser.pnl_today_usd)} today)`,
    });
  }

  if (data.concentration) {
    const t = data.concentration.by_ticker;
    if (t.hhi >= 5000 && t.top[0]) {
      insights.push({
        type: 'concentration',
        text: `Single-name concentration is very high — ${t.top[0].label} represents ${t.top[0].pct.toFixed(0)}% of portfolio (HHI ${t.hhi})`,
      });
    } else if (t.hhi >= 2500 && t.top[0]) {
      insights.push({
        type: 'concentration',
        text: `${t.top[0].label} is ${t.top[0].pct.toFixed(0)}% of portfolio — high single-name exposure (HHI ${t.hhi})`,
      });
    }
    const sec = data.concentration.by_sector;
    if (sec.hhi >= 5000 && sec.top[0] && sec.top[0].label !== 'Unknown') {
      insights.push({
        type: 'concentration',
        text: `Sector concentration: ${sec.top[0].pct.toFixed(0)}% in ${sec.top[0].label} (HHI ${sec.hhi})`,
      });
    }
  }

  for (const e of data.earnings_upcoming.slice(0, 5)) {
    if (e.weight_pct != null && e.weight_pct >= 3) {
      insights.push({
        type: 'earnings_weight',
        text: `${e.symbol} earnings on ${e.date} — ${e.weight_pct.toFixed(1)}% of portfolio`,
      });
    }
  }

  if (data.macro?.fx_impact_home != null && Math.abs(data.macro.fx_impact_home) >= 1) {
    const sign = data.macro.fx_impact_home > 0 ? '+' : '−';
    const amt = Math.abs(Math.round(data.macro.fx_impact_home)).toLocaleString('en-US');
    const dir = data.macro.fx_impact_home > 0 ? 'gained' : 'cost';
    insights.push({
      type: 'fx_impact',
      text: `FX move ${dir} ${sign}${amt} ${data.macro.home_currency} on your $${Math.round(data.portfolio.total_value_usd).toLocaleString('en-US')} USD position today`,
    });
  }

  if (data.signals?.regime.bias && data.concentration) {
    const sectorTop = data.concentration.by_sector.top[0];
    if (data.signals.regime.bias === 'Risk-on bias' && sectorTop && sectorTop.pct >= 50) {
      insights.push({
        type: 'regime_context',
        text: `Risk-on regime (${data.signals.regime.bullish_count}/${data.signals.regime.bullish_count + data.signals.regime.bearish_count} signals) historically favors growth tilts — your ${sectorTop.label} concentration is ${sectorTop.pct.toFixed(0)}%`,
      });
    } else if (data.signals.regime.bias === 'Risk-off bias' && sectorTop && sectorTop.pct >= 50) {
      insights.push({
        type: 'regime_context',
        text: `Risk-off regime (${data.signals.regime.bearish_count}/${data.signals.regime.bullish_count + data.signals.regime.bearish_count} signals bearish) — concentrated ${sectorTop.label} exposure (${sectorTop.pct.toFixed(0)}%) tends to amplify drawdowns`,
      });
    }
  }

  if (data.signals?.stress.total_score != null && data.signals.stress.total_score >= 60) {
    insights.push({
      type: 'stress_context',
      text: `Economic stress is ${data.signals.stress.label?.toLowerCase()} (${data.signals.stress.total_score}/100) — historically associated with elevated cross-asset correlations`,
    });
  }

  return insights;
};

const computeHoldings = (
  txns: Transaction[],
  priceMap: Map<string, Price>,
): { holdings: BriefHolding[]; totalValue: number; totalCost: number; totalDailyChange: number; prevTotalValue: number } => {
  const aggregated = aggregateHoldings(txns);
  const holdingsArray: BriefHolding[] = [];
  let totalValue = 0;
  let totalCost = 0;
  let totalDailyChange = 0;
  let prevTotalValue = 0;

  for (const [ticker, h] of aggregated) {
    const p = priceMap.get(ticker);
    const current_price = p?.current_price ?? 0;
    const prev_close = p?.prev_close ?? current_price;
    const market_value = current_price * h.shares;
    const prev_value = prev_close * h.shares;
    const avg_price = h.costShares > 0 ? h.totalCost / h.costShares : null;
    const cost_basis = avg_price != null ? avg_price * h.costShares : 0;
    const pnl_today_usd = (current_price - prev_close) * h.shares;
    const pnl_today_pct = prev_close > 0 ? ((current_price - prev_close) / prev_close) * 100 : 0;
    const pnl_total_usd = avg_price != null ? market_value - cost_basis : null;
    const pnl_total_pct = pnl_total_usd != null && cost_basis > 0 ? (pnl_total_usd / cost_basis) * 100 : null;

    totalValue += market_value;
    totalCost += cost_basis;
    totalDailyChange += pnl_today_usd;
    prevTotalValue += prev_value;

    holdingsArray.push({
      ticker, shares: h.shares,
      current_price, prev_close, avg_price,
      market_value,
      weight_pct: 0,
      pnl_today_usd, pnl_today_pct,
      pnl_total_usd, pnl_total_pct,
      sector: p?.sector ?? null,
      country: p?.country ?? null,
      currency: p?.currency ?? 'USD',
    });
  }

  for (const h of holdingsArray) {
    h.weight_pct = totalValue > 0 ? (h.market_value / totalValue) * 100 : 0;
  }
  holdingsArray.sort((a, b) => b.market_value - a.market_value);

  return { holdings: holdingsArray, totalValue, totalCost, totalDailyChange, prevTotalValue };
};

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

const assembleBriefMacro = async (fredKey: string | null, homeCurrency: string, portfolioUsd: number): Promise<BriefMacro | null> => {
  if (!fredKey) return null;
  const homeUpper = homeCurrency.toUpperCase();
  const fx = FX_BY_CURRENCY[homeUpper];
  const indicators: { id: string; label: string; series_id: string; units: 'percent' | 'level' | 'price'; invert?: boolean }[] = [
    { id: 'vix',   label: 'VIX',                series_id: 'VIXCLS', units: 'level' },
    { id: 'ust10', label: '10Y Treasury Yield', series_id: 'DGS10',  units: 'percent' },
  ];
  if (fx) indicators.push(fx);

  const client = createFredClient(fredKey);
  const results = await Promise.all(indicators.map(ind => fetchBriefIndicator(client, ind))).catch(() => null);
  if (!results) return null;

  const fxResult = results.find(r => r.id === 'fx');
  const fx_impact_home = fxResult && fxResult.current != null && fxResult.prior_1d != null
    ? portfolioUsd * (fxResult.current - fxResult.prior_1d)
    : null;

  return { home_currency: homeUpper, indicators: results, fx_impact_home };
};

const assembleBriefSignals = async (fredKey: string | null): Promise<BriefSignals | null> => {
  if (!fredKey) return null;
  const client = createFredClient(fredKey);
  try {
    const [stress, regime] = await Promise.all([
      assembleStressIndex(client),
      assembleRegime(client),
    ]);
    return { stress, regime };
  } catch {
    return null;
  }
};

export const assembleBriefData = async (
  deps: BriefDeps,
  { newsPerTicker = 2, moverCount = 3, earningsHorizonDays = 14 }: AssembleOptions = {},
): Promise<BriefData> => {
  const date = todayStr();
  const tickers = getActiveTickers(deps.transactions);
  const priceMap = new Map(deps.prices.map(p => [p.ticker, p]));

  const { holdings, totalValue, totalCost, totalDailyChange, prevTotalValue } = computeHoldings(deps.transactions, priceMap);
  const totalPnlUsd = totalCost > 0 ? totalValue - totalCost : 0;
  const totalPnlPct = totalCost > 0 ? (totalPnlUsd / totalCost) * 100 : null;
  const dailyChangePct = prevTotalValue > 0 ? (totalDailyChange / prevTotalValue) * 100 : 0;

  const movables = holdings.filter(h => h.current_price > 0 && h.pnl_today_pct !== 0);
  const winners: BriefMover[] = [...movables].sort((a, b) => b.pnl_today_pct - a.pnl_today_pct).slice(0, moverCount)
    .filter(p => p.pnl_today_pct > 0)
    .map(p => ({
      ticker: p.ticker, change_percent: p.pnl_today_pct, current_price: p.current_price,
      weight_pct: p.weight_pct, pnl_today_usd: p.pnl_today_usd,
    }));
  const losers: BriefMover[] = [...movables].sort((a, b) => a.pnl_today_pct - b.pnl_today_pct).slice(0, moverCount)
    .filter(p => p.pnl_today_pct < 0)
    .map(p => ({
      ticker: p.ticker, change_percent: p.pnl_today_pct, current_price: p.current_price,
      weight_pct: p.weight_pct, pnl_today_usd: p.pnl_today_usd,
    }));

  let news: BriefNewsItem[] = [];
  let earnings_upcoming: BriefEarnings[] = [];
  if (deps.finnhubKey && tickers.length > 0) {
    const client = createFinnhubClient(deps.finnhubKey);
    const yest = yesterdayStr();
    const horizon = futureStr(earningsHorizonDays);

    const newsResults = await Promise.all(
      tickers.map(t =>
        client.getCompanyNews(t, yest, date)
          .then(items => items.slice(0, newsPerTicker).map((n: NewsItem): BriefNewsItem => ({
            ticker: t, headline: n.headline, summary: n.summary, source: n.source,
            published_at: n.datetime, url: n.url,
          })))
          .catch(() => [] as BriefNewsItem[]),
      ),
    );
    news = newsResults.flat().sort((a, b) => b.published_at - a.published_at);

    const weightByTicker = new Map(holdings.map(h => [h.ticker, h.weight_pct]));
    const earningsResults = await Promise.all(
      tickers.map(t =>
        client.getEarningsCalendar(date, horizon, t)
          .then(r => r.earningsCalendar ?? [])
          .catch(() => [] as EarningsItem[]),
      ),
    );
    earnings_upcoming = earningsResults.flat()
      .map(e => ({ ...e, weight_pct: weightByTicker.get(e.symbol) ?? null }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const [macro, signals] = await Promise.all([
    assembleBriefMacro(deps.fredKey, deps.homeCurrency, totalValue),
    assembleBriefSignals(deps.fredKey),
  ]);

  const concentration = computeConcentration(holdings);

  const partial: Omit<BriefData, 'insights' | 'generated_at'> = {
    date,
    portfolio: {
      total_value_usd: totalValue,
      total_cost_usd: totalCost,
      total_pnl_usd: totalPnlUsd,
      total_pnl_pct: totalPnlPct,
      daily_change_usd: totalDailyChange,
      daily_change_pct: dailyChangePct,
      holdings_count: holdings.length,
    },
    holdings,
    concentration,
    movers: { winners, losers },
    news,
    earnings_upcoming,
    macro,
    signals,
  };

  return {
    ...partial,
    generated_at: new Date().toISOString(),
    insights: generateInsights(partial),
  };
};
