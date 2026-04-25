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
- **Central price cache** — `prices` table shared across all users, updated by sync/cron
- **CLI auth via Google OAuth** — local HTTP server on port 54321 captures the callback code
- **JWT auth** — CLI sends `Authorization: Bearer <token>` to server; tokens stored in `~/.firma/config.json`
- **Supabase** — Auth (Google OAuth) + Postgres DB with RLS

## Supabase

Project URL: `https://kahzxbqbelpcndbmpste.supabase.co`
Schema: `supabase/schema.sql`
Tables: `transactions` (per-user, RLS), `prices` (shared cache, public read)

## Server API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | — | Email/password login (returns JWT) |
| POST | /api/auth/register | — | Email/password register |
| GET | /auth/confirm | — | Supabase email confirmation callback |
| GET | /api/transactions | Bearer | List user transactions |
| POST | /api/transactions | Bearer | Add transaction |
| GET | /api/portfolio | Bearer | Aggregated holdings + prices |
| POST | /api/sync | Bearer/Cron | Fetch prices from Finnhub → upsert |
| GET | /api/prices/[ticker] | Bearer | Single ticker price (cache-first) |

## CLI Commands

```
firma auth login     # Google OAuth → saves JWT to ~/.firma/config.json
firma auth whoami    # Show logged-in account
firma add            # Interactive: add buy/sell transaction
firma sync           # Fetch latest prices for all holdings
firma portfolio      # Display holdings table with P&L
firma flow           # (TODO) Income/expense tracking
```

## Dev

```bash
yarn dev:server   # Next.js on localhost:3000
yarn dev:cli      # Run CLI (e.g. yarn dev:cli portfolio)
yarn typecheck    # Turbo typecheck across all packages
```

## Env

`apps/server/.env.local` — see `.env.local.example` for required vars.

## Pending

- [ ] `firma flow` — income/expense tracking
- [ ] Money Scope feature parity (see conversation for full list)
- [ ] Token refresh (JWT expires after 1h)
- [ ] `firma auth logout`
- [ ] Vercel deployment
- [ ] Vercel Cron for scheduled price sync
- [ ] Portfolio snapshots (historical value tracking)
- [ ] npm publish (`npm install -g firma-app`)
- [ ] MCP server for AI integration
