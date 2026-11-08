import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { readOptionOiCoverage } from '../src/option-oi-coverage.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const oi = readOptionOiCoverage(db);
  const report = {
    generatedAt: new Date().toISOString(),
    databaseBytes: fs.statSync(config.databasePath).size,
    optionDateRange: db.prepare(`SELECT MIN(trade_date) AS first, MAX(trade_date) AS last, COUNT(*) AS days FROM (SELECT DISTINCT trade_date FROM options_contract_daily)`).get(),
    futuresDateRange: db.prepare(`SELECT MIN(trade_date) AS first, MAX(trade_date) AS last, COUNT(*) AS days FROM (SELECT DISTINCT trade_date FROM futures_contract_daily)`).get(),
    globalMarketCoverage: db.prepare(`SELECT symbol, MIN(trade_date) AS first, MAX(trade_date) AS last, COUNT(*) AS days
      FROM global_market_daily GROUP BY symbol ORDER BY symbol`).all(),
    macroCoverage: db.prepare(`SELECT series_key AS series, MIN(observation_date) AS first, MAX(observation_date) AS last, COUNT(*) AS observations
      FROM macro_observations GROUP BY series_key ORDER BY series_key`).all(),
    volatilityRelativeCoverage: db.prepare(`SELECT MIN(trade_date) AS first, MAX(trade_date) AS last, COUNT(*) AS days
      FROM volatility_relative_daily`).get(),
    counts: {
      futuresContracts: db.prepare('SELECT COUNT(*) AS count FROM futures_contract_daily').get().count,
      optionContracts: db.prepare('SELECT COUNT(*) AS count FROM options_contract_daily').get().count,
      optionStrikes: db.prepare('SELECT COUNT(*) AS count FROM options_strike_daily').get().count,
      optionOiChanges: oi.total,
      optionOiDelta1d: oi.delta1d,
      optionOiDelta3d: oi.delta3d,
      optionOiDelta5d: oi.delta5d,
      globalMarketRows: db.prepare('SELECT COUNT(*) AS count FROM global_market_daily').get().count,
      macroObservations: db.prepare('SELECT COUNT(*) AS count FROM macro_observations').get().count,
      volatilityRelativeDays: db.prepare('SELECT COUNT(*) AS count FROM volatility_relative_daily').get().count,
    },
    expirySources: db.prepare(`SELECT expiry_date_source AS source, COUNT(DISTINCT contract) AS contracts FROM options_contract_daily GROUP BY expiry_date_source`).all(),
    alignedCrossMarket: db.prepare(`SELECT MIN(m.trade_date) AS first, MAX(m.trade_date) AS last, COUNT(*) AS days
      FROM market_daily m JOIN spot_institutional_daily s USING(trade_date) JOIN futures_positions_daily f USING(trade_date)
      WHERE m.twii_close IS NOT NULL AND m.tx_close IS NOT NULL AND s.foreign_net_e IS NOT NULL AND f.foreign_net IS NOT NULL
      AND EXISTS (SELECT 1 FROM options_contract_daily o WHERE o.trade_date=m.trade_date)`).get(),
    alignedFuturesResearch: db.prepare(`SELECT MIN(m.trade_date) AS first, MAX(m.trade_date) AS last, COUNT(*) AS days
      FROM market_daily m JOIN futures_positions_daily f USING(trade_date)
      WHERE m.tx_close IS NOT NULL AND f.foreign_net IS NOT NULL
      AND EXISTS (SELECT 1 FROM options_contract_daily o WHERE o.trade_date=m.trade_date)`).get(),
    incompleteCrossMarketCount: db.prepare(`SELECT COUNT(*) AS count
      FROM raw_snapshots r LEFT JOIN market_daily m USING(trade_date) LEFT JOIN spot_institutional_daily s USING(trade_date)
      LEFT JOIN futures_positions_daily f USING(trade_date)
      WHERE m.twii_close IS NULL OR s.foreign_net_e IS NULL OR f.foreign_net IS NULL`).get().count,
    incompleteCrossMarketDates: db.prepare(`SELECT r.trade_date, m.twii_close, m.tx_close, s.foreign_net_e, f.foreign_net
      FROM raw_snapshots r LEFT JOIN market_daily m USING(trade_date) LEFT JOIN spot_institutional_daily s USING(trade_date)
      LEFT JOIN futures_positions_daily f USING(trade_date)
      WHERE m.twii_close IS NULL OR s.foreign_net_e IS NULL OR f.foreign_net IS NULL ORDER BY r.trade_date LIMIT 20`).all(),
  };
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const output = path.join(config.reportsPath, 'v2-status.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
