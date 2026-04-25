import type { Transaction, Holding } from './types.ts';

export const aggregateHoldings = (txns: Transaction[]): Map<string, Holding> => {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));

  const map = sorted.reduce((acc, t) => {
    const h = acc.get(t.ticker) ?? { ticker: t.ticker, shares: 0, costShares: 0, totalCost: 0 };

    if (t.type === 'buy') {
      h.shares     += t.shares;
      h.costShares += t.shares;
      h.totalCost  += t.shares * t.price;
    } else if (t.type === 'sell') {
      const ratio   = h.shares > 0 ? (h.shares - t.shares) / h.shares : 0;
      h.shares     -= t.shares;
      h.costShares  = h.costShares * ratio;
      h.totalCost   = h.totalCost  * ratio;
    } else if (t.type === 'deposit') {
      h.shares += t.shares;
      if (t.price > 0) {
        h.costShares += t.shares;
        h.totalCost  += t.shares * t.price;
      }
    }

    return acc.set(t.ticker, h);
  }, new Map<string, Holding>());

  return new Map([...map.entries()].filter(([, h]) => h.shares > 0));
};

export const getActiveTickers = (txns: Transaction[]): string[] =>
  [...aggregateHoldings(txns).keys()];
