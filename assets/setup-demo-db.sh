#!/bin/bash
set -e

DB_PATH="$HOME/.firma/demo.db"
mkdir -p "$HOME/.firma"
rm -f "$DB_PATH"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL,
  shares REAL NOT NULL, price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', memo TEXT
);
CREATE TABLE balance_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, date TEXT NOT NULL,
  type TEXT NOT NULL, sub_type TEXT NOT NULL, category TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0, memo TEXT,
  UNIQUE (period, type, sub_type, category)
);
CREATE TABLE flow_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, date TEXT NOT NULL,
  type TEXT NOT NULL, sub_type TEXT NOT NULL, category TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0, memo TEXT,
  UNIQUE (period, type, sub_type, category)
);
CREATE TABLE prices (
  ticker TEXT PRIMARY KEY, name TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD',
  current_price REAL NOT NULL, prev_close REAL NOT NULL DEFAULT 0,
  change_percent REAL NOT NULL DEFAULT 0, high_52w REAL NOT NULL DEFAULT 0,
  low_52w REAL NOT NULL DEFAULT 0, pe REAL, eps REAL,
  market_cap REAL NOT NULL DEFAULT 0, synced_at TEXT NOT NULL
);

-- TSLA: 392 shares, avg ~$245.68
INSERT INTO transactions (ticker, date, type, shares, price, currency) VALUES
  ('TSLA', '2024-08-01', 'buy', 100, 215.00, 'USD'),
  ('TSLA', '2025-01-15', 'buy', 150, 246.00, 'USD'),
  ('TSLA', '2025-04-08', 'buy', 142, 265.00, 'USD');

-- NVDA: 156 shares, avg ~$128.05
INSERT INTO transactions (ticker, date, type, shares, price, currency) VALUES
  ('NVDA', '2024-08-01', 'buy', 50, 120.00, 'USD'),
  ('NVDA', '2025-01-15', 'buy', 60, 130.00, 'USD'),
  ('NVDA', '2025-04-08', 'buy', 46, 135.00, 'USD');

-- AAPL: 43 shares, avg ~$185
INSERT INTO transactions (ticker, date, type, shares, price, currency) VALUES
  ('AAPL', '2024-08-01', 'buy', 20, 168.00, 'USD'),
  ('AAPL', '2025-01-15', 'buy', 23, 200.00, 'USD');

-- MSFT: 18 shares, avg ~$324
INSERT INTO transactions (ticker, date, type, shares, price, currency) VALUES
  ('MSFT', '2024-08-01', 'buy',  8, 280.00, 'USD'),
  ('MSFT', '2025-01-15', 'buy', 10, 360.00, 'USD');
SQL

echo "Demo DB ready: $DB_PATH"
