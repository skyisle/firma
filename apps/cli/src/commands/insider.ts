import { log, spinner, note } from '@clack/prompts';
import pc from 'picocolors';
import { createFinnhubClient } from '@firma/finnhub';
import { readConfig } from '../config.ts';

// Visible length of a string (strips ANSI escape codes for column math)
const visLen = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '').length;
const padAnsi = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visLen(s)));

const TX_LABEL: Record<string, string> = {
  P: 'BUY', S: 'SELL', A: 'AWARD', D: 'RETURN',
  F: 'TAX',  G: 'GIFT', M: 'EXERCISE', X: 'EXERCISE',
};

const fmtShares = (n: number) => Math.abs(n).toLocaleString('en-US');

const fmtPrice = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtValue = (change: number, price: number): string => {
  const v = Math.abs(change) * price;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export const insiderCommand = async (
  ticker: string,
  { json = false, limit = 20 } = {},
) => {
  const apiKey = readConfig()?.finnhub_api_key;
  if (!apiKey) {
    const msg = 'Finnhub API key not set. Run: firma config set finnhub-key <your-key>';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
    return;
  }

  const sym = ticker.toUpperCase();
  const s = json ? null : spinner();
  s?.start(`Fetching insider transactions for ${sym}...`);

  try {
    const client = createFinnhubClient(apiKey);
    const res    = await client.getInsiderTransactions(sym);
    const data   = (res.data ?? []).slice(0, limit);

    s?.stop(`${data.length} transaction${data.length !== 1 ? 's' : ''}`);

    if (json) {
      process.stdout.write(JSON.stringify(res, null, 2) + '\n');
      return;
    }

    if (data.length === 0) {
      log.warn(`No insider transactions found for ${sym}.`);
      return;
    }

    const COL = { NAME: 24, TYPE: 9, SHARES: 12, PRICE: 12, VALUE: 12, DATE: 10 };
    const totalW = COL.NAME + COL.TYPE + COL.SHARES + COL.PRICE + COL.VALUE + COL.DATE + 5 * 2;

    const header = [
      pc.dim('NAME'.padEnd(COL.NAME)),
      pc.dim('TYPE'.padEnd(COL.TYPE)),
      pc.dim('SHARES'.padEnd(COL.SHARES)),
      pc.dim('PRICE'.padEnd(COL.PRICE)),
      pc.dim('VALUE'.padEnd(COL.VALUE)),
      pc.dim('DATE'),
    ].join('  ');
    const divider = pc.dim('─'.repeat(totalW));

    const rows = data.map(tx => {
      const label = TX_LABEL[tx.transactionCode] ?? tx.transactionCode;
      const colored =
        tx.transactionCode === 'P' ? pc.green(label)  :
        tx.transactionCode === 'S' ? pc.red(label)    :
        pc.dim(label);

      const name = tx.name.length > COL.NAME - 1
        ? tx.name.slice(0, COL.NAME - 2) + '…'
        : tx.name;

      return [
        name.padEnd(COL.NAME),
        padAnsi(colored, COL.TYPE),
        fmtShares(tx.change).padEnd(COL.SHARES),
        (tx.transactionPrice > 0 ? fmtPrice(tx.transactionPrice) : '─').padEnd(COL.PRICE),
        (tx.transactionPrice > 0 ? fmtValue(tx.change, tx.transactionPrice) : '─').padEnd(COL.VALUE),
        tx.transactionDate,
      ].join('  ');
    });

    note(`${header}\n${divider}\n${rows.join('\n')}`, `Insider Transactions — ${sym}`);
  } catch (err) {
    s?.stop('Failed');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (json) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); }
    log.error(msg);
  }
};
