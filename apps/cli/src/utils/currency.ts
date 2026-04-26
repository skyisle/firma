export type Currency = 'KRW' | 'USD' | 'EUR' | 'JPY' | 'CNY' | 'GBP';

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  KRW: '₩', USD: '$', EUR: '€', JPY: '¥', CNY: '¥', GBP: '£',
};

export const CURRENCY_OPTIONS: Currency[] = ['USD', 'KRW', 'EUR', 'JPY', 'CNY', 'GBP'];

// KRW-based fallback rates (1 KRW = N foreign). Used when the FX API is unreachable.
export const FALLBACK_RATES: Record<string, number> = {
  KRW: 1, USD: 0.00072, EUR: 0.00066, JPY: 0.107, CNY: 0.0052, GBP: 0.00057,
};

export const fmtAmount = (amountKrw: number, currency: Currency, rate: number) => {
  const v = amountKrw * rate;
  const sym = CURRENCY_SYMBOL[currency];
  if (currency === 'KRW') return `${sym}${Math.round(v).toLocaleString('en-US')}`;
  if (currency === 'JPY') return `${sym}${Math.round(v).toLocaleString('en-US')}`;
  return `${sym}${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

// Normalize a stored amount (in any currency) to KRW for aggregation/display.
export const entryKrw = (amount: number, storedCurrency: string, rates: Record<string, number>): number =>
  amount / (rates[storedCurrency] ?? FALLBACK_RATES[storedCurrency] ?? 1);
