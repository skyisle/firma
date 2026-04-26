import { log, spinner } from '@clack/prompts';
import { syncPrices } from '../services/sync.ts';
import { backfillFxRates } from '../services/fx-history.ts';

const runFxSync = async (json: boolean) => {
  const s = json ? null : spinner();
  s?.start('Syncing FX rate history...');

  const result = await backfillFxRates();

  if (!result.ok) {
    if (result.reason === 'no-fred-key') {
      s?.stop('No FRED key — skipped FX sync');
      if (!json) log.info('Set up FRED for historical FX: firma config set fred-key <key>');
      return { skipped: true, total_rows: 0 };
    }
    if (result.reason === 'no-user-data') {
      s?.stop('No user data — skipped FX sync');
      return { skipped: true, total_rows: 0 };
    }
    s?.stop('FX sync failed');
    if (!json) log.error(result.error ?? 'FX sync failed');
    return { error: result.error, total_rows: 0 };
  }

  const total = result.per_currency.reduce((acc, c) => acc + c.rows_inserted, 0);
  s?.stop(total === 0 ? 'FX rates already up to date' : `Synced ${total} FX rate${total !== 1 ? 's' : ''} across ${result.per_currency.length} currencies`);
  return { per_currency: result.per_currency, total_rows: total };
};

const runPriceSync = async (json: boolean) => {
  const s = json ? null : spinner();
  s?.start('Syncing prices...');
  const result = await syncPrices();

  if (!result.ok) {
    s?.stop(result.reason === 'no-key' ? 'No API key' : result.reason === 'no-holdings' ? 'No holdings' : 'Price sync failed');
    const messages = {
      'no-key':       'Finnhub API key not set. Run: firma config set finnhub-key <your-key>',
      'no-holdings':  'No holdings to sync.',
      'fetch-failed': result.error ?? 'Sync failed',
    } as const;
    if (!json) {
      if (result.reason === 'no-holdings') log.warn(messages[result.reason]);
      else log.error(messages[result.reason]);
      if (result.reason === 'no-key') log.info('Get a free key at https://finnhub.io');
    }
    return { ok: false as const, reason: result.reason, error: result.error };
  }

  s?.stop(`Updated ${result.count} stock${result.count !== 1 ? 's' : ''}`);
  return { ok: true as const, count: result.count };
};

export const syncCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const priceResult = await runPriceSync(json);
  const fxResult    = await runFxSync(json);

  if (json) {
    process.stdout.write(JSON.stringify({ prices: priceResult, fx: fxResult }) + '\n');
    if (!priceResult.ok && priceResult.reason !== 'no-holdings') process.exit(1);
  }
};

export const syncFxCommand = async ({ json = false }: { json?: boolean } = {}) => {
  const result = await runFxSync(json);
  if (json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
};
