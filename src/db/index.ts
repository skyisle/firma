import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as schema from './schema.ts';

const DB_DIR = path.join(os.homedir(), '.firma');
const DB_PATH = path.join(DB_DIR, 'firma.db');

const initTables = (db: ReturnType<typeof drizzle>) => {
  db.run(sql`CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    exchange TEXT NOT NULL,
    currency TEXT NOT NULL,
    current_price REAL NOT NULL,
    prev_close REAL NOT NULL,
    change_percent REAL NOT NULL,
    high_52w REAL NOT NULL,
    low_52w REAL NOT NULL,
    pe REAL,
    eps REAL,
    market_cap REAL NOT NULL,
    synced_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
    shares REAL NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS cash_flow (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    category TEXT NOT NULL,
    label TEXT,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
};

export const createDatabase = () => {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  initTables(db);
  return db;
};

export type Db = ReturnType<typeof createDatabase>;
