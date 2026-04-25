import { cancel, isCancel, log, select, spinner, text } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { getActiveTickers } from '../services/portfolio.ts';

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
  if (isCancel(value)) { cancel('Cancelled'); process.exit(0); }
  return value as T;
};

const selectTicker = async (): Promise<string> => {
  const repo = getRepository();
  const activeTickers = getActiveTickers(repo.transactions.getAll());

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
  const ticker = await selectTicker();

  const repo = getRepository();
  const priceRow = repo.prices.getAll().find(p => p.ticker === ticker);

  const s = spinner();
  s.start('Looking up cached price...');
  const currentPrice = priceRow?.current_price ?? null;
  s.stop(currentPrice ? `Current price: $${currentPrice.toFixed(2)}` : 'No cached price (run `firma sync` first, or enter manually)');

  const priceHint = currentPrice ? pc.dim(` (current $${currentPrice.toFixed(2)})`) : '';

  const type = guard(await select({
    message: 'Type',
    options: [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }],
  })) as 'buy' | 'sell';

  const sharesInput = guard(await text({
    message: 'Shares', placeholder: '10', validate: validatePositiveNumber('Shares'),
  })) as string;

  const priceInput = guard(await text({
    message: `Price (USD)${priceHint}`,
    placeholder: currentPrice?.toFixed(2) ?? '0.00',
    validate: validatePositiveNumber('Price'),
  })) as string;

  const today = new Date().toISOString().split('T')[0];
  const dateInput = guard(await text({ message: 'Date', initialValue: today })) as string;

  repo.transactions.insert({
    ticker,
    type,
    shares: parsePositiveFloat(sharesInput)!,
    price: parsePositiveFloat(priceInput)!,
    currency: 'USD',
    date: dateInput.trim() || today,
  });

  const typeLabel = type === 'buy' ? pc.green('Buy') : pc.red('Sell');
  log.success(`${pc.bold(ticker)} ${typeLabel} ${sharesInput} shares @ $${priceInput} (${dateInput})`);
};
