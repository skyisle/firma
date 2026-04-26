import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const transactions = sqliteTable('transactions', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  ticker:   text('ticker').notNull(),
  date:     text('date').notNull(),
  type:     text('type').notNull(),
  shares:   real('shares').notNull(),
  price:    real('price').notNull(),
  currency: text('currency').notNull().default('USD'),
  memo:     text('memo'),
});

export const balanceEntries = sqliteTable('balance_entries', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  period:   text('period').notNull(),
  date:     text('date').notNull(),
  type:     text('type').notNull(),
  sub_type: text('sub_type').notNull(),
  category: text('category').notNull(),
  amount:   integer('amount').notNull().default(0),
  currency: text('currency').notNull().default('KRW'),
  memo:     text('memo'),
}, t => [uniqueIndex('balance_uq').on(t.period, t.type, t.sub_type, t.category)]);

export const flowEntries = sqliteTable('flow_entries', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  period:   text('period').notNull(),
  date:     text('date').notNull(),
  type:     text('type').notNull(),
  sub_type: text('sub_type').notNull(),
  category: text('category').notNull(),
  amount:   integer('amount').notNull().default(0),
  currency: text('currency').notNull().default('KRW'),
  memo:     text('memo'),
}, t => [uniqueIndex('flow_uq').on(t.period, t.type, t.sub_type, t.category)]);

export const portfolioSnapshots = sqliteTable('portfolio_snapshots', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  date:          text('date').notNull(),
  ticker:        text('ticker').notNull(),
  shares:        real('shares').notNull(),
  avg_price:     real('avg_price'),
  current_price: real('current_price').notNull(),
  currency:      text('currency').notNull().default('USD'),
}, t => [uniqueIndex('snapshot_uq').on(t.date, t.ticker)]);

export const prices = sqliteTable('prices', {
  ticker:         text('ticker').primaryKey(),
  name:           text('name').notNull(),
  exchange:       text('exchange').notNull().default(''),
  currency:       text('currency').notNull().default('USD'),
  current_price:  real('current_price').notNull(),
  prev_close:     real('prev_close').notNull().default(0),
  change_percent: real('change_percent').notNull().default(0),
  high_52w:       real('high_52w').notNull().default(0),
  low_52w:        real('low_52w').notNull().default(0),
  pe:             real('pe'),
  eps:            real('eps'),
  market_cap:     real('market_cap').notNull().default(0),
  sector:             text('sector'),
  country:            text('country'),
  dividend_per_share: real('dividend_per_share'),
  dividend_yield:     real('dividend_yield'),
  synced_at:          text('synced_at').notNull(),
});
