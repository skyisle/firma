import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

type PortfolioItem = {
  ticker: string;
  shares: number;
  avgPrice: number;
  currentPrice: number | null;
  marketValue: number | null;
  costBasis: number;
  pnl: number | null;
  pnlPct: number | null;
  name: string | null;
  syncedAt: string | null;
};

const fmt = {
  usd: (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
  shares: (n: number) => n % 1 === 0 ? `${n}` : n.toFixed(4),
};

const colorPnl = (n: number, text: string) => n >= 0 ? pc.green(text) : pc.red(text);

// Korean/CJK chars occupy 2 columns in terminal
const visualWidth = (str: string) =>
  [...str].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0x2E7F ? 2 : 1), 0);

const wpad = (str: string, target: number) =>
  str + ' '.repeat(Math.max(0, target - visualWidth(str)));

const COL = { TICKER: 8, SHARES: 8, AVG: 12, PRICE: 12, PNL: 22 };

const renderTable = (items: PortfolioItem[]) => {
  const header = [
    pc.dim('TICKER'.padEnd(COL.TICKER)),
    pc.dim('QTY'.padEnd(COL.SHARES)),
    pc.dim('AVG'.padEnd(COL.AVG)),
    pc.dim('PRICE'.padEnd(COL.PRICE)),
    pc.dim('P&L'),
  ].join('  ');

  const divider = pc.dim('─'.repeat(COL.TICKER + COL.SHARES + COL.AVG + COL.PRICE + COL.PNL + 8));

  const rows = items.map(item => {
    const pnlText = item.pnl != null && item.pnlPct != null
      ? `${fmt.usd(item.pnl)} (${fmt.pct(item.pnlPct)})`
      : pc.dim('─');
    return [
      pc.bold(item.ticker.padEnd(COL.TICKER)),
      fmt.shares(item.shares).padEnd(COL.SHARES),
      fmt.usd(item.avgPrice).padEnd(COL.AVG),
      (item.currentPrice != null ? fmt.usd(item.currentPrice) : pc.dim('─')).padEnd(COL.PRICE),
      item.pnl != null ? colorPnl(item.pnl, pnlText) : pnlText,
    ].join('  ');
  });

  const totalCost = items.reduce((s, i) => s + i.costBasis, 0);
  const totalValue = items.reduce((s, i) => s + (i.marketValue ?? i.costBasis), 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = (totalPnl / totalCost) * 100;

  const LBL = 10;
  const summary = [
    `${pc.dim(wpad('평가액', LBL))}${pc.bold(fmt.usd(totalValue))}`,
    `${pc.dim(wpad('투자원금', LBL))}${fmt.usd(totalCost)}`,
    `${pc.dim(wpad('손익', LBL))}${colorPnl(totalPnl, `${fmt.usd(totalPnl)}  ${fmt.pct(totalPnlPct)}`)}`,
  ].join('\n');

  const syncedAt = items.find(i => i.syncedAt)?.syncedAt;
  const lastSynced = syncedAt
    ? `\n${pc.dim('sync  ' + new Date(syncedAt).toLocaleString('ko-KR'))}`
    : '';

  note(`${header}\n${divider}\n${rows.join('\n')}\n${divider}\n${summary}${lastSynced}`, '포트폴리오');
};

export const portfolioCommand = async () => {
  const { token } = requireAuth();
  const items = await apiFetch<PortfolioItem[]>('/api/portfolio', { token });

  if (items.length === 0) {
    log.warn('거래 내역이 없어요. `firma add`로 거래를 추가해보세요.');
    return;
  }

  renderTable(items);
};
