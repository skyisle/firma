#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { createFinnhubClient } from '@firma/finnhub';
import type { FinancialLineItem, FinancialPeriod } from '@firma/finnhub';
import {
  getDb, getFinnhubKey,
  transactions, balanceEntries, flowEntries, prices,
} from './db.ts';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const server = new McpServer({
  name: 'firma',
  version: '0.1.0',
});


const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const err = (msg: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${msg}` }],
  isError: true,
});


server.tool(
  'get_portfolio',
  'Get current stock holdings with average cost and cached prices',
  {},
  async () => {
    const db = getDb();
    const txns = db.select().from(transactions).orderBy(asc(transactions.date)).all();
    const priceRows = db.select().from(prices).all();
    const priceMap = new Map(priceRows.map(p => [p.ticker, p]));

    const map = new Map<string, { shares: number; costShares: number; totalCost: number }>();
    for (const t of txns) {
      const h = map.get(t.ticker) ?? { shares: 0, costShares: 0, totalCost: 0 };
      if (t.type === 'buy') {
        h.shares += t.shares; h.costShares += t.shares; h.totalCost += t.shares * t.price;
      } else if (t.type === 'sell') {
        const prev = h.shares; h.shares -= t.shares;
        h.costShares = prev > 0 ? h.costShares * (h.shares / prev) : 0;
        h.totalCost = h.costShares > 0 ? h.costShares * (h.totalCost / h.costShares) : 0;
      } else if (t.type === 'deposit') {
        h.shares += t.shares;
        if (t.price > 0) { h.costShares += t.shares; h.totalCost += t.shares * t.price; }
      }
      map.set(t.ticker, h);
    }

    const holdings = [...map.entries()]
      .filter(([, h]) => h.shares > 0)
      .map(([ticker, h]) => {
        const p = priceMap.get(ticker);
        const avgPrice = h.costShares > 0 ? h.totalCost / h.costShares : null;
        const costBasis = avgPrice != null ? avgPrice * h.costShares : 0;
        const marketValue = p ? p.current_price * h.shares : null;
        return {
          ticker, shares: h.shares, avgPrice, costBasis,
          currentPrice: p?.current_price ?? null,
          marketValue,
          pnl: marketValue != null ? marketValue - costBasis : null,
          pnlPct: marketValue != null && costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : null,
          name: p?.name ?? null,
          syncedAt: p?.synced_at ?? null,
        };
      });

    return ok(holdings);
  },
);

server.tool(
  'get_transactions',
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
  'get_balance',
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
  'get_flow',
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
  'get_prices',
  'Get cached stock prices for all synced tickers',
  {},
  async () => {
    const db = getDb();
    return ok(db.select().from(prices).all());
  },
);


server.tool(
  'add_transaction',
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
  'set_balance_entry',
  'Upsert a balance sheet entry for a period. sub_type: cash|investment|other (assets) or short_term|long_term (liabilities)',
  {
    period:   z.string().describe('YYYY-MM'),
    date:     z.string().describe('YYYY-MM-DD (typically month-end)'),
    type:     z.enum(['asset', 'liability']),
    sub_type: z.string().describe('cash | investment | other | short_term | long_term'),
    category: z.string().describe('Specific category name'),
    amount:   z.number().int().describe('Amount in KRW'),
    memo:     z.string().optional(),
  },
  async ({ period, date, type, sub_type, category, amount, memo }) => {
    const db = getDb();
    db.insert(balanceEntries).values({ period, date, type, sub_type, category, amount, memo: memo ?? null })
      .onConflictDoUpdate({
        target: [balanceEntries.period, balanceEntries.type, balanceEntries.sub_type, balanceEntries.category],
        set: { amount, date, memo: memo ?? null },
      }).run();
    return ok({ period, type, sub_type, category, amount });
  },
);

server.tool(
  'set_flow_entry',
  'Upsert a cash flow entry for a period. sub_type for income: salary|business|dividends|interest|income_other. For expense: personal|insurance|phone|utilities|rent|maintenance|loan_repayment|expense_other',
  {
    period:   z.string().describe('YYYY-MM'),
    date:     z.string().describe('YYYY-MM-DD (typically month-end)'),
    type:     z.enum(['income', 'expense']),
    sub_type: z.string(),
    category: z.string(),
    amount:   z.number().int().describe('Amount in KRW'),
    memo:     z.string().optional(),
  },
  async ({ period, date, type, sub_type, category, amount, memo }) => {
    const db = getDb();
    db.insert(flowEntries).values({ period, date, type, sub_type, category, amount, memo: memo ?? null })
      .onConflictDoUpdate({
        target: [flowEntries.period, flowEntries.type, flowEntries.sub_type, flowEntries.category],
        set: { amount, date, memo: memo ?? null },
      }).run();
    return ok({ period, type, sub_type, category, amount });
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
    const txns = db.select().from(transactions).all();
    const net = new Map<string, number>();
    for (const t of txns) {
      const cur = net.get(t.ticker) ?? 0;
      if (t.type === 'buy' || t.type === 'deposit') net.set(t.ticker, cur + t.shares);
      else if (t.type === 'sell') net.set(t.ticker, cur - t.shares);
    }
    const tickers = [...net.entries()].filter(([, s]) => s > 0).map(([t]) => t);
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
        pe: d.pe ?? null, eps: d.eps ?? null, market_cap: d.marketCap ?? 0, synced_at: now,
      }).onConflictDoUpdate({
        target: prices.ticker,
        set: {
          name: d.name ?? d.ticker, exchange: d.exchange ?? '', currency: d.currency ?? 'USD',
          current_price: d.currentPrice, prev_close: d.prevClose ?? 0,
          change_percent: d.changePercent ?? 0, high_52w: d.high52w ?? 0,
          low_52w: d.low52w ?? 0, pe: d.pe ?? null, eps: d.eps ?? null,
          market_cap: d.marketCap ?? 0, synced_at: now,
        },
      }).run();
    }

    return ok({ synced: results.length, tickers });
  },
);


server.tool(
  'get_news',
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
  'get_insider_transactions',
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

const findConcept = (items: FinancialLineItem[], ...concepts: string[]): number | null => {
  for (const concept of concepts) {
    const hit = items.find(i => i.concept === concept);
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
                       'us-gaap/Revenues',
                       'us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax',
                       'us-gaap/SalesRevenueNet',
                     ),
    grossProfit:     findConcept(ic, 'us-gaap/GrossProfit'),
    operatingIncome: findConcept(ic, 'us-gaap/OperatingIncomeLoss'),
    netIncome:       findConcept(ic, 'us-gaap/NetIncomeLoss', 'us-gaap/ProfitLoss'),
    epsDiluted:      findConcept(ic, 'us-gaap/EarningsPerShareDiluted', 'us-gaap/EarningsPerShareBasic'),
    operatingCF:     findConcept(cf, 'us-gaap/NetCashProvidedByUsedInOperatingActivities'),
    capex:           findConcept(cf, 'us-gaap/PaymentsToAcquirePropertyPlantAndEquipment'),
    totalAssets:     findConcept(bs, 'us-gaap/Assets'),
    cash:            findConcept(bs,
                       'us-gaap/CashAndCashEquivalentsAtCarryingValue',
                       'us-gaap/CashCashEquivalentsAndShortTermInvestments',
                     ),
    totalDebt:       findConcept(bs, 'us-gaap/LongTermDebt', 'us-gaap/LongTermDebtNoncurrent'),
  };
};

server.tool(
  'get_financials',
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
  'get_earnings',
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

      const db   = getDb();
      const txns = db.select().from(transactions).all();
      const net  = new Map<string, number>();
      for (const t of txns) {
        const cur = net.get(t.ticker) ?? 0;
        if (t.type === 'buy' || t.type === 'deposit') net.set(t.ticker, cur + t.shares);
        else if (t.type === 'sell') net.set(t.ticker, cur - t.shares);
      }
      const tickers = [...net.entries()].filter(([, s]) => s > 0).map(([t]) => t);

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


const transport = new StdioServerTransport();
await server.connect(transport);
