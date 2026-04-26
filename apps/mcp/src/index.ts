#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { eq, asc, desc, and, gte, lte, sql } from 'drizzle-orm';
import { createFinnhubClient } from '@firma/finnhub';
import type { FinancialLineItem, FinancialPeriod } from '@firma/finnhub';
import { createFredClient, assembleMacroSnapshot, assembleStressIndex, assembleRegime, FX_BY_CURRENCY } from '@firma/fred';
import { assembleBriefData } from '@firma/brief';
import {
  getDb, getFinnhubKey, getFredKey,
  transactions, balanceEntries, flowEntries, prices, portfolioSnapshots, fxRates,
  aggregateHoldings, getActiveTickers,
} from './db.ts';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const server = new McpServer({
  name: 'firma',
  version: '0.10.0',
});


const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (msg: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${msg}` }],
  isError: true,
});


server.tool(
  'show_portfolio',
  'Get current stock holdings with average cost and cached prices',
  {},
  async () => {
    const db = getDb();
    const txns = db.select().from(transactions).all();
    const priceMap = new Map(db.select().from(prices).all().map(p => [p.ticker, p]));

    const holdings = [...aggregateHoldings(txns).entries()].map(([ticker, h]) => {
      const p = priceMap.get(ticker);
      const avgPrice = h.costShares > 0 ? h.totalCost / h.costShares : null;
      const costBasis = avgPrice != null ? avgPrice * h.costShares : 0;
      const marketValue = p ? p.current_price * h.shares : null;
      return {
        ticker, shares: h.shares, avgPrice, costBasis,
        currentPrice: p?.current_price ?? null,
        marketValue,
        pnl:    marketValue != null ? marketValue - costBasis : null,
        pnlPct: marketValue != null && costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : null,
        name:     p?.name ?? null,
        syncedAt: p?.synced_at ?? null,
      };
    });

    return ok(holdings);
  },
);

server.tool(
  'show_txns',
  'List transactions, optionally filtered by ticker symbol',
  { ticker: z.string().optional().describe('Filter by ticker (e.g. AAPL)') },
  async ({ ticker }) => {
    const db = getDb();
    const rows = ticker
      ? db.select().from(transactions).where(eq(transactions.ticker, ticker.toUpperCase())).orderBy(asc(transactions.date)).all()
      : db.select().from(transactions).orderBy(asc(transactions.date)).all();
    return ok(rows);
  },
);

server.tool(
  'show_balance',
  'Get balance sheet entries (assets and liabilities). Optionally filter by period (YYYY-MM)',
  { period: z.string().optional().describe('Period filter e.g. "2025-03"') },
  async ({ period }) => {
    const db = getDb();
    const rows = period
      ? db.select().from(balanceEntries).where(eq(balanceEntries.period, period)).all()
      : db.select().from(balanceEntries).all();
    return ok(rows);
  },
);

server.tool(
  'show_flow',
  'Get cash flow entries (income and expenses). Optionally filter by period (YYYY-MM)',
  { period: z.string().optional().describe('Period filter e.g. "2025-03"') },
  async ({ period }) => {
    const db = getDb();
    const rows = period
      ? db.select().from(flowEntries).where(eq(flowEntries.period, period)).all()
      : db.select().from(flowEntries).all();
    return ok(rows);
  },
);

server.tool(
  'report_balance',
  'Aggregate balance sheet entries by period. Returns monthly net worth trend sorted by period.',
  { limit: z.number().int().min(1).max(120).default(36).describe('Max number of periods to return (default: 36)') },
  async ({ limit }) => {
    const db = getDb();
    const rows = db.select().from(balanceEntries).all();

    const byPeriod = rows.reduce((map, { period, type, amount }) => {
      const prev = map.get(period) ?? { assets: 0, liabilities: 0 };
      map.set(period, {
        assets:      prev.assets      + (type === 'asset'     ? amount : 0),
        liabilities: prev.liabilities + (type === 'liability' ? amount : 0),
      });
      return map;
    }, new Map<string, { assets: number; liabilities: number }>());

    const result = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit)
      .map(([period, { assets, liabilities }]) => ({
        period, assets, liabilities, net_worth: assets - liabilities,
      }));

    return ok(result);
  },
);

server.tool(
  'report_flow',
  'Aggregate cash flow entries by period. Returns monthly income, expenses, net flow, and savings rate sorted by period.',
  { limit: z.number().int().min(1).max(120).default(36).describe('Max number of periods to return (default: 36)') },
  async ({ limit }) => {
    const db = getDb();
    const rows = db.select().from(flowEntries).all();

    const byPeriod = rows.reduce((map, { period, type, amount }) => {
      const prev = map.get(period) ?? { income: 0, expenses: 0 };
      map.set(period, {
        income:   prev.income   + (type === 'income'  ? amount : 0),
        expenses: prev.expenses + (type === 'expense' ? amount : 0),
      });
      return map;
    }, new Map<string, { income: number; expenses: number }>());

    const result = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit)
      .map(([period, { income, expenses }]) => ({
        period, income, expenses,
        net_flow: income - expenses,
        savings_rate: income > 0 ? ((income - expenses) / income) * 100 : null,
      }));

    return ok(result);
  },
);

server.tool(
  'report_settle',
  'Read-only summary for a period: balance sheet + cash flow entries with computed totals (net_worth, net_flow). Use this to review month-end settlement results after entries are recorded via add_balance / add_flow. Defaults to the current month.',
  { period: z.string().optional().describe('Period in YYYY-MM format (defaults to current month)') },
  async ({ period }) => {
    const db = getDb();
    const targetPeriod = period ?? new Date().toISOString().slice(0, 7);

    const balEntries = db.select().from(balanceEntries).where(eq(balanceEntries.period, targetPeriod)).all();
    const flowEnts   = db.select().from(flowEntries).where(eq(flowEntries.period, targetPeriod)).all();

    const sumBy = (entries: typeof balEntries | typeof flowEnts, type: string) =>
      entries.filter(e => e.type === type).reduce((s, e) => s + e.amount, 0);

    const total_assets      = sumBy(balEntries, 'asset');
    const total_liabilities = sumBy(balEntries, 'liability');
    const total_income      = sumBy(flowEnts, 'income');
    const total_expenses    = sumBy(flowEnts, 'expense');

    return ok({
      period: targetPeriod,
      balance: {
        entries: balEntries,
        total_assets, total_liabilities,
        net_worth: total_assets - total_liabilities,
      },
      flow: {
        entries: flowEnts,
        total_income, total_expenses,
        net_flow: total_income - total_expenses,
      },
    });
  },
);

server.tool(
  'report_combined',
  'Both balance sheet and cash flow trends in one call. Equivalent to calling report_balance and report_flow with the same limit.',
  { limit: z.number().int().min(1).max(120).default(36).describe('Max number of periods per report (default: 36)') },
  async ({ limit }) => {
    const db = getDb();
    const balRows = db.select().from(balanceEntries).all();
    const flowRows = db.select().from(flowEntries).all();

    const aggBal = [...balRows.reduce((map, { period, type, amount }) => {
      const prev = map.get(period) ?? { assets: 0, liabilities: 0 };
      return map.set(period, {
        assets:      prev.assets      + (type === 'asset'     ? amount : 0),
        liabilities: prev.liabilities + (type === 'liability' ? amount : 0),
      });
    }, new Map<string, { assets: number; liabilities: number }>()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit)
      .map(([period, { assets, liabilities }]) => ({
        period, assets, liabilities, net_worth: assets - liabilities,
      }));

    const aggFlow = [...flowRows.reduce((map, { period, type, amount }) => {
      const prev = map.get(period) ?? { income: 0, expenses: 0 };
      return map.set(period, {
        income:   prev.income   + (type === 'income'  ? amount : 0),
        expenses: prev.expenses + (type === 'expense' ? amount : 0),
      });
    }, new Map<string, { income: number; expenses: number }>()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-limit)
      .map(([period, { income, expenses }]) => ({
        period, income, expenses,
        net_flow: income - expenses,
        savings_rate: income > 0 ? ((income - expenses) / income) * 100 : null,
      }));

    return ok({ balance: aggBal, flow: aggFlow });
  },
);

server.tool(
  'show_prices',
  'Get cached stock prices for all synced tickers',
  {},
  async () => {
    const db = getDb();
    return ok(db.select().from(prices).all());
  },
);

server.tool(
  'get_brief',
  'Daily portfolio brief — the richest single tool for daily check-ins. Returns: full holdings list with weights and per-position daily P&L; ticker/currency/sector/country concentration (HHI) with top contributors; today\'s movers tagged with portfolio weight; recent news with summaries; upcoming earnings tagged with portfolio weight; macro context (VIX, 10Y, FX with home-currency portfolio impact); macro signals (Stress 0-100, Regime bias from 5 signals); pre-computed insights array cross-referencing portfolio composition with macro state. Cached per day on disk.',
  {
    refresh: z.boolean().default(false).describe('Force regenerate, bypass today\'s cache'),
    home_currency: z.string().default('USD').describe('User\'s home currency for FX context (USD/KRW/EUR/JPY/CNY/GBP). USD = no FX line.'),
  },
  async ({ refresh, home_currency }) => {
    const today = new Date().toISOString().slice(0, 10);
    const cacheDir = `${process.env.HOME ?? ''}/.firma/cache`;
    const cachePath = `${cacheDir}/brief-${today}.json`;
    const fs = await import('fs');

    if (!refresh && fs.existsSync(cachePath)) {
      try { return ok(JSON.parse(fs.readFileSync(cachePath, 'utf-8'))); }
      catch { /* fall through to regen */ }
    }

    const db = getDb();
    const data = await assembleBriefData({
      transactions: db.select().from(transactions).all(),
      prices:       db.select().from(prices).all(),
      finnhubKey:   getFinnhubKey() ?? null,
      fredKey:      getFredKey() ?? null,
      homeCurrency: home_currency,
    });

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    return ok(data);
  },
);

server.tool(
  'show_concentration',
  'Portfolio concentration measured by Herfindahl-Hirschman Index (HHI) across ticker, currency, sector, and country dimensions. HHI ranges 0–10000; >2500 is high, >5000 very high. Returns top contributors per dimension.',
  {},
  async () => {
    const db = getDb();
    const txns = db.select().from(transactions).all();
    const holdings = aggregateHoldings(txns);
    if (holdings.size === 0) return ok({});

    const priceMap = new Map(db.select().from(prices).all().map(p => [p.ticker, p]));

    const positions = [...holdings.entries()].map(([ticker, h]) => {
      const p = priceMap.get(ticker);
      const marketValue = p ? p.current_price * h.shares : 0;
      return {
        ticker, marketValue,
        currency: p?.currency ?? 'USD',
        sector:   p?.sector   ?? 'Unknown',
        country:  p?.country  ?? 'Unknown',
      };
    }).filter(p => p.marketValue > 0);

    const hhi = (slices: { value: number }[]) => {
      const total = slices.reduce((s, x) => s + x.value, 0);
      if (total <= 0) return 0;
      return Math.round(slices.reduce((s, { value }) => {
        const p = value / total;
        return s + p * p * 10000;
      }, 0));
    };

    const groupBy = (keyOf: (p: typeof positions[number]) => string) => {
      const map = positions.reduce((m, p) => m.set(keyOf(p), (m.get(keyOf(p)) ?? 0) + p.marketValue), new Map<string, number>());
      const slices = [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      const total = slices.reduce((s, x) => s + x.value, 0);
      return {
        hhi: hhi(slices),
        slices: slices.map(s => ({ label: s.label, value: s.value, pct: total > 0 ? (s.value / total) * 100 : 0 })),
      };
    };

    return ok({
      by_ticker:   groupBy(p => p.ticker),
      by_currency: groupBy(p => p.currency),
      by_sector:   groupBy(p => p.sector),
      by_country:  groupBy(p => p.country),
    });
  },
);


server.tool(
  'add_txn',
  'Record a stock transaction (buy, sell, deposit, dividend, tax)',
  {
    ticker:   z.string().describe('Stock ticker symbol (e.g. AAPL)'),
    date:     z.string().describe('Transaction date (YYYY-MM-DD)'),
    type:     z.enum(['buy', 'sell', 'deposit', 'dividend', 'tax']),
    shares:   z.number().positive(),
    price:    z.number().min(0).describe('Price per share in USD (use 0 for price=unknown deposits)'),
    currency: z.string().default('USD'),
    memo:     z.string().optional(),
  },
  async ({ ticker, date, type, shares, price, currency, memo }) => {
    const db = getDb();
    const result = db.insert(transactions).values({
      ticker: ticker.toUpperCase(), date, type, shares, price, currency, memo: memo ?? null,
    }).returning({ id: transactions.id }).get();
    return ok({ id: result?.id, ticker: ticker.toUpperCase(), date, type, shares, price });
  },
);

server.tool(
  'edit_txn',
  'Update fields of an existing transaction by id. Only provided fields are changed.',
  {
    id:     z.number().int().positive(),
    ticker: z.string().optional(),
    date:   z.string().optional().describe('YYYY-MM-DD'),
    type:   z.enum(['buy', 'sell', 'deposit', 'dividend', 'tax']).optional(),
    shares: z.number().positive().optional(),
    price:  z.number().min(0).optional(),
    memo:   z.string().nullable().optional(),
  },
  async ({ id, ticker, ...rest }) => {
    const db = getDb();
    const fields = {
      ...(ticker !== undefined ? { ticker: ticker.toUpperCase() } : {}),
      ...rest,
    };
    if (Object.keys(fields).length === 0) return err('No fields to update');
    const res = db.update(transactions).set(fields).where(eq(transactions.id, id)).run();
    if (res.changes === 0) return err(`Transaction #${id} not found`);
    const updated = db.select().from(transactions).where(eq(transactions.id, id)).get();
    return ok(updated);
  },
);

