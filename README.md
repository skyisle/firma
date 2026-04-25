# firma

Your finances, managed by AI.

Firma is a local-first financial data layer for overseas stock investors.
Connect Claude via MCP and let it query your portfolio, analyze spending, and log transactions —
all stored privately on your machine.

```bash
npm install -g firma-app
```

---

## How it works

```
You:     How is my portfolio doing?
Claude:  Total market value is $147,509, up +$55,870 (+60.9%) from cost basis.
         TSLA (392 shares) is driving most of the gain.

You:     Spending feels high this month. How does it compare to last year?
Claude:  March 2026 expenses were ₩4,230,000 — up 18% vs. March 2025.
         Savings rate dropped from 41% to 34%.

You:     I just bought 15 shares of AAPL at $211. Log it.
Claude:  Done — AAPL 15 shares @ $211.00 recorded for 2026-04-25.
```

---

## Get started

```bash
# 1. Install
npm install -g firma-app

# 2. Sign in and set your Finnhub key (free at finnhub.io)
firma auth login
firma config set finnhub-key YOUR_KEY

# 3. Connect Claude Desktop
firma mcp install
# Restart Claude Desktop — that's it.

# 4. Add your first trade and sync prices
firma add txn
firma sync
```

---

## Privacy

All financial data is stored in `~/.firma/firma.db` — a local SQLite file only you can access.
Nothing is sent to Firma servers.

- Prices → Finnhub, called directly with your own API key
- Exchange rates → open.er-api.com (no auth required)
- Claude reads data → local process-to-process via MCP protocol

Your numbers never leave your machine.

---

## MCP tools

Available in Claude Desktop after `firma mcp install`. Same `add_*` / `show_*` / `report_*` shape as the CLI.

| Tool | Description |
|---|---|
| `add_txn` | Record a buy / sell / deposit / dividend / tax |
| `edit_txn` | Update fields of an existing transaction |
| `delete_txn` | Delete a transaction by id |
| `add_balance` | Add or update an asset/liability entry |
| `add_flow` | Add or update an income/expense entry |
| `show_portfolio` | Holdings with P&L and avg cost |
| `show_txns` | Transaction history (filterable by ticker) |
| `show_balance` | Stored balance entries (filterable by period) |
| `show_flow` | Stored flow entries (filterable by period) |
| `show_prices` | Cached price data |
| `show_news` / `show_insider` / `show_financials` / `show_earnings` | Finnhub queries |
| `report_settle` | Single-period summary with net_worth + net_flow |
| `sync_prices` | Fetch latest prices from Finnhub |

---

## CLI reference

Three verb groups: **add** (input), **show** (read), **report** (aggregated). All `show *` and `report *` commands accept `--json`.

| Command | Description |
|---|---|
| `firma add txn` | Record a transaction (buy / sell / deposit / dividend / tax) |
| `firma add balance [-p YYYY-MM]` | Monthly asset & liability snapshot |
| `firma add flow [-p YYYY-MM]` | Monthly income & expense entry |
| `firma add monthly [-p YYYY-MM]` | Balance + flow in one flow (month-end entry) |
| `firma show portfolio` | Holdings overview with P&L |
| `firma show txns [ticker]` | Transaction history with running avg cost |
| `firma show balance / flow [-p YYYY-MM]` | Stored entries for a period |
| `firma show news / insider / financials / earnings <ticker>` | Finnhub data |
| `firma report` | Net worth trend + cash flow charts (combined) |
| `firma report balance / flow / settle` | Targeted views |
| `firma report -c USD` | Display in USD, EUR, JPY, CNY, or GBP |
| `firma edit [id]` | Edit a transaction |
| `firma delete [id]` | Delete a transaction (alias `rm`) |
| `firma sync` | Fetch latest prices from Finnhub |
| `firma mcp install` | Register MCP server in Claude Desktop |
| `firma auth login` | Sign in with Google |
| `firma config set finnhub-key KEY` | Set Finnhub API key |
| `firma config set db-path PATH` | Use a custom database location |

---

## Architecture

```
packages/
  db/        @firma/db       Drizzle schema, types, repository interfaces
  finnhub/   @firma/finnhub  Finnhub API client
  utils/     @firma/utils    Shared constants and assert helper

apps/
  cli/                       Commander CLI (firma)
    src/
      providers/prices.ts    PriceProvider interface + factory (swap provider here)
      services/portfolio.ts  aggregateHoldings(), getActiveTickers()
      services/fx.ts         fetchFxRates() with 60s cache
      db/repositories.ts     SQLite DataRepository implementation (swap here for server sync)
      commands/              Thin UI layer — no business logic
  mcp/                       MCP server (firma-mcp)
  server/                    Next.js landing page
```

**Swap the price provider** → edit `createPriceProvider()` in `apps/cli/src/providers/prices.ts`.

**Add server-side sync** → implement `DataRepository` against your API, swap in `getRepository()`.

---

## Development

Requires Node.js 22+ and Yarn Berry.

```bash
corepack enable
yarn install

yarn dev:cli portfolio    # CLI dev mode
yarn dev:server           # Landing page
yarn typecheck            # Full type check
```

Default DB is `~/.firma/firma.db`. To use a separate file during development:

```bash
firma config set db-path ./dev.db
```

---

## License

MIT
