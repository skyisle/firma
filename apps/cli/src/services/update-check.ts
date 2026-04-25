import { readConfig, writeConfig } from '../config.ts';

const REGISTRY_URL = 'https://registry.npmjs.org/firma-app/latest';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

const isNewer = (latest: string, current: string): boolean => {
  const parse = (v: string) => v.split('.').map(Number) as [number, number, number];
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
};

export const checkForUpdate = async (currentVersion: string): Promise<string | null> => {
  try {
    const config = readConfig() ?? {};
    const now = Date.now();

    if (config.update_check_at && config.latest_version) {
      if (now - config.update_check_at < CHECK_INTERVAL) {
        return isNewer(config.latest_version, currentVersion) ? config.latest_version : null;
      }
    }

    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(3000) });
    const { version: latest } = await res.json() as { version: string };

    writeConfig({ ...config, update_check_at: now, latest_version: latest });

    return isNewer(latest, currentVersion) ? latest : null;
  } catch {
    return null;
  }
};
