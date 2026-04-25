import { log, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { getRepository } from '../db/index.ts';
import { aggregateHoldings } from '@firma/db';
import { syncPrices } from '../services/sync.ts';

const fmt = {
  usd: (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
  shares: (n: number) => n % 1 === 0 ? `${n}` : n.toFixed(4),
};

const colorPnl = (n: number, text: string) => n >= 0 ? pc.green(text) : pc.red(text);
const COL = { TICKER: 8, SHARES: 8, AVG: 12, PRICE: 12, PNL: 22 };

export const showPortfolioCommand = async ({ json = false, sync = true } = {}) => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());

  if (holdings.size === 0) {
    if (json) { process.stdout.write('[]\n'); return; }
    log.warn('No transactions found. Run `firma add txn` to add your first trade.');
    return;
  }

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
    pc.dim('P&L'),
  ].join('  ');
  const divider = pc.dim('─'.repeat(COL.TICKER + COL.SHARES + COL.AVG + COL.PRICE + COL.PNL + 8));

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

    return [
      pc.bold(ticker.padEnd(COL.TICKER)),
      fmt.shares(h.shares).padEnd(COL.SHARES),
      (avgPrice != null ? fmt.usd(avgPrice) : pc.dim('─')).padEnd(COL.AVG),
      (p ? fmt.usd(p.current_price) : pc.dim('─')).padEnd(COL.PRICE),
      pnl != null ? colorPnl(pnl, pnlText) : pnlText,
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

  const lastSynced = lastSyncedAt
    ? `\n${pc.dim('Synced'.padEnd(LBL) + new Date(lastSyncedAt).toLocaleString('en-US'))}`
    : `\n${pc.dim('Not synced — run `firma sync`')}`;

  note(`${header}\n${divider}\n${rows.join('\n')}\n${divider}\n${summary}${lastSynced}`, 'Portfolio');
};
