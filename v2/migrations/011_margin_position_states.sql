CREATE TABLE IF NOT EXISTS margin_short_daily (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  margin_balance_e REAL,
  short_balance_lots INTEGER,
  source_name TEXT,
  source_data_date TEXT,
  fetched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_margin_short_source_date ON margin_short_daily(source_data_date);
