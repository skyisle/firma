import { cancel, confirm, log, note, select, text } from '@clack/prompts';
import pc from 'picocolors';
import type { Snapshot } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { takeSnapshot } from '../services/snapshot.ts';
import { fetchFxRates } from '../services/fx.ts';
import { fmtAmount, FALLBACK_RATES, pickDisplayCurrency, guard } from '../utils/index.ts';

const fmtSnapshot = (s: Snapshot) => {
  const mv = (s.current_price * s.shares).toFixed(2);
  const pnl = s.avg_price != null
    ? ((s.current_price - s.avg_price) * s.shares)
    : null;
  const pnlStr = pnl != null
    ? (pnl >= 0 ? pc.green(`+$${pnl.toFixed(2)}`) : pc.red(`-$${Math.abs(pnl).toFixed(2)}`))
    : pc.dim('─');
  return `${pc.dim(s.date)}  ${pc.bold(s.ticker.padEnd(6))} ${s.shares} sh  $${s.current_price.toFixed(2)}  MV $${mv}  ${pnlStr}`;
};

export const addSnapshotCommand = async () => {
  log.step('Syncing prices...');
  const result = await takeSnapshot();

  if (!result.ok) {
    if (result.reason === 'sync-failed') {
      if (result.syncReason === 'no-key') {
        log.error('Finnhub API key not set. Run: firma config set finnhub-key <key>');
      } else if (result.syncReason === 'no-holdings') {
        log.warn('No active holdings to snapshot.');
      } else {
        log.error(`Sync failed: ${result.error ?? 'unknown error'}`);
      }
    } else {
      log.warn('No holdings with known prices — snapshot not recorded.');
    }
    process.exit(1);
  }

  log.success(`Snapshot recorded for ${result.date}: ${result.count} holding${result.count === 1 ? '' : 's'}.`);
};

export const editSnapshotCommand = async () => {
  const repo = getRepository();
  const dates = repo.snapshots.getDates();

  if (dates.length === 0) {
    log.warn('No snapshots to edit.');
    return;
  }

  const date = guard(await select({
    message: 'Select snapshot date',
    options: dates.map(d => ({ value: d, label: d })),
  })) as string;

  const entries = repo.snapshots.getByDate(date);
  const ticker = guard(await select({
    message: 'Select holding',
    options: entries.map(s => ({ value: s.ticker, label: fmtSnapshot(s) })),
  })) as string;

  let entry = entries.find(s => s.ticker === ticker)!;
  log.message(fmtSnapshot(entry));

  while (true) {
    const field = guard(await select({
      message: 'Edit which field?',
      options: [
        { value: 'shares',        label: `Shares         ${pc.dim('(' + entry.shares + ')')}` },
        { value: 'avg_price',     label: `Avg Price      ${pc.dim('(' + (entry.avg_price != null ? '$' + entry.avg_price.toFixed(4) : '—') + ')')}` },
        { value: 'current_price', label: `Current Price  ${pc.dim('($' + entry.current_price.toFixed(4) + ')')}` },
        { value: '__done__',      label: pc.dim('Done') },
      ],
    })) as string;

    if (field === '__done__') break;

    const raw = (guard(await text({
      message: `New ${field.replace('_', ' ')}`,
      initialValue: field === 'avg_price'
        ? String(entry.avg_price ?? '')
        : String(field === 'shares' ? entry.shares : entry.current_price),
      validate: val => {
        if (!val.trim() && field === 'avg_price') return;
        const n = parseFloat(val);
        if (isNaN(n) || n < 0) return 'Must be a non-negative number';
        if (field === 'shares' && n <= 0) return 'Must be > 0';
      },
    })) as string).trim();

    const update: Partial<Pick<typeof entry, 'shares' | 'avg_price' | 'current_price'>> = {};
    if (field === 'shares')        update.shares        = parseFloat(raw);
    if (field === 'avg_price')     update.avg_price     = raw ? parseFloat(raw) : null;
    if (field === 'current_price') update.current_price = parseFloat(raw);

    repo.snapshots.update(date, ticker, update);
    entry = repo.snapshots.getByDate(date).find(s => s.ticker === ticker)!;
    log.message(fmtSnapshot(entry));
  }

  log.success(`Updated ${ticker} snapshot for ${date}.`);
};

