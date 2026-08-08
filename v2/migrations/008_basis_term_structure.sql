CREATE TABLE IF NOT EXISTS basis_term_structure_daily (
  trade_date TEXT PRIMARY KEY,
  near_contract TEXT NOT NULL,
  next_contract TEXT NOT NULL,
  near_close REAL NOT NULL,
  next_close REAL NOT NULL,
  spot_close REAL,
  days_to_near_expiry INTEGER NOT NULL,
  rollover_risk INTEGER NOT NULL DEFAULT 0 CHECK (rollover_risk IN (0, 1)),
  term_spread_points REAL NOT NULL,
  term_spread_bps REAL NOT NULL,
  term_change_1d_bps REAL,
  term_change_5d_bps REAL,
  term_change_z60 REAL,
  close_basis_points REAL,
  close_basis_bps REAL,
  basis_change_1d_bps REAL,
  basis_change_5d_bps REAL,
  basis_level_z60 REAL,
  feature_version TEXT NOT NULL,
  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_basis_term_contracts
  ON basis_term_structure_daily(near_contract, next_contract, trade_date);
