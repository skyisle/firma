import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const prices = sqliteTable('prices', {
  ticker: text('ticker').primaryKey(),
  name: text('name').notNull(),
  exchange: text('exchange').notNull(),
  currency: text('currency').notNull(),
  currentPrice: real('current_price').notNull(),
  prevClose: real('prev_close').notNull(),
  changePercent: real('change_percent').notNull(),
  high52w: real('high_52w').notNull(),
  low52w: real('low_52w').notNull(),
  pe: real('pe'),
  eps: real('eps'),
  marketCap: real('market_cap').notNull(),
  syncedAt: text('synced_at').notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticker: text('ticker').notNull(),
  type: text('type', { enum: ['buy', 'sell'] }).notNull(),
  shares: real('shares').notNull(),
  price: real('price').notNull(),
  currency: text('currency').notNull().default('USD'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
});

export const cashFlow = sqliteTable('cash_flow', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('KRW'),
  category: text('category').notNull(),
  label: text('label'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
});
