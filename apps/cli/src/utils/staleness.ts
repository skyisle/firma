import pc from 'picocolors';

const MIN = 60 * 1000;
const HR  = 60 * MIN;
const DAY = 24 * HR;

export type StaleLevel = 'fresh' | 'aging' | 'stale' | 'missing';

export const stalenessLevel = (syncedAt: string | null | undefined): StaleLevel => {
  if (!syncedAt) return 'missing';
  const ageMs = Date.now() - new Date(syncedAt).getTime();
  if (ageMs <= HR)   return 'fresh';
  if (ageMs <= DAY)  return 'aging';
  return 'stale';
};

const formatAge = (ms: number): string => {
  if (ms < HR)  return `${Math.round(ms / MIN)}m`;
  if (ms < DAY) return `${Math.round(ms / HR)}h`;
  return `${Math.round(ms / DAY)}d`;
};

export const stalenessLine = (syncedAt: string | null | undefined, label = 'Synced'): string => {
  if (!syncedAt) return pc.yellow(`⚠ Not synced — run \`firma sync\``);
  const ageMs = Date.now() - new Date(syncedAt).getTime();
  const age = formatAge(ageMs);
  const level = stalenessLevel(syncedAt);
  if (level === 'fresh') return pc.dim(`${label} ${age} ago`);
  if (level === 'aging') return pc.yellow(`⚠ ${label} ${age} ago — consider \`firma sync\``);
  return pc.red(`⚠ Stale: last sync ${age} ago — run \`firma sync\``);
};
