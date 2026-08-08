import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { optionStructure } from './taifex-csv.mjs';

function evenlySpaced(rows, count) {
  if (rows.length <= count) return rows;
  return Array.from({ length: count }, (_, index) => rows[Math.round(index * (rows.length - 1) / (count - 1))]);
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

export function officialCachePath(cacheDir, file) {
  const dataDir = path.dirname(cacheDir);
  const csvName = `${file.period_start}-${file.period_end}.csv.gz`;
  const candidates = {
    domestic_institutional_positions: [path.join(dataDir, 'domestic-institution-cache', csvName)],
    option_institutional_positions: [path.join(dataDir, 'option-institution-cache', csvName)],
    option_large_traders: [path.join(dataDir, 'option-large-trader-cache', csvName)],
    twse_spot_institutional_final: [path.join(dataDir, 'twse-institution-cache', `${file.period_start}.json.gz`)],
  }[file.dataset] || [];
  candidates.push(path.join(cacheDir, `${file.dataset}-${file.period_start}-${file.period_end}.csv.gz`));
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

export function validateOfficialBackfill(db, cacheDir) {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });

  const files = db.prepare('SELECT * FROM official_backfill_files ORDER BY dataset, period_start').all();
  for (const file of files) {
    const cachePath = officialCachePath(cacheDir, file);
    const exists = fs.existsSync(cachePath);
    const digest = exists ? sha256(zlib.gunzipSync(fs.readFileSync(cachePath))) : null;
    check(`checksum ${file.dataset} ${file.period_start}`, exists && digest === file.payload_sha256, exists ? `expected ${file.payload_sha256}, actual ${digest}` : 'cache file missing');
  }

  const futuresDates = db.prepare(`SELECT DISTINCT trade_date FROM futures_contract_daily WHERE product='TX' AND session='一般' ORDER BY trade_date`).all();
  for (const item of evenlySpaced(futuresDates, 20)) {
    const rows = db.prepare(`SELECT contract, volume, close, is_active FROM futures_contract_daily WHERE trade_date=? AND product='TX' AND session='一般' ORDER BY volume DESC`).all(item.trade_date);
    const active = rows.find((row) => row.is_active === 1);
    const market = db.prepare('SELECT tx_contract, tx_close FROM market_daily WHERE trade_date=?').get(item.trade_date);
    check(`futures active ${item.trade_date}`, active && active.contract === rows[0]?.contract && market?.tx_contract === active.contract && market?.tx_close === active.close,
      `active ${active?.contract || 'none'}, highest-volume ${rows[0]?.contract || 'none'}, market ${market?.tx_contract || 'none'}`);
  }

  const activeOptions = db.prepare(`SELECT trade_date, contract, call_oi, put_oi, call_volume, put_volume, call_wall_strike, put_wall_strike, max_pain
    FROM options_contract_daily WHERE is_active=1 ORDER BY trade_date`).all();
  for (const contract of evenlySpaced(activeOptions, 20)) {
    const strikes = db.prepare(`SELECT strike, call_oi, put_oi, call_volume, put_volume FROM options_strike_daily WHERE trade_date=? AND contract=? ORDER BY strike`).all(contract.trade_date, contract.contract);
    const totals = strikes.reduce((sum, row) => ({ callOi: sum.callOi + row.call_oi, putOi: sum.putOi + row.put_oi, callVolume: sum.callVolume + row.call_volume, putVolume: sum.putVolume + row.put_volume }), { callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 });
    const structure = optionStructure(new Map(strikes.map((row) => [row.strike, { strike: row.strike, callOi: row.call_oi, putOi: row.put_oi }])));
    check(`options totals ${contract.trade_date} ${contract.contract}`,
      totals.callOi === contract.call_oi && totals.putOi === contract.put_oi && totals.callVolume === contract.call_volume && totals.putVolume === contract.put_volume,
      `contract OI ${contract.call_oi}/${contract.put_oi}; strike sum ${totals.callOi}/${totals.putOi}`);
    check(`options structure ${contract.trade_date} ${contract.contract}`,
      structure.callWall?.strike === contract.call_wall_strike && structure.putWall?.strike === contract.put_wall_strike && structure.maxPain === contract.max_pain,
      `walls ${contract.call_wall_strike}/${contract.put_wall_strike}; max pain ${contract.max_pain}`);
  }

  const deltaSamples = evenlySpaced(db.prepare(`SELECT * FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL AND put_oi_delta_1d IS NOT NULL ORDER BY contract, strike, trade_date`).all(), 20);
  for (const row of deltaSamples) {
    const previous = db.prepare(`SELECT call_oi, put_oi FROM options_strike_daily WHERE contract=? AND strike=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1`).get(row.contract, row.strike, row.trade_date);
    check(`option delta ${row.trade_date} ${row.contract} ${row.strike}`, previous && row.call_oi - previous.call_oi === row.call_oi_delta_1d && row.put_oi - previous.put_oi === row.put_oi_delta_1d,
      `delta ${row.call_oi_delta_1d}/${row.put_oi_delta_1d}`);
  }

  const coverage = db.prepare(`SELECT
    (SELECT COUNT(DISTINCT trade_date) FROM futures_contract_daily WHERE product='TX' AND session='一般') AS futures_days,
    (SELECT COUNT(DISTINCT trade_date) FROM options_contract_daily) AS option_days,
    (SELECT COUNT(*) FROM options_strike_daily) AS option_strikes,
    (SELECT COUNT(*) FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL OR put_oi_delta_1d IS NOT NULL) AS delta_rows`).get();
  check('at least one year of futures', coverage.futures_days >= 240, `${coverage.futures_days} trading days`);
  check('at least one year of options', coverage.option_days >= 240, `${coverage.option_days} trading days`);
  const invalidSessions = db.prepare(`SELECT COUNT(*) AS count FROM futures_contract_daily WHERE session<>'一般'`).get().count;
  const invalidActiveDates = db.prepare(`SELECT COUNT(*) AS count FROM (SELECT trade_date, SUM(is_active) AS active_count FROM options_contract_daily GROUP BY trade_date HAVING active_count<>1)`).get().count;
  const missingExpiry = db.prepare(`SELECT COUNT(*) AS count FROM options_contract_daily WHERE expiry_date IS NULL OR expiry_date_source IS NULL`).get().count;
  const maxOptionDate = db.prepare('SELECT MAX(trade_date) AS date FROM options_contract_daily').get().date;
  const unverifiedExpired = db.prepare(`SELECT COUNT(DISTINCT contract) AS count FROM options_contract_daily WHERE expiry_date<=? AND expiry_date_source<>'official_last_seen'`).get(maxOptionDate).count;
  check('regular session only', invalidSessions === 0, `${invalidSessions} non-regular futures rows`);
  check('exactly one active option contract per date', invalidActiveDates === 0, `${invalidActiveDates} invalid dates`);
  check('option expiry provenance recorded', missingExpiry === 0, `${missingExpiry} rows missing expiry provenance`);
  check('expired contracts use official last-seen date', unverifiedExpired === 0, `${unverifiedExpired} expired contracts still use estimates`);

  const failed = checks.filter((item) => !item.passed);
  return { generatedAt: new Date().toISOString(), coverage, totalChecks: checks.length, passedChecks: checks.length - failed.length, failedChecks: failed.length, checks };
}
