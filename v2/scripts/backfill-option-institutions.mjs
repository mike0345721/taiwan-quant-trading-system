import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase, withTransaction } from '../src/db.mjs';
import { monthRanges } from '../src/taifex-csv.mjs';
import { parseOptionInstitutionCsv } from '../src/taifex-option-participants.mjs';

const SOURCE_URL = 'https://www.taifex.com.tw/cht/3/optContractsDateDown';
const config = v2Config(); const db = openDatabase(config.databasePath);
const cacheDir = path.join(config.dataRoot, 'data', 'option-institution-cache');
fs.mkdirSync(cacheDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function fetchCsv(range) {
  const cachePath = path.join(cacheDir, `${range.start}-${range.end}.csv.gz`);
  if (fs.existsSync(cachePath)) return { buffer: zlib.gunzipSync(fs.readFileSync(cachePath)), cacheHit: true };
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(SOURCE_URL, {
        method: 'POST', signal: controller.signal,
        body: new URLSearchParams({ queryStartDate: range.start.replaceAll('-', '/'), queryEndDate: range.end.replaceAll('-', '/'), commodityId: 'TXO' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tw-chip-dashboard-v2/3.6.2 option-institution-backfill' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100 || buffer.length > 16 * 1024 * 1024) throw new Error(`unexpected payload bytes ${buffer.length}`);
      parseOptionInstitutionCsv(new TextDecoder('big5').decode(buffer));
      fs.writeFileSync(cachePath, zlib.gzipSync(buffer, { level: 9 }), { mode: 0o600 });
      return { buffer, cacheHit: false };
    } catch (error) { lastError = error; if (attempt < 5) await sleep(attempt * 2_000); }
    finally { clearTimeout(timer); }
  }
  throw lastError;
}

try {
  applyMigrations(db, config.migrationsPath);
  const databaseStart = db.prepare('SELECT MIN(trade_date) date FROM market_daily WHERE tx_close IS NOT NULL').get().date;
  const rollingStartDate = new Date(); rollingStartDate.setUTCFullYear(rollingStartDate.getUTCFullYear() - 3);
  const officialEarliest = process.env.V2_OPTION_INSTITUTION_OFFICIAL_EARLIEST || rollingStartDate.toISOString().slice(0, 10);
  const start = process.env.V2_OPTION_INSTITUTION_START || [databaseStart, officialEarliest].sort().at(-1);
  const end = process.env.V2_OPTION_INSTITUTION_END || db.prepare('SELECT MAX(trade_date) date FROM market_daily WHERE tx_close IS NOT NULL').get().date;
  const maxMonths = Math.max(1, Number(process.env.V2_OPTION_INSTITUTION_MONTHS || 6));
  const ranges = monthRanges(start, end).filter((range) => !db.prepare(`SELECT 1 FROM official_backfill_files
    WHERE dataset='option_institutional_positions' AND period_start=? AND period_end=?`).get(range.start, range.end)).slice(0, maxMonths);
  const upsert = db.prepare(`INSERT OR REPLACE INTO option_institutional_daily
    (trade_date,participant,trade_long,trade_short,trade_net,trade_long_value,trade_short_value,trade_net_value,
     open_interest_long,open_interest_short,open_interest_net,open_interest_long_value,open_interest_short_value,
     open_interest_net_value,product_scope,source_url,fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'TXO_ALL_CONTRACTS_AGGREGATE',?,?)`);
  const register = db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
    (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,product_scope,
     expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,quality_status,rollover_flag,error)
    VALUES ('taifex_option_institutional',?,?,?,?,?,'regular','TXO','all_contracts','dealer_trust_foreign','contracts',?,?,?,?,0,?)`);
  const now = new Date().toISOString();
  withTransaction(db, () => {
    for (const row of db.prepare(`SELECT trade_date FROM market_daily WHERE tx_close IS NOT NULL AND trade_date<? ORDER BY trade_date`).all(start)) {
      register.run(row.trade_date, 'no_data', `${row.trade_date}T16:30:00+08:00`, now, 'final_after_16_15',
        SOURCE_URL, null, 0, 'outside_official_rolling_window', 'Outside the official rolling three-year download window.');
    }
  });
  const failures = []; let importedRows = 0; let cacheHits = 0;
  for (const range of ranges) {
    const retrievedAt = new Date().toISOString();
    try {
      const { buffer, cacheHit } = await fetchCsv(range); const payloadHash = sha256(buffer);
      const rows = parseOptionInstitutionCsv(new TextDecoder('big5').decode(buffer));
      withTransaction(db, () => {
        for (const row of rows) upsert.run(row.tradeDate, row.participant,
          row.tradeLong, row.tradeShort, row.tradeNet, row.tradeLongValue, row.tradeShortValue, row.tradeNetValue,
          row.oiLong, row.oiShort, row.oiNet, row.oiLongValue, row.oiShortValue, row.oiNetValue, SOURCE_URL, retrievedAt);
        for (const tradeDate of [...new Set(rows.map((row) => row.tradeDate))]) register.run(
          tradeDate, 'success', `${tradeDate}T16:30:00+08:00`, retrievedAt, 'final_after_16_15',
          SOURCE_URL, payloadHash, rows.filter((row) => row.tradeDate === tradeDate).length, 'official_final_complete', null);
        db.prepare(`INSERT OR REPLACE INTO official_backfill_files
          (dataset,period_start,period_end,source_url,payload_sha256,payload_bytes,downloaded_at,imported_rows)
          VALUES ('option_institutional_positions',?,?,?,?,?,?,?)`)
          .run(range.start, range.end, SOURCE_URL, payloadHash, buffer.length, retrievedAt, rows.length);
      });
      importedRows += rows.length; if (cacheHit) cacheHits += 1;
    } catch (error) { failures.push({ ...range, error: error.message }); }
    await sleep(Number(process.env.V2_OPTION_INSTITUTION_DELAY_MS || 500));
  }
  const coverage = db.prepare(`SELECT COUNT(DISTINCT trade_date) days,COUNT(*) rows,MIN(trade_date) first,MAX(trade_date) last FROM option_institutional_daily`).get();
  const report = { generatedAt: new Date().toISOString(), databaseStart, officialEarliest, start, end, requestedRanges: ranges.length, importedRows, cacheHits, failures, coverage };
  fs.writeFileSync(path.join(config.reportsPath, 'latest-option-institution-backfill.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
