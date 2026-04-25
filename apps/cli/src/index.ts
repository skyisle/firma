#!/usr/bin/env node
import { Command } from 'commander';
import { intro, outro, log } from '@clack/prompts';
import pc from 'picocolors';

import { syncCommand } from './commands/sync.ts';
import { addTxnCommand } from './commands/add.ts';
import { editTxnCommand, editBalanceCommand, editFlowCommand } from './commands/edit.ts';
import { deleteTxnCommand, deleteBalanceCommand, deleteFlowCommand } from './commands/delete.ts';
import { addBalanceCommand, showBalanceCommand } from './commands/balance.ts';
import { addFlowCommand, showFlowCommand } from './commands/flow.ts';
import { addMonthlyCommand } from './commands/monthly.ts';
import { showPortfolioCommand } from './commands/portfolio.ts';
import { showTxnsCommand } from './commands/txns.ts';
import { showNewsCommand } from './commands/news.ts';
import { showInsiderCommand } from './commands/insider.ts';
import { showFinancialsCommand } from './commands/financials.ts';
import { showEarningsCommand } from './commands/earnings.ts';
import { reportCommand, type Currency } from './commands/report.ts';

import { loginCommand } from './commands/auth/login.ts';
import { whoamiCommand } from './commands/auth/whoami.ts';
import { logoutCommand } from './commands/auth/logout.ts';
import { mcpInstallCommand } from './commands/mcp.ts';
import { setConfigValue, readConfig } from './config.ts';

const jsonMode = process.argv.includes('--json');

const handleFatalError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ error: message }) + '\n');
  } else {
    log.error(message);
  }
  process.exit(1);
};

process.on('unhandledRejection', handleFatalError);
process.on('uncaughtException', handleFatalError);

const UNGUARDED = new Set(['login', 'logout', 'whoami', 'set', 'get', 'install']);

const program = new Command();

program.hook('preAction', (_thisCommand, actionCommand) => {
  if (UNGUARDED.has(actionCommand.name())) return;
  const config = readConfig();
  if (!config?.access_token) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ error: 'Not logged in. Run: firma auth login' }) + '\n');
    } else {
      log.error('Not logged in. Run ' + pc.bold('firma auth login') + ' to authenticate.');
    }
    process.exit(1);
  }
});

const wrap = <Args extends unknown[]>(
  label: string,
  fn: (...args: Args) => Promise<void> | void,
) => async (...args: Args) => {
  intro(pc.bgCyan(pc.black(` ${label} `)));
  await fn(...args);
  outro('Done');
};

const wrapMaybeJson = <Args extends unknown[]>(
  label: string,
  fn: (...args: Args) => Promise<void> | void,
  isJson: (...args: Args) => boolean,
) => async (...args: Args) => {
  const json = isJson(...args);
  if (!json) intro(pc.bgCyan(pc.black(` ${label} `)));
  await fn(...args);
  if (!json) outro('Done');
};

program
  .name('firma')
  .description('Personal asset tracker for overseas investors')
  .version('0.3.0');

// ── add ────────────────────────────────────────────────
const add = program.command('add').description('Record a new entry');

add
  .command('txn')
  .description('Add a stock transaction (buy/sell/deposit/dividend/tax)')
  .action(wrap('firma add txn', addTxnCommand));

add
  .command('balance')
  .description('Record monthly asset & liability snapshot')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(wrap('firma add balance', (opts: { period?: string }) => addBalanceCommand({ period: opts.period })));

add
  .command('flow')
  .description('Record monthly income & expenses')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(wrap('firma add flow', (opts: { period?: string }) => addFlowCommand({ period: opts.period })));

add
  .command('monthly')
  .description('Month-end entry: balance sheet + cash flow in one flow')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(wrap('firma add monthly', (opts: { period?: string }) => addMonthlyCommand({ period: opts.period })));

// ── show (read-only, --json supported) ─────────────────
const show = program.command('show').description('Show data (use --json for scripting)');

