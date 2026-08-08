import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { alignTaiwanVixWithKnownUs } from '../src/taiwan-vix.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const version = '2.9.0';

try {
  applyMigrations(db, config.migrationsPath);
  const taiwan = db.prepare(`SELECT observation_date AS tradeDate, value
    FROM macro_observations WHERE series_key='TAIWANVIX' ORDER BY observation_date`).all();
  const us = db.prepare(`SELECT observation_date AS tradeDate, value
    FROM macro_observations WHERE series_key='VIXCLS' ORDER BY observation_date`).all();
  const rows = alignTaiwanVixWithKnownUs(
    taiwan.map((row) => ({ observationDate: row.tradeDate, value: row.value })),
    us.map((row) => ({ observationDate: row.tradeDate, value: row.value })),
  );
  const builtAt = new Date().toISOString();
  withTransaction(db, () => {
    db.exec('DELETE FROM volatility_relative_daily;');
    const insert = db.prepare(`INSERT INTO volatility_relative_daily(
      trade_date,taiwan_vix_close,taiwan_vix_change_1d,us_vix_known,us_vix_source_date,us_vix_change_1d,
      vix_ratio,vix_spread,change_divergence,feature_version,built_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rows) insert.run(
      row.tradeDate, row.taiwanVix, row.taiwanChange, row.usVix, row.usSourceDate, row.usChange,
      row.taiwanVix / row.usVix, row.taiwanVix - row.usVix,
      row.taiwanChange == null || row.usChange == null ? null : row.taiwanChange - row.usChange,
      version, builtAt,
    );
  });
  console.log(JSON.stringify({ generatedAt: builtAt, version, rows: rows.length, first: rows[0]?.tradeDate, last: rows.at(-1)?.tradeDate }, null, 2));
} finally { db.close(); }
