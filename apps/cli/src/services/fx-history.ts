import { createFredClient, FX_BY_CURRENCY } from '@firma/fred';
import type { NewFxRate } from '@firma/db';
import { getRepository } from '../db/index.ts';
import { readConfig } from '../config.ts';

const SUPPORTED_CURRENCIES = ['KRW', 'JPY', 'EUR', 'CNY', 'GBP'] as const;

const todayStr = () => new Date().toISOString().slice(0, 10);

const earliestUserDate = (): string | null => {
  const repo = getRepository();
  const dates = [
    ...repo.transactions.getAll().map(t => t.date),
    ...repo.balance.getAll().map(b => b.date),
    ...repo.flow.getAll().map(f => f.date),
  ];
  if (dates.length === 0) return null;
  return dates.sort()[0];
};

type FxBackfillResult =
  | { ok: true; per_currency: { currency: string; rows_inserted: number; first_date: string | null; last_date: string | null }[] }
  | { ok: false; reason: 'no-fred-key' | 'no-user-data' | 'fetch-failed'; error?: string };

export const backfillFxRates = async (): Promise<FxBackfillResult> => {
  const apiKey = readConfig()?.fred_api_key;
  if (!apiKey) return { ok: false, reason: 'no-fred-key' };

  const repo = getRepository();
  const earliest = earliestUserDate();
  if (!earliest) return { ok: false, reason: 'no-user-data' };

  const today = todayStr();
  const client = createFredClient(apiKey);

  try {
    const per_currency = await Promise.all(SUPPORTED_CURRENCIES.map(async (cur) => {
      const fxDef = FX_BY_CURRENCY[cur];
      if (!fxDef) return { currency: cur, rows_inserted: 0, first_date: null, last_date: null };

      // Increment-only: start from the day after our latest cached date, if any.
      const latestCached = repo.fx.getLatestDate(cur);
      const startDate = latestCached
        ? new Date(new Date(`${latestCached}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
        : earliest;

      if (startDate > today) {
        return { currency: cur, rows_inserted: 0, first_date: null, last_date: null };
      }

      const obs = await client.fetchObservations(fxDef.series_id, { from: startDate, to: today });
      const valid = obs.filter((o): o is { date: string; value: number } => o.value != null);
      const apply = fxDef.invert ? (v: number) => 1 / v : (v: number) => v;

      const rows: NewFxRate[] = valid.map(o => ({
        date:        o.date,
        currency:    cur,
        rate_to_usd: apply(o.value),
      }));

      if (rows.length > 0) repo.fx.upsertBatch(rows);

      return {
        currency: cur,
        rows_inserted: rows.length,
        first_date: rows[0]?.date ?? null,
        last_date:  rows.at(-1)?.date ?? null,
      };
    }));

    return { ok: true, per_currency };
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', error: err instanceof Error ? err.message : String(err) };
  }
};

