CREATE TABLE IF NOT EXISTS futures_oi_daily (
  trade_date TEXT PRIMARY KEY,
  near_contract TEXT,
  near_contract_oi INTEGER,
  total_market_oi INTEGER,
  research_oi INTEGER,
  research_definition TEXT NOT NULL DEFAULT 'near_contract_oi',
  days_to_near_expiry INTEGER,
  rollover_risk INTEGER NOT NULL DEFAULT 0 CHECK (rollover_risk IN (0, 1)),
  contract_changed INTEGER NOT NULL DEFAULT 0 CHECK (contract_changed IN (0, 1)),
  quality_status TEXT NOT NULL,
  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_futures_oi_quality
  ON futures_oi_daily(quality_status, trade_date);
