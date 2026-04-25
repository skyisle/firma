<p align="center">
  <img src="https://raw.githubusercontent.com/evan-moon/firma/main/assets/og-image.png" alt="firma" width="800" />
</p>

<h1 align="center">firma</h1>

<p align="center">
  <strong>The asset tracker that talks back.</strong><br/>
  A local-first, AI-native CLI for overseas stock investors.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/firma-app"><img src="https://img.shields.io/npm/v/firma-app.svg?style=flat&color=cb3837&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/firma-app"><img src="https://img.shields.io/npm/dm/firma-app.svg?style=flat&color=cb3837" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat&logo=node.js&logoColor=white" alt="Node >= 22"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-ready-7c3aed?style=flat" alt="MCP-ready"></a>
</p>

<p align="center">
  <code>npm install -g firma-app</code>
</p>

---

Track your portfolio, log trades, and analyze monthly cash flow — all from your terminal, all stored on your machine. Drop-in [MCP](https://modelcontextprotocol.io) integration means Claude reads, writes, and reasons about your finances directly. No vendor lock-in. No cloud sync. No financial data leaving your laptop.

---

## In conversation with Claude

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

In the terminal:

```
$ firma show portfolio

◇  Synced 4 stocks
│
◇  Portfolio
│
│  TICKER    QTY     AVG          PRICE         P&L
│  ─────────────────────────────────────────────────────────────
│  TSLA      392     $245.68      $376.32       $55,878.78 (+60.98%)
│  NVDA      156     $128.05      $208.29       $12,517.92 (+62.67%)
│  AAPL      43      ─            $271.08       ─
│  MSFT      18      ─            $424.64       ─
│  ─────────────────────────────────────────────────────────────
│  Value       $199,310.64
│  Cost        $111,613.98
│  P&L         +$87,696.66  (+78.57%)
```

---

## Why firma

- **Local-first by design.** Your transactions, balances, and cash flow live in `~/.firma/firma.db` — a single SQLite file. Nothing syncs anywhere unless you ask it to.
- **MCP-native.** Every CLI command has a matching MCP tool, so Claude can do everything you can — analyze, log, reconcile — through natural conversation.
- **Built for overseas investors.** First-class USD/KRW handling, fxratesapi auto-conversion, KRW-denominated balance sheets, and Finnhub-powered prices for U.S. equities.
- **Transactions as source of truth.** No holdings table to drift out of sync — your portfolio is always derived from your trade log. Buy/sell/deposit/dividend/tax all supported.
- **Developer-first UX.** `--json` output on every read command, scriptable, pipe-friendly. Three clean verb groups: `add`, `show`, `report`.

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

Already have data? Skip to `firma show portfolio` and let Claude take it from there.

---

## Privacy

All financial data is stored in `~/.firma/firma.db` — a local SQLite file only you can access. Nothing is sent to Firma servers.

- **Prices** → Finnhub, called directly with your own API key
- **Exchange rates** → open.er-api.com (no auth required)
- **Claude reads data** → local process-to-process via MCP protocol

Your numbers never leave your machine.

---

## CLI reference

Three verb groups: **`add`** (input), **`show`** (read, `--json` everywhere), **`report`** (aggregated, `--json` everywhere).

| Command | What it does |
|---|---|
| `firma add txn` | Record a transaction (buy / sell / deposit / dividend / tax) |
| `firma add balance [-p YYYY-MM]` | Monthly asset & liability snapshot |
| `firma add flow [-p YYYY-MM]` | Monthly income & expense entry |
| `firma add monthly [-p YYYY-MM]` | Balance + flow in one flow (month-end) |
| `firma show portfolio` | Holdings overview with P&L (auto-syncs prices) |
| `firma show txns [ticker]` | Transaction history with running avg cost |
| `firma show balance / flow [-p YYYY-MM]` | Stored entries for a period |
| `firma show news / insider / financials / earnings <ticker>` | Finnhub data |
| `firma report` | Net worth trend + cash flow charts |
| `firma report balance / flow / settle` | Targeted views |
| `firma report -c USD` | Display in USD, EUR, JPY, CNY, or GBP |
| `firma edit txn [id]` | Edit a transaction |
| `firma edit balance / flow [period]` | Edit a monthly snapshot (existing values pre-filled) |
| `firma delete txn [id]` | Delete a transaction |
| `firma delete balance / flow [period]` | Delete all entries for a period (alias `rm`) |
| `firma sync` | Fetch latest prices from Finnhub |
| `firma mcp install` | Register MCP server in Claude Desktop |
| `firma auth login` | Sign in with Google |
| `firma config set finnhub-key KEY` | Set Finnhub API key |
| `firma config set db-path PATH` | Use a custom database location |

---

## MCP tools

Available in Claude Desktop after `firma mcp install`. Same `add_*` / `show_*` / `report_*` shape as the CLI.

| Tool | What it does |
|---|---|
| `add_txn` / `edit_txn` / `delete_txn` | Stock transaction CRUD |
| `add_balance` / `add_flow` | Upsert (acts as edit when the composite key matches) |
| `delete_balance` / `delete_flow` | Drop entries by period (or single composite key) |
| `show_portfolio` | Holdings with P&L, avg cost, market value |
| `show_txns` | Transaction history (filterable by ticker) |
| `show_balance` / `show_flow` | Stored entries (filterable by period) |
| `show_prices` | Cached price snapshots |
| `show_news` / `show_insider` / `show_financials` / `show_earnings` | Finnhub passthroughs |
| `report_settle` | Single-period summary with `net_worth` + `net_flow` |
| `sync_prices` | Refresh prices from Finnhub |

---

## Architecture

```
packages/
  db/        @firma/db       Drizzle schema, types, repository interfaces, aggregateHoldings()
  finnhub/   @firma/finnhub  Finnhub API client
  utils/     @firma/utils    Shared constants and assert helper

apps/
  cli/                       Commander CLI (firma)
    src/
      providers/prices.ts    PriceProvider interface + factory (swap provider here)
      services/sync.ts       syncPrices() — used by `firma sync` and `show portfolio`
      services/fx.ts         fetchFxRates() with 60s cache
      db/repositories.ts     SQLite DataRepository implementation
      commands/              Thin UI layer — no business logic
  mcp/                       MCP server (firma-mcp), bundled with the CLI binary
```

**Swap the price provider** → edit `createPriceProvider()` in `apps/cli/src/providers/prices.ts`.

**Swap the storage layer** → implement `DataRepository` against your API and swap it into `getRepository()`.

---

## Development

Requires Node.js 22+ and Yarn Berry.

```bash
corepack enable
yarn install

yarn dev:cli show portfolio    # CLI dev mode
yarn typecheck                 # Full type check
```

Default DB is `~/.firma/firma.db`. To use a separate file during development:

```bash
firma config set db-path ./dev.db
```

---

## License

MIT © [Evan Moon](https://github.com/evan-moon)
