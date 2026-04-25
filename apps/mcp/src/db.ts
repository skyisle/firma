import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { transactions, balanceEntries, flowEntries, prices } from '@firma/db';
export { aggregateHoldings, getActiveTickers } from '@firma/db';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync } from 'fs';

const schema = { transactions, balanceEntries, flowEntries, prices };

type Config = { db_path?: string; finnhub_api_key?: string };

const readConfig = (): Config => {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.firma', 'config.json'), 'utf-8')) as Config;
  } catch {
    return {};
  }
};

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export const getDb = () => {
  if (_db) return _db;
  const cfg = readConfig();
  const path = cfg.db_path ?? join(homedir(), '.firma', 'firma.db');
  mkdirSync(join(path, '..'), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, date TEXT NOT NULL,
      type TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', memo TEXT
    );
    CREATE TABLE IF NOT EXISTS balance_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, date TEXT NOT NULL,
      type TEXT NOT NULL, sub_type TEXT NOT NULL, category TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, memo TEXT,
      UNIQUE (period, type, sub_type, category)
    );
    CREATE TABLE IF NOT EXISTS flow_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, date TEXT NOT NULL,
      type TEXT NOT NULL, sub_type TEXT NOT NULL, category TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, memo TEXT,
      UNIQUE (period, type, sub_type, category)
    );
    CREATE TABLE IF NOT EXISTS prices (
      ticker TEXT PRIMARY KEY, name TEXT NOT NULL,
      exchange TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD',
      current_price REAL NOT NULL, prev_close REAL NOT NULL DEFAULT 0,
      change_percent REAL NOT NULL DEFAULT 0, high_52w REAL NOT NULL DEFAULT 0,
      low_52w REAL NOT NULL DEFAULT 0, pe REAL, eps REAL,
      market_cap REAL NOT NULL DEFAULT 0, synced_at TEXT NOT NULL
    );
  `);
  _db = drizzle(sqlite, { schema });
  return _db;
};

export const getFinnhubKey = (): string | undefined => readConfig().finnhub_api_key;

export { transactions, balanceEntries, flowEntries, prices };
