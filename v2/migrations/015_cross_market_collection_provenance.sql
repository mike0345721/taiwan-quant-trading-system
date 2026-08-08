ALTER TABLE spot_institutional_daily ADD COLUMN foreign_buy_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN foreign_sell_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN trust_buy_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN trust_sell_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN dealer_proprietary_buy_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN dealer_proprietary_sell_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN dealer_hedge_buy_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN dealer_hedge_sell_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN institutional_buy_e REAL;
ALTER TABLE spot_institutional_daily ADD COLUMN institutional_sell_e REAL;

ALTER TABLE futures_oi_daily ADD COLUMN near_scope_market_oi INTEGER;
ALTER TABLE futures_oi_daily ADD COLUMN all_contracts_market_oi INTEGER;
ALTER TABLE futures_oi_daily ADD COLUMN product_scope TEXT;

CREATE TABLE IF NOT EXISTS research_input_registry_daily (
  dataset_key TEXT NOT NULL,
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  collection_status TEXT NOT NULL CHECK (collection_status IN ('success', 'no_data', 'source_error', 'not_applicable')),
  available_at TEXT,
  retrieved_at TEXT NOT NULL,
  revision TEXT NOT NULL,
  session_scope TEXT NOT NULL,
  product_scope TEXT NOT NULL,
  expiry_scope TEXT NOT NULL DEFAULT '',
  participant_scope TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  source_url TEXT NOT NULL,
  payload_sha256 TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  quality_status TEXT NOT NULL,
  rollover_flag INTEGER NOT NULL DEFAULT 0 CHECK (rollover_flag IN (0, 1)),
  error TEXT,
  PRIMARY KEY (dataset_key, trade_date, revision, session_scope, product_scope, expiry_scope, participant_scope)
);

CREATE INDEX IF NOT EXISTS idx_research_input_registry_status
  ON research_input_registry_daily(dataset_key, collection_status, trade_date);

