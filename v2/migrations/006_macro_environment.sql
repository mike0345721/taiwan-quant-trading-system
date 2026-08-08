CREATE TABLE IF NOT EXISTS macro_series (
  series_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  frequency TEXT NOT NULL,
  units TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  availability_rule TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS macro_import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_key TEXT NOT NULL REFERENCES macro_series(series_key),
  fetched_at TEXT NOT NULL,
  first_observation_date TEXT,
  last_observation_date TEXT,
  row_count INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS macro_observations (
  series_key TEXT NOT NULL REFERENCES macro_series(series_key),
  observation_date TEXT NOT NULL CHECK (observation_date GLOB '????-??-??'),
  value REAL NOT NULL,
  source_run_id INTEGER NOT NULL REFERENCES macro_import_runs(id),
  PRIMARY KEY (series_key, observation_date)
);

CREATE INDEX IF NOT EXISTS idx_macro_observation_asof
  ON macro_observations(series_key, observation_date DESC);
