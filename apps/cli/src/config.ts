import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const CONFIG_DIR = join(homedir(), '.firma');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

type Config = {
  finnhub_api_key?: string;
  db_path?: string;
  update_check_at?: number;
  latest_version?: string;
};

export const readConfig = (): Config | null => {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config;
  } catch {
    return null;
  }
};

export const writeConfig = (config: Config) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

export const setConfigValue = (key: keyof Config, value: string) => {
  const config = readConfig() ?? {};
  writeConfig({ ...config, [key]: value });
};