server.tool(
  'delete_txn',
  'Delete a transaction by id',
  { id: z.number().int().positive() },
  async ({ id }) => {
    const db = getDb();
    const res = db.delete(transactions).where(eq(transactions.id, id)).run();
    if (res.changes === 0) return err(`Transaction #${id} not found`);
    return ok({ deleted: id });
  },
);

server.tool(
  'add_balance',
  'Upsert a balance sheet entry for a period — also used to edit an existing entry (same composite key overwrites). sub_type: cash|investment|other (assets) or short_term|long_term (liabilities)',
  {
    period:   z.string().describe('YYYY-MM'),
    date:     z.string().describe('YYYY-MM-DD (typically month-end)'),
    type:     z.enum(['asset', 'liability']),
    sub_type: z.string().describe('cash | investment | other | short_term | long_term'),
    category: z.string().describe('Specific category name'),
    amount:   z.number().int().describe('Amount in USD (whole dollars)'),
    memo:     z.string().optional(),
  },
  async ({ period, date, type, sub_type, category, amount, memo }) => {
    const db = getDb();
    db.insert(balanceEntries).values({ period, date, type, sub_type, category, amount, currency: 'USD', memo: memo ?? null })
      .onConflictDoUpdate({
        target: [balanceEntries.period, balanceEntries.type, balanceEntries.sub_type, balanceEntries.category],
        set: { amount, currency: 'USD', date, memo: memo ?? null },
      }).run();
    return ok({ period, type, sub_type, category, amount, currency: 'USD' });
  },
);

