import type { MacroResult, StressIndex, Regime } from '@firma/fred';
import type { EarningsItem } from '@firma/finnhub';

export type BriefHolding = {
  ticker: string;
  shares: number;
  current_price: number;
  prev_close: number;
  avg_price: number | null;
  market_value: number;
  weight_pct: number;
  pnl_today_usd: number;
  pnl_today_pct: number;
  pnl_total_usd: number | null;
  pnl_total_pct: number | null;
  sector: string | null;
  country: string | null;
  currency: string;
};

export type BriefConcentration = {
  by_ticker:   { hhi: number; top: { label: string; pct: number }[] };
  by_currency: { hhi: number; top: { label: string; pct: number }[] };
  by_sector:   { hhi: number; top: { label: string; pct: number }[] };
  by_country:  { hhi: number; top: { label: string; pct: number }[] };
};

export type BriefMover = {
  ticker: string;
  change_percent: number;
  current_price: number;
  weight_pct: number;
  pnl_today_usd: number;
};

export type BriefNewsItem = {
  ticker: string;
  headline: string;
  summary: string;
  source: string;
  published_at: number;
  url: string;
};

export type BriefMacro = {
  home_currency: string;
  indicators: MacroResult[];
  fx_impact_home: number | null;
};

export type BriefSignals = {
  stress: StressIndex;
  regime: Regime;
};

export type BriefInsight = {
  type: 'mover_weight' | 'concentration' | 'earnings_weight' | 'fx_impact' | 'regime_context' | 'stress_context' | 'price_milestone';
  text: string;
};

export type BriefEarnings = EarningsItem & { weight_pct: number | null };

export type BriefData = {
  date: string;
  generated_at: string;
  portfolio: {
    total_value_usd: number;
    total_cost_usd: number;
    total_pnl_usd: number;
    total_pnl_pct: number | null;
    daily_change_usd: number;
    daily_change_pct: number;
    holdings_count: number;
  };
  holdings: BriefHolding[];
  concentration: BriefConcentration | null;
  movers: { winners: BriefMover[]; losers: BriefMover[] };
  news: BriefNewsItem[];
  earnings_upcoming: BriefEarnings[];
  macro: BriefMacro | null;
  signals: BriefSignals | null;
  insights: BriefInsight[];
};
