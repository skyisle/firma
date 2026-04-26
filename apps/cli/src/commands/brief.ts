import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { assembleBrief, readCachedBrief, type BriefData } from '../services/brief.ts';

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const renderMovers = (m: BriefData['movers']): string[] => {
  const colTicker = 8, colPrice = 12, colChg = 10;
  const row = (p: { ticker: string; change_percent: number; current_price: number }, color: (s: string) => string) =>
    `  ${pc.bold(p.ticker.padEnd(colTicker))}${`$${p.current_price.toFixed(2)}`.padEnd(colPrice)}${color(fmtPct(p.change_percent).padStart(colChg))}`;

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

const renderNews = (news: BriefData['news'], limit = 8): string[] => {
  if (news.length === 0) return [pc.dim('  (no news in last 24h)')];
  const items = news.slice(0, limit);
  return items.map(n => {
    const headline = n.headline.length > 90 ? n.headline.slice(0, 87) + '...' : n.headline;
    return `  ${pc.bold(pc.cyan(n.ticker.padEnd(6)))}${headline}\n        ${pc.dim(n.source)}`;
  });
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

  const { portfolio, movers, news, earnings_upcoming } = data;

  const summaryLine = `${pc.dim('Portfolio:')} ${pc.bold(fmtUsd(portfolio.total_value_usd))} ${pc.dim(`across ${portfolio.holdings_count} holding${portfolio.holdings_count === 1 ? '' : 's'}`)}`;

  const body = [
    summaryLine,
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
