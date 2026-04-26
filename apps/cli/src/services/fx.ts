type FxRates = Record<string, number>;

let _cache: { rates: FxRates; ts: number } | null = null;

// Rates are KRW-based (1 KRW = N foreign). Cache for 60s per process.
export const fetchFxRates = async (): Promise<FxRates> => {
  const now = Date.now();
  if (_cache && now - _cache.ts < 60_000) return _cache.rates;
  const res = await fetch('https://open.er-api.com/v6/latest/KRW');
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = await res.json() as { rates: FxRates };
  _cache = { rates: data.rates, ts: now };
  return data.rates;
};
