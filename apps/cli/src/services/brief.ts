import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { assembleBriefData, type BriefData } from '@firma/brief';
import { getRepository } from '../db/index.ts';
import { readConfig, getDefaultCurrency } from '../config.ts';

const CACHE_DIR = join(homedir(), '.firma', 'cache');
const cachePath = (date: string) => join(CACHE_DIR, `brief-${date}.json`);
const todayStr = () => new Date().toISOString().slice(0, 10);

const dbPath = () => readConfig()?.db_path ?? join(homedir(), '.firma', 'firma.db');

const mtimeOr = (path: string, fallback = 0): number => {
  try { return statSync(path).mtimeMs; } catch { return fallback; }
};

// Cache is stale if any local data file (db or its WAL) was modified after the cache was written.
const isCacheStale = (cacheFilePath: string): boolean => {
  const cacheMs = mtimeOr(cacheFilePath);
  if (cacheMs === 0) return true;
  const db = dbPath();
  return cacheMs < Math.max(mtimeOr(db), mtimeOr(`${db}-wal`));
};

export type { BriefData, BriefMacro, BriefSignals } from '@firma/brief';

export const readCachedBrief = (date: string): BriefData | null => {
  const path = cachePath(date);
  if (!existsSync(path)) return null;
  if (isCacheStale(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as BriefData; }
  catch { return null; }
};

const writeCachedBrief = (data: BriefData) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(data.date), JSON.stringify(data, null, 2));
};

export const assembleBrief = async ({ refresh = false } = {}): Promise<BriefData> => {
  const date = todayStr();
  if (!refresh) {
    const cached = readCachedBrief(date);
    if (cached) return cached;
  }

  const repo = getRepository();
  const config = readConfig();
  const data = await assembleBriefData({
    transactions: repo.transactions.getAll(),
    prices:       repo.prices.getAll(),
    finnhubKey:   config?.finnhub_api_key ?? null,
    fredKey:      config?.fred_api_key ?? null,
    homeCurrency: getDefaultCurrency(),
  });

  writeCachedBrief(data);
  return data;
};
