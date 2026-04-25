import type { Transaction, NewTransaction, BalanceEntry, NewBalanceEntry, FlowEntry, NewFlowEntry, Price, NewPrice } from './types.ts';

export interface TransactionRepository {
  getAll(ticker?: string): Transaction[];
  getById(id: number): Transaction | undefined;
  insert(txn: NewTransaction): void;
  update(id: number, fields: Partial<NewTransaction>): boolean;
  delete(id: number): boolean;
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
