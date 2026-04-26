import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { assembleBrief, readCachedBrief, type BriefData, type BriefMacro, type BriefSignals } from '../services/brief.ts';
import { CURRENCY_SYMBOL, type Currency } from '../utils/index.ts';

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const fmtSigned = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

const renderMovers = (m: BriefData['movers']): string[] => {
  const colTicker = 8, colPrice = 12, colChg = 10, colWeight = 10;
  const row = (p: BriefData['movers']['winners'][number], color: (s: string) => string) =>
    `  ${pc.bold(p.ticker.padEnd(colTicker))}${`$${p.current_price.toFixed(2)}`.padEnd(colPrice)}${color(fmtPct(p.change_percent).padStart(colChg))}  ${pc.dim(`${p.weight_pct.toFixed(1)}%`.padStart(colWeight))}`;

  const lines: string[] = [];
  if (m.winners.length === 0 && m.losers.length === 0) return [pc.dim('  (no price movement data — run `firma sync`)')];
  if (m.winners.length > 0) {
    lines.push(pc.bold(pc.green('  ▲ Winners')));
    lines.push(...m.winners.map(p => row(p, pc.green)));
  }
  if (m.losers.length > 0) {
    if (lines.length) lines.push('');
    lines.push(pc.bold(pc.red('  ▼ Losers')));
    lines.push(...m.losers.map(p => row(p, pc.red)));
  }
  return lines;
};

const renderInsights = (insights: BriefData['insights']): string[] => {
  if (insights.length === 0) return [pc.dim('  (no notable cross-references today)')];
  return insights.map(i => `  ${pc.cyan('•')} ${i.text}`);
};

const renderNews = (news: BriefData['news'], limit = 8): string[] => {
  if (news.length === 0) return [pc.dim('  (no news in last 24h)')];
  const items = news.slice(0, limit);
  return items.map(n => {
    const headline = n.headline.length > 90 ? n.headline.slice(0, 87) + '...' : n.headline;
    return `  ${pc.bold(pc.cyan(n.ticker.padEnd(6)))}${headline}\n        ${pc.dim(n.source)}`;
  });
};

const vixLabel = (v: number): string => {
  if (v < 15) return 'calm';
  if (v < 20) return 'moderate';
  if (v < 30) return 'elevated';
  return 'high';
};

const renderMacro = (macro: BriefMacro | null): string[] => {
  if (!macro) return [pc.dim('  (FRED key not set — run `firma config set fred-key <key>`)')];

  const homeSym = CURRENCY_SYMBOL[macro.home_currency as Currency] ?? macro.home_currency;
  const fmtHomeAmount = (n: number) => {
    const abs = Math.abs(n);
    return `${homeSym}${Math.round(abs).toLocaleString('en-US')}`;
  };

  const rows: string[] = [];

  for (const r of macro.indicators) {
    if (r.current == null) continue;
    const delta = r.prior_1d != null ? r.current - r.prior_1d : null;
    const arrow = delta == null ? '' : delta > 0 ? pc.green('▲') : delta < 0 ? pc.red('▼') : pc.dim('·');

    let valueStr: string;
    let deltaStr = '';
    let note = '';

    if (r.id === 'vix') {
      valueStr = r.current.toFixed(2);
      if (delta != null) deltaStr = pc.dim(`${arrow} ${fmtSigned(delta)}`);
      note = pc.dim(`(${vixLabel(r.current)})`);
    } else if (r.id === 'ust10') {
      valueStr = `${r.current.toFixed(2)}%`;
      if (delta != null) {
        const bp = Math.round(delta * 100);
        deltaStr = pc.dim(`${arrow} ${fmtSigned(bp, 0)}bp`);
      }
    } else if (r.id === 'fx') {
      valueStr = r.current >= 100
        ? r.current.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : r.current.toFixed(4);
      if (delta != null) {
        const pct = (delta / r.prior_1d!) * 100;
        deltaStr = pc.dim(`${arrow} ${fmtSigned(pct)}%`);
        if (delta > 0)      note = pc.dim('(USD strengthening)');
        else if (delta < 0) note = pc.dim('(USD weakening)');
      }
    } else {
      valueStr = r.current.toFixed(2);
    }

    rows.push(`  ${pc.bold(r.label.padEnd(22))}${valueStr.padEnd(12)}${deltaStr.padEnd(20)}${note}`);
  }

  if (macro.fx_impact_home != null && Math.abs(macro.fx_impact_home) >= 1) {
    const color = macro.fx_impact_home > 0 ? pc.green : pc.red;
    const sign = macro.fx_impact_home > 0 ? '+' : '−';
    rows.push('');
    rows.push(`  ${pc.dim('FX impact on portfolio:')} ${color(`${sign}${fmtHomeAmount(macro.fx_impact_home)}`)} ${pc.dim('(today vs previous trading day)')}`);
  }

  return rows;
};