show
  .command('portfolio')
  .alias('p')
  .description('Holdings overview with P&L (auto-syncs prices first)')
  .option('--json',     'Output as JSON')
  .option('--no-sync',  'Skip price sync, use cached prices')
  .action(wrapMaybeJson('firma show portfolio',
    (opts: { json?: boolean; sync: boolean }) => showPortfolioCommand({ json: opts.json ?? false, sync: opts.sync }),
    (opts) => opts.json ?? false));

show
  .command('txns [ticker]')
  .alias('t')
  .description('Transaction history (optionally filtered by ticker)')
  .option('--json', 'Output as JSON')
  .action(wrapMaybeJson('firma show txns',
    (ticker: string | undefined, opts: { json?: boolean }) => showTxnsCommand(ticker, { json: opts.json ?? false }),
    (_t, opts) => opts.json ?? false));

show
  .command('balance')
  .description('Show stored balance entries for a period')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .option('--json', 'Output as JSON')
  .action(wrapMaybeJson('firma show balance',
    (opts: { period?: string; json?: boolean }) => showBalanceCommand({ json: opts.json ?? false, period: opts.period }),
    (opts) => opts.json ?? false));

show
  .command('flow')
  .description('Show stored flow entries for a period')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .option('--json', 'Output as JSON')
  .action(wrapMaybeJson('firma show flow',
    (opts: { period?: string; json?: boolean }) => showFlowCommand({ json: opts.json ?? false, period: opts.period }),
    (opts) => opts.json ?? false));

show
  .command('news <ticker>')
  .description('Latest company news from Finnhub')
  .option('--days <n>',  'Days to look back (default: 7)', '7')
  .option('--limit <n>', 'Max articles to show (default: 10)', '10')
  .option('--json',      'Output as JSON')
  .action(wrapMaybeJson('firma show news',
    (ticker: string, opts: { days: string; limit: string; json?: boolean }) =>
      showNewsCommand(ticker, { json: opts.json ?? false, days: Number(opts.days), limit: Number(opts.limit) }),
    (_t, opts) => opts.json ?? false));

show
  .command('insider <ticker>')
  .description('Insider buy/sell transactions from Finnhub')
  .option('--limit <n>', 'Max transactions to show (default: 20)', '20')
  .option('--json',      'Output as JSON')
  .action(wrapMaybeJson('firma show insider',
    (ticker: string, opts: { limit: string; json?: boolean }) =>
      showInsiderCommand(ticker, { json: opts.json ?? false, limit: Number(opts.limit) }),
    (_t, opts) => opts.json ?? false));

show
  .command('financials <ticker>')
  .description('SEC-reported financials (income, cash flow, balance sheet)')
  .option('--annual',    'Show annual periods instead of quarterly')
  .option('--limit <n>', 'Number of periods to show (default: 4)', '4')
  .option('--json',      'Output as JSON')
  .action(wrapMaybeJson('firma show financials',
    (ticker: string, opts: { annual?: boolean; limit: string; json?: boolean }) =>
      showFinancialsCommand(ticker, { json: opts.json ?? false, annual: opts.annual ?? false, limit: Number(opts.limit) }),
    (_t, opts) => opts.json ?? false));

show
  .command('earnings [ticker]')
  .description('Earnings calendar — upcoming (all holdings) or history+upcoming (single ticker)')
  .option('--weeks <n>', 'Look-ahead window in weeks (default: 4)', '4')
  .option('--json',      'Output as JSON')
  .action(wrapMaybeJson('firma show earnings',
    (ticker: string | undefined, opts: { weeks: string; json?: boolean }) =>
      showEarningsCommand(ticker, { json: opts.json ?? false, weeks: Number(opts.weeks) }),
    (_t, opts) => opts.json ?? false));

// ── report (aggregated views, --json supported) ────────
program
  .command('report [target]')
  .alias('r')
  .description('Aggregated reports: balance, flow, settle, or omit for combined')
  .option('-c, --currency <currency>', 'Display currency: KRW, USD, EUR, JPY, CNY, GBP', 'KRW')
  .option('-p, --period <period>',     'Period in YYYY-MM (used by `report settle`)')
  .option('--json',                    'Output raw data as JSON')
  .action(wrapMaybeJson('firma report',
    (target: string | undefined, opts: { currency: string; period?: string; json?: boolean }) =>
      reportCommand(target, opts.currency.toUpperCase() as Currency, { json: opts.json ?? false, period: opts.period }),
    (_t, opts) => opts.json ?? false));

