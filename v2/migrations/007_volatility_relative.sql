CREATE TABLE IF NOT EXISTS volatility_relative_daily (
  trade_date TEXT PRIMARY KEY CHECK (trade_date GLOB '????-??-??'),
  taiwan_vix_close REAL NOT NULL,
  taiwan_vix_change_1d REAL,
  us_vix_known REAL NOT NULL,
  us_vix_source_date TEXT NOT NULL CHECK (us_vix_source_date GLOB '????-??-??'),
  us_vix_change_1d REAL,
  vix_ratio REAL NOT NULL,
  vix_spread REAL NOT NULL,
  change_divergence REAL,
  feature_version TEXT NOT NULL,
  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volatility_relative_us_date
  ON volatility_relative_daily(us_vix_source_date);
