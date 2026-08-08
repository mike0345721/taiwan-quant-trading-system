PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pp1_source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('TAIFEX_CALENDAR','ANNOUNCEMENT_OVERLAY','CONTRACT_MASTER','PROVIDER_MAPPING')),
  source_url TEXT,
  source_published_at TEXT,
  retrieved_at TEXT NOT NULL,
  effective_from TEXT,
  effective_until TEXT,
  payload_json TEXT NOT NULL,
  source_data_hash TEXT NOT NULL,
  policy_spec_hash TEXT NOT NULL,
  revision_number INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pp1_session_contexts (
  session_id TEXT PRIMARY KEY,
  calendar_date TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  session_trade_date TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('DAY','NIGHT')),
  session_start TEXT NOT NULL,
  session_end TEXT NOT NULL,
  cross_midnight INTEGER NOT NULL CHECK (cross_midnight IN (0,1)),
  is_settlement_trade_date INTEGER NOT NULL CHECK (is_settlement_trade_date IN (0,1)),
  calendar_source_hash TEXT NOT NULL,
  policy_spec_hash TEXT NOT NULL,
  quality_state TEXT NOT NULL CHECK (quality_state IN ('PASS','DEGRADED','UNAVAILABLE'))
);

CREATE TABLE IF NOT EXISTS pp1_contract_identities (
  canonical_contract_id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  product TEXT NOT NULL,
  contract_code TEXT NOT NULL,
  contract_month TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  provider_alias TEXT,
  source_data_hash TEXT NOT NULL,
  UNIQUE(provider, provider_code)
);

CREATE TABLE IF NOT EXISTS pp1_contract_selection_sets (
  selection_set_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES pp1_session_contexts(session_id),
  selected_at TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_until TEXT NOT NULL,
  policy_spec_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  source_data_hash TEXT NOT NULL,
  UNIQUE(session_id, policy_spec_hash, policy_version)
);

CREATE TABLE IF NOT EXISTS pp1_contract_selections (
  selection_id TEXT PRIMARY KEY,
  selection_set_id TEXT NOT NULL REFERENCES pp1_contract_selection_sets(selection_set_id) ON DELETE CASCADE,
  contract_role TEXT NOT NULL CHECK (contract_role IN ('NEAREST_ELIGIBLE_MONTH','NEXT_MONTHLY','OBSERVED_LIQUIDITY_LEAD','SESSION_FROZEN_LIQUIDITY_LEAD','SELECTED_RESEARCH','SELECTED_TRADING')),
  canonical_contract_id TEXT REFERENCES pp1_contract_identities(canonical_contract_id),
  selection_reason TEXT,
  fallback_reason TEXT,
  quality_state TEXT NOT NULL CHECK (quality_state IN ('PASS','DEGRADED','UNAVAILABLE')),
  trade_eligible INTEGER NOT NULL CHECK (trade_eligible IN (0,1)),
  is_final_trading_session_for_selected_contract INTEGER NOT NULL CHECK (is_final_trading_session_for_selected_contract IN (0,1)),
  selected_contract_expiry_date TEXT,
  selected_contract_final_trading_timestamp TEXT,
  lineage_json TEXT NOT NULL,
  UNIQUE(selection_set_id, contract_role)
);

CREATE TABLE IF NOT EXISTS pp1_gap_observations (
  gap_observation_id TEXT PRIMARY KEY,
  gap_definition TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  source_trade_date TEXT NOT NULL,
  source_contract_code TEXT NOT NULL,
  target_session_id TEXT NOT NULL,
  target_trade_date TEXT NOT NULL,
  target_contract_code TEXT NOT NULL,
  gap_state TEXT NOT NULL,
  raw_gap REAL,
  quality_state TEXT NOT NULL CHECK (quality_state IN ('PASS','DEGRADED','UNAVAILABLE')),
  descriptive_only INTEGER NOT NULL CHECK (descriptive_only IN (0,1)),
  trade_eligible INTEGER NOT NULL CHECK (trade_eligible IN (0,1)),
  threshold_policy_status TEXT NOT NULL,
  optimized_on_trading_target INTEGER NOT NULL CHECK (optimized_on_trading_target IN (0,1)),
  lineage_json TEXT NOT NULL,
  UNIQUE(gap_definition, source_session_id, target_session_id, source_contract_code, target_contract_code)
);

CREATE TABLE IF NOT EXISTS pp1_continuous_series_points (
  series_id TEXT NOT NULL,
  event_timestamp TEXT NOT NULL,
  contract_code TEXT NOT NULL,
  source_price REAL NOT NULL,
  continuous_value REAL NOT NULL,
  series_type TEXT NOT NULL CHECK (series_type IN ('CONTINUOUS_UNADJUSTED','CONTINUOUS_BACK_ADJUSTED_POINTS','CONTINUOUS_RETURN_LINKED_INDEX')),
  series_as_of TEXT,
  adjustment_knowledge_at TEXT,
  as_of_reconstruction TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  historical_model_eligible INTEGER NOT NULL CHECK (historical_model_eligible IN (0,1)),
  lineage_json TEXT NOT NULL,
  PRIMARY KEY(series_id, event_timestamp, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_pp1_sessions_trade_date ON pp1_session_contexts(session_trade_date, session_type);
CREATE INDEX IF NOT EXISTS idx_pp1_selections_session ON pp1_contract_selection_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_pp1_gaps_target ON pp1_gap_observations(target_trade_date, gap_definition);