// ── edit ───────────────────────────────────────────────
const edit = program.command('edit').description('Edit an existing entry');

edit
  .command('txn [id]')
  .description('Edit a transaction (interactive picker if id omitted)')
  .action(wrap('firma edit txn', editTxnCommand));

edit
  .command('balance [period]')
  .description('Edit a monthly balance snapshot (re-runs add wizard with existing values pre-filled)')
  .action(wrap('firma edit balance', editBalanceCommand));

edit
  .command('flow [period]')
  .description('Edit a monthly flow entry (re-runs add wizard with existing values pre-filled)')
  .action(wrap('firma edit flow', editFlowCommand));

// ── delete ─────────────────────────────────────────────
const del = program.command('delete').alias('rm').description('Delete an existing entry');

del
  .command('txn [id]')
  .description('Delete a transaction (interactive picker if id omitted)')
  .action(wrap('firma delete txn', deleteTxnCommand));

del
  .command('balance [period]')
  .description('Delete all balance entries for a period')
  .action(wrap('firma delete balance', deleteBalanceCommand));

del
  .command('flow [period]')
  .description('Delete all flow entries for a period')
  .action(wrap('firma delete flow', deleteFlowCommand));

// ── actions ────────────────────────────────────────────
program
  .command('sync')
  .description('Sync latest stock prices from Finnhub')
  .option('--json', 'Output result as JSON')
  .action(wrapMaybeJson('firma sync',
    (opts: { json?: boolean }) => syncCommand({ json: opts.json ?? false }),
    (opts) => opts.json ?? false));

// ── auth ───────────────────────────────────────────────
const auth = program.command('auth').description('Manage authentication');
auth.command('login').description('Log in to your Firma account')
  .action(wrap('firma auth login', loginCommand));
auth.command('whoami').description('Show currently logged-in account')
  .action(wrap('firma auth whoami', whoamiCommand));
auth.command('logout').description('Log out and clear saved credentials')
  .action(wrap('firma auth logout', logoutCommand));

// ── config ─────────────────────────────────────────────
const config = program.command('config').description('Manage local configuration');

config
  .command('set <key> <value>')
  .description('Set a config value (keys: finnhub-key, db-path)')
  .action((key: string, value: string) => {
    const keyMap: Record<string, 'finnhub_api_key' | 'db_path'> = {
      'finnhub-key': 'finnhub_api_key',
      'db-path':     'db_path',
    };
    const mapped = keyMap[key];
    if (!mapped) {
      log.error(`Unknown key "${key}". Valid keys: finnhub-key, db-path`);
      process.exit(1);
    }
    setConfigValue(mapped, value);
    log.success(`Set ${key}`);
  });

config
  .command('get [key]')
  .description('Show config values (keys: finnhub-key, db-path)')
  .action((key?: string) => {
    const cfg = readConfig() ?? {};
    if (key === 'finnhub-key') {
      log.message(cfg.finnhub_api_key ? pc.dim('(set)') : pc.dim('(not set)'));
    } else if (key === 'db-path') {
      log.message(cfg.db_path ?? pc.dim(`~/.firma/firma.db (default)`));
    } else {
      log.message([
        `finnhub-key  ${cfg.finnhub_api_key ? pc.green('set') : pc.dim('not set')}`,
        `db-path      ${cfg.db_path ?? pc.dim('~/.firma/firma.db (default)')}`,
      ].join('\n'));
    }
  });

// ── mcp ────────────────────────────────────────────────
const mcp = program.command('mcp').description('Manage MCP server integration');
mcp.command('install').description('Register firma MCP server in Claude Desktop config')
  .action(wrap('firma mcp install', mcpInstallCommand));

program.parse();
