CREATE TABLE IF NOT EXISTS institutional_futures_detail_daily (
  trade_date TEXT NOT NULL CHECK (trade_date GLOB '????-??-??'),
  institution_type TEXT NOT NULL CHECK (institution_type IN ('investment_trust', 'dealer')),
  trade_long INTEGER,
  trade_short INTEGER,
  trade_net INTEGER,
  open_interest_long INTEGER,
  open_interest_short INTEGER,
  open_interest_net INTEGER,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, institution_type)
);

CREATE INDEX IF NOT EXISTS idx_institutional_futures_type_date
  ON institutional_futures_detail_daily(institution_type, trade_date);

