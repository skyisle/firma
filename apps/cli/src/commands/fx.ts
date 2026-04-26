import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';

const renderCoverage = (rows: ReturnType<ReturnType<typeof getRepository>['fx']['getCoverage']>) => {
  if (rows.length === 0) return pc.dim('  (cache empty — run `firma sync fx`)');
  const COL = { CUR: 8, COUNT: 8, FIRST: 14, LAST: 14 };
  const header = [
    pc.dim('CURRENCY'.padEnd(COL.CUR)),
    pc.dim('ROWS'.padEnd(COL.COUNT)),
    pc.dim('FIRST'.padEnd(COL.FIRST)),
    pc.dim('LAST'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.CUR + COL.COUNT + COL.FIRST + COL.LAST + 6));
  const lines = rows.map(r =>
    [
      pc.bold(r.currency.padEnd(COL.CUR)),
      String(r.count).padEnd(COL.COUNT),
      r.first_date.padEnd(COL.FIRST),
      r.last_date,
    ].join('  ')
  );
  return `${header}\n${divider}\n${lines.join('\n')}`;
};

const renderSeries = (rows: ReturnType<ReturnType<typeof getRepository>['fx']['getRange']>, currency: string) => {
  if (rows.length === 0) return pc.dim(`  (no rates cached for ${currency} in this range)`);
  const COL = { DATE: 14, RATE: 16 };
  const header = [pc.dim('DATE'.padEnd(COL.DATE)), pc.dim(`${currency.toUpperCase()} per USD`)].join('  ');
  const divider = pc.dim('─'.repeat(COL.DATE + COL.RATE + 4));
  const lines = rows.map(r => `${r.date.padEnd(COL.DATE)}  ${r.rate_to_usd.toFixed(4)}`);
  return `${header}\n${divider}\n${lines.join('\n')}`;
};

export const showFxCommand = async (
  currency: string | undefined,
  { json = false, from, to, limit = 30 }: { json?: boolean; from?: string; to?: string; limit?: number } = {},
) => {
  const repo = getRepository();

  if (!currency) {
    const coverage = repo.fx.getCoverage();
    if (json) { process.stdout.write(JSON.stringify(coverage, null, 2) + '\n'); return; }
    if (coverage.length === 0) {
      log.warn('FX cache is empty. Run `firma sync fx` to populate.');
      return;
    }
    note(renderCoverage(coverage), 'FX Rate Cache (KRW/JPY/EUR/CNY/GBP per 1 USD)');
    return;
  }

  const cur = currency.toUpperCase();
  if (cur === 'USD') {
    if (json) { process.stdout.write(JSON.stringify({ currency: 'USD', rate_to_usd: 1.0, note: 'USD is the base — always 1.0' }) + '\n'); return; }
    log.info('USD is the base currency — always 1.0 against itself.');
    return;
  }

  const rows = repo.fx.getRange({ currency: cur, from, to, limit: from || to ? undefined : limit });
  if (json) {
    process.stdout.write(JSON.stringify({ currency: cur, count: rows.length, observations: rows }, null, 2) + '\n');
    return;
  }

  if (rows.length === 0) {
    log.warn(`No FX rates cached for ${cur}${from || to ? ' in the requested range' : ''}. Run \`firma sync fx\`.`);
    return;
  }

  const range = from || to ? `  ${pc.dim(`(${from ?? '…'} → ${to ?? '…'})`)}` : `  ${pc.dim(`(latest ${rows.length})`)}`;
  note(renderSeries(rows, cur), `FX History — ${cur} per USD${range}`);
};
