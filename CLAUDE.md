# Firma — Project Context

Firma is a CLI-first personal asset tracker targeting overseas stock investors.
Target audience: developers (Hacker News / GeekNews demographic).

## Architecture

Turborepo monorepo with Yarn Berry (`nodeLinker: node-modules`):

```
apps/
  cli/       — firma-app       TypeScript CLI (Commander + Clack)
  mcp/       — @firma/mcp      MCP server (shares ~/.firma/firma.db with CLI)
packages/
  db/        — @firma/db       Drizzle schema + repository contracts (shared)
  finnhub/   — @firma/finnhub  Finnhub API client (shared)
  utils/     — @firma/utils    pure helpers + ledger category defs (shared)
```

## Development Rules

**모든 기능은 CLI + MCP 동시 구현.**
새 커맨드를 추가할 때는 반드시 대응하는 MCP 툴도 함께 작성한다.

- CLI: `apps/cli/src/commands/<name>.ts` + `apps/cli/src/index.ts` 등록
- MCP: `apps/mcp/src/index.ts` 에 `server.tool()` 추가
- MCP 툴 이름 컨벤션: `add_*` (입력), `show_*` (단순 조회), `report_*` (집계). 변경/삭제는 `edit_*` / `delete_*`.
- 빌드 순서: `@firma/finnhub` → `@firma/mcp` → `firma-app`

## Key Design Decisions

- **Transactions as source of truth** — holdings are derived via aggregation, no holdings table
- **Local SQLite** — all data stored in `~/.firma/firma.db` via better-sqlite3 + Drizzle ORM
- **Finnhub** — stock price provider; API key stored in `~/.firma/config.json`

## CLI Commands

Three verb groups: `add` (input), `show` (read), `report` (aggregated).

```
# config
firma config set finnhub-key <key>
firma config get [key]

# add — interactive entry
firma add txn                 # buy/sell/deposit/dividend/tax
firma add balance [-p YYYY-MM]
firma add flow    [-p YYYY-MM]
firma add monthly [-p YYYY-MM]   # balance + flow in one flow
firma add snapshot            # sync prices then record portfolio snapshot for today

# show — read-only, supports --json
firma show portfolio
firma show txns [ticker]
firma show balance [-p YYYY-MM]
firma show flow    [-p YYYY-MM]
firma show snapshot [ticker]   # portfolio value history; --from/--to for date range
firma show dividend            # estimated annual income + per-ticker yield
firma show news <ticker>
firma show insider <ticker>
firma show financials <ticker>
firma show earnings [ticker]

# report — aggregated, supports --json
firma report                       # combined balance + flow trends
firma report balance
firma report flow
firma report settle [-p YYYY-MM]   # single-period summary

# mutations
firma edit txn [id]
firma edit balance [period]        # picker if period omitted; pre-fills existing values
firma edit flow [period]
firma edit snapshot                # interactive picker: date → ticker → field
firma delete txn [id]
firma delete balance [period]      # deletes all entries for the period
firma delete flow [period]
firma delete snapshot [date]       # deletes all holdings for that date
# alias: `firma rm ...` for delete

# actions
firma sync
firma mcp install
```

## MCP Tools

Same pattern: `add_*` / `show_*` / `report_*` (+ `edit_txn`, `delete_txn`, `sync_prices`).

```
add_txn / edit_txn / delete_txn
add_balance / add_flow              # upsert: also acts as edit for same composite key
add_monthly                         # batch upsert balance + flow for one period
delete_balance / delete_flow        # period-level (or single entry by composite key)
add_snapshot / edit_snapshot / delete_snapshot / show_snapshot
show_portfolio / show_txns / show_balance / show_flow / show_prices
show_dividend / show_news / show_insider / show_financials / show_earnings
report_balance / report_flow / report_combined / report_settle
sync_prices
```

## Dev

```bash
yarn dev:cli      # Run CLI (e.g. yarn dev:cli portfolio)
yarn typecheck    # Turbo typecheck across all packages
```