export const deleteSnapshotCommand = async (dateArg?: string) => {
  const repo = getRepository();
  const dates = repo.snapshots.getDates();

  if (dates.length === 0) {
    log.warn('No snapshots to delete.');
    return;
  }

  let date: string;
  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      log.error(`Invalid date "${dateArg}". Use YYYY-MM-DD format.`);
      process.exit(1);
    }
    if (!dates.includes(dateArg)) {
      log.error(`No snapshot for ${dateArg}.`);
      process.exit(1);
    }
    date = dateArg;
  } else {
    date = guard(await select({
      message: 'Select snapshot date to delete',
      options: dates.map(d => ({ value: d, label: d })),
    })) as string;
  }

  const entries = repo.snapshots.getByDate(date);
  const totalMV = entries.reduce((s, e) => s + e.current_price * e.shares, 0);

  log.message([
    `${pc.dim('Date:')}     ${date}`,
    `${pc.dim('Holdings:')} ${entries.length}`,
    `${pc.dim('Total MV:')} $${totalMV.toFixed(2)}`,
  ].join('\n'));

  const ok = guard(await confirm({
    message: `Delete all ${entries.length} snapshot entries for ${date}?`,
    initialValue: false,
  })) as boolean;
  if (!ok) { cancel('Cancelled'); return; }

  const deleted = repo.snapshots.deleteByDate(date);
  log.success(`Deleted ${deleted} snapshot entr${deleted === 1 ? 'y' : 'ies'} for ${date}.`);
};

const COL = { D: 12, N: 8, P: 10, MV: 14, PNL: 14 };

export const showSnapshotCommand = async (
  tickerArg?: string,
  opts: { from?: string; to?: string; json?: boolean; currency?: string } = {},
) => {
  const repo = getRepository();
  const entries = repo.snapshots.getAll(opts.from, opts.to);

  if (entries.length === 0) {
    log.warn('No snapshot data found.');
    return;
  }

  const cur = await pickDisplayCurrency(opts.currency, opts.json ?? false);
  const rates = await fetchFxRates().catch(() => FALLBACK_RATES);
  const usdRate = (rates['USD'] ?? FALLBACK_RATES['USD']) as number;
  const targetRate = (rates[cur] ?? FALLBACK_RATES[cur]) as number;
  const fmtUsd = (usd: number) => fmtAmount(usd / usdRate, cur, targetRate);
  const fmtDelta = (usd: number) => {
    const s = fmtUsd(Math.abs(usd));
    return usd >= 0 ? pc.green(`+${s}`) : pc.red(`-${s}`);
  };

  if (tickerArg) {
    const ticker = tickerArg.toUpperCase();
    const rows = entries.filter(e => e.ticker === ticker);
    if (rows.length === 0) {
      log.warn(`No snapshots for ${ticker}.`);
      return;
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }

    const header = [
      pc.dim('DATE'.padEnd(COL.D)),
      pc.dim('SHARES'.padEnd(COL.N)),
      pc.dim('PRICE'.padEnd(COL.P)),
      pc.dim('MKT VALUE'.padEnd(COL.MV)),
      pc.dim('UNREALIZED P&L'),
    ].join('  ');
    const divider = pc.dim('─'.repeat(COL.D + COL.N + COL.P + COL.MV + COL.PNL + 8));

    const lines = rows.map(s => {
      const mv  = s.current_price * s.shares;
      const pnl = s.avg_price != null ? (s.current_price - s.avg_price) * s.shares : null;
      const pnlStr = pnl != null ? fmtDelta(pnl) : pc.dim('─');
      return [
        s.date.padEnd(COL.D),
        s.shares.toFixed(4).padEnd(COL.N),
        fmtUsd(s.current_price).padEnd(COL.P),
        fmtUsd(mv).padEnd(COL.MV),
        pnlStr,
      ].join('  ');
    });

    note(`${header}\n${divider}\n${lines.join('\n')}`, `${ticker} Snapshot History`);
    return;
  }

  // Group by date → total market value
  const byDate = entries.reduce((map, e) => {
    const prev = map.get(e.date) ?? 0;
    map.set(e.date, prev + e.current_price * e.shares);
    return map;
  }, new Map<string, number>());

  const rows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (opts.json) {
    process.stdout.write(JSON.stringify(
      rows.map(([date, total_market_value]) => ({ date, total_market_value })),
      null, 2,
    ) + '\n');
    return;
  }

  const maxMV = Math.max(...rows.map(([, v]) => v));
  const BAR_W = 24;
  const header = [pc.dim('DATE'.padEnd(COL.D)), pc.dim('TOTAL MARKET VALUE'), ''].join('  ');
  const divider = pc.dim('─'.repeat(COL.D + BAR_W + 20));

  const lines = rows.map(([date, mv], i) => {
    const prev = rows[i - 1];
    const delta = prev != null ? mv - prev[1] : null;
    const deltaStr = delta != null ? fmtDelta(delta) : '';
    const ratio = maxMV > 0 ? mv / maxMV : 0;
    const filled = Math.round(ratio * BAR_W);
    const bar = pc.cyan('█'.repeat(filled)) + pc.dim('░'.repeat(BAR_W - filled));
    return `${pc.dim(date.padEnd(COL.D))}  ${bar}  ${fmtUsd(mv)}  ${deltaStr}`;
  });

  note(`${header}\n${divider}\n${lines.join('\n')}`, 'Portfolio Value History');
};
