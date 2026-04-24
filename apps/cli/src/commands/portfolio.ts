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
  shares: (n: number) => `${n % 1 === 0 ? n : n.toFixed(4)}주`,
};

const colorPnl = (n: number, text: string) => n >= 0 ? pc.green(text) : pc.red(text);
const pad = (str: string, len: number) => str.padEnd(len);

const renderTable = (items: PortfolioItem[]) => {
  const TICKER_W = 8, SHARES_W = 10, PRICE_W = 12;

  const header = [
    pc.dim(pad('티커', TICKER_W)),
    pc.dim(pad('수량', SHARES_W)),
    pc.dim(pad('평단가', PRICE_W)),
    pc.dim(pad('현재가', PRICE_W)),
    pc.dim('평가손익'),
  ].join('');

  const rows = items.map(item => {
    const pnlText = item.pnl != null && item.pnlPct != null
      ? `${fmt.usd(item.pnl)} (${fmt.pct(item.pnlPct)})`
      : pc.dim('sync 필요');
    return [
      pc.bold(pad(item.ticker, TICKER_W)),
      pad(fmt.shares(item.shares), SHARES_W),
      pad(fmt.usd(item.avgPrice), PRICE_W),
      pad(item.currentPrice != null ? fmt.usd(item.currentPrice) : pc.dim('-'), PRICE_W),
      item.pnl != null ? colorPnl(item.pnl, pnlText) : pnlText,
    ].join('');
  });

  const divider = pc.dim('─'.repeat(TICKER_W + SHARES_W + PRICE_W * 2 + 24));

  const totalCost = items.reduce((s, i) => s + i.costBasis, 0);
  const totalValue = items.reduce((s, i) => s + (i.marketValue ?? i.costBasis), 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = (totalPnl / totalCost) * 100;

  const summary = [
    `${pc.dim('총 평가액')}   ${pc.bold(fmt.usd(totalValue))}`,
    `${pc.dim('총 투자원금')}  ${fmt.usd(totalCost)}`,
    `${pc.dim('총 수익')}    ${colorPnl(totalPnl, `${fmt.usd(totalPnl)} (${fmt.pct(totalPnlPct)})`)}`,
  ].join('\n');

  const syncedAt = items.find(i => i.syncedAt)?.syncedAt;
  const lastSynced = syncedAt
    ? pc.dim(`\n마지막 동기화: ${new Date(syncedAt).toLocaleString('ko-KR')}`)
    : '';

  note(`${header}\n${rows.join('\n')}\n${divider}\n${summary}${lastSynced}`, '포트폴리오');
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
