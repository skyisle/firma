# Contributing to firma

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

Build order: `@firma/finnhub` → `@firma/db` → `firma-app`

## Extension points

**Swap the price provider** → edit `createPriceProvider()` in `apps/cli/src/providers/prices.ts`.

**Swap the storage layer** → implement `DataRepository` against your API and swap it into `getRepository()` in `apps/cli/src/db/repositories.ts`.

## Adding a command

Every new command needs both a CLI entry and a matching MCP tool:

- CLI: `apps/cli/src/commands/<name>.ts` + register in `apps/cli/src/index.ts`
- MCP: add `server.tool()` in `apps/mcp/src/index.ts`

MCP tool naming: `add_*` (write), `show_*` (read), `report_*` (aggregated), `edit_*` / `delete_*` (mutations).

## Dev setup

Requires Node.js 22+ and Yarn Berry.

```bash
corepack enable
yarn install

yarn dev:cli show portfolio    # run CLI in dev mode
yarn typecheck                 # full type check across all packages
```
