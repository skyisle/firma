import { log, spinner, note } from '@clack/prompts';
import pc from 'picocolors';
import { createFinnhubClient } from '@firma/finnhub';
import type { EarningsItem } from '@firma/finnhub';
import { readConfig } from '../config.ts';
import { getRepository } from '../db/index.ts';
import { getActiveTickers } from '@firma/db';

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const visLen = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '').length;
const padAnsi = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visLen(s)));

const fmtBig = (n: number | null) => {
  if (n == null) return '─';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(2)}`;
};

const fmtEps = (n: number | null) =>
  n == null ? '─' : `$${n.toFixed(2)}`;

const HOUR_LABEL: Record<string, string> = { bmo: 'BMO', amc: 'AMC', dmh: 'Intra' };

const beatMiss = (actual: number | null, estimate: number | null) => {
  if (actual == null || estimate == null || estimate === 0) return '';
  const beat = actual >= estimate;
  const pct  = ((actual - estimate) / Math.abs(estimate)) * 100;
  return beat
    ? pc.green(` ▲ ${pct.toFixed(1)}%`)
    : pc.red(` ▼ ${Math.abs(pct).toFixed(1)}%`);
};

const renderTable = (items: EarningsItem[], title: string) => {
  if (items.length === 0) return;

  const COL = { TICKER: 8, DATE: 12, WHEN: 7, EPS_E: 10, EPS_A: 12, REV_E: 13 };

  const header = [
    pc.dim('TICKER'.padEnd(COL.TICKER)),
    pc.dim('DATE'.padEnd(COL.DATE)),
    pc.dim('WHEN'.padEnd(COL.WHEN)),
    pc.dim('EPS EST'.padEnd(COL.EPS_E)),
    pc.dim('EPS ACT'.padEnd(COL.EPS_A)),
    pc.dim('REV EST'.padEnd(COL.REV_E)),
    pc.dim('REV ACT'),
  ].join('  ');

  const totalW = COL.TICKER + COL.DATE + COL.WHEN + COL.EPS_E + COL.EPS_A + COL.REV_E + 14 + 6 * 2;
  const divider = pc.dim('─'.repeat(totalW));

  const rows = items.map(item => {
    const when     = (HOUR_LABEL[item.hour] ?? item.hour ?? '─').padEnd(COL.WHEN);
    const epsEst   = fmtEps(item.epsEstimate).padEnd(COL.EPS_E);
    const epsAct   = padAnsi(fmtEps(item.epsActual), COL.EPS_A);
    const revEst   = fmtBig(item.revenueEstimate).padEnd(COL.REV_E);
    const revAct   = fmtBig(item.revenueActual) + beatMiss(item.revenueActual, item.revenueEstimate);

    return [
      pc.bold(item.symbol.padEnd(COL.TICKER)),
      item.date.padEnd(COL.DATE),
      when,
      epsEst,
      epsAct,
      revEst,
      revAct,
    ].join('  ');
  });

  note(`${header}\n${divider}\n${rows.join('\n')}`, title);
};

export const showEarningsCommand = async (
  ticker: string | undefined,
  { json = false, weeks = 4 } = {},
) => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) {
    const msg = 'Finnhub API key not set. Run: firma config set finnhub-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  const client  = createFinnhubClient(apiKey);
  const today   = toDateStr(new Date());
  const future  = toDateStr(new Date(Date.now() + weeks * 7 * 86_400_000));

  if (ticker) {
    // ── Single ticker: 1 year back + N weeks ahead ──────────────────────────
    const sym      = ticker.toUpperCase();
    const yearAgo  = toDateStr(new Date(Date.now() - 365 * 86_400_000));

    const s = json ? null : spinner();
    s?.start(`Fetching earnings for ${sym}...`);

    try {
      const res   = await client.getEarningsCalendar(yearAgo, future, sym);
      const items = res.earningsCalendar ?? [];

      s?.stop(`${items.length} quarter${items.length !== 1 ? 's' : ''}`);

      if (json) {
        process.stdout.write(JSON.stringify(items, null, 2) + '\n');
        return;
      }

      if (items.length === 0) {
        log.warn(`No earnings data found for ${sym}.`);
        return;
      }

      const upcoming = items.filter(i => i.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const history  = items.filter(i => i.date <  today).sort((a, b) => b.date.localeCompare(a.date));

      if (upcoming.length > 0) renderTable(upcoming, `Upcoming Earnings — ${sym}`);
      if (history.length  > 0) renderTable(history,  `Recent Earnings — ${sym}`);
    } catch (err) {
      s?.stop('Failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
      log.error(msg);
    }
  } else {
    // ── All holdings: upcoming only ─────────────────────────────────────────
    const repo    = getRepository();
    const tickers = getActiveTickers(repo.transactions.getAll());

    if (tickers.length === 0) {
      log.warn('No holdings found. Run `firma add` to add a transaction.');
      return;
    }

    const s = json ? null : spinner();
    s?.start(`Fetching earnings for ${tickers.length} holdings...`);

    try {
      const results = await Promise.all(
        tickers.map(t =>
          client.getEarningsCalendar(today, future, t)
            .then(r => r.earningsCalendar ?? [])
            .catch((): EarningsItem[] => []),
        ),
      );
      const all = results.flat().sort((a, b) => a.date.localeCompare(b.date));

      s?.stop(`${all.length} event${all.length !== 1 ? 's' : ''} in the next ${weeks} weeks`);

      if (json) {
        process.stdout.write(JSON.stringify(all, null, 2) + '\n');
        return;
      }

      if (all.length === 0) {
        log.info(`No earnings scheduled in the next ${weeks} weeks for your holdings.`);
        return;
      }

      renderTable(all, `Upcoming Earnings — Your Holdings (next ${weeks}w)`);
    } catch (err) {
      s?.stop('Failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
      log.error(msg);
    }
  }
};
