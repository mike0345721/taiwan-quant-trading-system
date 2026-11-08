import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase, withTransaction } from '../src/db.mjs';
import { monthRanges } from '../src/taifex-csv.mjs';
import { parseOptionLargeTraderCsv } from '../src/taifex-option-participants.mjs';

const SOURCE_URL = 'https://www.taifex.com.tw/cht/3/largeTraderOptDown';
const config = v2Config(); const db = openDatabase(config.databasePath);
const cacheDir = path.join(config.dataRoot, 'data', 'option-large-trader-cache');
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
        body: new URLSearchParams({ queryStartDate: range.start.replaceAll('-', '/'), queryEndDate: range.end.replaceAll('-', '/') }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tw-chip-dashboard-v2/3.6.2 option-large-trader-backfill' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100 || buffer.length > 32 * 1024 * 1024) throw new Error(`unexpected payload bytes ${buffer.length}`);
      parseOptionLargeTraderCsv(new TextDecoder('big5').decode(buffer));
      fs.writeFileSync(cachePath, zlib.gzipSync(buffer, { level: 9 }), { mode: 0o600 });
      return { buffer, cacheHit: false };
    } catch (error) { lastError = error; if (attempt < 5) await sleep(attempt * 2_000); }
    finally { clearTimeout(timer); }
  }
  throw lastError;
}

try {
  applyMigrations(db, config.migrationsPath);
  const start = process.env.V2_OPTION_LARGE_START || db.prepare('SELECT MIN(trade_date) date FROM market_daily WHERE tx_close IS NOT NULL').get().date;
  const end = process.env.V2_OPTION_LARGE_END || db.prepare('SELECT MAX(trade_date) date FROM market_daily WHERE tx_close IS NOT NULL').get().date;
  const maxMonths = Math.max(1, Number(process.env.V2_OPTION_LARGE_MONTHS || 6));
  const ranges = monthRanges(start, end).filter((range) => !db.prepare(`SELECT 1 FROM official_backfill_files
    WHERE dataset='option_large_traders' AND period_start=? AND period_end=?`).get(range.start, range.end)).slice(0, maxMonths);
  const upsert = db.prepare(`INSERT OR REPLACE INTO option_large_trader_daily
    (trade_date,product_scope,option_right,expiry_scope,expiry_label,trader_category,
     top5_buy,top5_sell,top10_buy,top10_sell,market_open_interest,source_url,fetched_at)
    VALUES (?,'TXO',?,?,?,?,?,?,?,?,?,?,?)`);
  const register = db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
    (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,product_scope,
     expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,quality_status,rollover_flag,error)
    VALUES ('taifex_option_large_trader',?,?,?,?,?,'regular','TXO',?,?,'contracts',?,?,?,?,0,?)`);
  const failures = []; let importedRows = 0; let cacheHits = 0;
  for (const range of ranges) {
    const retrievedAt = new Date().toISOString();
    try {
      const { buffer, cacheHit } = await fetchCsv(range);
      const payloadHash = sha256(buffer); const rows = parseOptionLargeTraderCsv(new TextDecoder('big5').decode(buffer));
      withTransaction(db, () => {
        for (const row of rows) {
          upsert.run(row.tradeDate, row.optionRight, row.expiryScope, row.expiryLabel, row.traderCategory,
            row.top5Buy, row.top5Sell, row.top10Buy, row.top10Sell, row.marketOi, SOURCE_URL, retrievedAt);
          register.run(row.tradeDate, 'success', `${row.tradeDate}T16:30:00+08:00`, retrievedAt, 'final_after_16_15',
            row.expiryScope, row.traderCategory, SOURCE_URL, payloadHash, 1, 'official_final_complete', null);
        }
        db.prepare(`INSERT OR REPLACE INTO official_backfill_files
          (dataset,period_start,period_end,source_url,payload_sha256,payload_bytes,downloaded_at,imported_rows)
          VALUES ('option_large_traders',?,?,?,?,?,?,?)`)
          .run(range.start, range.end, SOURCE_URL, payloadHash, buffer.length, retrievedAt, rows.length);
      });
      importedRows += rows.length; if (cacheHit) cacheHits += 1;
    } catch (error) { failures.push({ ...range, error: error.message }); }
    await sleep(Number(process.env.V2_OPTION_LARGE_DELAY_MS || 500));
  }
  const coverage = db.prepare(`SELECT COUNT(DISTINCT trade_date) days,COUNT(*) rows,MIN(trade_date) first,MAX(trade_date) last FROM option_large_trader_daily`).get();
  const report = { generatedAt: new Date().toISOString(), start, end, requestedRanges: ranges.length, importedRows, cacheHits, failures, coverage };
  fs.writeFileSync(path.join(config.reportsPath, 'latest-option-large-trader-backfill.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }

