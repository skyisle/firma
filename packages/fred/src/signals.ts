import type { FredObservation } from './types.js';

type FredClient = {
  fetchObservations: (
    seriesId: string,
    opts?: { from?: string; to?: string; limit?: number },
  ) => Promise<FredObservation[]>;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── Stress Index (port of worldmonitor's Economic Stress Index) ───────

export type StressComponent = {
  id: string;
  label: string;
  series_id: string;
  weight: number;
  raw_value: number | null;
  score: number | null;
  formula: string;
};

export type StressIndex = {
  total_score: number | null;
  label: 'Low' | 'Moderate' | 'Elevated' | 'Severe' | 'Critical' | null;
  components: StressComponent[];
};

type StressDef = {
  id: string;
  label: string;
  series_id: string;
  weight: number;
  score: (v: number) => number;
  formula: string;
};

// Weights from worldmonitor — re-normalized after dropping GSCPI (not on FRED).
// Sum = 1.0 across the remaining 5 FRED series.
const STRESS_DEFS: StressDef[] = [
  {
    id: 'yield_curve', label: 'Yield Curve (10y-2y)', series_id: 'T10Y2Y',
    weight: 0.235,
    score: v => clamp((0.5 - v) / 2.0 * 100, 0, 100),
    formula: '(0.5 − v) / 2.0 × 100',
  },
  {
    id: 'bank_spread', label: 'Bank Spread (10y-3m)', series_id: 'T10Y3M',
    weight: 0.176,
    score: v => clamp((0.5 - v) / 1.5 * 100, 0, 100),
    formula: '(0.5 − v) / 1.5 × 100',
  },
  {
    id: 'volatility', label: 'Volatility (VIX)', series_id: 'VIXCLS',
    weight: 0.235,
    score: v => clamp((v - 15) / 65 * 100, 0, 100),
    formula: '(v − 15) / 65 × 100',
  },
  {
    id: 'financial_stress', label: 'Financial Stress (STLFSI4)', series_id: 'STLFSI4',
    weight: 0.235,
    score: v => clamp((v + 1) / 6 * 100, 0, 100),
    formula: '(v + 1) / 6 × 100',
  },
  {
    id: 'job_claims', label: 'Initial Jobless Claims', series_id: 'ICSA',
    weight: 0.118,
    score: v => clamp((v - 180_000) / 320_000 * 100, 0, 100),
    formula: '(v − 180k) / 320k × 100',
  },
];

const stressLabel = (s: number): StressIndex['label'] =>
  s < 20 ? 'Low' : s < 40 ? 'Moderate' : s < 60 ? 'Elevated' : s < 80 ? 'Severe' : 'Critical';

const fetchLatest = async (client: FredClient, seriesId: string): Promise<number | null> => {
  const fromDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  try {
    const obs = await client.fetchObservations(seriesId, { from: fromDate });
    const valid = obs.filter((o): o is { date: string; value: number } => o.value != null);
    return valid.at(-1)?.value ?? null;
  } catch {
    return null;
  }
};

export const assembleStressIndex = async (client: FredClient): Promise<StressIndex> => {
  const components: StressComponent[] = await Promise.all(STRESS_DEFS.map(async (def) => {
    const raw = await fetchLatest(client, def.series_id);
    return {
      id: def.id, label: def.label, series_id: def.series_id, weight: def.weight,
      raw_value: raw,
      score: raw == null ? null : def.score(raw),
      formula: def.formula,
    };
  }));

  const present = components.filter(c => c.score != null);
  if (present.length === 0) return { total_score: null, label: null, components };

  // Re-normalize weights across present components only
  const totalWeight = present.reduce((s, c) => s + c.weight, 0);
  const total = present.reduce((s, c) => s + (c.score! * c.weight) / totalWeight, 0);
  const rounded = Math.round(total);

  return { total_score: rounded, label: stressLabel(rounded), components };
};

// ── Macro Regime (5 binary signals → bias label) ──────────────────────

export type RegimeSignal = {
  id: string;
  label: string;
  series_id: string;
  current_value: number | null;
  threshold: string;            // human-readable rule
  bullish: boolean | null;      // null = unknown / no data
  detail: string;               // e.g. "VIX 19.3 (calm, < 20)"
};

export type Regime = {
  bias: 'Risk-on bias' | 'Risk-off bias' | 'Mixed' | null;
  bullish_count: number;
  bearish_count: number;
  signals: RegimeSignal[];
};

type RegimeDef = {
  id: string;
  label: string;
  series_id: string;
  threshold: string;
  // computes bullish status from latest value(s)
  evaluate: (latest: number, observations: { date: string; value: number }[]) => { bullish: boolean | null; detail: string };
  // for "trend" signals we need history
  needs_history?: boolean;
};

const fmtNum = (n: number, digits = 2) => n.toFixed(digits);

const REGIME_DEFS: RegimeDef[] = [
  {
    id: 'vix', label: 'VIX', series_id: 'VIXCLS',
    threshold: 'VIX < 20 (calm)',
    evaluate: (v) => ({
      bullish: v < 20,
      detail: `VIX ${fmtNum(v)} (${v < 15 ? 'calm' : v < 20 ? 'moderate' : v < 30 ? 'elevated' : 'high'})`,
    }),
  },
  {
    id: 'yield_curve', label: 'Yield Curve', series_id: 'T10Y2Y',
    threshold: '10Y − 2Y > 0 (not inverted)',
    evaluate: (v) => ({
      bullish: v > 0,
      detail: `10Y − 2Y ${v >= 0 ? '+' : ''}${fmtNum(v)}% (${v > 0 ? 'normal' : 'inverted'})`,
    }),
  },
  {
    id: 'hy_spread', label: 'HY Credit Spread', series_id: 'BAMLH0A0HYM2',
    threshold: 'HY OAS < 4% (tight credit)',
    evaluate: (v) => ({
      bullish: v < 4,
      detail: `HY OAS ${fmtNum(v)}% (${v < 3 ? 'very tight' : v < 4 ? 'tight' : v < 5 ? 'normal' : 'stressed'})`,
    }),
  },
  {
    id: 'dollar_trend', label: 'USD Trend', series_id: 'DTWEXBGS',
    threshold: 'USD index 30d change < +1% (not strengthening fast)',
    needs_history: true,
    evaluate: (latest, obs) => {
      if (obs.length < 2) return { bullish: null, detail: 'USD trend (insufficient data)' };
      // find observation closest to 30 days ago
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      let prior: number | null = null;
      for (const o of obs) {
        if (o.date <= cutoff) prior = o.value;
        else break;
      }
      if (prior == null) prior = obs[0].value;
      const pct = ((latest - prior) / prior) * 100;
      return {
        bullish: pct < 1,
        detail: `USD ${pct >= 0 ? '+' : ''}${fmtNum(pct)}% 30d (${pct < -1 ? 'weak' : pct < 1 ? 'flat' : 'strengthening'})`,
      };
    },
  },
  {
    id: 'breakeven', label: 'Inflation Expectations', series_id: 'T10YIE',
    threshold: '10Y breakeven 1.8% – 2.5% (anchored)',
    evaluate: (v) => ({
      bullish: v >= 1.8 && v <= 2.5,
      detail: `Breakeven ${fmtNum(v)}% (${v < 1.8 ? 'low' : v <= 2.5 ? 'anchored' : 'elevated'})`,
    }),
  },
];

const evaluateSignal = async (
  def: RegimeDef,
  client: FredClient,
): Promise<RegimeSignal> => {
  const fromDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  let observations: { date: string; value: number }[] = [];
  let latest: number | null = null;
  try {
    const obs = await client.fetchObservations(def.series_id, { from: fromDate });
    observations = obs.filter((o): o is { date: string; value: number } => o.value != null);
    latest = observations.at(-1)?.value ?? null;
  } catch {
    /* fall through with nulls */
  }
  if (latest == null) {
    return {
      id: def.id, label: def.label, series_id: def.series_id,
      current_value: null, threshold: def.threshold, bullish: null,
      detail: `${def.label} (no data)`,
    };
  }
  const { bullish, detail } = def.evaluate(latest, observations);
  return {
    id: def.id, label: def.label, series_id: def.series_id,
    current_value: latest, threshold: def.threshold, bullish, detail,
  };
};

export const assembleRegime = async (client: FredClient): Promise<Regime> => {
  const signals = await Promise.all(REGIME_DEFS.map(def => evaluateSignal(def, client)));
  const bullish_count = signals.filter(s => s.bullish === true).length;
  const bearish_count = signals.filter(s => s.bullish === false).length;
  const known = bullish_count + bearish_count;
  let bias: Regime['bias'] = null;
  if (known >= 3) {
    const ratio = bullish_count / known;
    if      (ratio >= 0.7) bias = 'Risk-on bias';
    else if (ratio <= 0.4) bias = 'Risk-off bias';
    else                   bias = 'Mixed';
  }
  return { bias, bullish_count, bearish_count, signals };
};
