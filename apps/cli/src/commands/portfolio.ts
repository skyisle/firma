import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { aggregateHoldings } from '@firma/db';
import { syncPrices } from '../services/sync.ts';
import { fetchFxRates } from '../services/fx.ts';
import { fracBar, fmtAmount, entryKrw, FALLBACK_RATES, pickDisplayCurrency, stalenessLine } from '../utils/index.ts';

const fmt = {
  usd: (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
  shares: (n: number) => n % 1 === 0 ? `${n}` : n.toFixed(4),
};

const colorPnl = (n: number, text: string) => n >= 0 ? pc.green(text) : pc.red(text);
const COL = { TICKER: 8, SHARES: 8, AVG: 12, PRICE: 12, YIELD: 8, PNL: 22 };

export const showPortfolioCommand = async ({ json = false, sync = true, currency }: { json?: boolean; sync?: boolean; currency?: string } = {}) => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());

  if (holdings.size === 0) {
    if (json) { process.stdout.write('[]\n'); return; }
    log.warn('No transactions found. Run `firma add txn` to add your first trade.');
    return;
  }

  const cur = await pickDisplayCurrency(currency, json);

  if (sync) {
    if (json) {
      await syncPrices();
    } else {
      const s = spinner();
      s.start('Syncing prices...');
      const r = await syncPrices();
      if (r.ok)                          s.stop(`Synced ${r.count} stock${r.count !== 1 ? 's' : ''}`);
      else if (r.reason === 'no-key')    s.stop(pc.dim('No Finnhub key — showing cached prices'));
      else if (r.reason === 'no-holdings') s.stop(pc.dim('No holdings to sync'));
      else                               s.stop(pc.yellow('Sync failed — showing cached prices'));
    }
  }

  const tickers = [...holdings.keys()];
  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p]));

  if (json) {
    const data = tickers.map(ticker => {
      const h = holdings.get(ticker)!;
      const p = priceMap.get(ticker);
      const avgPrice = h.costShares > 0 ? h.totalCost / h.costShares : null;
      const costBasis = avgPrice != null ? avgPrice * h.costShares : 0;
      const marketValue = p ? p.current_price * h.shares : null;
      const pnl = marketValue != null ? marketValue - costBasis : null;
      return {
        ticker, shares: h.shares, avgPrice, costBasis,
        currentPrice: p?.current_price ?? null, marketValue,
        pnl, pnlPct: pnl != null && costBasis > 0 ? (pnl / costBasis) * 100 : null,
        name: p?.name ?? null, syncedAt: p?.synced_at ?? null,
      };
    });
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const header = [
    pc.dim('TICKER'.padEnd(COL.TICKER)),
    pc.dim('QTY'.padEnd(COL.SHARES)),
    pc.dim('AVG'.padEnd(COL.AVG)),
    pc.dim('PRICE'.padEnd(COL.PRICE)),
    pc.dim('YIELD'.padEnd(COL.YIELD)),
    pc.dim('P&L'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.TICKER + COL.SHARES + COL.AVG + COL.PRICE + COL.YIELD + COL.PNL + 10));

  let totalCost = 0, totalValue = 0;
  let lastSyncedAt: string | null = null;

  const rows = tickers.map(ticker => {
    const h = holdings.get(ticker)!;
    const p = priceMap.get(ticker);
    const avgPrice = h.costShares > 0 ? h.totalCost / h.costShares : null;
    const costBasis = avgPrice != null ? avgPrice * h.costShares : 0;
    const marketValue = p ? p.current_price * h.shares : null;
    const pnl = marketValue != null ? marketValue - costBasis : null;
    const pnlPct = pnl != null && costBasis > 0 ? (pnl / costBasis) * 100 : null;

    totalCost += costBasis;
    totalValue += marketValue ?? costBasis;
    if (p?.synced_at && (!lastSyncedAt || p.synced_at > lastSyncedAt)) lastSyncedAt = p.synced_at;

    const pnlText = pnl != null && pnlPct != null
      ? `${fmt.usd(pnl)} (${fmt.pct(pnlPct)})`
      : pc.dim('─');

    const yieldStr = p?.dividend_yield != null ? `${p.dividend_yield.toFixed(2)}%` : '─';

    return [
      pc.bold(ticker.padEnd(COL.TICKER)),
      fmt.shares(h.shares).padEnd(COL.SHARES),
      avgPrice != null ? fmt.usd(avgPrice).padEnd(COL.AVG) : pc.dim('─'.padEnd(COL.AVG)),
      p ? fmt.usd(p.current_price).padEnd(COL.PRICE) : pc.dim('─'.padEnd(COL.PRICE)),
      pc.dim(yieldStr.padEnd(COL.YIELD)),
      pnl != null ? colorPnl(pnl, pnlText) : pc.dim(pnlText as string),
    ].join('  ');
  });

  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const LBL = 12;
  const summary = [
    `${pc.dim('Value'.padEnd(LBL))}${pc.bold(fmt.usd(totalValue))}`,
    `${pc.dim('Cost'.padEnd(LBL))}${fmt.usd(totalCost)}`,
    `${pc.dim('P&L'.padEnd(LBL))}${colorPnl(totalPnl, `${fmt.usd(totalPnl)}  ${fmt.pct(totalPnlPct)}`)}`,
  ].join('\n');

  const lastSynced = `\n${stalenessLine(lastSyncedAt)}`;

  note(`${header}\n${divider}\n${rows.join('\n')}\n${divider}\n${summary}${lastSynced}`, 'Portfolio');

  // ── Sector allocation ───────────────────────────────
  const sectorMap = new Map<string, number>();
  const countryMap = new Map<string, number>();

  for (const ticker of tickers) {
    const h = holdings.get(ticker)!;
    const p = priceMap.get(ticker);
    if (!p) continue;
    const mv = p.current_price * h.shares;
    const sector  = p.sector  ?? 'Unknown';
    const country = p.country ?? 'Unknown';
    sectorMap.set(sector,  (sectorMap.get(sector)   ?? 0) + mv);
    countryMap.set(country, (countryMap.get(country) ?? 0) + mv);
  }

  if (sectorMap.size > 0) {
    const BAR_W = 20;
    const renderAlloc = (map: Map<string, number>, total: number) =>
      [...map.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([label, mv]) => {
          const pct = mv / total;
          const bar = pc.cyan(fracBar(pct, BAR_W)) + pc.dim('░'.repeat(BAR_W - Math.round(pct * BAR_W)));
          return `  ${label.padEnd(20)}  ${bar}  ${(pct * 100).toFixed(1)}%`;
        })
        .join('\n');

    note(renderAlloc(sectorMap, totalValue), 'Sector Allocation');
    note(renderAlloc(countryMap, totalValue), 'Country Allocation');
  }

  // ── Net worth context ───────────────────────────────
  const repo2 = getRepository();
  const balancePeriods = repo2.balance.getPeriods();
  if (balancePeriods.length > 0) {
    const latestPeriod = balancePeriods[0];
    const balEntries = repo2.balance.getByPeriod(latestPeriod);
    const BAR_W = 20;
    const rates = await fetchFxRates().catch(() => FALLBACK_RATES as Record<string, number>);
    const rate = (rates[cur] ?? FALLBACK_RATES[cur]) as number;
    const fmt2 = (krw: number) => fmtAmount(krw, cur, rate);

    const toKrw = (e: { amount: number; currency: string }) => entryKrw(e.amount, e.currency, rates);
    const totalAssets = balEntries.filter(e => e.type === 'asset').reduce((s, e) => s + toKrw(e), 0);
    const totalLiab   = balEntries.filter(e => e.type === 'liability').reduce((s, e) => s + toKrw(e), 0);
    const netWorth    = totalAssets - totalLiab;

    if (netWorth > 0) {
      const bySubType = balEntries
        .filter(e => e.type === 'asset')
        .reduce((map, e) => map.set(e.sub_type, (map.get(e.sub_type) ?? 0) + toKrw(e)), new Map<string, number>());

      const SUB_LABEL: Record<string, string> = {
        cash: 'Cash', investment: 'Investments', other: 'Other Assets',
      };

      const lines = [...bySubType.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([sub, amt]) => {
          const pct = amt / (totalAssets || 1);
          const bar = pc.cyan(fracBar(pct, BAR_W)) + pc.dim('░'.repeat(BAR_W - Math.round(pct * BAR_W)));
          return `  ${(SUB_LABEL[sub] ?? sub).padEnd(14)}  ${bar}  ${fmt2(amt)}  ${pc.dim(`${(pct * 100).toFixed(1)}%`)}`;
        });

      const portfolioMvKrw = entryKrw(totalValue, 'USD', rates);
      const portfolioMvDisplay = cur === 'USD'
        ? pc.dim(fmt.usd(totalValue))
        : `${pc.dim(fmt2(portfolioMvKrw))}  ${pc.dim(`(≈ ${fmt.usd(totalValue)})`)}`;

      lines.push('');
      lines.push(`  ${'Net Worth'.padEnd(14)}  ${pc.dim('─'.repeat(BAR_W + 2))}  ${pc.bold(fmt2(netWorth))}  ${pc.dim(`(${latestPeriod})`)}`);
      lines.push(`  ${pc.dim('Portfolio MV'.padEnd(14))}  ${pc.dim('─'.repeat(BAR_W + 2))}  ${portfolioMvDisplay}`);

      note(lines.join('\n'), 'Net Worth Breakdown');
    }
  }
};
