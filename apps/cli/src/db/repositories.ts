import { eq, asc, desc, and, gte, lte } from 'drizzle-orm';
import { transactions, balanceEntries, flowEntries, prices, portfolioSnapshots } from '@firma/db';
import type {
  TransactionRepository, PriceRepository, BalanceRepository, FlowRepository, SnapshotRepository, DataRepository,
  NewTransaction, NewPrice, NewBalanceEntry, NewFlowEntry, NewSnapshot,
} from '@firma/db';
import type { getDb } from './client.ts';

type Db = ReturnType<typeof getDb>;

const createTransactionRepository = (db: Db): TransactionRepository => ({
  getAll: (ticker?: string) =>
    ticker
      ? db.select().from(transactions).where(eq(transactions.ticker, ticker.toUpperCase())).orderBy(asc(transactions.date)).all()
      : db.select().from(transactions).orderBy(asc(transactions.date)).all(),
  getById: (id: number) =>
    db.select().from(transactions).where(eq(transactions.id, id)).get(),
  insert: (txn: NewTransaction) => db.insert(transactions).values(txn).run(),
  update: (id: number, fields: Partial<NewTransaction>) => {
    const res = db.update(transactions).set(fields).where(eq(transactions.id, id)).run();
    return res.changes > 0;
  },
  delete: (id: number) => {
    const res = db.delete(transactions).where(eq(transactions.id, id)).run();
    return res.changes > 0;
  },
});

const createPriceRepository = (db: Db): PriceRepository => ({
  getAll: () => db.select().from(prices).all(),
  upsertBatch: (priceList: NewPrice[]) => {
    for (const p of priceList) {
      db.insert(prices).values(p).onConflictDoUpdate({ target: prices.ticker, set: { ...p } }).run();
    }
  },
});

const createBalanceRepository = (db: Db): BalanceRepository => ({
  getAll: () => db.select().from(balanceEntries).all(),
  getByPeriod: (period: string) =>
    db.select().from(balanceEntries).where(eq(balanceEntries.period, period)).all(),
  getPeriods: () =>
    db.selectDistinct({ period: balanceEntries.period }).from(balanceEntries).orderBy(desc(balanceEntries.period)).all().map(r => r.period),
  upsert: (entry: NewBalanceEntry) =>
    db.insert(balanceEntries).values(entry).onConflictDoUpdate({
      target: [balanceEntries.period, balanceEntries.type, balanceEntries.sub_type, balanceEntries.category],
      set: { amount: entry.amount, currency: entry.currency, date: entry.date, memo: entry.memo },
    }).run(),
  deleteByPeriod: (period: string) =>
    db.delete(balanceEntries).where(eq(balanceEntries.period, period)).run().changes,
});

const createFlowRepository = (db: Db): FlowRepository => ({
  getAll: () => db.select().from(flowEntries).all(),
  getByPeriod: (period: string) =>
    db.select().from(flowEntries).where(eq(flowEntries.period, period)).all(),
  getPeriods: () =>
    db.selectDistinct({ period: flowEntries.period }).from(flowEntries).orderBy(desc(flowEntries.period)).all().map(r => r.period),
  upsert: (entry: NewFlowEntry) =>
    db.insert(flowEntries).values(entry).onConflictDoUpdate({
      target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
      set: { amount: entry.amount, currency: entry.currency, date: entry.date, memo: entry.memo },
    }).run(),
  deleteByPeriod: (period: string) =>
    db.delete(flowEntries).where(eq(flowEntries.period, period)).run().changes,
});

const createSnapshotRepository = (db: Db): SnapshotRepository => ({
  getDates: () =>
    db.selectDistinct({ date: portfolioSnapshots.date }).from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.date)).all().map(r => r.date),
  getAll: (from?: string, to?: string) => {
    const conditions = [
      from ? gte(portfolioSnapshots.date, from) : undefined,
      to   ? lte(portfolioSnapshots.date, to)   : undefined,
    ].filter(Boolean) as Parameters<typeof and>;
    return conditions.length
      ? db.select().from(portfolioSnapshots).where(and(...conditions)).orderBy(asc(portfolioSnapshots.date)).all()
      : db.select().from(portfolioSnapshots).orderBy(asc(portfolioSnapshots.date)).all();
  },
  getByDate: (date: string) =>
    db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.date, date)).all(),
  getByTicker: (ticker: string) =>
    db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.ticker, ticker)).orderBy(asc(portfolioSnapshots.date)).all(),
  upsert: (entry: NewSnapshot) =>
    db.insert(portfolioSnapshots).values(entry).onConflictDoUpdate({
      target: [portfolioSnapshots.date, portfolioSnapshots.ticker],
      set: { shares: entry.shares, avg_price: entry.avg_price, current_price: entry.current_price },
    }).run(),
  update: (date: string, ticker: string, fields) => {
    const res = db.update(portfolioSnapshots).set(fields).where(
      and(eq(portfolioSnapshots.date, date), eq(portfolioSnapshots.ticker, ticker)),
    ).run();
    return res.changes > 0;
  },
  deleteByDate: (date: string) =>
    db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.date, date)).run().changes,
});

export const createDataRepository = (db: Db): DataRepository => ({
  transactions: createTransactionRepository(db),
  prices: createPriceRepository(db),
  balance: createBalanceRepository(db),
  flow: createFlowRepository(db),
  snapshots: createSnapshotRepository(db),
});
