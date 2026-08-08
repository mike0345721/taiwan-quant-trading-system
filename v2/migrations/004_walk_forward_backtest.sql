CREATE TABLE IF NOT EXISTS backtest_folds (
  run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  fold_index INTEGER NOT NULL,
  train_start TEXT NOT NULL,
  train_end TEXT NOT NULL,
  test_start TEXT NOT NULL,
  test_end TEXT NOT NULL,
  thresholds_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  PRIMARY KEY (run_id, fold_index)
);

CREATE TABLE IF NOT EXISTS backtest_daily_results (
  run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  next_trade_date TEXT NOT NULL,
  fold_index INTEGER NOT NULL,
  signal INTEGER NOT NULL CHECK (signal IN (-1, 0, 1)),
  regime TEXT NOT NULL,
  entry_close REAL NOT NULL,
  exit_close REAL NOT NULL,
  gross_points REAL NOT NULL,
  cost_points REAL NOT NULL,
  net_points REAL NOT NULL,
  net_return_pct REAL NOT NULL,
  feature_snapshot_json TEXT NOT NULL,
  PRIMARY KEY (run_id, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_backtest_daily_run ON backtest_daily_results(run_id, trade_date);