server.tool(
  'add_flow',
  'Upsert a cash flow entry for a period — also used to edit an existing entry (same composite key overwrites). sub_type for income: salary|business|dividends|interest|income_other. For expense: personal|insurance|phone|utilities|rent|maintenance|loan_repayment|expense_other',
  {
    period:   z.string().describe('YYYY-MM'),
    date:     z.string().describe('YYYY-MM-DD (typically month-end)'),
    type:     z.enum(['income', 'expense']),
    sub_type: z.string(),
    category: z.string(),
    amount:   z.number().int().describe('Amount in USD (whole dollars)'),
    memo:     z.string().optional(),
  },
  async ({ period, date, type, sub_type, category, amount, memo }) => {
    const db = getDb();
    db.insert(flowEntries).values({ period, date, type, sub_type, category, amount, currency: 'USD', memo: memo ?? null })
      .onConflictDoUpdate({
        target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
        set: { amount, currency: 'USD', date, memo: memo ?? null },
      }).run();
    return ok({ period, type, sub_type, category, amount, currency: 'USD' });
  },
);

server.tool(
  'add_monthly',
  'Batch upsert balance and flow entries for a single period in one call. Use for month-end settlement when both sheets are ready together. Each entry follows the same shape as add_balance / add_flow.',
  {
    period: z.string().describe('YYYY-MM'),
    date:   z.string().describe('YYYY-MM-DD (typically month-end)'),
    balance: z.array(z.object({
      type:     z.enum(['asset', 'liability']),
      sub_type: z.string(),
      category: z.string(),
      amount:   z.number().int(),
      memo:     z.string().optional(),
    })).default([]),
    flow: z.array(z.object({
      type:     z.enum(['income', 'expense']),
      sub_type: z.string(),
      category: z.string(),
      amount:   z.number().int(),
      memo:     z.string().optional(),
    })).default([]),
  },
  async ({ period, date, balance, flow }) => {
    const db = getDb();

    for (const e of balance) {
      db.insert(balanceEntries).values({
        period, date, type: e.type, sub_type: e.sub_type, category: e.category,
        amount: e.amount, currency: 'USD', memo: e.memo ?? null,
      }).onConflictDoUpdate({
        target: [balanceEntries.period, balanceEntries.type, balanceEntries.sub_type, balanceEntries.category],
        set: { amount: e.amount, currency: 'USD', date, memo: e.memo ?? null },
      }).run();
    }

    for (const e of flow) {
      db.insert(flowEntries).values({
        period, date, type: e.type, sub_type: e.sub_type, category: e.category,
        amount: e.amount, currency: 'USD', memo: e.memo ?? null,
      }).onConflictDoUpdate({
        target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
        set: { amount: e.amount, currency: 'USD', date, memo: e.memo ?? null },
      }).run();
    }

    return ok({ period, balance_upserted: balance.length, flow_upserted: flow.length });
  },
);

