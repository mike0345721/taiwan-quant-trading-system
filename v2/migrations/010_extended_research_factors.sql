CREATE TABLE IF NOT EXISTS securities_lending_daily (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  short_sale_quantity INTEGER,
  short_sale_balance INTEGER,
  lending_balance INTEGER,
  available_to_short INTEGER,
  source_name TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS etf_flow_daily (
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  issued_units REAL,
  issued_units_change REAL,
  estimated_creation_units REAL,
  estimated_redemption_units REAL,
  nav REAL,
  market_price REAL,
  premium_discount_pct REAL,
  source_name TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS option_volatility_daily (
  trade_date TEXT NOT NULL,
  contract TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  days_to_expiry INTEGER,
  underlying_close REAL,
  realized_vol_20d REAL,
  atm_iv REAL,
  put_25d_iv REAL,
  call_25d_iv REAL,
  skew_25d REAL,
  iv_rv_spread REAL,
  calculation_version TEXT NOT NULL,
  source_name TEXT NOT NULL,
  PRIMARY KEY (trade_date, contract)
);

CREATE TABLE IF NOT EXISTS policy_events (
  event_id TEXT PRIMARY KEY,
  central_bank TEXT NOT NULL CHECK (central_bank IN ('FOMC', 'BOJ', 'CBC')),
  decision_timestamp_utc TEXT NOT NULL,
  prior_policy_rate REAL,
  expected_policy_rate REAL,
  actual_policy_rate REAL,
  rate_surprise_bps REAL,
  expectation_source TEXT,
  statement_surprise_score REAL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_event_time ON policy_events(decision_timestamp_utc);
