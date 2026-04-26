import { log, select, text } from '@clack/prompts';
import pc from 'picocolors';
import { getActiveTickers } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { guard, todayLocal } from '../utils/index.ts';

type TxnType = 'buy' | 'sell' | 'deposit' | 'dividend' | 'tax';

const parsePositiveFloat = (val: string) => {
  const n = parseFloat(val);
  return isNaN(n) || n <= 0 ? undefined : n;
};

const parseNonNegativeFloat = (val: string) => {
  const n = parseFloat(val);
  return isNaN(n) || n < 0 ? undefined : n;
};

const validateTicker = (val: string) => {
  if (!val.trim()) return 'Ticker is required';
  if (!/^[A-Za-z.^-]+$/.test(val.trim())) return 'Invalid ticker symbol';
};

const validatePositive = (label: string) => (val: string) => {
  if (!val.trim()) return `${label} is required`;
  if (parsePositiveFloat(val) === undefined) return 'Must be a positive number';
};

const validateNonNegative = (label: string) => (val: string) => {
  if (!val.trim()) return `${label} is required`;
  if (parseNonNegativeFloat(val) === undefined) return 'Must be a non-negative number';
};

const validateDate = (val: string) => {
  if (!val.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return 'Use YYYY-MM-DD format';
  const d = new Date(val.trim());
  if (isNaN(d.getTime())) return 'Invalid date';
};

const promptTicker = async (label: string, suggestions: string[], allowManual = true): Promise<string> => {
  if (suggestions.length === 0) {
    return (guard(await text({ message: label, placeholder: 'TSLA', validate: validateTicker })) as string)
      .trim().toUpperCase();
  }

  const options = [
    ...suggestions.map(t => ({ value: t, label: t })),
    ...(allowManual ? [{ value: '__new__', label: pc.dim('Enter manually...') }] : []),
  ];

  const selected = guard(await select({ message: label, options })) as string;
  if (selected !== '__new__') return selected;

  return (guard(await text({ message: label, placeholder: 'AAPL', validate: validateTicker })) as string)
    .trim().toUpperCase();
};

const promptDate = async () => {
  const today = todayLocal();
  const dateInput = (guard(await text({ message: 'Date', initialValue: today, validate: validateDate })) as string).trim();
  return dateInput || today;
};

const TYPE_OPTIONS: { value: TxnType; label: string; hint: string }[] = [
  { value: 'buy',      label: 'Buy',      hint: 'Add shares with cost basis' },
  { value: 'sell',     label: 'Sell',     hint: 'Reduce shares' },
  { value: 'deposit',  label: 'Deposit',  hint: 'Receive shares (transfer or grant)' },
  { value: 'dividend', label: 'Dividend', hint: 'Cash dividend received' },
  { value: 'tax',      label: 'Tax',      hint: 'Tax withheld or paid' },
];

export const addTxnCommand = async () => {
  const repo = getRepository();
  const activeTickers = getActiveTickers(repo.transactions.getAll());

  const type = guard(await select({
    message: 'Type',
    options: TYPE_OPTIONS.map(({ value, label, hint }) => ({ value, label, hint })),
  })) as TxnType;

  const ticker = type === 'sell'
    ? await promptTicker('Stock', activeTickers, false)
    : await promptTicker('Stock', activeTickers, true);

  if (type === 'sell' && !activeTickers.includes(ticker)) {
    log.error(`No holdings of ${ticker} to sell.`);
    process.exit(1);
  }

  const priceRow = repo.prices.getAll().find(p => p.ticker === ticker);
  const currentPrice = priceRow?.current_price ?? null;
  const priceHint = currentPrice ? pc.dim(` (current $${currentPrice.toFixed(2)})`) : '';

  let shares: number;
  let price: number;

  if (type === 'buy' || type === 'sell') {
    const sharesInput = guard(await text({
      message: 'Shares', placeholder: '10', validate: validatePositive('Shares'),
    })) as string;
    const priceInput = guard(await text({
      message: `Price (USD)${priceHint}`,
      placeholder: currentPrice?.toFixed(2) ?? '0.00',
      validate: validatePositive('Price'),
    })) as string;
    shares = parsePositiveFloat(sharesInput)!;
    price  = parsePositiveFloat(priceInput)!;
  } else if (type === 'deposit') {
    const sharesInput = guard(await text({
      message: 'Shares', placeholder: '10', validate: validatePositive('Shares'),
    })) as string;
    const priceInput = guard(await text({
      message: `Cost basis per share (USD, 0 if grant)${priceHint}`,
      placeholder: '0',
      validate: validateNonNegative('Cost basis'),
    })) as string;
    shares = parsePositiveFloat(sharesInput)!;
    price  = parseNonNegativeFloat(priceInput)!;
  } else {
    const amountInput = guard(await text({
      message: type === 'dividend' ? 'Dividend amount (USD)' : 'Tax amount (USD)',
      placeholder: '50.00',
      validate: validatePositive('Amount'),
    })) as string;
    shares = 1;
    price  = parsePositiveFloat(amountInput)!;
  }

  const date = await promptDate();

  repo.transactions.insert({
    ticker, type, shares, price, currency: 'USD', date,
  });

  const colors: Record<TxnType, (s: string) => string> = {
    buy: pc.green, sell: pc.red, deposit: pc.cyan, dividend: pc.yellow, tax: pc.magenta,
  };
  const label = colors[type](TYPE_OPTIONS.find(o => o.value === type)!.label);
  const summary = (type === 'dividend' || type === 'tax')
    ? `${pc.bold(ticker)} ${label} $${price.toFixed(2)} (${date})`
    : `${pc.bold(ticker)} ${label} ${shares} shares @ $${price.toFixed(2)} (${date})`;
  log.success(summary);
};