server.tool(
  'delete_balance',
  'Delete balance entries for a period. If category is provided, only that single entry is removed; otherwise all entries for the period are deleted.',
  {
    period:   z.string().describe('YYYY-MM'),
    type:     z.enum(['asset', 'liability']).optional().describe('Required when category is provided'),
    sub_type: z.string().optional().describe('Required when category is provided'),
    category: z.string().optional().describe('Specific category — if omitted, deletes all entries for the period'),
  },
  async ({ period, type, sub_type, category }) => {
    const db = getDb();
    if (category) {
      if (!type || !sub_type) return err('type and sub_type are required when category is provided');
      const res = db.delete(balanceEntries).where(
        and(
          eq(balanceEntries.period, period),
          eq(balanceEntries.type, type),
          eq(balanceEntries.sub_type, sub_type),
          eq(balanceEntries.category, category),
        ),
      ).run();
      if (res.changes === 0) return err(`No balance entry matched`);
      return ok({ deleted: res.changes, period, category });
    }
    const res = db.delete(balanceEntries).where(eq(balanceEntries.period, period)).run();
    if (res.changes === 0) return err(`No balance entries for ${period}`);
    return ok({ deleted: res.changes, period });
  },
);

server.tool(
  'delete_flow',
  'Delete flow entries for a period. If category is provided, only that single entry is removed; otherwise all entries for the period are deleted.',
  {
    period:   z.string().describe('YYYY-MM'),
    type:     z.enum(['income', 'expense']).optional().describe('Required when category is provided'),
    sub_type: z.string().optional().describe('Required when category is provided'),
    category: z.string().optional().describe('Specific category — if omitted, deletes all entries for the period'),
  },
  async ({ period, type, sub_type, category }) => {
    const db = getDb();
    if (category) {
      if (!type || !sub_type) return err('type and sub_type are required when category is provided');
      const res = db.delete(flowEntries).where(
        and(
          eq(flowEntries.period, period),
          eq(flowEntries.type, type),
          eq(flowEntries.sub_type, sub_type),
          eq(flowEntries.category, category),
        ),
      ).run();
      if (res.changes === 0) return err(`No flow entry matched`);
      return ok({ deleted: res.changes, period, category });
    }
    const res = db.delete(flowEntries).where(eq(flowEntries.period, period)).run();
    if (res.changes === 0) return err(`No flow entries for ${period}`);
    return ok({ deleted: res.changes, period });
  },
);

server.tool(
  'sync_prices',
  'Fetch latest stock prices from Finnhub and update local cache. Requires finnhub_api_key in ~/.firma/config.json',
  {},
  async () => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');

    const db = getDb();
    const tickers = getActiveTickers(db.select().from(transactions).all());
    if (tickers.length === 0) return ok({ synced: 0 });

    const client = createFinnhubClient(apiKey);
    const results = await client.getStockDataBatch(tickers);
    const now = new Date().toISOString();

    for (const d of results.filter(r => r.currentPrice > 0)) {
      db.insert(prices).values({
        ticker: d.ticker, name: d.name ?? d.ticker, exchange: d.exchange ?? '',
        currency: d.currency ?? 'USD', current_price: d.currentPrice,
        prev_close: d.prevClose ?? 0, change_percent: d.changePercent ?? 0,
        high_52w: d.high52w ?? 0, low_52w: d.low52w ?? 0,
        pe: d.pe ?? null, eps: d.eps ?? null, market_cap: d.marketCap ?? 0,
        sector: d.sector ?? null, country: d.country ?? null,
        dividend_per_share: d.dividendPerShare ?? null, dividend_yield: d.dividendYield ?? null,
        synced_at: now,
      }).onConflictDoUpdate({
        target: prices.ticker,
        set: {
          name: d.name ?? d.ticker, exchange: d.exchange ?? '', currency: d.currency ?? 'USD',
          current_price: d.currentPrice, prev_close: d.prevClose ?? 0,
          change_percent: d.changePercent ?? 0, high_52w: d.high52w ?? 0,
          low_52w: d.low52w ?? 0, pe: d.pe ?? null, eps: d.eps ?? null,
          market_cap: d.marketCap ?? 0, sector: d.sector ?? null, country: d.country ?? null,
          dividend_per_share: d.dividendPerShare ?? null, dividend_yield: d.dividendYield ?? null,
          synced_at: now,
        },
      }).run();
    }

    return ok({ synced: results.length, tickers });
  },
);

