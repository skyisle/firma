import { cancel, isCancel, log, select, spinner, text } from '@clack/prompts';
import pc from 'picocolors';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { prices, transactions } from '../db/schema.ts';
import { getActiveTickers } from '../db/queries.ts';
import { createFinnhubClient } from '@firma/finnhub';

// ── helpers ───────────────────────────────────────────────────────────────────

const parsePositiveFloat = (val: string) => {
  const n = parseFloat(val);
  return isNaN(n) || n <= 0 ? undefined : n;
};

const validateTicker = (val: string) => {
  if (!val.trim()) return '티커를 입력해주세요';
  if (!/^[A-Za-z.^-]+$/.test(val.trim())) return '유효하지 않은 티커예요';
};

const validatePositiveNumber = (label: string) => (val: string) => {
  if (!val.trim()) return `${label}을 입력해주세요`;
  if (parsePositiveFloat(val) === undefined) return '0보다 큰 숫자를 입력해주세요';
};

const guard = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel('취소됐어요');
    process.exit(0);
  }
  return value as T;
};

// ── current price resolution ──────────────────────────────────────────────────

const resolveCurrentPrice = async (
  db: Db,
  ticker: string,
  apiKey: string,
): Promise<number | null> => {
  const cached = db.select({ currentPrice: prices.currentPrice })
    .from(prices)
    .where(eq(prices.ticker, ticker))
    .get();

  if (cached) return cached.currentPrice;

  const s = spinner();
  s.start('현재가 조회 중...');
  try {
    const client = createFinnhubClient(apiKey);
    const data = await client.getStockData(ticker);
    s.stop(`현재가: $${data.currentPrice.toFixed(2)}`);
    return data.currentPrice;
  } catch {
    s.stop('현재가 조회 실패 (직접 입력해주세요)');
    return null;
  }
};

// ── ticker selection ──────────────────────────────────────────────────────────

const selectTicker = async (db: Db): Promise<string> => {
  const activeTickers = getActiveTickers(db);

  if (activeTickers.length === 0) {
    return (guard(await text({ message: '티커', placeholder: 'TSLA', validate: validateTicker })) as string)
      .trim()
      .toUpperCase();
  }

  const options = [
    ...activeTickers.map(t => ({ value: t, label: t })),
    { value: '__new__', label: pc.dim('직접 입력...') },
  ];

  const selected = guard(await select({ message: '종목', options })) as string;

  if (selected !== '__new__') return selected;

  return (guard(await text({ message: '티커', placeholder: 'AAPL', validate: validateTicker })) as string)
    .trim()
    .toUpperCase();
};

// ── entry ─────────────────────────────────────────────────────────────────────

export const addCommand = async (db: Db, apiKey: string) => {
  const ticker = await selectTicker(db);
  const currentPrice = await resolveCurrentPrice(db, ticker, apiKey);
  const priceHint = currentPrice ? pc.dim(` (현재가 $${currentPrice.toFixed(2)})`) : '';

  const type = guard(await select({
    message: '거래 유형',
    options: [
      { value: 'buy', label: '매수' },
      { value: 'sell', label: '매도' },
    ],
  })) as 'buy' | 'sell';

  const sharesInput = guard(await text({
    message: '수량',
    placeholder: '10',
    validate: validatePositiveNumber('수량'),
  })) as string;

  const priceInput = guard(await text({
    message: `단가 (USD)${priceHint}`,
    placeholder: currentPrice?.toFixed(2) ?? '0.00',
    validate: validatePositiveNumber('단가'),
  })) as string;

  const today = new Date().toISOString().split('T')[0];
  const dateInput = guard(await text({
    message: '거래일',
    initialValue: today,
  })) as string;

  db.insert(transactions).values({
    ticker,
    type,
    shares: parsePositiveFloat(sharesInput)!,
    price: parsePositiveFloat(priceInput)!,
    currency: 'USD',
    date: dateInput.trim() || today,
    createdAt: new Date().toISOString(),
  }).run();

  const typeLabel = type === 'buy' ? pc.green('매수') : pc.red('매도');
  log.success(`${pc.bold(ticker)} ${typeLabel} ${sharesInput}주 @ $${priceInput} (${dateInput})`);
};
