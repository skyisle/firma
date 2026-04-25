import { eq, asc, desc } from 'drizzle-orm';
import { transactions, balanceEntries, flowEntries, prices } from '@firma/db';
import type {
  TransactionRepository, PriceRepository, BalanceRepository, FlowRepository, DataRepository,
  NewTransaction, NewPrice, NewBalanceEntry, NewFlowEntry,
} from '@firma/db';
import type { getDb } from './client.ts';

type Db = ReturnType<typeof getDb>;

export const createTransactionRepository = (db: Db): TransactionRepository => ({
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

export const createPriceRepository = (db: Db): PriceRepository => ({
  getAll: () => db.select().from(prices).all(),
  upsertBatch: (priceList: NewPrice[]) => {
    for (const p of priceList) {
      db.insert(prices).values(p).onConflictDoUpdate({ target: prices.ticker, set: { ...p } }).run();
    }
  },
});

export const createBalanceRepository = (db: Db): BalanceRepository => ({
  getAll: () => db.select().from(balanceEntries).all(),
  getByPeriod: (period: string) =>
    db.select().from(balanceEntries).where(eq(balanceEntries.period, period)).all(),
  getPeriods: () =>
    db.selectDistinct({ period: balanceEntries.period }).from(balanceEntries).orderBy(desc(balanceEntries.period)).all().map(r => r.period),
  upsert: (entry: NewBalanceEntry) =>
    db.insert(balanceEntries).values(entry).onConflictDoUpdate({
      target: [balanceEntries.period, balanceEntries.type, balanceEntries.sub_type, balanceEntries.category],
      set: { amount: entry.amount, date: entry.date, memo: entry.memo },
    }).run(),
  deleteByPeriod: (period: string) =>
    db.delete(balanceEntries).where(eq(balanceEntries.period, period)).run().changes,
});

export const createFlowRepository = (db: Db): FlowRepository => ({
  getAll: () => db.select().from(flowEntries).all(),
  getByPeriod: (period: string) =>
    db.select().from(flowEntries).where(eq(flowEntries.period, period)).all(),
  getPeriods: () =>
    db.selectDistinct({ period: flowEntries.period }).from(flowEntries).orderBy(desc(flowEntries.period)).all().map(r => r.period),
  upsert: (entry: NewFlowEntry) =>
    db.insert(flowEntries).values(entry).onConflictDoUpdate({
      target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
      set: { amount: entry.amount, date: entry.date, memo: entry.memo },
    }).run(),
  deleteByPeriod: (period: string) =>
    db.delete(flowEntries).where(eq(flowEntries.period, period)).run().changes,
});

export const createDataRepository = (db: Db): DataRepository => ({
  transactions: createTransactionRepository(db),
  prices: createPriceRepository(db),
  balance: createBalanceRepository(db),
  flow: createFlowRepository(db),
});