server.tool(
  'sync_fx_rates',
  'Backfill historical FX rate cache (KRW, JPY, EUR, CNY, GBP per USD) from FRED. Increment-only: starts from the last cached date, fetches up to today. On first run, backfills from earliest user transaction/balance/flow date. Required for accurate historical currency conversion.',
  {},
  async () => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not configured. Run: firma config set fred-key <key>');

    const db = getDb();

    // Find earliest user date
    const txnDates = db.select({ date: transactions.date }).from(transactions).all().map(r => r.date);
    const balDates = db.select({ date: balanceEntries.date }).from(balanceEntries).all().map(r => r.date);
    const flowDates = db.select({ date: flowEntries.date }).from(flowEntries).all().map(r => r.date);
    const allDates = [...txnDates, ...balDates, ...flowDates];
    if (allDates.length === 0) return ok({ synced: 0, message: 'No user data — no FX backfill needed' });

    const earliest = allDates.sort()[0];
    const today = new Date().toISOString().slice(0, 10);
    const client = createFredClient(apiKey);

    const SUPPORTED = ['KRW', 'JPY', 'EUR', 'CNY', 'GBP'] as const;

    const per_currency = await Promise.all(SUPPORTED.map(async (cur) => {
      const fxDef = FX_BY_CURRENCY[cur];
      if (!fxDef) return { currency: cur, rows_inserted: 0 };

      // Increment-only
      const latestRow = db.select({ date: fxRates.date }).from(fxRates)
        .where(eq(fxRates.currency, cur))
        .orderBy(desc(fxRates.date))
        .limit(1).get();
      const startDate = latestRow
        ? new Date(new Date(`${latestRow.date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
        : earliest;
      if (startDate > today) return { currency: cur, rows_inserted: 0 };

      try {
        const obs = await client.fetchObservations(fxDef.series_id, { from: startDate, to: today });
        const valid = obs.filter((o): o is { date: string; value: number } => o.value != null);
        const apply = fxDef.invert ? (v: number) => 1 / v : (v: number) => v;
        for (const o of valid) {
          db.insert(fxRates).values({
            date: o.date, currency: cur, rate_to_usd: apply(o.value),
          }).onConflictDoUpdate({
            target: [fxRates.date, fxRates.currency],
            set: { rate_to_usd: apply(o.value) },
          }).run();
        }
        return { currency: cur, rows_inserted: valid.length };
      } catch (e) {
        return { currency: cur, rows_inserted: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }));

    const total = per_currency.reduce((s, c) => s + c.rows_inserted, 0);
    return ok({ synced: total, per_currency, earliest_user_date: earliest });
  },
);

server.tool(
  'show_fx_history',
  'Inspect the local FX rate cache. Without `currency`, returns per-currency coverage (count + first/last date). With `currency`, returns the cached series — date range via from/to, or `limit` most-recent rows. USD has no rows (it\'s the base, always 1.0).',
  {
    currency: z.string().optional().describe('Currency code (KRW/JPY/EUR/CNY/GBP). Omit for coverage summary.'),
    from:     z.string().optional().describe('Start date YYYY-MM-DD'),
    to:       z.string().optional().describe('End date YYYY-MM-DD'),
    limit:    z.number().int().min(1).max(10000).default(60).describe('Max rows when no date range (default 60)'),
  },
  async ({ currency, from, to, limit }) => {
    const db = getDb();
    if (!currency) {
      const coverage = db.select({
        currency:   fxRates.currency,
        count:      sql<number>`count(*)`,
        first_date: sql<string>`min(${fxRates.date})`,
        last_date:  sql<string>`max(${fxRates.date})`,
      }).from(fxRates).groupBy(fxRates.currency).orderBy(asc(fxRates.currency)).all();
      return ok({ coverage });
    }

    const cur = currency.toUpperCase();
    if (cur === 'USD') return ok({ currency: 'USD', rate_to_usd: 1.0, note: 'USD is the base — always 1.0' });

    const conditions = [
      eq(fxRates.currency, cur),
      from ? gte(fxRates.date, from) : undefined,
      to   ? lte(fxRates.date, to)   : undefined,
    ].filter(Boolean) as Parameters<typeof and>;
    const baseQuery = db.select().from(fxRates).where(and(...conditions)).orderBy(desc(fxRates.date));
    const rows = (from || to) ? baseQuery.all() : baseQuery.limit(limit).all();

    return ok({ currency: cur, count: rows.length, observations: rows });
  },
);

server.tool(
  'get_fx_rate',
  'Look up the historical FX rate for a date and currency from the local cache (foreign per 1 USD). USD always returns 1.0. Falls back to the most recent rate within `lookback_days` (handles weekends/holidays). Returns null if no rate found in the lookback window. Run sync_fx_rates first to populate the cache.',
  {
    date:          z.string().describe('YYYY-MM-DD'),
    currency:      z.string().describe('Currency code: USD/KRW/JPY/EUR/CNY/GBP'),
    lookback_days: z.number().int().min(0).max(30).default(7).describe('Days to look back if exact date not cached'),
  },
  async ({ date, currency, lookback_days }) => {
    const cur = currency.toUpperCase();
    if (cur === 'USD') return ok({ date, currency: 'USD', rate_to_usd: 1.0, source_date: date });

    const db = getDb();
    const earliest = new Date(`${date}T00:00:00Z`);
    earliest.setUTCDate(earliest.getUTCDate() - lookback_days);
    const earliestStr = earliest.toISOString().slice(0, 10);

    const row = db.select().from(fxRates)
      .where(and(eq(fxRates.currency, cur), gte(fxRates.date, earliestStr), lte(fxRates.date, date)))
      .orderBy(desc(fxRates.date))
      .limit(1)
      .get();

    if (!row) return ok({ date, currency: cur, rate_to_usd: null, source_date: null, hint: 'Run sync_fx_rates to populate the cache' });
    return ok({ date, currency: cur, rate_to_usd: row.rate_to_usd, source_date: row.date });
  },
);


server.tool(
  'add_snapshot',
  'Sync latest prices from Finnhub then record a portfolio snapshot for today. Required before snapshot data is useful.',
  {},
  async () => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');

    const db = getDb();
    const tickers = getActiveTickers(db.select().from(transactions).all());
    if (tickers.length === 0) return err('No active holdings to snapshot');

    const client = createFinnhubClient(apiKey);
    const results = await client.getStockDataBatch(tickers);
    const now = new Date().toISOString();

    const priceMap = new Map<string, number>();
    const currencyMap = new Map<string, string>();

    for (const d of results.filter(r => r.currentPrice > 0)) {
      db.insert(prices).values({
        ticker: d.ticker, name: d.name ?? d.ticker, exchange: d.exchange ?? '',
        currency: d.currency ?? 'USD', current_price: d.currentPrice,
        prev_close: d.prevClose ?? 0, change_percent: d.changePercent ?? 0,
        high_52w: d.high52w ?? 0, low_52w: d.low52w ?? 0,
        pe: d.pe ?? null, eps: d.eps ?? null, market_cap: d.marketCap ?? 0,
        sector: d.sector ?? null, country: d.country ?? null,
        dividend_per_share: d.dividendPerShare ?? null, dividend_yield: d.dividendYield ?? null,
        synced_at: now,
      }).onConflictDoUpdate({
        target: prices.ticker,
        set: {
          name: d.name ?? d.ticker, exchange: d.exchange ?? '', currency: d.currency ?? 'USD',
          current_price: d.currentPrice, prev_close: d.prevClose ?? 0,
          change_percent: d.changePercent ?? 0, high_52w: d.high52w ?? 0,
          low_52w: d.low52w ?? 0, pe: d.pe ?? null, eps: d.eps ?? null,
          market_cap: d.marketCap ?? 0, sector: d.sector ?? null, country: d.country ?? null,
          dividend_per_share: d.dividendPerShare ?? null, dividend_yield: d.dividendYield ?? null,
          synced_at: now,
        },
      }).run();
      priceMap.set(d.ticker, d.currentPrice);
      currencyMap.set(d.ticker, d.currency ?? 'USD');
    }

    const allTxns = db.select().from(transactions).all();
    const holdings = aggregateHoldings(allTxns);
    const date = now.slice(0, 10);
    let count = 0;

    for (const [ticker, holding] of holdings) {
      const currentPrice = priceMap.get(ticker);
      if (!currentPrice) continue;
      const avgPrice = holding.costShares > 0 ? holding.totalCost / holding.costShares : null;
      db.insert(portfolioSnapshots).values({
        date, ticker, shares: holding.shares, avg_price: avgPrice,
        current_price: currentPrice, currency: currencyMap.get(ticker) ?? 'USD',
      }).onConflictDoUpdate({
        target: [portfolioSnapshots.date, portfolioSnapshots.ticker],
        set: { shares: holding.shares, avg_price: avgPrice, current_price: currentPrice },
      }).run();
      count++;
    }

    return ok({ date, count, synced_prices: priceMap.size });
  },
);

server.tool(
  'edit_snapshot',
  'Update shares, avg_price, or current_price for a specific holding in a snapshot. Identified by date + ticker.',
  {
    date:          z.string().describe('Snapshot date (YYYY-MM-DD)'),
    ticker:        z.string().describe('Stock ticker symbol'),
    shares:        z.number().positive().optional(),
    avg_price:     z.number().min(0).nullable().optional(),
    current_price: z.number().positive().optional(),
  },
  async ({ date, ticker, shares, avg_price, current_price }) => {
    const db = getDb();
    const fields = Object.fromEntries(
      Object.entries({ shares, avg_price, current_price }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(fields).length === 0) return err('No fields to update');
    const res = db.update(portfolioSnapshots).set(fields).where(
      and(eq(portfolioSnapshots.date, date), eq(portfolioSnapshots.ticker, ticker.toUpperCase())),
    ).run();
    if (res.changes === 0) return err(`No snapshot found for ${ticker} on ${date}`);
    const updated = db.select().from(portfolioSnapshots).where(
      and(eq(portfolioSnapshots.date, date), eq(portfolioSnapshots.ticker, ticker.toUpperCase())),
    ).get();
    return ok(updated);
  },
);

server.tool(
  'delete_snapshot',
  'Delete all snapshot entries for a given date.',
  { date: z.string().describe('Snapshot date (YYYY-MM-DD)') },
  async ({ date }) => {
    const db = getDb();
    const res = db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.date, date)).run();
    if (res.changes === 0) return err(`No snapshot found for ${date}`);
    return ok({ deleted: res.changes, date });
  },
);

server.tool(
  'show_snapshot',
  'Query portfolio snapshot history. Without ticker, returns daily total market value. With ticker, returns per-holding time series.',
  {
    ticker: z.string().optional().describe('Filter by ticker symbol'),
    from:   z.string().optional().describe('Start date (YYYY-MM-DD, inclusive)'),
    to:     z.string().optional().describe('End date (YYYY-MM-DD, inclusive)'),
  },
  async ({ ticker, from, to }) => {
    const db = getDb();
    const conditions = [
      ticker ? eq(portfolioSnapshots.ticker, ticker.toUpperCase()) : undefined,
      from   ? gte(portfolioSnapshots.date, from)                  : undefined,
      to     ? lte(portfolioSnapshots.date, to)                    : undefined,
    ].filter(Boolean) as Parameters<typeof and>;

    const rows = conditions.length
      ? db.select().from(portfolioSnapshots).where(and(...conditions)).orderBy(asc(portfolioSnapshots.date)).all()
      : db.select().from(portfolioSnapshots).orderBy(asc(portfolioSnapshots.date)).all();

    if (ticker) return ok(rows);

    const byDate = rows.reduce((map, e) => {
      const prev = map.get(e.date) ?? 0;
      map.set(e.date, prev + e.current_price * e.shares);
      return map;
    }, new Map<string, number>());

    return ok([...byDate.entries()].map(([date, total_market_value]) => ({ date, total_market_value })));
  },
);

server.tool(
  'show_dividend',
  'Estimated annual dividend income for all holdings. Returns per-ticker yield, annual DPS, and estimated income. Only includes tickers with dividend data.',
  {},
  async () => {
    const db = getDb();
    const txns = db.select().from(transactions).all();
    const holdings = aggregateHoldings(txns);
    const priceMap = new Map(db.select().from(prices).all().map(p => [p.ticker, p]));

    const rows = [...holdings.entries()]
      .map(([ticker, h]) => {
        const p = priceMap.get(ticker);
        const dps      = p?.dividend_per_share ?? null;
        const yieldPct = p?.dividend_yield     ?? null;
        return {
          ticker,
          shares:         h.shares,
          dividend_yield: yieldPct,
          dividend_per_share: dps,
          estimated_annual_income: dps != null ? dps * h.shares : null,
        };
      })
      .filter(r => r.dividend_per_share != null);

    const total_annual = rows.reduce((s, r) => s + (r.estimated_annual_income ?? 0), 0);
    return ok({ holdings: rows, total_annual_income: total_annual, total_monthly_income: total_annual / 12 });
  },
);

server.tool(
  'show_news',
  'Fetch recent company news for a ticker from Finnhub',
  {
    ticker: z.string().describe('Stock ticker symbol (e.g. AAPL)'),
    days:   z.number().int().min(1).max(30).default(7).describe('Days to look back (default: 7)'),
    limit:  z.number().int().min(1).max(50).default(10).describe('Max articles to return (default: 10)'),
  },
  async ({ ticker, days, limit }) => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');
    try {
      const sym    = ticker.toUpperCase();
      const to     = toDateStr(new Date());
      const from   = toDateStr(new Date(Date.now() - days * 86_400_000));
      const client = createFinnhubClient(apiKey);
      const all    = await client.getCompanyNews(sym, from, to);
      return ok(all.slice(0, limit));
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch news');
    }
  },
);

server.tool(
  'show_insider',
  'Fetch recent insider buy/sell transactions for a ticker from Finnhub. transactionCode: P=buy, S=sell, A=award, G=gift, M=exercise',
  {
    ticker: z.string().describe('Stock ticker symbol (e.g. AAPL)'),
    limit:  z.number().int().min(1).max(100).default(20).describe('Max transactions to return (default: 20)'),
  },
  async ({ ticker, limit }) => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');
    try {
      const client = createFinnhubClient(apiKey);
      const res    = await client.getInsiderTransactions(ticker.toUpperCase());
      return ok({ symbol: res.symbol, data: (res.data ?? []).slice(0, limit) });
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch insider transactions');
    }
  },
);

const findConcept = (items: FinancialLineItem[], ...concepts: string[]) => {
  for (const concept of concepts) {
    const hit = concept.startsWith('*')
      ? items.find(i => i.concept.endsWith(concept.slice(1)))
      : items.find(i => i.concept === concept);
    if (hit != null) return hit.value;
  }
  return null;
};

const extractFinancialPeriod = (p: FinancialPeriod) => {
  const ic = p.report?.ic ?? [];
  const cf = p.report?.cf ?? [];
  const bs = p.report?.bs ?? [];
  return {
    period:          p.quarter === 0 ? `FY ${p.year}` : `Q${p.quarter} ${p.year}`,
    form:            p.form,
    endDate:         p.endDate,
    filedDate:       p.filedDate,
    revenue:         findConcept(ic,
                       'us-gaap_Revenues',
                       'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
                       'us-gaap_SalesRevenueNet',
                       'us-gaap_SalesRevenueGoodsNet',
                     ),
    grossProfit:     findConcept(ic, 'us-gaap_GrossProfit'),
    operatingIncome: findConcept(ic, 'us-gaap_OperatingIncomeLoss'),
    netIncome:       findConcept(ic, 'us-gaap_NetIncomeLoss', 'us-gaap_ProfitLoss'),
    epsDiluted:      findConcept(ic, 'us-gaap_EarningsPerShareDiluted', 'us-gaap_EarningsPerShareBasic'),
    operatingCF:     findConcept(cf, 'us-gaap_NetCashProvidedByUsedInOperatingActivities'),
    capex:           findConcept(cf, 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment'),
    totalAssets:     findConcept(bs, 'us-gaap_Assets'),
    cash:            findConcept(bs,
                       'us-gaap_CashAndCashEquivalentsAtCarryingValue',
                       'us-gaap_CashCashEquivalentsAndShortTermInvestments',
                     ),
    totalDebt:       findConcept(bs,
                       'us-gaap_LongTermDebt',
                       'us-gaap_LongTermDebtNoncurrent',
                       'us-gaap_LongTermDebtAndCapitalLeaseObligations',
                       'us-gaap_DebtLongtermAndShorttermCombinedAmount',
                       '*LongTermDebtNoncurrent',
                       '*LongTermDebtAndFinanceLeasesNoncurrent',
                     ),
  };
};

server.tool(
  'show_financials',
  'Fetch SEC-reported financials for a ticker. Returns key income statement, cash flow, and balance sheet metrics extracted from XBRL filings.',
  {
    ticker: z.string().describe('Stock ticker symbol (e.g. AAPL)'),
    freq:   z.enum(['quarterly', 'annual']).default('quarterly'),
    limit:  z.number().int().min(1).max(12).default(4).describe('Number of periods to return (default: 4)'),
  },
  async ({ ticker, freq, limit }) => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');
    try {
      const client  = createFinnhubClient(apiKey);
      const res     = await client.getFinancialsReported(ticker.toUpperCase(), freq);
      const periods = (res.data ?? []).slice(0, limit).map(extractFinancialPeriod);
      return ok({ symbol: ticker.toUpperCase(), freq, periods });
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch financials');
    }
  },
);

server.tool(
  'show_earnings',
  'Fetch earnings calendar. Without a ticker, returns upcoming earnings for all held tickers. With a ticker, returns history + upcoming.',
  {
    ticker:  z.string().optional().describe('Ticker symbol. Omit to get upcoming earnings for all holdings.'),
    weeks:   z.number().int().min(1).max(52).default(4).describe('Look-ahead window in weeks (default: 4)'),
    history: z.boolean().default(false).describe('Include past quarters (only applies when ticker is provided)'),
  },
  async ({ ticker, weeks, history }) => {
    const apiKey = getFinnhubKey();
    if (!apiKey) return err('Finnhub API key not configured. Run: firma config set finnhub-key <key>');
    try {
      const client = createFinnhubClient(apiKey);
      const today  = toDateStr(new Date());
      const future = toDateStr(new Date(Date.now() + weeks * 7 * 86_400_000));

      if (ticker) {
        const from = history
          ? toDateStr(new Date(Date.now() - 365 * 86_400_000))
          : today;
        const res = await client.getEarningsCalendar(from, future, ticker.toUpperCase());
        return ok((res.earningsCalendar ?? []).sort((a, b) => b.date.localeCompare(a.date)));
      }

      const db = getDb();
      const tickers = getActiveTickers(db.select().from(transactions).all());

      if (tickers.length === 0) return ok([]);

      const results = await Promise.all(
        tickers.map(t =>
          client.getEarningsCalendar(today, future, t)
            .then(r => r.earningsCalendar ?? [])
            .catch(() => []),
        ),
      );
      return ok(results.flat().sort((a, b) => a.date.localeCompare(b.date)));
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch earnings');
    }
  },
);


server.tool(
  'fetch_fred_series',
  'Fetch a FRED (Federal Reserve Economic Data) time series by ID. Returns metadata + observations. Common series: VIXCLS (VIX), DGS10 (10Y Treasury), T10Y2Y (yield curve), DTWEXBGS (Dollar Index), FEDFUNDS, CPIAUCSL, UNRATE, BAMLH0A0HYM2 (HY spread), DEXKOUS (KRW/USD), DEXJPUS (JPY/USD), DEXUSEU (USD/EUR — invert for EUR/USD).',
  {
    series_id: z.string().describe('FRED series ID (e.g. "VIXCLS", "DGS10", "FEDFUNDS")'),
    from:      z.string().optional().describe('Start date YYYY-MM-DD (inclusive)'),
    to:        z.string().optional().describe('End date YYYY-MM-DD (inclusive)'),
    limit:     z.number().int().positive().optional().describe('Max observations to return'),
  },
  async ({ series_id, from, to, limit }) => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not set. Run: firma config set fred-key <your-key>');
    try {
      const client = createFredClient(apiKey);
      const data = await client.fetchSeries(series_id, { from, to, limit });
      return ok(data);
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch FRED series');
    }
  },
);

server.tool(
  'show_macro',
  'Curated macro snapshot (8 indicators: VIX, 10Y Treasury, yield curve, USD index, HY credit spread, breakeven inflation, Fed funds, plus FX vs user\'s home currency). Each indicator has current value, 30d/90d delta, and 5y average. The home_currency arg drives the FX series selection (USD = no FX line).',
  {
    home_currency: z.string().default('USD').describe('User\'s home currency: USD/KRW/EUR/JPY/CNY/GBP'),
  },
  async ({ home_currency }) => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not set. Run: firma config set fred-key <your-key>');
    try {
      const client = createFredClient(apiKey);
      const indicators = await assembleMacroSnapshot(client, home_currency);
      return ok({
        generated_at: new Date().toISOString(),
        home_currency: home_currency.toUpperCase(),
        indicators,
      });
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to fetch macro snapshot');
    }
  },
);

server.tool(
  'show_stress',
  'Economic Stress Index (0–100) computed from 5 FRED series — yield curve (T10Y2Y), bank spread (T10Y3M), volatility (VIXCLS), financial stress (STLFSI4), initial jobless claims (ICSA). Returns total score, label (Low/Moderate/Elevated/Severe/Critical), and per-component breakdown with weights and formulas. Pure descriptive, no advice.',
  {},
  async () => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not set. Run: firma config set fred-key <your-key>');
    try {
      const data = await assembleStressIndex(createFredClient(apiKey));
      return ok({ generated_at: new Date().toISOString(), ...data });
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to compute stress index');
    }
  },
);

server.tool(
  'show_regime',
  'Macro regime bias (Risk-on bias / Mixed / Risk-off bias) from 5 FRED-based binary signals: VIX level, yield curve, HY credit spread, USD trend (30d), and breakeven inflation. Each signal evaluates to bullish/bearish; ≥70% bullish → risk-on, ≤40% → risk-off, otherwise mixed. Returns full signal breakdown — never present as advice.',
  {},
  async () => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not set. Run: firma config set fred-key <your-key>');
    try {
      const data = await assembleRegime(createFredClient(apiKey));
      return ok({ generated_at: new Date().toISOString(), ...data });
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to compute regime');
    }
  },
);

server.tool(
  'search_fred_series',
  'Search the FRED catalog (800K+ economic time series) by keyword. Returns series IDs ranked by popularity. Use this when you don\'t know the exact series_id for an indicator.',
  {
    query: z.string().describe('Search keywords (e.g. "treasury yield", "korea unemployment", "high yield spread")'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
  },
  async ({ query, limit }) => {
    const apiKey = getFredKey();
    if (!apiKey) return err('FRED API key not set. Run: firma config set fred-key <your-key>');
    try {
      const client = createFredClient(apiKey);
      const results = await client.searchSeries(query, limit);
      return ok(results);
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Failed to search FRED');
    }
  },
);


const transport = new StdioServerTransport();
await server.connect(transport);
