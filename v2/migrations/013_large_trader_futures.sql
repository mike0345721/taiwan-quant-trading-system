CREATE TABLE IF NOT EXISTS large_trader_futures_daily (
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  product_scope TEXT NOT NULL DEFAULT 'TX_MTX_TMF_EQUIVALENT',
  expiry_scope TEXT NOT NULL CHECK (expiry_scope IN ('weekly', 'near_month', 'all_contracts')),
  expiry_label TEXT,
  top5_long INTEGER,
  top5_long_specific INTEGER,
  top10_long INTEGER,
  top10_long_specific INTEGER,
  top5_short INTEGER,
  top5_short_specific INTEGER,
  top10_short INTEGER,
  top10_short_specific INTEGER,
  market_open_interest INTEGER,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, product_scope, expiry_scope)
);

CREATE INDEX IF NOT EXISTS idx_large_trader_futures_scope_date
  ON large_trader_futures_daily(expiry_scope, trade_date);

