import { cancel, isCancel, log, select, spinner, text } from '@clack/prompts';
import pc from 'picocolors';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

const parsePositiveFloat = (val: string) => {
  const n = parseFloat(val);
  return isNaN(n) || n <= 0 ? undefined : n;
};

const validateTicker = (val: string) => {
  if (!val.trim()) return 'Ticker is required';
  if (!/^[A-Za-z.^-]+$/.test(val.trim())) return 'Invalid ticker symbol';
};

const validatePositiveNumber = (label: string) => (val: string) => {
  if (!val.trim()) return `${label} is required`;
  if (parsePositiveFloat(val) === undefined) return 'Must be a positive number';
};

const guard = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel('Cancelled');
    process.exit(0);
  }
  return value as T;
};

const resolveCurrentPrice = async (ticker: string, token: string): Promise<number | null> => {
  const s = spinner();
  s.start('Fetching current price...');
  try {
    const { currentPrice } = await apiFetch<{ currentPrice: number }>(`/api/prices/${ticker}`, { token });
    s.stop(`Current price: $${currentPrice.toFixed(2)}`);
    return currentPrice;
  } catch {
    s.stop('Could not fetch price (enter manually)');
    return null;
  }
};

const selectTicker = async (token: string): Promise<string> => {
  const holdings = await apiFetch<Array<{ ticker: string }>>('/api/portfolio', { token });
  const activeTickers = holdings.map(h => h.ticker);

  if (activeTickers.length === 0) {
    return (guard(await text({ message: 'Ticker', placeholder: 'TSLA', validate: validateTicker })) as string)
      .trim().toUpperCase();
  }

  const options = [
    ...activeTickers.map(t => ({ value: t, label: t })),
    { value: '__new__', label: pc.dim('Enter manually...') },
  ];

  const selected = guard(await select({ message: 'Stock', options })) as string;
  if (selected !== '__new__') return selected;

  return (guard(await text({ message: 'Ticker', placeholder: 'AAPL', validate: validateTicker })) as string)
    .trim().toUpperCase();
};

export const addCommand = async () => {
  const { token } = requireAuth();

  const ticker = await selectTicker(token);
  const currentPrice = await resolveCurrentPrice(ticker, token);
  const priceHint = currentPrice ? pc.dim(` (current $${currentPrice.toFixed(2)})`) : '';

  const type = guard(await select({
    message: 'Type',
    options: [
      { value: 'buy', label: 'Buy' },
      { value: 'sell', label: 'Sell' },
    ],
  })) as 'buy' | 'sell';

  const sharesInput = guard(await text({
    message: 'Shares',
    placeholder: '10',
    validate: validatePositiveNumber('Shares'),
  })) as string;

  const priceInput = guard(await text({
    message: `Price (USD)${priceHint}`,
    placeholder: currentPrice?.toFixed(2) ?? '0.00',
    validate: validatePositiveNumber('Price'),
  })) as string;

  const today = new Date().toISOString().split('T')[0];
  const dateInput = guard(await text({
    message: 'Date',
    initialValue: today,
  })) as string;

  await apiFetch('/api/transactions', {
    method: 'POST',
    token,
    body: {
      ticker,
      type,
      shares: parsePositiveFloat(sharesInput)!,
      price: parsePositiveFloat(priceInput)!,
      currency: 'USD',
      date: dateInput.trim() || today,
    },
  });

  const typeLabel = type === 'buy' ? pc.green('Buy') : pc.red('Sell');
  log.success(`${pc.bold(ticker)} ${typeLabel} ${sharesInput} shares @ $${priceInput} (${dateInput})`);
};
