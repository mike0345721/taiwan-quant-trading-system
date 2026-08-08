PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_path TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  snapshots_imported INTEGER NOT NULL DEFAULT 0,
  snapshots_skipped INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT
);

CREATE TABLE IF NOT EXISTS raw_snapshots (
  trade_date TEXT PRIMARY KEY CHECK (trade_date GLOB '????-??-??'),
  generated_at TEXT,
  as_of_date TEXT,
  data_mode TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_sources (
  trade_date TEXT NOT NULL REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_name TEXT,
  source_data_date TEXT,
  fetched_at TEXT,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
  fallback_from_cache INTEGER NOT NULL CHECK (fallback_from_cache IN (0, 1)),
  error TEXT,
  PRIMARY KEY (trade_date, source_key)
);

CREATE TABLE IF NOT EXISTS market_daily (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  twii_close REAL,
  twii_change REAL,
  twii_change_pct REAL,
  otc_close REAL,
  otc_change_pct REAL,
  taiwan_vix REAL,
  us_vix REAL,
  tx_contract TEXT,
  tx_close REAL,
  tx_change REAL,
  tx_change_pct REAL,
  tx_volume INTEGER,
  tx_open_interest INTEGER,
  basis REAL,
  listed_advance INTEGER,
  listed_decline INTEGER,
  listed_limit_up INTEGER,
  listed_limit_down INTEGER,
  otc_advance INTEGER,
  otc_decline INTEGER,
  otc_limit_up INTEGER,
  otc_limit_down INTEGER
);

CREATE TABLE IF NOT EXISTS spot_institutional_daily (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  foreign_net_e REAL,
  trust_net_e REAL,
  dealer_proprietary_net_e REAL,
  dealer_hedge_net_e REAL,
  dealer_total_net_e REAL,
  institutional_total_e REAL
);

CREATE TABLE IF NOT EXISTS futures_positions_daily (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  foreign_long INTEGER,
  foreign_short INTEGER,
  foreign_net INTEGER,
  dealer_net INTEGER,
  trust_net INTEGER,
  market_open_interest INTEGER,
  top5_long INTEGER,
  top5_short INTEGER,
  top10_long INTEGER,
  top10_short INTEGER
);

CREATE TABLE IF NOT EXISTS options_contract_daily (
  trade_date TEXT NOT NULL REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  contract TEXT NOT NULL,
  contract_type TEXT,
  expiry_date TEXT,
  days_to_expiry INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  call_volume INTEGER,
  put_volume INTEGER,
  volume_pc_ratio REAL,
  call_oi INTEGER,
  put_oi INTEGER,
  oi_pc_ratio REAL,
  call_wall_strike REAL,
  call_wall_oi INTEGER,
  put_wall_strike REAL,
  put_wall_oi INTEGER,
  max_pain REAL,
  PRIMARY KEY (trade_date, contract)
);

CREATE TABLE IF NOT EXISTS options_strike_daily (
  trade_date TEXT NOT NULL,
  contract TEXT NOT NULL,
  strike REAL NOT NULL,
  call_oi INTEGER NOT NULL DEFAULT 0,
  put_oi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_date, contract, strike),
  FOREIGN KEY (trade_date, contract) REFERENCES options_contract_daily(trade_date, contract) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS signals_daily (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  signal_version TEXT,
  total_score REAL,
  bias TEXT,
  regime TEXT,
  volatility_risk REAL,
  spot_score REAL,
  futures_score REAL,
  options_score REAL,
  breadth_score REAL,
  model_coverage_pct REAL,
  completeness_pct REAL,
  advice_json TEXT
);

CREATE TABLE IF NOT EXISTS daily_features (
  trade_date TEXT PRIMARY KEY REFERENCES raw_snapshots(trade_date) ON DELETE CASCADE,
  foreign_spot_1d_e REAL,
  foreign_spot_5d_e REAL,
  foreign_spot_20d_e REAL,
  foreign_futures_net INTEGER,
  foreign_futures_delta_1d INTEGER,
  foreign_futures_delta_5d INTEGER,
  market_oi INTEGER,
  market_oi_delta_1d INTEGER,
  active_option_pc_ratio REAL,
  twii_return_1d_pct REAL,
  tx_return_1d_pct REAL,
  next_tx_return_pct REAL,
  signal_total_score REAL,
  signal_bias TEXT,
  feature_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  rule_code TEXT NOT NULL,
  source_key TEXT,
  message TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  UNIQUE (trade_date, rule_code, source_key, message)
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_key TEXT NOT NULL,
  version TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (strategy_key, version)
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_key TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  first_trade_date TEXT,
  last_trade_date TEXT,
  sample_size INTEGER,
  assumptions_json TEXT NOT NULL,
  results_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sources_date ON data_sources(source_data_date);
CREATE INDEX IF NOT EXISTS idx_options_contract ON options_contract_daily(contract, trade_date);
CREATE INDEX IF NOT EXISTS idx_options_strike ON options_strike_daily(contract, strike, trade_date);
CREATE INDEX IF NOT EXISTS idx_quality_severity ON quality_issues(severity, trade_date);
