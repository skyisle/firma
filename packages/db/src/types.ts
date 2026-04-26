import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { transactions, balanceEntries, flowEntries, prices, portfolioSnapshots } from './schema.ts';

export type Transaction    = InferSelectModel<typeof transactions>;
export type NewTransaction = InferInsertModel<typeof transactions>;
export type BalanceEntry   = InferSelectModel<typeof balanceEntries>;
export type NewBalanceEntry = InferInsertModel<typeof balanceEntries>;
export type FlowEntry      = InferSelectModel<typeof flowEntries>;
export type NewFlowEntry   = InferInsertModel<typeof flowEntries>;
export type Price          = InferSelectModel<typeof prices>;
export type NewPrice       = InferInsertModel<typeof prices>;
export type Snapshot       = InferSelectModel<typeof portfolioSnapshots>;
export type NewSnapshot    = InferInsertModel<typeof portfolioSnapshots>;

export type Holding = {
  ticker: string;
  shares: number;
  costShares: number;
  totalCost: number;
};
