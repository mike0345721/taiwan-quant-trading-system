CREATE TABLE IF NOT EXISTS global_import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  first_trade_date TEXT,
  last_trade_date TEXT,
  row_count INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_market_daily (
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  close REAL NOT NULL,
  previous_close REAL,
  return_pct REAL,
  source_run_id INTEGER NOT NULL REFERENCES global_import_runs(id),
  PRIMARY KEY (symbol, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_global_market_date ON global_market_daily(trade_date, symbol);
