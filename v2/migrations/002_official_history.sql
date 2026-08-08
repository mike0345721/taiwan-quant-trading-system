CREATE TABLE IF NOT EXISTS official_backfill_files (
  dataset TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  source_url TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  downloaded_at TEXT NOT NULL,
  imported_rows INTEGER NOT NULL,
  PRIMARY KEY (dataset, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS futures_contract_daily (
  trade_date TEXT NOT NULL REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  product TEXT NOT NULL,
  contract TEXT NOT NULL,
  session TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  change REAL,
  change_pct REAL,
  volume INTEGER,
  settlement REAL,
  open_interest INTEGER,
  best_bid REAL,
  best_ask REAL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  PRIMARY KEY (trade_date, product, contract, session)
);

ALTER TABLE options_strike_daily ADD COLUMN call_volume INTEGER NOT NULL DEFAULT 0;
ALTER TABLE options_strike_daily ADD COLUMN put_volume INTEGER NOT NULL DEFAULT 0;
ALTER TABLE options_strike_daily ADD COLUMN call_close REAL;
ALTER TABLE options_strike_daily ADD COLUMN put_close REAL;
ALTER TABLE options_strike_daily ADD COLUMN call_settlement REAL;
ALTER TABLE options_strike_daily ADD COLUMN put_settlement REAL;

CREATE TABLE IF NOT EXISTS option_oi_changes (
  trade_date TEXT NOT NULL,
  contract TEXT NOT NULL,
  strike REAL NOT NULL,
  call_oi INTEGER NOT NULL,
  put_oi INTEGER NOT NULL,
  call_oi_delta_1d INTEGER,
  put_oi_delta_1d INTEGER,
  call_oi_delta_3d INTEGER,
  put_oi_delta_3d INTEGER,
  call_oi_delta_5d INTEGER,
  put_oi_delta_5d INTEGER,
  PRIMARY KEY (trade_date, contract, strike),
  FOREIGN KEY (trade_date, contract, strike) REFERENCES options_strike_daily(trade_date, contract, strike) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_futures_contract_date ON futures_contract_daily(product, trade_date, is_active);
CREATE INDEX IF NOT EXISTS idx_option_changes_contract ON option_oi_changes(contract, strike, trade_date);
