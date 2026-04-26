import type { FredObservation } from './types.js';

type FredClient = {
  fetchObservations: (
    seriesId: string,
    opts?: { from?: string; to?: string; limit?: number },
  ) => Promise<FredObservation[]>;
};

export type MacroUnit = 'percent' | 'level' | 'price';

export type MacroIndicator = {
  id: string;
  label: string;
  series_id: string;
  units: MacroUnit;
  invert?: boolean;
};

export type MacroResult = MacroIndicator & {
  current: number | null;
  prior_30d: number | null;
  prior_90d: number | null;
  avg_5y: number | null;
  latest_date: string | null;
};

export const CORE_MACRO_INDICATORS: MacroIndicator[] = [
  { id: 'vix',       label: 'VIX',                     series_id: 'VIXCLS',       units: 'level'   },
  { id: 'ust10',     label: '10Y Treasury Yield',      series_id: 'DGS10',        units: 'percent' },
  { id: 'curve',     label: 'Yield Curve (10y-2y)',    series_id: 'T10Y2Y',       units: 'percent' },
  { id: 'usd_index', label: 'USD Index (Broad)',       series_id: 'DTWEXBGS',     units: 'price'   },
  { id: 'hy_spread', label: 'HY Credit Spread',        series_id: 'BAMLH0A0HYM2', units: 'percent' },
  { id: 'breakeven', label: '10Y Breakeven Inflation', series_id: 'T10YIE',       units: 'percent' },
  { id: 'fed_funds', label: 'Fed Funds Rate',          series_id: 'FEDFUNDS',     units: 'percent' },
];

// FRED's "X/USD" series give foreign per 1 USD (no invert).
// FRED's "USD/X" series give USD per 1 foreign — invert to get foreign per 1 USD.
export const FX_BY_CURRENCY: Record<string, MacroIndicator | null> = {
  USD: null,
  KRW: { id: 'fx', label: 'KRW per USD', series_id: 'DEXKOUS', units: 'price' },
  JPY: { id: 'fx', label: 'JPY per USD', series_id: 'DEXJPUS', units: 'price' },
  CNY: { id: 'fx', label: 'CNY per USD', series_id: 'DEXCHUS', units: 'price' },
  EUR: { id: 'fx', label: 'EUR per USD', series_id: 'DEXUSEU', units: 'price', invert: true },
  GBP: { id: 'fx', label: 'GBP per USD', series_id: 'DEXUSUK', units: 'price', invert: true },
};

const fiveYearsAgoStr = (): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
};

const daysAgoStr = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const computeIndicator = async (
  ind: MacroIndicator,
  client: FredClient,
  fromDate: string,
): Promise<MacroResult> => {
  const obs = await client.fetchObservations(ind.series_id, { from: fromDate });
  const valid = obs.filter((o): o is { date: string; value: number } => o.value != null);
  if (valid.length === 0) {
    return { ...ind, current: null, prior_30d: null, prior_90d: null, avg_5y: null, latest_date: null };
  }

  const apply = ind.invert ? (v: number) => 1 / v : (v: number) => v;
  const transformed = valid.map(o => ({ date: o.date, value: apply(o.value) }));

  const findOnOrBefore = (cutoffStr: string): number | null => {
    let best: number | null = null;
    for (const o of transformed) {
      if (o.date <= cutoffStr) best = o.value;
      else break;
    }
    return best;
  };

  const latest = transformed.at(-1)!;
  return {
    ...ind,
    current:     latest.value,
    prior_30d:   findOnOrBefore(daysAgoStr(30)),
    prior_90d:   findOnOrBefore(daysAgoStr(90)),
    avg_5y:      transformed.reduce((s, o) => s + o.value, 0) / transformed.length,
    latest_date: latest.date,
  };
};

export const assembleMacroSnapshot = async (
  client: FredClient,
  homeCurrency: string,
): Promise<MacroResult[]> => {
  const fx = FX_BY_CURRENCY[homeCurrency.toUpperCase()];
  const all = fx ? [...CORE_MACRO_INDICATORS, fx] : CORE_MACRO_INDICATORS;
  const fromDate = fiveYearsAgoStr();
  return Promise.all(all.map(ind => computeIndicator(ind, client, fromDate)));
};
