import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { buildBasisTermRows } from '../src/basis-term-structure.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);

try {
  applyMigrations(db, config.migrationsPath);
  const contracts = db.prepare(`SELECT trade_date, contract, close, is_active
    FROM futures_contract_daily WHERE product='TX' ORDER BY trade_date, contract`).all();
  const spots = db.prepare('SELECT trade_date, twii_close FROM market_daily WHERE twii_close IS NOT NULL ORDER BY trade_date').all();
  const rows = buildBasisTermRows(contracts, spots);
  const insert = db.prepare(`INSERT OR REPLACE INTO basis_term_structure_daily
    (trade_date,near_contract,next_contract,near_close,next_close,spot_close,days_to_near_expiry,rollover_risk,
     term_spread_points,term_spread_bps,term_change_1d_bps,term_change_5d_bps,term_change_z60,
     close_basis_points,close_basis_bps,basis_change_1d_bps,basis_change_5d_bps,basis_level_z60,feature_version,built_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const builtAt = new Date().toISOString();
  withTransaction(db, () => {
    db.exec('DELETE FROM basis_term_structure_daily');
    for (const row of rows) insert.run(
      row.tradeDate, row.nearContract, row.nextContract, row.nearClose, row.nextClose, row.spotClose,
      row.daysToNearExpiry, row.rolloverRisk, row.termSpreadPoints, row.termSpreadBps,
      row.termChange1dBps, row.termChange5dBps, row.termChangeZ60,
      row.closeBasisPoints, row.closeBasisBps, row.basisChange1dBps, row.basisChange5dBps,
      row.basisLevelZ60, 'basis-term-v1', builtAt,
    );
  });
  console.log(JSON.stringify({ rows: rows.length, first: rows[0]?.tradeDate, last: rows.at(-1)?.tradeDate }, null, 2));
} finally {
  db.close();
}
