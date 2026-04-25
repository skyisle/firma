import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

const CONFIG_DIR = join(homedir(), '.firma');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

type Config = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
  server_url: string;
};

export const readConfig = (): Config | null => {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config;
  } catch {
    return null;
  }
};

export const writeConfig = (config: Config): void => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

export const clearConfig = (): void => {
  try { unlinkSync(CONFIG_PATH); } catch {}
};
