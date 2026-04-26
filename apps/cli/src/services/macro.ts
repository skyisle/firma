import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { createFredClient, assembleMacroSnapshot, type MacroResult } from '@firma/fred';
import { readConfig } from '../config.ts';

const CACHE_DIR = join(homedir(), '.firma', 'cache');

type MacroData = {
  date: string;
  generated_at: string;
  home_currency: string;
  indicators: MacroResult[];
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const cachePath = (date: string, currency: string) => join(CACHE_DIR, `macro-${currency}-${date}.json`);

export const readCachedMacro = (date: string, currency: string): MacroData | null => {
  const path = cachePath(date, currency);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as MacroData; }
  catch { return null; }
};

const writeCachedMacro = (data: MacroData) => {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(data.date, data.home_currency), JSON.stringify(data, null, 2));
};

export const assembleMacro = async (
  homeCurrency: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<MacroData> => {
  const cur = homeCurrency.toUpperCase();
  const date = todayStr();
  if (!refresh) {
    const cached = readCachedMacro(date, cur);
    if (cached) return cached;
  }

  const apiKey = readConfig()?.fred_api_key;
  if (!apiKey) throw new Error('FRED API key not set. Run: firma config set fred-key <your-key>');

  const client = createFredClient(apiKey);
  const indicators = await assembleMacroSnapshot(client, cur);

  const data: MacroData = {
    date,
    generated_at: new Date().toISOString(),
    home_currency: cur,
    indicators,
  };
  writeCachedMacro(data);
  return data;
};
