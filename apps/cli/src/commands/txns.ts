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

const COL = { ID: 6, DATE: 12, TICKER: 8, TYPE: 10, SHARES: 10, PRICE: 12, TOTAL: 14, AVG: 14 };

export const showTxnsCommand = async (ticker?: string, { json = false } = {}) => {
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
    pc.dim('ID'.padEnd(COL.ID)),
    pc.dim('DATE'.padEnd(COL.DATE)),
    ...(showTicker ? [pc.dim('TICKER'.padEnd(COL.TICKER))] : []),
    pc.dim('TYPE'.padEnd(COL.TYPE)),
    pc.dim('SHARES'.padEnd(COL.SHARES)),
    pc.dim('PRICE'.padEnd(COL.PRICE)),
    pc.dim('TOTAL'.padEnd(COL.TOTAL)),
    ...(showAvg ? [pc.dim('AVG COST')] : []),
  ].join('  ');

  const totalWidth = COL.ID + COL.DATE + (showTicker ? COL.TICKER + 2 : 0) + COL.TYPE + COL.SHARES + COL.PRICE + COL.TOTAL + (showAvg ? COL.AVG + 2 : 0) + 10;
  const divider = pc.dim('─'.repeat(totalWidth));

  const ordered = showAvg ? [...txns].reverse() : txns;

  const { rows: rowsAsc } = ordered.reduce(
    ({ shares, costShares, totalCost, rows }, t) => {
      const colorType = TYPE_COLOR[t.type] ?? ((s: string) => s);
      const total = t.shares * t.price;

      let ns = shares, nc = costShares, nt = totalCost;
      if (t.type === 'buy') {
        ns = shares + t.shares; nc = costShares + t.shares; nt = totalCost + total;
      } else if (t.type === 'sell') {
        ns = shares - t.shares;
        const ratio = shares > 0 ? ns / shares : 0;
        nc = costShares * ratio; nt = totalCost * ratio;
      } else if (t.type === 'deposit' && t.price > 0) {
        ns = shares + t.shares; nc = costShares + t.shares; nt = totalCost + t.shares * t.price;
      } else if (t.type === 'deposit') {
        ns = shares + t.shares;
      }

      const avg = nc > 0 ? nt / nc : 0;
      const row = [
        pc.dim(`#${t.id}`.padEnd(COL.ID)),
        pc.dim(t.date.padEnd(COL.DATE)),
        ...(showTicker ? [pc.bold(t.ticker.padEnd(COL.TICKER))] : []),
        colorType(t.type.padEnd(COL.TYPE)),
        fmt.num(t.shares).padEnd(COL.SHARES),
        (t.price > 0 ? fmt.usd(t.price) : pc.dim('─')).padEnd(COL.PRICE),
        (total > 0 ? fmt.usd(total) : pc.dim('─')).padEnd(COL.TOTAL),
        ...(showAvg ? [avg > 0 ? pc.bold(fmt.usd(avg)) : pc.dim('─')] : []),
      ].join('  ');
      return { shares: ns, costShares: nc, totalCost: nt, rows: [...rows, row] };
    },
    { shares: 0, costShares: 0, totalCost: 0, rows: [] as string[] },
  );

  const rows = showAvg ? rowsAsc.reverse() : rowsAsc;
  const title = ticker ? `Transactions · ${ticker.toUpperCase()}` : 'Transactions';
  const footer = `\n${pc.dim(`${txns.length} transaction${txns.length !== 1 ? 's' : ''}`)}`;
  note(`${header}\n${divider}\n${rows.join('\n')}${footer}`, title);
};
