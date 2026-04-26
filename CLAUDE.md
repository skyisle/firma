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
  fred/      — @firma/fred     FRED (St. Louis Fed) API client + macro snapshot helper
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
- **FRED** — macro data provider (rates, yields, FX, inflation); API key stored in `~/.firma/config.json`
- **Historical FX cache** — `fx_rates` table caches daily rates for KRW/JPY/EUR/CNY/GBP per USD. Backfilled from FRED on `firma sync` (or `firma sync fx`), starting from earliest user transaction/balance/flow date. Increment-only on subsequent runs. USD has no row (returns 1.0 in code).

## Build: MCP bundling

`apps/mcp`는 published 패키지가 아니다. CLI 빌드 시 `apps/mcp/dist/index.js`를 `apps/cli/dist/mcp.js`로 복사해서 `firma-mcp` 바이너리로 배포한다.

tsup 기본 동작은 node_modules 의존성을 external로 남긴다. 개발 환경에서는 Yarn hoisting으로 루트 `node_modules`에서 찾지만, `npm i -g firma-app`으로 글로벌 설치하면 `firma-app`의 deps만 설치되므로 MCP 전용 패키지(`@modelcontextprotocol/sdk`, `zod`)가 누락된다.

따라서 `apps/mcp/tsup.config.ts`에서 해당 패키지를 `noExternal`로 번들에 직접 포함시킨다. `better-sqlite3`는 네이티브 애드온이므로 절대 번들에 포함하지 않는다 (항상 external).

MCP 전용 deps를 추가할 때는 `apps/mcp/package.json`에만 선언하고, `apps/mcp/tsup.config.ts`의 `noExternal` 배열에도 추가한다. `apps/cli/package.json`에는 넣지 않는다.

## CLI Commands

Three verb groups: `add` (input), `show` (read), `report` (aggregated).

```
# config
firma config set finnhub-key <key>
firma config set fred-key <key>
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
firma show concentration       # HHI by ticker / currency / sector / country
firma show macro               # FRED macro snapshot (8 indicators + dynamic FX)
firma show stress              # Economic Stress Index (0-100) from 5 FRED series
firma show regime              # Macro regime bias (Risk-on / Mixed / Risk-off) from 5 signals
firma show fx [currency]       # Inspect cached FX history (coverage summary or per-currency series)
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
firma brief                   # daily brief: movers + news + earnings (cached per day)
firma doctor                  # check setup status (keys, data, FX cache); suggests next steps
firma sync                    # prices (Finnhub) + FX history (FRED) — default
firma sync fx                 # FX history only — increment-only backfill
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
show_concentration                  # HHI by dimension
show_macro                          # curated FRED macro snapshot (8 indicators + FX)
show_stress                         # Economic Stress Index (0-100, 5 FRED series weighted)
show_regime                         # Macro regime bias (5 binary signals → Risk-on / Mixed / Risk-off)
fetch_fred_series / search_fred_series  # raw FRED data layer
sync_fx_rates                       # backfill historical FX rate cache (KRW/JPY/EUR/CNY/GBP per USD)
get_fx_rate                         # lookup historical FX rate for a date
show_fx_history                     # inspect cached FX series (coverage summary or per-currency)
setup_status                        # diagnostic: keys/data/cache + next_steps array
get_brief                           # daily brief (cached per day)
report_balance / report_flow / report_combined / report_settle
sync_prices
```

## Dev

```bash
yarn dev:cli      # Run CLI (e.g. yarn dev:cli portfolio)
yarn typecheck    # Turbo typecheck across all packages
```

