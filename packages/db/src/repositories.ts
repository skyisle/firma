import type { Transaction, NewTransaction, BalanceEntry, NewBalanceEntry, FlowEntry, NewFlowEntry, Price, NewPrice } from './types.ts';

export interface TransactionRepository {
  getAll(ticker?: string): Transaction[];
  insert(txn: NewTransaction): void;
}

export interface PriceRepository {
  getAll(): Price[];
  upsertBatch(prices: NewPrice[]): void;
}

export interface BalanceRepository {
  getAll(): BalanceEntry[];
  getByPeriod(period: string): BalanceEntry[];
  upsert(entry: NewBalanceEntry): void;
}

export interface FlowRepository {
  getAll(): FlowEntry[];
  getByPeriod(period: string): FlowEntry[];
  upsert(entry: NewFlowEntry): void;
}

export interface DataRepository {
  transactions: TransactionRepository;
  prices: PriceRepository;
  balance: BalanceRepository;
  flow: FlowRepository;
}
