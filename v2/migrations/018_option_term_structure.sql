CREATE TABLE IF NOT EXISTS option_volatility_term_daily (
  trade_date TEXT PRIMARY KEY,
  weekly_contract TEXT NOT NULL,
  weekly_expiry TEXT NOT NULL,
  weekly_days INTEGER NOT NULL,
  weekly_atm_iv REAL NOT NULL,
  monthly_contract TEXT NOT NULL,
  monthly_expiry TEXT NOT NULL,
  monthly_days INTEGER NOT NULL,
  monthly_atm_iv REAL NOT NULL,
  monthly_minus_weekly_iv REAL NOT NULL,
  structure TEXT NOT NULL CHECK (structure IN ('contango','backwardation','flat')),
  available_at TEXT NOT NULL,
  calculation_version TEXT NOT NULL
);
