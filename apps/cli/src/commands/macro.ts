import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import type { MacroResult, MacroUnit } from '@firma/fred';
import { assembleMacro, readCachedMacro } from '../services/macro.ts';
import { getDefaultCurrency } from '../config.ts';

const fmtLevel = (v: number) => v.toFixed(2);
const fmtPercent = (v: number) => `${v.toFixed(2)}%`;
const fmtPrice = (v: number) =>
  v >= 100 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
           : v.toFixed(4);

const fmtCurrent = (v: number, units: MacroUnit) =>
  units === 'percent' ? fmtPercent(v) : units === 'price' ? fmtPrice(v) : fmtLevel(v);

const fmtDelta = (current: number | null, prior: number | null, units: MacroUnit): string => {
  if (current == null || prior == null) return pc.dim('─');
  const diff = current - prior;
  if (Math.abs(diff) < 1e-9) return pc.dim('0');
  const arrow = diff >= 0 ? '+' : '';
  if (units === 'percent') {
    const bp = Math.round(diff * 100);
    const txt = `${arrow}${bp}bp`;
    return diff >= 0 ? pc.cyan(txt) : pc.yellow(txt);
  }
  if (units === 'price') {
    const pct = (diff / prior) * 100;
    const txt = `${arrow}${pct.toFixed(2)}%`;
    return diff >= 0 ? pc.cyan(txt) : pc.yellow(txt);
  }
  const txt = `${arrow}${diff.toFixed(2)}`;
  return diff >= 0 ? pc.cyan(txt) : pc.yellow(txt);
};

const fmtAvg = (v: number | null, units: MacroUnit) =>
  v == null ? pc.dim('─') : pc.dim(fmtCurrent(v, units));

export const showMacroCommand = async ({ json = false, refresh = false }: { json?: boolean; refresh?: boolean } = {}) => {
  const homeCurrency = getDefaultCurrency().toUpperCase();
  const today = new Date().toISOString().slice(0, 10);

  const cached = !refresh ? readCachedMacro(today, homeCurrency) : null;

  let data;
  if (cached) {
    data = cached;
    if (!json) log.message(pc.dim(`Using cached macro from ${cached.generated_at}. Use --refresh to regenerate.`));
  } else if (json) {
    data = await assembleMacro(homeCurrency, { refresh });
  } else {
    const s = spinner();
    s.start('Fetching FRED indicators...');
    try {
      data = await assembleMacro(homeCurrency, { refresh });
      s.stop(`Fetched ${data.indicators.length} indicators`);
    } catch (err) {
      s.stop('Failed');
      log.error(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const COL = { LABEL: 24, CUR: 12, D30: 10, D90: 10, AVG: 12 };

  const header = [
    pc.dim('INDICATOR'.padEnd(COL.LABEL)),
    pc.dim('CURRENT'.padEnd(COL.CUR)),
    pc.dim('30d Δ'.padEnd(COL.D30)),
    pc.dim('90d Δ'.padEnd(COL.D90)),
    pc.dim('5y AVG'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.LABEL + COL.CUR + COL.D30 + COL.D90 + COL.AVG + 8));

  const renderRow = (r: MacroResult) => {
    const cur = r.current != null ? fmtCurrent(r.current, r.units) : pc.dim('─');
    return [
      r.label.padEnd(COL.LABEL),
      pc.bold(cur).padEnd(COL.CUR),
      fmtDelta(r.current, r.prior_30d, r.units).padEnd(COL.D30),
      fmtDelta(r.current, r.prior_90d, r.units).padEnd(COL.D90),
      fmtAvg(r.avg_5y, r.units).padEnd(COL.AVG),
    ].join('  ');
  };

  const body = [
    header,
    divider,
    ...data.indicators.map(renderRow),
    '',
    pc.dim(`As of ${data.indicators[0]?.latest_date ?? '─'}  ·  Source: FRED  ·  Home currency: ${data.home_currency}`),
  ].join('\n');

  note(body, 'Macro Snapshot');
};
