CREATE TABLE IF NOT EXISTS market_breadth_history_daily (
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('TWSE','TPEX')),
  advance INTEGER,
  decline INTEGER,
  unchanged INTEGER,
  limit_up INTEGER,
  limit_down INTEGER,
  universe_scope TEXT NOT NULL,
  derivation TEXT NOT NULL,
  available_at TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  PRIMARY KEY (trade_date, market)
);

ALTER TABLE securities_lending_daily ADD COLUMN market TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN lending_new INTEGER;
ALTER TABLE securities_lending_daily ADD COLUMN lending_return INTEGER;
ALTER TABLE securities_lending_daily ADD COLUMN short_sale_buyback INTEGER;
ALTER TABLE securities_lending_daily ADD COLUMN short_sale_adjustment INTEGER;
ALTER TABLE securities_lending_daily ADD COLUMN available_at TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN retrieved_at TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN revision TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN product_scope TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN source_url TEXT;
ALTER TABLE securities_lending_daily ADD COLUMN payload_sha256 TEXT;

ALTER TABLE etf_flow_daily ADD COLUMN available_at TEXT;
ALTER TABLE etf_flow_daily ADD COLUMN retrieved_at TEXT;
ALTER TABLE etf_flow_daily ADD COLUMN revision TEXT;
ALTER TABLE etf_flow_daily ADD COLUMN flow_method TEXT;
ALTER TABLE etf_flow_daily ADD COLUMN source_url TEXT;

ALTER TABLE option_volatility_daily ADD COLUMN contract_type TEXT;
ALTER TABLE option_volatility_daily ADD COLUMN futures_contract TEXT;
ALTER TABLE option_volatility_daily ADD COLUMN available_at TEXT;
ALTER TABLE option_volatility_daily ADD COLUMN retrieved_at TEXT;
ALTER TABLE option_volatility_daily ADD COLUMN quality_status TEXT;
ALTER TABLE option_volatility_daily ADD COLUMN atm_strike REAL;
ALTER TABLE option_volatility_daily ADD COLUMN observations INTEGER;

CREATE INDEX IF NOT EXISTS idx_breadth_history_date ON market_breadth_history_daily(trade_date);
CREATE INDEX IF NOT EXISTS idx_lending_market_date ON securities_lending_daily(market, trade_date);
CREATE INDEX IF NOT EXISTS idx_option_vol_type_date ON option_volatility_daily(contract_type, trade_date);
