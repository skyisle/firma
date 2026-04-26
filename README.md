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

<p align="center">
  🚧 Early stage — feedback and contributions welcome.<br/>
  If you've installed it, I'd love to hear how you found it: <a href="https://github.com/evan-moon/firma/discussions">Discussions</a>
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

The fastest path is to let Claude do the data entry. firma is built so the only thing you ever need to type at a terminal is the four-line setup below — everything else (logging trades, importing balances, syncing prices) happens through conversation.

```bash
# 1. Install
npm install -g firma-app

# 2. Set API keys (both free)
firma config set finnhub-key YOUR_KEY   # finnhub.io — prices, news, earnings
firma config set fred-key YOUR_KEY      # fred.stlouisfed.org — macro & FX history

# 3. Connect Claude Desktop
firma mcp install
# Restart Claude Desktop. firma tools should appear in the toolbar.
```

**4. Now talk to Claude.** Drop a CSV / brokerage export / screenshot / plain text in chat and ask it to set up firma:

```
You:    Here's my IBKR trade history [trades.csv attached]. Set up firma.
Claude: I see 47 transactions. Logging in chronological order so the avg
        cost stays accurate... done. Now syncing prices and FX history...
        Your portfolio: $179K, +$68,970 (+61%) all-time. TSLA is 78%.
```

Claude calls `add_txn` for each row, then `sync_prices` + `sync_fx_rates`, then `show_portfolio`. Same flow works for monthly balances and cash flow — `add_balance` / `add_flow` per row.

> Prefer the CLI? Every MCP tool has a matching `firma` command — see [CLI reference](#cli-reference).

---

## Privacy

All financial data is stored in `~/.firma/firma.db` — a local SQLite file only you can access. Nothing is sent to Firma servers.

- **Prices** → Finnhub, called directly with your own API key
- **Exchange rates (live)** → open.er-api.com (no auth)
- **Macro & historical FX** → FRED, called directly with your own API key; daily series cached locally in `~/.firma/firma.db` (`fx_rates` table)
- **Claude reads data** → local process-to-process via MCP protocol

Your numbers never leave your machine.

---

## CLI reference

`--json` is available on every read command. Alias: `firma rm` = `firma delete`.

### Portfolio

| Command | What it does |
|---|---|
| `firma show portfolio` | Holdings with P&L, avg cost, market value |
| `firma show txns [ticker]` | Transaction history with running avg cost |
| `firma show dividend` | Estimated annual income + per-ticker yield |
| `firma show concentration` | HHI concentration by ticker, currency, sector, country |
| `firma show snapshot [ticker]` | Portfolio value history; `--from`/`--to` for date range |

### Balance & Cash Flow

| Command | What it does |
|---|---|
| `firma add balance [-p YYYY-MM]` | Monthly asset & liability snapshot |
| `firma add flow [-p YYYY-MM]` | Monthly income & expense entry |
| `firma add monthly [-p YYYY-MM]` | Balance + flow in one call (month-end) |
| `firma show balance [-p YYYY-MM]` | Stored balance entries for a period |
| `firma show flow [-p YYYY-MM]` | Stored cash flow entries for a period |
| `firma report` | Net worth trend + cash flow charts (combined) |
| `firma report balance / flow / settle` | Targeted views |
| `firma report -c USD` | Display in USD, EUR, JPY, CNY, or GBP |

### Transactions

| Command | What it does |
|---|---|
| `firma add txn` | Record a transaction (buy / sell / deposit / dividend / tax) |
| `firma edit txn [id]` | Edit a transaction |
| `firma delete txn [id]` | Delete a transaction |

### Snapshots

| Command | What it does |
|---|---|
| `firma add snapshot` | Sync prices and record today's portfolio snapshot |
| `firma edit snapshot` | Edit a snapshot entry (interactive picker) |
| `firma delete snapshot [date]` | Delete all entries for a date |

### Research (Finnhub)

| Command | What it does |
|---|---|
| `firma show news <ticker>` | Recent company news |
| `firma show insider <ticker>` | Insider buy/sell transactions |
| `firma show financials <ticker>` | SEC-reported quarterly financials |
| `firma show earnings [ticker]` | Earnings calendar + EPS history |

### Macro (FRED)

| Command | What it does |
|---|---|
| `firma show macro` | VIX, 10Y yield, yield curve, USD index, HY spread, inflation, fed funds, FX (cached per day) |
| `firma show stress` | Economic Stress Index (0–100) from 5 FRED series with per-component breakdown |
| `firma show regime` | Macro regime bias (Risk-on / Mixed / Risk-off) from 5 binary signals — descriptive heuristic, not advice |

### Daily Brief

| Command | What it does |
|---|---|
| `firma brief` | Movers, news, upcoming earnings, macro context (cached per day; `--refresh` to regenerate) |

### Actions & Config

| Command | What it does |
|---|---|
| `firma sync` | Fetch latest prices (Finnhub) + FX rate history (FRED) |
| `firma sync fx` | FX rate history only — incremental backfill from your earliest entry date |
| `firma mcp install` | Register MCP server in Claude Desktop |
| `firma config set finnhub-key KEY` | Set Finnhub API key |
| `firma config set fred-key KEY` | Set FRED API key (free at fred.stlouisfed.org) |
| `firma config set db-path PATH` | Use a custom database location |
| `firma config set currency CODE` | Set home currency for display (KRW, USD, JPY, …) |
| `firma config get [key]` | Print a config value (omit key to list all) |

---

## Claude integration (MCP)

After `firma mcp install`, every CLI command has a matching MCP tool — Claude can read and write all your data directly from conversation.

Two tools are available only via MCP (no CLI equivalent):

| Tool | What it does |
|---|---|
| `fetch_fred_series` | Fetch any FRED time series by ID (800K+ series available) |
| `search_fred_series` | Search the FRED catalog by keyword to discover series IDs |

`get_brief` is the richest single tool for daily check-ins — it returns holdings with weights, daily P&L, concentration, movers, news, earnings, macro context, stress/regime signals, and pre-computed portfolio insights in one call.

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
