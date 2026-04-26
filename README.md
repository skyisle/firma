<p align="center">
  <img src="https://raw.githubusercontent.com/evan-moon/firma/main/assets/og-image.png" alt="firma" width="800" />
</p>

<h1 align="center">firma</h1>

<p align="center">
  <strong>You earned well this year.<br/>Do you know where it went?</strong>
</p>

<p align="center">
  Just ask Claude.<br/>
  <span>A local-first, AI-native CLI for overseas stock investors.</span>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/firma-app"><img src="https://img.shields.io/npm/v/firma-app.svg?style=flat&color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat&logo=node.js&logoColor=white" alt="Node >= 22"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://glama.ai/mcp/servers/evan-moon/firma"><img src="https://glama.ai/mcp/servers/evan-moon/firma/badges/score.svg" alt="firma MCP server"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-ready-7c3aed?style=flat" alt="MCP-ready"></a>
</p>

<p align="center">
  <code>npm install -g firma-app</code>
</p>

---

Track your portfolio, log trades, and analyze monthly cash flow — all from your terminal, all stored on your machine. Drop-in [MCP](https://modelcontextprotocol.io) integration means Claude reads, writes, and reasons about your finances directly. No vendor lock-in. No cloud sync. No financial data leaving your laptop.

---

## In conversation with Claude

<p align="center">
  <img src="https://raw.githubusercontent.com/evan-moon/firma/main/assets/demo.gif" alt="firma CLI demo" width="700" />
</p>

```
You:     How is my portfolio doing?
Claude:  Total market value is $147,509, up +$55,870 (+60.9%) from cost basis.
         TSLA (392 shares) is driving most of the gain.

You:     Spending feels high this month. How does it compare to last year?
Claude:  March 2026 expenses were $3,050 — up 18% vs. March 2025.
         Savings rate dropped from 41% to 34%.

You:     I just bought 15 shares of AAPL at $211. Log it.
Claude:  Done — AAPL 15 shares @ $211.00 recorded for 2026-04-25.

You:     Give me a full overview of my finances with charts.
Claude:  [renders live portfolio dashboard — holdings, net worth trend, asset mix, cash flow]
```

<p align="center">
  <img src="https://raw.githubusercontent.com/evan-moon/firma/main/assets/claude-demo.png" alt="Claude rendering a live portfolio dashboard" width="700" />
</p>

---

## Why firma

- **Local-first by design.** Your transactions, balances, and cash flow live in `~/.firma/firma.db` — a single SQLite file. Nothing syncs anywhere unless you ask it to.
- **MCP-native.** Every CLI command has a matching MCP tool, so Claude can do everything you can — analyze, log, reconcile — through natural conversation.
- **Built for overseas investors.** Multi-currency support (USD, KRW, EUR, JPY, and more), fxratesapi auto-conversion, and Finnhub-powered prices for U.S. equities.
- **Transactions as source of truth.** No holdings table to drift out of sync — your portfolio is always derived from your trade log. Buy/sell/deposit/dividend/tax all supported.
- **Developer-first UX.** `--json` output on every read command, scriptable, pipe-friendly. Three clean verb groups: `add`, `show`, `report`.

---

## Get started

```bash
# 1. Install
npm install -g firma-app

# 2. Set your Finnhub key (free at finnhub.io)
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
| `firma add snapshot` | Sync prices and record today's portfolio snapshot |
| `firma show portfolio` | Holdings overview with P&L (auto-syncs prices) |
| `firma show txns [ticker]` | Transaction history with running avg cost |
| `firma show balance / flow [-p YYYY-MM]` | Stored entries for a period |
| `firma show snapshot [ticker]` | Portfolio value history; `--from`/`--to` for date range |
| `firma show dividend` | Estimated annual income + per-ticker yield |
| `firma show concentration` | HHI concentration by ticker, currency, sector, country |
| `firma show macro` | FRED macro snapshot: VIX, yields, USD index, credit spread, FX (cached per day) |
| `firma show news / insider / financials / earnings <ticker>` | Finnhub data |
| `firma report` | Net worth trend + cash flow charts |
| `firma report balance / flow / settle` | Targeted views |
| `firma report -c USD` | Display in USD, EUR, JPY, CNY, or GBP |
| `firma brief` | Daily brief: movers, news, upcoming earnings (cached per day) |
| `firma edit txn [id]` | Edit a transaction |
| `firma edit balance / flow [period]` | Edit a monthly snapshot (existing values pre-filled) |
| `firma edit snapshot` | Edit a snapshot entry (interactive picker) |
| `firma delete txn [id]` | Delete a transaction |
| `firma delete balance / flow [period]` | Delete all entries for a period (alias `rm`) |
| `firma delete snapshot [date]` | Delete all snapshot entries for a date (alias `rm`) |
| `firma sync` | Fetch latest prices from Finnhub |
| `firma mcp install` | Register MCP server in Claude Desktop |
| `firma config set finnhub-key KEY` | Set Finnhub API key |
| `firma config set fred-key KEY` | Set FRED API key (for `show macro` and `fetch_fred_series`) |
| `firma config set db-path PATH` | Use a custom database location |
| `firma config get [key]` | Print a config value (omit key to list all) |

---

## MCP tools

Available in Claude Desktop after `firma mcp install`. Same `add_*` / `show_*` / `report_*` shape as the CLI.

| Tool | What it does |
|---|---|
| `add_txn` / `edit_txn` / `delete_txn` | Stock transaction CRUD |
| `add_balance` / `add_flow` | Upsert (acts as edit when the composite key matches) |
| `add_monthly` | Batch upsert balance + flow for one period |
| `delete_balance` / `delete_flow` | Drop entries by period (or single composite key) |
| `add_snapshot` / `edit_snapshot` / `delete_snapshot` | Portfolio snapshot CRUD |
| `show_portfolio` | Holdings with P&L, avg cost, market value |
| `show_txns` | Transaction history (filterable by ticker) |
| `show_balance` / `show_flow` | Stored entries (filterable by period) |
| `show_snapshot` | Portfolio value history (per-ticker or daily total) |
| `show_dividend` | Estimated annual dividend income + per-ticker yield |
| `show_concentration` | HHI concentration by ticker, currency, sector, country |
| `show_macro` | Curated FRED macro snapshot (8 indicators + dynamic FX) |
| `fetch_fred_series` / `search_fred_series` | Raw FRED time-series access (any of 800K+ series) |
| `show_prices` | Cached price snapshots |
| `show_news` / `show_insider` / `show_financials` / `show_earnings` | Finnhub passthroughs |
| `get_brief` | Daily brief: movers, news, upcoming earnings (cached per day) |
| `report_balance` / `report_flow` / `report_combined` | Monthly aggregations with trends |
| `report_settle` | Single-period summary with `net_worth` + `net_flow` |
| `sync_prices` | Refresh prices from Finnhub |

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview and extension points.

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
