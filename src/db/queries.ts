import { sql } from 'drizzle-orm';
import type { Db } from './index.ts';

export type PortfolioRow = {
  ticker: string;
  netShares: number;
  avgPrice: number;
};

// 거래 내역을 집계해 현재 보유 종목 계산
// 매수 수량 가중평균으로 평단가 산출, 순보유 수량 > 0인 종목만 반환
export const getPortfolio = (db: Db): PortfolioRow[] =>
  db.all(sql`
    SELECT
      ticker,
      SUM(CASE WHEN type = 'buy' THEN shares ELSE -shares END) AS net_shares,
      SUM(CASE WHEN type = 'buy' THEN shares * price ELSE 0 END) /
        NULLIF(SUM(CASE WHEN type = 'buy' THEN shares ELSE 0 END), 0) AS avg_price
    FROM transactions
    GROUP BY ticker
    HAVING net_shares > 0
  `) as PortfolioRow[];

export const getActiveTickers = (db: Db): string[] =>
  getPortfolio(db).map(r => r.ticker);
