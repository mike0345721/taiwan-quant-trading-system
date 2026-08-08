import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const range = (table, condition = '1=1', date = 'trade_date', distinct = false) => db.prepare(`SELECT COUNT(${distinct ? 'DISTINCT ' : ''}${date}) AS days, MIN(${date}) AS first, MAX(${date}) AS last FROM ${table} WHERE ${condition}`).get();
  const report = {
    generatedAt: new Date().toISOString(),
    target: 'At least three years of contiguous, timestamped daily research inputs before event and sector-rotation research is promoted.',
    coverage: {
      market: range('market_daily'), twii: range('market_daily', 'twii_close IS NOT NULL'), tx: range('market_daily', 'tx_close IS NOT NULL'),
      spotInstitutional: range('spot_institutional_daily', 'foreign_net_e IS NOT NULL'),
      futuresPositions: range('futures_positions_daily', 'foreign_short IS NOT NULL'),
      marginShort: range('margin_short_daily', 'margin_balance_e IS NOT NULL'),
      options: range('options_contract_daily', '1=1', 'trade_date', true),
      taiwanVix: range('macro_observations', "series_key='TAIWANVIX'", 'observation_date'),
    },
    unresolvedAlignedDates: db.prepare(`SELECT COUNT(*) AS n FROM market_daily m LEFT JOIN spot_institutional_daily s USING(trade_date)
      LEFT JOIN futures_positions_daily f USING(trade_date) LEFT JOIN margin_short_daily ms USING(trade_date)
      WHERE m.tx_close IS NOT NULL AND (m.twii_close IS NULL OR s.foreign_net_e IS NULL OR f.foreign_short IS NULL OR ms.margin_balance_e IS NULL)`).get().n,
  };
  const output = path.join(config.reportsPath, 'data-completion-status.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally { db.close(); }
