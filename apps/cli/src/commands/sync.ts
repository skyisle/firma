import { log, spinner } from '@clack/prompts';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

export const syncCommand = async () => {
  const { token } = requireAuth();
  const s = spinner();
  s.start('Syncing prices...');
  try {
    const { synced } = await apiFetch<{ synced: number }>('/api/sync', { method: 'POST', token });
    s.stop(synced > 0 ? `Updated ${synced} stock${synced > 1 ? 's' : ''}` : 'No holdings to sync');
  } catch (err) {
    s.stop('Sync failed');
    log.error(err instanceof Error ? err.message : 'Unknown error');
  }
};
