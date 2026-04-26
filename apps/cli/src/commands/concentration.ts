import { log, note } from '@clack/prompts';
import pc from 'picocolors';
import { aggregateHoldings } from '@firma/db';
import { getRepository } from '../db/index.ts';

type Slice = { label: string; value: number };

const computeHHI = (slices: Slice[]): number => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return 0;
  return slices.reduce((s, { value }) => {
    const p = value / total;
    return s + p * p * 10000;
  }, 0);
};

const hhiSeverity = (hhi: number): { label: string; color: (s: string) => string } => {
  if (hhi >= 5000) return { label: 'very high', color: pc.red };
  if (hhi >= 2500) return { label: 'high',      color: pc.yellow };
  if (hhi >= 1500) return { label: 'moderate',  color: pc.cyan };
  return { label: 'low', color: pc.green };
};

const groupSum = <T>(items: T[], keyOf: (t: T) => string, valueOf: (t: T) => number): Map<string, number> =>
  items.reduce((map, item) => {
    const key = keyOf(item);
    return map.set(key, (map.get(key) ?? 0) + valueOf(item));
  }, new Map<string, number>());

const topN = (slices: Slice[], n: number): Slice[] =>
  [...slices].sort((a, b) => b.value - a.value).slice(0, n);

const fmtSlices = (slices: Slice[], total: number, n = 4): string =>
  topN(slices, n)
    .map(s => `${s.label} ${((s.value / total) * 100).toFixed(0)}%`)
    .join(', ');

const renderRow = (dimension: string, slices: Slice[]): string => {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return `${dimension.padEnd(10)}  ${pc.dim('(no data)')}`;
  const hhi = computeHHI(slices);
  const { label, color } = hhiSeverity(hhi);
  const top = fmtSlices(slices, total);
  return `${dimension.padEnd(10)}  HHI ${color(String(Math.round(hhi)).padStart(5))}  ${color(`(${label})`)}  ${pc.dim(top)}`;
};

export const showConcentrationCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const repo = getRepository();
  const holdings = aggregateHoldings(repo.transactions.getAll());

  if (holdings.size === 0) {
    if (json) { process.stdout.write('{}\n'); return; }
    log.warn('No holdings found. Run `firma add txn` first.');
    return;
  }

  const priceMap = new Map(repo.prices.getAll().map(p => [p.ticker, p]));

  const positions = [...holdings.entries()].map(([ticker, h]) => {
    const p = priceMap.get(ticker);
    const marketValue = p ? p.current_price * h.shares : 0;
    return {
      ticker,
      marketValue,
      currency: p?.currency ?? 'USD',
      sector:   p?.sector   ?? 'Unknown',
      country:  p?.country  ?? 'Unknown',
    };
  }).filter(p => p.marketValue > 0);

  const tickerSlices   = positions.map(p => ({ label: p.ticker, value: p.marketValue }));
  const currencySlices = [...groupSum(positions, p => p.currency, p => p.marketValue)].map(([label, value]) => ({ label, value }));
  const sectorSlices   = [...groupSum(positions, p => p.sector,   p => p.marketValue)].map(([label, value]) => ({ label, value }));
  const countrySlices  = [...groupSum(positions, p => p.country,  p => p.marketValue)].map(([label, value]) => ({ label, value }));

  const result = {
    by_ticker:   { hhi: Math.round(computeHHI(tickerSlices)),   top: topN(tickerSlices, 5) },
    by_currency: { hhi: Math.round(computeHHI(currencySlices)), top: topN(currencySlices, 5) },
    by_sector:   { hhi: Math.round(computeHHI(sectorSlices)),   top: topN(sectorSlices, 5) },
    by_country:  { hhi: Math.round(computeHHI(countrySlices)),  top: topN(countrySlices, 5) },
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const body = [
    renderRow('Ticker',   tickerSlices),
    renderRow('Currency', currencySlices),
    renderRow('Sector',   sectorSlices),
    renderRow('Country',  countrySlices),
    '',
    pc.dim('HHI scale: <1500 low · 1500–2500 moderate · 2500–5000 high · >5000 very high'),
  ].join('\n');

  note(body, 'Portfolio Concentration (HHI)');
};
