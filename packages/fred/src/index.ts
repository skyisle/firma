export type {
  FredObservation, FredSeries, FredSearchResult, FredSeriesData,
} from './types.ts';

import {
  CORE_MACRO_INDICATORS, FX_BY_CURRENCY, assembleMacroSnapshot,
} from './macro.js';
import type { MacroUnit, MacroIndicator, MacroResult } from './macro.js';

import { assembleStressIndex, assembleRegime } from './signals.js';
import type { StressIndex, StressComponent, Regime, RegimeSignal } from './signals.js';

export { CORE_MACRO_INDICATORS, FX_BY_CURRENCY, assembleMacroSnapshot };
export type { MacroUnit, MacroIndicator, MacroResult };

export { assembleStressIndex, assembleRegime };
export type { StressIndex, StressComponent, Regime, RegimeSignal };

import type {
  FredObservation, FredSeries, FredSearchResult, FredSeriesData,
} from './types.ts';

const BASE_URL = 'https://api.stlouisfed.org/fred';

type RawSeriesEntry = {
  id: string; title: string; units: string; frequency: string;
  seasonal_adjustment: string; last_updated: string;
  observation_start: string; observation_end: string;
  notes?: string; popularity?: number;
};

type RawObservation = { date: string; value: string };

const parseObservation = (o: RawObservation): FredObservation => ({
  date: o.date,
  value: o.value === '.' ? null : Number(o.value),
});

export const createFredClient = (apiKey: string) => {
  const get = <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('file_type', 'json');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return fetch(url.toString()).then(res => {
      if (!res.ok) throw new Error(`FRED error ${res.status}: ${path}`);
      return res.json() as Promise<T>;
    });
  };

  const getMetadata = async (seriesId: string): Promise<FredSeries> => {
    const data = await get<{ seriess: RawSeriesEntry[] }>('/series', { series_id: seriesId });
    const s = data.seriess[0];
    if (!s) throw new Error(`FRED series not found: ${seriesId}`);
    return {
      id: s.id, title: s.title, units: s.units, frequency: s.frequency,
      seasonal_adjustment: s.seasonal_adjustment, last_updated: s.last_updated,
      observation_start: s.observation_start, observation_end: s.observation_end,
      notes: s.notes,
    };
  };

  const fetchObservations = async (
    seriesId: string,
    { from, to, limit }: { from?: string; to?: string; limit?: number } = {},
  ): Promise<FredObservation[]> => {
    const params: Record<string, string> = { series_id: seriesId, sort_order: 'asc' };
    if (from)  params.observation_start = from;
    if (to)    params.observation_end   = to;
    if (limit) params.limit             = String(limit);
    const data = await get<{ observations: RawObservation[] }>('/series/observations', params);
    return data.observations.map(parseObservation);
  };

  const fetchSeries = async (
    seriesId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<FredSeriesData> => {
    const [series, observations] = await Promise.all([
      getMetadata(seriesId),
      fetchObservations(seriesId, opts),
    ]);
    return { series, observations };
  };

  const searchSeries = async (query: string, limit = 20): Promise<FredSearchResult[]> => {
    const data = await get<{ seriess: RawSeriesEntry[] }>('/series/search', {
      search_text: query,
      limit: String(limit),
      order_by: 'popularity',
      sort_order: 'desc',
    });
    return data.seriess.map(s => ({
      id: s.id, title: s.title, units: s.units, frequency: s.frequency,
      last_updated: s.last_updated, popularity: s.popularity ?? 0,
    }));
  };

  return { fetchSeries, fetchObservations, getMetadata, searchSeries };
};
