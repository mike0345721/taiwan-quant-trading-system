CREATE TABLE IF NOT EXISTS fundamental_series (
  series_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  frequency TEXT NOT NULL,
  units TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  release_rule TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fundamental_releases (
  series_key TEXT NOT NULL REFERENCES fundamental_series(series_key),
  reference_period TEXT NOT NULL,
  release_date TEXT NOT NULL CHECK (release_date GLOB '????-??-??'),
  release_time TEXT,
  value REAL NOT NULL,
  yoy_pct REAL,
  revision_vintage TEXT NOT NULL DEFAULT 'initial',
  source_payload_sha256 TEXT,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (series_key, reference_period, revision_vintage)
);

CREATE INDEX IF NOT EXISTS idx_fundamental_available
  ON fundamental_releases(series_key, release_date DESC, release_time DESC);
