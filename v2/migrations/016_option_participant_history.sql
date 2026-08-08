CREATE TABLE IF NOT EXISTS option_institutional_daily (
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  participant TEXT NOT NULL CHECK (participant IN ('dealer', 'investment_trust', 'foreign')),
  trade_long INTEGER NOT NULL,
  trade_short INTEGER NOT NULL,
  trade_net INTEGER NOT NULL,
  trade_long_value INTEGER,
  trade_short_value INTEGER,
  trade_net_value INTEGER,
  open_interest_long INTEGER NOT NULL,
  open_interest_short INTEGER NOT NULL,
  open_interest_net INTEGER NOT NULL,
  open_interest_long_value INTEGER,
  open_interest_short_value INTEGER,
  open_interest_net_value INTEGER,
  product_scope TEXT NOT NULL DEFAULT 'TXO_ALL_CONTRACTS_AGGREGATE',
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, participant, product_scope)
);

CREATE TABLE IF NOT EXISTS option_large_trader_daily (
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  product_scope TEXT NOT NULL DEFAULT 'TXO',
  option_right TEXT NOT NULL CHECK (option_right IN ('call', 'put')),
  expiry_scope TEXT NOT NULL CHECK (expiry_scope IN ('weekly', 'near_month', 'all_contracts')),
  expiry_label TEXT NOT NULL,
  trader_category TEXT NOT NULL CHECK (trader_category IN ('all_traders', 'specific_legal')),
  top5_buy INTEGER NOT NULL,
  top5_sell INTEGER NOT NULL,
  top10_buy INTEGER NOT NULL,
  top10_sell INTEGER NOT NULL,
  market_open_interest INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, product_scope, option_right, expiry_scope, expiry_label, trader_category)
);

CREATE INDEX IF NOT EXISTS idx_option_institutional_date
  ON option_institutional_daily(participant, trade_date);

CREATE INDEX IF NOT EXISTS idx_option_large_trader_date
  ON option_large_trader_daily(option_right, expiry_scope, trader_category, trade_date);

