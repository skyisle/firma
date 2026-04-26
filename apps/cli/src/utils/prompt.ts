import { cancel, isCancel, select } from '@clack/prompts';
import { CURRENCY_OPTIONS, CURRENCY_SYMBOL, type Currency } from './currency.ts';
import { getDefaultCurrency } from '../config.ts';

export const guard = <T>(value: T | symbol): T => {
  if (isCancel(value)) { cancel('Cancelled'); process.exit(0); }
  return value as T;
};

export const pickDisplayCurrency = async (explicit: string | undefined, json: boolean): Promise<Currency> => {
  if (json || explicit) return ((explicit ?? getDefaultCurrency()) as string).toUpperCase() as Currency;
  return guard(await select({
    message: 'Display currency',
    options: CURRENCY_OPTIONS.map(c => ({ value: c, label: `${c}  (${CURRENCY_SYMBOL[c]})` })),
    initialValue: getDefaultCurrency().toUpperCase() as Currency,
  })) as Currency;
};

export const pickInputCurrency = async (): Promise<Currency> =>
  guard(await select({
    message: 'Enter amounts in',
    options: CURRENCY_OPTIONS.map(c => ({ value: c, label: `${c}  (${CURRENCY_SYMBOL[c]})` })),
    initialValue: getDefaultCurrency().toUpperCase() as Currency,
  })) as Currency;
