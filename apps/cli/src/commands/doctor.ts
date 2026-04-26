import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { aggregateHoldings } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { readConfig } from '../config.ts';

type CheckStatus = 'ok' | 'warn' | 'missing';

type Check = {
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
};

const SYMBOL: Record<CheckStatus, string> = {
  ok:      pc.green('✓'),
  warn:    pc.yellow('!'),
  missing: pc.red('✗'),
};

const renderChecks = (checks: Check[]): string => {
  const labelW = Math.max(...checks.map(c => c.label.length));
  return checks.map(c => {
    const head = `  ${SYMBOL[c.status]}  ${c.label.padEnd(labelW)}  ${c.detail}`;
    return c.fix ? `${head}\n     ${pc.dim(`→ ${c.fix}`)}` : head;
  }).join('\n');
};

const summarize = (checks: Check[]): string => {
  const missing = checks.filter(c => c.status === 'missing').length;
  const warn    = checks.filter(c => c.status === 'warn').length;
  if (missing === 0 && warn === 0) return pc.green('All systems ready. Run `firma brief` for a daily snapshot.');
  if (missing === 0) return pc.yellow(`${warn} item${warn === 1 ? '' : 's'} could be improved.`);
  return pc.red(`${missing} required item${missing === 1 ? '' : 's'} missing.`);
};

export const doctorCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const cfg = readConfig() ?? {};
  const repo = getRepository();

  const txns        = repo.transactions.getAll();
  const holdings    = aggregateHoldings(txns);
  const balanceCnt  = repo.balance.getAll().length;
  const flowCnt     = repo.flow.getAll().length;
  const fxCount     = repo.fx.count();
  const fxCoverage  = repo.fx.getCoverage();

  const checks: Check[] = [
    {
      label: 'Finnhub API key',
      status: cfg.finnhub_api_key ? 'ok' : 'missing',
      detail: cfg.finnhub_api_key ? 'set' : 'not set — required for prices, news, earnings',
      fix: cfg.finnhub_api_key ? undefined : 'firma config set finnhub-key <key>  (free at finnhub.io)',
    },
    {
      label: 'FRED API key',
      status: cfg.fred_api_key ? 'ok' : 'warn',
      detail: cfg.fred_api_key ? 'set' : 'not set — needed for macro indicators and historical FX',
      fix: cfg.fred_api_key ? undefined : 'firma config set fred-key <key>  (free at fred.stlouisfed.org)',
    },
    {
      label: 'Display currency',
      status: 'ok',
      detail: `${(cfg.currency ?? 'USD').toUpperCase()}${cfg.currency ? '' : ' (default)'}`,
    },
    {
      label: 'Transactions',
      status: txns.length > 0 ? 'ok' : 'warn',
      detail: `${txns.length} recorded · ${holdings.size} active holding${holdings.size === 1 ? '' : 's'}`,
      fix: txns.length === 0
        ? 'Tell Claude: "Here\'s my trade history [paste/CSV/screenshot]. Set up firma."  (or `firma add txn`)'
        : undefined,
    },
    {
      label: 'Balance entries',
      status: balanceCnt > 0 ? 'ok' : 'warn',
      detail: `${balanceCnt} entries`,
      fix: balanceCnt === 0 ? 'firma add balance  (or ask Claude to import a net-worth spreadsheet)' : undefined,
    },
    {
      label: 'Cash flow entries',
      status: flowCnt > 0 ? 'ok' : 'warn',
      detail: `${flowCnt} entries`,
      fix: flowCnt === 0 ? 'firma add flow  (or ask Claude to import income/expense data)' : undefined,
    },
    {
      label: 'FX rate cache',
      status: fxCount > 0 ? 'ok' : (cfg.fred_api_key ? 'warn' : 'missing'),
      detail: fxCount > 0
        ? `${fxCount} rows · ${fxCoverage.length} currencies · ${fxCoverage[0]?.first_date ?? '─'} → ${fxCoverage[0]?.last_date ?? '─'}`
        : 'empty',
      fix: fxCount === 0
        ? (cfg.fred_api_key
            ? 'firma sync fx  (backfills from your earliest entry date)'
            : 'set FRED key first, then `firma sync`')
        : undefined,
    },
  ];

  if (json) {
    process.stdout.write(JSON.stringify({
      checks: checks.map(c => ({ label: c.label, status: c.status, detail: c.detail, fix: c.fix ?? null })),
      ready: checks.every(c => c.status === 'ok'),
    }, null, 2) + '\n');
    return;
  }

  note(`${renderChecks(checks)}\n\n  ${summarize(checks)}`, 'firma doctor — setup status');

  const fixes = checks.filter(c => c.fix).map(c => `  • ${c.fix}`);
  if (fixes.length > 0) {
    log.message(pc.bold('Suggested next steps:'));
    log.message(fixes.join('\n'));
  }
};
