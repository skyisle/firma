import { log, spinner } from '@clack/prompts';
import { syncPrices } from '../services/sync.ts';

export const syncCommand = async ({ json = false } = {}) => {
  const s = json ? null : spinner();
  s?.start('Syncing prices...');

  const result = await syncPrices();

  if (!result.ok) {
    s?.stop(result.reason === 'no-key' ? 'No API key' : result.reason === 'no-holdings' ? 'No holdings' : 'Sync failed');

    const messages: Record<typeof result.reason, string> = {
      'no-key':       'Finnhub API key not set. Run: firma config set finnhub-key <your-key>',
      'no-holdings':  'No holdings to sync.',
      'fetch-failed': result.error ?? 'Sync failed',
    };

    if (json) {
      process.stdout.write(JSON.stringify(
        result.reason === 'no-holdings' ? { count: 0, synced: [] } : { error: messages[result.reason] },
      ) + '\n');
      if (result.reason !== 'no-holdings') process.exit(1);
      return;
    }

    if (result.reason === 'no-holdings') log.warn(messages[result.reason]);
    else log.error(messages[result.reason]);
    if (result.reason === 'no-key') log.info('Get a free key at https://finnhub.io');
    return;
  }

  if (json) {
    process.stdout.write(JSON.stringify({ count: result.count }) + '\n');
  } else {
    s!.stop(`Updated ${result.count} stock${result.count !== 1 ? 's' : ''}`);
  }
};
