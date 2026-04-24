import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { prices } from '../db/schema.ts';
import { getPortfolio } from '../db/queries.ts';

// ── formatting ────────────────────────────────────────────────────────────────

const fmt = {
  usd: (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
  shares: (n: number) => `${n % 1 === 0 ? n : n.toFixed(4)}주`,
};

const colorPnl = (n: number, text: string) => n >= 0 ? pc.green(text) : pc.red(text);

const pad = (str: string, len: number) => str.padEnd(len);

// ── types ─────────────────────────────────────────────────────────────────────

type PortfolioLine = {
  ticker: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  cost: number;
  value: number;
  pnl: number;
  pnlPct: number;
  syncedAt: string;
};

// ── queries ───────────────────────────────────────────────────────────────────

const buildPortfolioLines = (db: Db): { lines: PortfolioLine[]; missing: string[] } => {
  const portfolio = getPortfolio(db);

  if (portfolio.length === 0) return { lines: [], missing: [] };

  const tickers = portfolio.map(r => r.ticker);
  const priceRows = db.select().from(prices).where(inArray(prices.ticker, tickers)).all();
  const priceMap = new Map(priceRows.map(r => [r.ticker, r]));

  const lines: PortfolioLine[] = [];
  const missing: string[] = [];

  portfolio.forEach(({ ticker, netShares, avgPrice }) => {
    const price = priceMap.get(ticker);
    if (!price) {
      missing.push(ticker);
      return;
    }
    const cost = netShares * avgPrice;
    const value = netShares * price.currentPrice;
    const pnl = value - cost;
    lines.push({
      ticker,
      shares: netShares,
      avgPrice,
      currentPrice: price.currentPrice,
      cost,
      value,
      pnl,
      pnlPct: (pnl / cost) * 100,
      syncedAt: price.syncedAt,
    });
  });

  return { lines, missing };
};

// ── rendering ─────────────────────────────────────────────────────────────────

const renderTable = (lines: PortfolioLine[]) => {
  const TICKER_W = 8;
  const SHARES_W = 10;
  const PRICE_W = 12;
  const PNL_W = 18;

  const header = [
    pc.dim(pad('티커', TICKER_W)),
    pc.dim(pad('수량', SHARES_W)),
    pc.dim(pad('평단가', PRICE_W)),
    pc.dim(pad('현재가', PRICE_W)),
    pc.dim('평가손익'),
  ].join('');

  const rows = lines.map(l => {
    const pnlText = `${fmt.usd(l.pnl)} (${fmt.pct(l.pnlPct)})`;
    return [
      pc.bold(pad(l.ticker, TICKER_W)),
      pad(fmt.shares(l.shares), SHARES_W),
      pad(fmt.usd(l.avgPrice), PRICE_W),
      pad(fmt.usd(l.currentPrice), PRICE_W),
      colorPnl(l.pnl, pnlText),
    ].join('');
  });

  const divider = pc.dim('─'.repeat(TICKER_W + SHARES_W + PRICE_W * 2 + 24));

  const totalCost = lines.reduce((s, l) => s + l.cost, 0);
  const totalValue = lines.reduce((s, l) => s + l.value, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = (totalPnl / totalCost) * 100;

  const summary = [
    `${pc.dim('총 평가액')}   ${pc.bold(fmt.usd(totalValue))}`,
    `${pc.dim('총 투자원금')}  ${fmt.usd(totalCost)}`,
    `${pc.dim('총 수익')}    ${colorPnl(totalPnl, `${fmt.usd(totalPnl)} (${fmt.pct(totalPnlPct)})`)}`,
  ].join('\n');

  const lastSynced = lines[0]?.syncedAt
    ? pc.dim(`\n마지막 동기화: ${new Date(lines[0].syncedAt).toLocaleString('ko-KR')}`)
    : '';

  note(`${header}\n${rows.join('\n')}\n${divider}\n${summary}${lastSynced}`, '포트폴리오');
};

// ── entry ─────────────────────────────────────────────────────────────────────

export const portfolioCommand = (db: Db) => {
  const { lines, missing } = buildPortfolioLines(db);

  if (lines.length === 0 && missing.length === 0) {
    log.warn('거래 내역이 없어요. `firma add`로 거래를 추가해보세요.');
    return;
  }

  if (lines.length > 0) renderTable(lines);

  if (missing.length > 0) {
    log.warn(`가격 정보 없음: ${missing.join(', ')} — \`firma sync\`를 실행해주세요.`);
  }
};
