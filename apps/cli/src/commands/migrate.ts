import { log, note, confirm, isCancel, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { eq } from 'drizzle-orm';
import { balanceEntries, flowEntries } from '@firma/db';
import { getDb } from '../db/index.ts';

const FAWAZ_CUTOFF = '2024-03-05';

const withRetry = async <T>(fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
};

const fetchRateFawaz = async (date: string): Promise<number> => {
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fawaz API ${res.status} for ${date}`);
  const data = await res.json() as { usd: { krw: number } };
  if (!data.usd?.krw) throw new Error(`fawaz: no KRW rate in response for ${date}`);
  return data.usd.krw;
};

const fetchRateEcb = async (date: string): Promise<number> => {
  const d = new Date(`${date}T00:00:00Z`);
  const startDate = new Date(d);
  startDate.setUTCDate(startDate.getUTCDate() - 5);
  const start = startDate.toISOString().slice(0, 10);

  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.KRW+USD.EUR.SP00.A?startPeriod=${start}&endPeriod=${date}&detail=dataonly&format=jsondata`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECB API ${res.status} for ${date}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  const seriesDims = data.structure.dimensions.series as Array<{ id: string; values: Array<{ id: string }> }>;
  const currencyDimIdx = seriesDims.findIndex(d => d.id === 'CURRENCY');
  const allSeries = data.dataSets[0].series as Record<string, { observations: Record<string, [number]> }>;

  let krwObs: Record<string, [number]> | null = null;
  let usdObs: Record<string, [number]> | null = null;

  for (const [key, seriesData] of Object.entries(allSeries)) {
    const idx = parseInt(key.split(':')[currencyDimIdx]);
    const currency = seriesDims[currencyDimIdx]?.values[idx]?.id;
    if (currency === 'KRW') krwObs = seriesData.observations;
    else if (currency === 'USD') usdObs = seriesData.observations;
  }

  if (!krwObs || !usdObs) throw new Error(`ECB: missing KRW or USD series for ${date}`);

  const lastVal = (obs: Record<string, [number]>): number => {
    const keys = Object.keys(obs).sort((a, b) => Number(a) - Number(b));
    if (keys.length === 0) throw new Error(`ECB: no observations near ${date}`);
    return obs[keys[keys.length - 1]][0];
  };

  return lastVal(krwObs) / lastVal(usdObs);
};

const fetchHistoricalKrwPerUsd = (date: string): Promise<number> =>
  withRetry(() => date >= FAWAZ_CUTOFF ? fetchRateFawaz(date) : fetchRateEcb(date));

export const migrateCommand = async () => {
  const db = getDb();

  const krwBalance = db.select().from(balanceEntries).where(eq(balanceEntries.currency, 'KRW')).all();
  const krwFlow    = db.select().from(flowEntries).where(eq(flowEntries.currency, 'KRW')).all();

  const total = krwBalance.length + krwFlow.length;
  if (total === 0) {
    log.info('All entries are already in USD. Nothing to migrate.');
    return;
  }

  const uniqueDates = [...new Set([...krwBalance.map(e => e.date), ...krwFlow.map(e => e.date)])].sort();

  log.message(`Found ${pc.bold(String(total))} KRW entries across ${uniqueDates.length} date(s).`);

  const s = spinner();
  s.start('Fetching historical USD/KRW rates...');

  const rateMap = new Map<string, number>();
  for (const date of uniqueDates) {
    try {
      const rate = await fetchHistoricalKrwPerUsd(date);
      rateMap.set(date, rate);
      s.message(`${date}  →  ₩${Math.round(rate).toLocaleString('en-US')} / USD`);
    } catch (err) {
      s.stop(pc.red(`Failed to fetch rate for ${date}: ${err instanceof Error ? err.message : String(err)}`));
      log.error('Migration aborted — all historical rates must be available before converting.');
      process.exit(1);
    }
  }
  s.stop(`Fetched ${rateMap.size} historical rate(s).`);

  const fmtRow = (table: string, period: string, category: string, krw: number, usd: number) =>
    `  ${table.padEnd(8)}  ${period}  ${category.padEnd(22)}  ₩${krw.toLocaleString('en-US').padStart(12)}  →  $${usd.toLocaleString('en-US').padStart(8)}`;

  const previewLines: string[] = [];
  for (const e of krwBalance) {
    previewLines.push(fmtRow('balance', e.period, e.category, e.amount, Math.round(e.amount / rateMap.get(e.date)!)));
  }
  for (const e of krwFlow) {
    previewLines.push(fmtRow('flow', e.period, e.category, e.amount, Math.round(e.amount / rateMap.get(e.date)!)));
  }

  note(previewLines.join('\n'), `Migration Preview — ${total} entries`);

  const ok = await confirm({ message: `Convert all ${total} KRW entries to USD?` });
  if (isCancel(ok) || !ok) {
    log.info('Migration cancelled.');
    return;
  }

  let updated = 0;
  for (const e of krwBalance) {
    const usd = Math.round(e.amount / rateMap.get(e.date)!);
    db.update(balanceEntries).set({ amount: usd, currency: 'USD' }).where(eq(balanceEntries.id, e.id)).run();
    updated++;
  }
  for (const e of krwFlow) {
    const usd = Math.round(e.amount / rateMap.get(e.date)!);
    db.update(flowEntries).set({ amount: usd, currency: 'USD' }).where(eq(flowEntries.id, e.id)).run();
    updated++;
  }

  log.success(`Migration complete — converted ${updated} entries from KRW to USD.`);
};