const stressColor = (label: string | null) =>
  label === 'Low' ? pc.green
    : label === 'Moderate' ? pc.cyan
    : label === 'Elevated' ? pc.yellow
    : label === 'Severe' || label === 'Critical' ? pc.red
    : pc.dim;

const regimeColor = (bias: string | null) =>
  bias === 'Risk-on bias' ? pc.green
    : bias === 'Risk-off bias' ? pc.red
    : bias === 'Mixed' ? pc.yellow
    : pc.dim;

const renderSignals = (signals: BriefSignals | null): string[] => {
  if (!signals) return [pc.dim('  (FRED key not set — run `firma config set fred-key <key>`)')];

  const { stress, regime } = signals;
  const lines: string[] = [];

  const stressStr = stress.total_score != null
    ? `${stressColor(stress.label)(`${stress.total_score}/100 ${stress.label}`)}`
    : pc.dim('─');

  const known = regime.bullish_count + regime.bearish_count;
  const regimeStr = regime.bias
    ? `${regimeColor(regime.bias)(regime.bias)}  ${pc.dim(`(${regime.bullish_count}/${known})`)}`
    : pc.dim('insufficient data');

  lines.push(`  ${pc.dim('Stress'.padEnd(8))}${stressStr}`);
  lines.push(`  ${pc.dim('Regime'.padEnd(8))}${regimeStr}`);
  lines.push(pc.dim('  ※ heuristic — `firma show stress` / `show regime` for breakdown'));
  return lines;
};

const renderEarnings = (items: BriefData['earnings_upcoming']): string[] => {
  if (items.length === 0) return [pc.dim('  (no earnings in next 14 days)')];
  return items.map(e => {
    const when = e.hour === 'bmo' ? 'BMO' : e.hour === 'amc' ? 'AMC' : 'Intra';
    const eps = e.epsEstimate != null ? `EPS est $${e.epsEstimate.toFixed(2)}` : '';
    return `  ${pc.bold(e.symbol.padEnd(6))}${e.date}  ${pc.dim(when.padEnd(7))}${pc.dim(eps)}`;
  });
};

export const briefCommand = async ({ json = false, refresh = false }: { json?: boolean; refresh?: boolean } = {}) => {
  const today = new Date().toISOString().slice(0, 10);

  let data: BriefData | null = null;
  if (!refresh) data = readCachedBrief(today);

  if (!data) {
    if (json) {
      data = await assembleBrief({ refresh });
    } else {
      const s = spinner();
      s.start('Assembling daily brief...');
      try {
        data = await assembleBrief({ refresh });
        s.stop(`Brief ready (${data.news.length} news, ${data.earnings_upcoming.length} earnings, ${data.portfolio.holdings_count} holdings)`);
      } catch (err) {
        s.stop('Failed');
        log.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }
  } else if (!json) {
    log.message(pc.dim(`Using cached brief from ${data.generated_at}. Use --refresh to regenerate.`));
  }

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const { portfolio, movers, news, earnings_upcoming, macro, signals, insights } = data;

  const dailyChangeColor = portfolio.daily_change_usd >= 0 ? pc.green : pc.red;
  const dailySign = portfolio.daily_change_usd >= 0 ? '+' : '';
  const totalPnlColor = portfolio.total_pnl_usd >= 0 ? pc.green : pc.red;
  const totalPnlSign  = portfolio.total_pnl_usd >= 0 ? '+' : '';

  const summaryLine = [
    `${pc.dim('Portfolio:')} ${pc.bold(fmtUsd(portfolio.total_value_usd))} ${pc.dim(`across ${portfolio.holdings_count} holding${portfolio.holdings_count === 1 ? '' : 's'}`)}`,
    `${pc.dim('Today:')}     ${dailyChangeColor(`${dailySign}${fmtUsd(portfolio.daily_change_usd)} (${fmtPct(portfolio.daily_change_pct)})`)}`,
    portfolio.total_pnl_pct != null
      ? `${pc.dim('All-time:')}  ${totalPnlColor(`${totalPnlSign}${fmtUsd(portfolio.total_pnl_usd)} (${fmtPct(portfolio.total_pnl_pct)})`)}`
      : null,
  ].filter(Boolean).join('\n');

  const body = [
    summaryLine,
    '',
    pc.bold('INSIGHTS'),
    ...renderInsights(insights),
    '',
    pc.bold('MACRO TODAY'),
    ...renderMacro(macro),
    '',
    pc.bold('MACRO SIGNALS'),
    ...renderSignals(signals),
    '',
    pc.bold('MOVERS (today)'),
    ...renderMovers(movers),
    '',
    pc.bold('NEWS (last 24h)'),
    ...renderNews(news),
    '',
    pc.bold('UPCOMING EARNINGS (next 14d)'),
    ...renderEarnings(earnings_upcoming),
  ].join('\n');

  note(body, `Daily Brief — ${data.date}`);
};
