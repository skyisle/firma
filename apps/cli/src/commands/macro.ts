import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import type { MacroResult, MacroUnit } from '@firma/fred';
import { assembleMacro, readCachedMacro } from '../services/macro.ts';
import { getDefaultCurrency } from '../config.ts';
import { tierColor, deltaColor, type Tier, type Polarity } from '../utils/index.ts';

// Per-indicator coloring spec.
// `level` colors the current value; `polarity` colors the deltas.
type Spec = { level: (v: number) => Tier; polarity: Polarity };

const SPEC: Record<string, Spec> = {
  vix:       { level: v => v < 15 ? 'good' : v < 20 ? 'neutral' : v < 30 ? 'caution' : 'alert', polarity: 'up_bad' },
  ust10:     { level: () => 'neutral', polarity: 'up_bad' },                                            // for stock holders, rising rates = bad
  curve:     { level: v => v > 0.25 ? 'good' : v > 0 ? 'neutral' : v > -0.5 ? 'caution' : 'alert', polarity: 'up_good' },
  usd_index: { level: () => 'neutral', polarity: 'up_bad' },                                            // strong USD = headwind for US multinationals
  hy_spread: { level: v => v < 3 ? 'good' : v < 4 ? 'neutral' : v < 5 ? 'caution' : 'alert', polarity: 'up_bad' },
  breakeven: { level: v => v >= 1.8 && v <= 2.5 ? 'good' : v >= 1.5 && v <= 3 ? 'neutral' : 'caution', polarity: 'neutral' },
  fed_funds: { level: () => 'neutral', polarity: 'neutral' },
  fx:        { level: () => 'neutral', polarity: 'neutral' },                                           // direction depends on user POV
};

const fmtLevel = (v: number) => v.toFixed(2);
const fmtPercent = (v: number) => `${v.toFixed(2)}%`;
const fmtPrice = (v: number) =>
  v >= 100 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
           : v.toFixed(4);

const fmtCurrent = (v: number, units: MacroUnit) =>
  units === 'percent' ? fmtPercent(v) : units === 'price' ? fmtPrice(v) : fmtLevel(v);

const fmtSignedNum = (n: number, digits = 2) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

const fmtDelta = (current: number | null, prior: number | null, units: MacroUnit, polarity: Polarity): string => {
  if (current == null || prior == null) return pc.dim('─');
  const diff = current - prior;
  if (Math.abs(diff) < 1e-9) return pc.dim('0');
  let txt: string;
  if (units === 'percent') {
    const bp = Math.round(diff * 100);
    txt = `${bp >= 0 ? '+' : '−'}${Math.abs(bp)}bp`;
  } else if (units === 'price') {
    const pct = (diff / prior) * 100;
    txt = `${fmtSignedNum(pct, 2)}%`;
  } else {
    txt = fmtSignedNum(diff, 2);
  }
  return deltaColor(polarity, diff)(txt);
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

  const COL = { LABEL: 24, CUR: 12, D30: 12, D90: 12, AVG: 12 };

  const header = [
    pc.dim('INDICATOR'.padEnd(COL.LABEL)),
    pc.dim('CURRENT'.padEnd(COL.CUR)),
    pc.dim('30d Δ'.padEnd(COL.D30)),
    pc.dim('90d Δ'.padEnd(COL.D90)),
    pc.dim('5y AVG'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.LABEL + COL.CUR + COL.D30 + COL.D90 + COL.AVG + 8));

  const renderRow = (r: MacroResult) => {
    const spec: Spec = SPEC[r.id] ?? { level: () => 'neutral', polarity: 'neutral' };
    const curRaw = r.current != null ? fmtCurrent(r.current, r.units) : '─';
    const tier = r.current != null ? spec.level(r.current) : 'neutral';
    const cur = r.current != null ? tierColor[tier](curRaw) : pc.dim(curRaw);

    return [
      r.label.padEnd(COL.LABEL),
      cur.padEnd(COL.CUR),
      fmtDelta(r.current, r.prior_30d, r.units, spec.polarity).padEnd(COL.D30),
      fmtDelta(r.current, r.prior_90d, r.units, spec.polarity).padEnd(COL.D90),
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
