import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { aggregateHoldings } from '@firma/db';
import { fetchFxRates } from '../services/fx.ts';
import { fmtAmount, FALLBACK_RATES, pickDisplayCurrency } from '../utils/index.ts';

const COL = { TICKER: 8, SHARES: 8, YIELD: 8, DPS: 10, ANNUAL: 14 };

export const showDividendCommand = async ({ json = false, currency }: { json?: boolean; currency?: string } = {}) => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());

  if (holdings.size === 0) {
    if (json) { process.stdout.write('[]\n'); return; }
    log.warn('No holdings found.');
    return;
  }

  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p]));

  const rows = [...holdings.entries()]
    .map(([ticker, h]) => {
      const p = priceMap.get(ticker);
      const dps         = p?.dividend_per_share ?? null;
      const yieldPct    = p?.dividend_yield     ?? null;
      const annualIncome = dps != null ? dps * h.shares : null;
      return { ticker, shares: h.shares, dps, yieldPct, annualIncome };
    })
    .filter(r => r.dps != null)
    .sort((a, b) => (b.yieldPct ?? 0) - (a.yieldPct ?? 0));

  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }

  if (rows.length === 0) {
    log.warn('No dividend data found. Run `firma sync` to fetch latest prices.');
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);
  const rates = await fetchFxRates().catch(() => FALLBACK_RATES);
  const usdRate = (rates['USD'] ?? FALLBACK_RATES['USD']) as number;
  const targetRate = (rates[cur] ?? FALLBACK_RATES[cur]) as number;
  // USD → display: convert to KRW first (÷ usdRate), then to target (× targetRate)
  const fmtUsd = (usd: number) => fmtAmount(usd / usdRate, cur, targetRate);

  const totalAnnual  = rows.reduce((s, r) => s + (r.annualIncome ?? 0), 0);
  const totalMonthly = totalAnnual / 12;

  const header = [
    pc.dim('TICKER'.padEnd(COL.TICKER)),
    pc.dim('SHARES'.padEnd(COL.SHARES)),
    pc.dim('YIELD'.padEnd(COL.YIELD)),
    pc.dim('ANN. DPS'.padEnd(COL.DPS)),
    pc.dim('EST. ANNUAL'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.TICKER + COL.SHARES + COL.YIELD + COL.DPS + COL.ANNUAL + 8));

  const lines = rows.map(r => [
    pc.bold(r.ticker.padEnd(COL.TICKER)),
    String(r.shares % 1 === 0 ? r.shares : r.shares.toFixed(4)).padEnd(COL.SHARES),
    (r.yieldPct != null ? pc.green(`${r.yieldPct.toFixed(2)}%`) : pc.dim('─')).padEnd(COL.YIELD),
    (r.dps != null ? `$${r.dps.toFixed(4)}` : pc.dim('─')).padEnd(COL.DPS),
    r.annualIncome != null ? pc.cyan(fmtUsd(r.annualIncome)) : pc.dim('─'),
  ].join('  '));

  const footer = [
    '',
    `${pc.dim('Annual income'.padEnd(COL.TICKER + COL.SHARES + COL.YIELD + COL.DPS + 8))}${pc.bold(pc.cyan(fmtUsd(totalAnnual)))}`,
    `${pc.dim('Monthly avg'.padEnd(COL.TICKER + COL.SHARES + COL.YIELD + COL.DPS + 8))}${pc.dim(fmtUsd(totalMonthly))}`,
  ].join('\n');

  note(`${header}\n${divider}\n${lines.join('\n')}${footer}`, 'Dividend Overview');
};
