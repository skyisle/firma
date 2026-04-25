#!/usr/bin/env node
import { Command } from 'commander';
import { intro, outro, log } from '@clack/prompts';
import pc from 'picocolors';
import { syncCommand } from './commands/sync.ts';
import { addCommand } from './commands/add.ts';
import { portfolioCommand } from './commands/portfolio.ts';
import { balanceCommand } from './commands/balance.ts';
import { flowCommand } from './commands/flow.ts';
import { settleCommand } from './commands/settle.ts';
import { txnsCommand } from './commands/txns.ts';
import { reportCommand, type Currency } from './commands/report.ts';
import { loginCommand } from './commands/auth/login.ts';
import { whoamiCommand } from './commands/auth/whoami.ts';
import { logoutCommand } from './commands/auth/logout.ts';
import { newsCommand } from './commands/news.ts';
import { insiderCommand } from './commands/insider.ts';
import { financialsCommand } from './commands/financials.ts';
import { earningsCommand } from './commands/earnings.ts';
import { setConfigValue, readConfig } from './config.ts';
import { mcpInstallCommand } from './commands/mcp.ts';

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

program
  .name('firma')
  .description('Personal asset tracker for overseas investors')
  .version('0.1.0');

const auth = program.command('auth').description('Manage authentication');

auth
  .command('login')
  .description('Log in to your Firma account')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma auth login ')));
    await loginCommand();
    outro('Done');
  });

auth
  .command('whoami')
  .description('Show currently logged-in account')
  .action(() => {
    intro(pc.bgCyan(pc.black(' firma auth whoami ')));
    whoamiCommand();
    outro('Done');
  });

auth
  .command('logout')
  .description('Log out and clear saved credentials')
  .action(() => {
    intro(pc.bgCyan(pc.black(' firma auth logout ')));
    logoutCommand();
    outro('Done');
  });

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

program
  .command('sync')
  .description('Sync latest stock prices from Finnhub')
  .option('--json', 'Output result as JSON')
  .action(async (opts: { json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma sync ')));
    await syncCommand({ json: opts.json ?? false });
    if (!opts.json) outro('Done');
  });

program
  .command('portfolio')
  .alias('p')
  .description('Show portfolio overview')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma portfolio ')));
    await portfolioCommand({ json: opts.json ?? false });
    if (!opts.json) outro('Done');
  });

program
  .command('add')
  .description('Add a stock transaction')
  .action(async () => {
    intro(pc.bgCyan(pc.black(' firma add ')));
    await addCommand();
    outro('Done');
  });

program
  .command('flow')
  .description('Record monthly income & expenses')
  .option('--json', 'Output stored data as JSON (read-only)')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(async (opts: { json?: boolean; period?: string }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma flow ')));
    await flowCommand({ json: opts.json ?? false, period: opts.period });
    if (!opts.json) outro('Done');
  });

program
  .command('balance')
  .description('Record monthly asset & liability snapshot')
  .option('--json', 'Output stored data as JSON (read-only)')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(async (opts: { json?: boolean; period?: string }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma balance ')));
    await balanceCommand({ json: opts.json ?? false, period: opts.period });
    if (!opts.json) outro('Done');
  });

program
  .command('settle')
  .description('Month-end settlement: balance sheet + cash flow')
  .option('--json', 'Output stored data as JSON (read-only)')
  .option('-p, --period <period>', 'Period in YYYY-MM format')
  .action(async (opts: { json?: boolean; period?: string }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma settle ')));
    await settleCommand({ json: opts.json ?? false, period: opts.period });
    if (!opts.json) outro('Done');
  });

program
  .command('report [target]')
  .alias('r')
  .description('Show reports: balance, flow, or combined (default)')
  .option('-c, --currency <currency>', 'Display currency: KRW, USD, EUR, JPY, CNY, GBP', 'KRW')
  .option('--json', 'Output raw data as JSON')
  .action(async (target: string | undefined, opts: { currency: string; json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma report ')));
    await reportCommand(target, opts.currency.toUpperCase() as Currency, { json: opts.json ?? false });
    if (!opts.json) outro('Done');
  });

program
  .command('txns [ticker]')
  .alias('t')
  .description('List transactions, optionally filtered by ticker')
  .option('--json', 'Output as JSON')
  .action(async (ticker: string | undefined, opts: { json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma txns ')));
    await txnsCommand(ticker, { json: opts.json ?? false });
    if (!opts.json) outro('Done');
  });

program
  .command('news <ticker>')
  .description('Latest company news from Finnhub')
  .option('--days <n>',  'Days to look back (default: 7)', '7')
  .option('--limit <n>', 'Max articles to show (default: 10)', '10')
  .option('--json',      'Output as JSON')
  .action(async (ticker: string, opts: { days: string; limit: string; json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma news ')));
    await newsCommand(ticker, { json: opts.json ?? false, days: Number(opts.days), limit: Number(opts.limit) });
    if (!opts.json) outro('Done');
  });

program
  .command('insider <ticker>')
  .description('Insider buy/sell transactions from Finnhub')
  .option('--limit <n>', 'Max transactions to show (default: 20)', '20')
  .option('--json',      'Output as JSON')
  .action(async (ticker: string, opts: { limit: string; json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma insider ')));
    await insiderCommand(ticker, { json: opts.json ?? false, limit: Number(opts.limit) });
    if (!opts.json) outro('Done');
  });

program
  .command('financials <ticker>')
  .description('SEC-reported financials (income, cash flow, balance sheet)')
  .option('--annual',    'Show annual periods instead of quarterly')
  .option('--limit <n>', 'Number of periods to show (default: 4)', '4')
  .option('--json',      'Output as JSON')
  .action(async (ticker: string, opts: { annual?: boolean; limit: string; json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma financials ')));
    await financialsCommand(ticker, { json: opts.json ?? false, annual: opts.annual ?? false, limit: Number(opts.limit) });
    if (!opts.json) outro('Done');
  });

program
  .command('earnings [ticker]')
  .description('Earnings calendar — upcoming (all holdings) or history+upcoming (single ticker)')
  .option('--weeks <n>', 'Look-ahead window in weeks (default: 4)', '4')
  .option('--json',      'Output as JSON')
  .action(async (ticker: string | undefined, opts: { weeks: string; json?: boolean }) => {
    if (!opts.json) intro(pc.bgCyan(pc.black(' firma earnings ')));
    await earningsCommand(ticker, { json: opts.json ?? false, weeks: Number(opts.weeks) });
    if (!opts.json) outro('Done');
  });

const mcp = program.command('mcp').description('Manage MCP server integration');

mcp
  .command('install')
  .description('Register firma MCP server in Claude Desktop config')
  .action(() => {
    intro(pc.bgCyan(pc.black(' firma mcp install ')));
    mcpInstallCommand();
    outro('Done');
  });

program.parse();
