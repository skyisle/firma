import type { FxRepository } from '@firma/db';
import { FALLBACK_RATES, type Currency } from './currency.ts';

// Convert a USD amount to display currency using the historical FX rate at `date`.
// Falls back to live rates if the cache doesn't have the date (and live rates are provided).
// Returns null only if no rate is available from any source.
export const usdToDisplayAtDate = (
  usdAmount: number,
  date: string,
  targetCurrency: Currency,
  fxRepo: FxRepository,
  liveRates?: Record<string, number>,
): number | null => {
  if (targetCurrency === 'USD') return usdAmount;

  const cached = fxRepo.getRateOnOrBefore(date, targetCurrency);
  if (cached) return usdAmount * cached.rate_to_usd;

  if (!liveRates) return null;
  const liveTarget = liveRates[targetCurrency] ?? FALLBACK_RATES[targetCurrency];
  const liveUsd    = liveRates['USD']           ?? FALLBACK_RATES['USD'];
  if (!liveTarget || !liveUsd) return null;
  return usdAmount * liveTarget / liveUsd;
};

// Convert a stored amount (in any currency) to USD using historical FX rate at `date`.
// USD passthrough. Falls back to live rates if cache misses.
export const storedToUsdAtDate = (
  amount: number,
  storedCurrency: string,
  date: string,
  fxRepo: FxRepository,
  liveRates?: Record<string, number>,
): number | null => {
  const cur = storedCurrency.toUpperCase();
  if (cur === 'USD') return amount;

  const cached = fxRepo.getRateOnOrBefore(date, cur);
  if (cached) return amount / cached.rate_to_usd;

  if (!liveRates) return null;
  const liveStored = liveRates[cur]   ?? FALLBACK_RATES[cur];
  const liveUsd    = liveRates['USD'] ?? FALLBACK_RATES['USD'];
  if (!liveStored || !liveUsd) return null;
  return amount * liveUsd / liveStored;
};
