# Firma — Project Context

Firma is a CLI-first personal asset tracker targeting overseas stock investors.
Target audience: developers (Hacker News / GeekNews demographic).

## Architecture

Turborepo monorepo with Yarn Berry (`nodeLinker: node-modules`):

```
apps/
  cli/       — @firma/cli      TypeScript CLI (Commander + Clack)
  server/    — @firma/server   Next.js 16 API server (deployed on Vercel)
packages/
  finnhub/   — @firma/finnhub  Finnhub API client (shared)
  utils/     — @firma/utils    assert() helper (shared)
```

## Development Rules

**모든 기능은 CLI + MCP 동시 구현.**
새 커맨드를 추가할 때는 반드시 대응하는 MCP 툴도 함께 작성한다.

- CLI: `apps/cli/src/commands/<name>.ts` + `apps/cli/src/index.ts` 등록
- MCP: `apps/mcp/src/index.ts` 에 `server.tool()` 추가
- MCP 툴 이름 컨벤션: `get_*` (조회), `add_*` / `set_*` (쓰기)
- 빌드 순서: `@firma/finnhub` → `@firma/mcp` → `firma-app`

## Key Design Decisions

- **Transactions as source of truth** — holdings are derived via aggregation, no holdings table
- **Local SQLite** — all data stored in `~/.firma/firma.db` via better-sqlite3 + Drizzle ORM
- **Finnhub** — stock price provider; API key stored in `~/.firma/config.json`

## CLI Commands

```
firma auth login          # Google OAuth → saves token to ~/.firma/config.json
firma auth whoami         # Show logged-in account
firma add                 # Interactive: add buy/sell transaction
firma sync                # Fetch latest prices from Finnhub
firma portfolio           # Holdings table with P&L
firma flow                # Monthly income/expense tracking
firma balance             # Monthly asset/liability snapshot
firma settle              # Month-end settlement report
firma report              # Combined balance + cash flow report
firma txns [ticker]       # Transaction history
firma news <ticker>       # Recent company news (Finnhub)
firma insider <ticker>    # Insider buy/sell transactions (Finnhub)
firma financials <ticker> # SEC-reported financials (Finnhub)
firma earnings [ticker]   # Earnings calendar (Finnhub)
firma mcp install         # Register MCP server in Claude Desktop
```

## Dev

```bash
yarn dev:cli      # Run CLI (e.g. yarn dev:cli portfolio)
yarn typecheck    # Turbo typecheck across all packages
```

## Pending

- [ ] Token refresh (JWT expires after 1h)
- [ ] `firma auth logout`
- [ ] Portfolio snapshots (historical value tracking)
- [ ] npm publish (`npm install -g firma-app`)
