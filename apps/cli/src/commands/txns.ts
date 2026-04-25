import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { getDb, transactions } from '../db/index.ts';
import { eq, asc } from 'drizzle-orm';

const TYPE_COLOR: Record<string, (s: string) => string> = {
  buy:      pc.green,
  sell:     pc.red,
  deposit:  pc.cyan,
  dividend: pc.yellow,
  tax:      pc.magenta,
};

const fmt = {
  usd: (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  num: (n: number) => n % 1 === 0 ? `${n}` : n.toFixed(4),
};

const COL = { DATE: 12, TICKER: 8, TYPE: 10, SHARES: 10, PRICE: 12, TOTAL: 14, AVG: 14 };

export const txnsCommand = async (ticker?: string, { json = false } = {}) => {
  const db = getDb();
  const all = ticker
    ? db.select().from(transactions).where(eq(transactions.ticker, ticker.toUpperCase())).orderBy(asc(transactions.date)).all()
    : db.select().from(transactions).orderBy(asc(transactions.date)).all();

  const txns = [...all].reverse();

  if (txns.length === 0) {
    if (json) { process.stdout.write('[]\n'); return; }
    log.warn(ticker ? `No transactions found for ${ticker.toUpperCase()}.` : 'No transactions found.');
    return;
  }

  if (json) {
    process.stdout.write(JSON.stringify(txns, null, 2) + '\n');
    return;
  }

  const showTicker = !ticker;
  const showAvg = !!ticker;

  const header = [
    pc.dim('DATE'.padEnd(COL.DATE)),
    ...(showTicker ? [pc.dim('TICKER'.padEnd(COL.TICKER))] : []),
    pc.dim('TYPE'.padEnd(COL.TYPE)),
    pc.dim('SHARES'.padEnd(COL.SHARES)),
    pc.dim('PRICE'.padEnd(COL.PRICE)),
    pc.dim('TOTAL'.padEnd(COL.TOTAL)),
    ...(showAvg ? [pc.dim('AVG COST')] : []),
  ].join('  ');

  const totalWidth = COL.DATE + (showTicker ? COL.TICKER + 2 : 0) + COL.TYPE + COL.SHARES + COL.PRICE + COL.TOTAL + (showAvg ? COL.AVG + 2 : 0) + 8;
  const divider = pc.dim('─'.repeat(totalWidth));

  const ordered = showAvg ? [...txns].reverse() : txns;
  let shares = 0, costShares = 0, totalCost = 0;

  const rowsAsc = ordered.map(t => {
    const colorType = TYPE_COLOR[t.type] ?? ((s: string) => s);
    const total = t.shares * t.price;

    if (t.type === 'buy') {
      shares += t.shares; costShares += t.shares; totalCost += total;
    } else if (t.type === 'sell') {
      const prev = shares; shares -= t.shares;
      costShares = prev > 0 ? costShares * (shares / prev) : 0;
      totalCost = costShares > 0 ? costShares * (totalCost / costShares) : 0;
    } else if (t.type === 'deposit' && t.price > 0) {
      shares += t.shares; costShares += t.shares; totalCost += t.shares * t.price;
    } else if (t.type === 'deposit') {
      shares += t.shares;
    }

    const avg = costShares > 0 ? totalCost / costShares : 0;
    return [
      pc.dim(t.date.padEnd(COL.DATE)),
      ...(showTicker ? [pc.bold(t.ticker.padEnd(COL.TICKER))] : []),
      colorType(t.type.padEnd(COL.TYPE)),
      fmt.num(t.shares).padEnd(COL.SHARES),
      (t.price > 0 ? fmt.usd(t.price) : pc.dim('─')).padEnd(COL.PRICE),
      (total > 0 ? fmt.usd(total) : pc.dim('─')).padEnd(COL.TOTAL),
      ...(showAvg ? [avg > 0 ? pc.bold(fmt.usd(avg)) : pc.dim('─')] : []),
    ].join('  ');
  });

  const rows = showAvg ? rowsAsc.reverse() : rowsAsc;
  const title = ticker ? `Transactions · ${ticker.toUpperCase()}` : 'Transactions';
  const footer = `\n${pc.dim(`${txns.length} transaction${txns.length !== 1 ? 's' : ''}`)}`;
  note(`${header}\n${divider}\n${rows.join('\n')}${footer}`, title);
};
