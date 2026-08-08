import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase } from '../src/db.mjs';
import { parseTwseInstitutionPayload } from '../src/twse-core-history.mjs';

const SOURCE_URL = 'https://www.twse.com.tw/fund/BFI82U';
const REVISION = 'final_including_block_trades';
const config = v2Config();
const db = openDatabase(config.databasePath);
const cacheDir = path.join(config.root, 'data', 'twse-institution-cache');
fs.mkdirSync(cacheDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const publishedAt = (date) => `${date}T20:05:00+08:00`;

async function fetchPayload(tradeDate) {
  const cachePath = path.join(cacheDir, `${tradeDate}.json.gz`);
  if (fs.existsSync(cachePath)) {
    const buffer = zlib.gunzipSync(fs.readFileSync(cachePath));
    return { buffer, payload: JSON.parse(buffer.toString('utf8')), cacheHit: true };
  }
  const compact = tradeDate.replaceAll('-', '');
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${SOURCE_URL}?dayDate=${compact}&type=day&response=json`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'tw-chip-dashboard-v2/3.6.2 spot-final-backfill', Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 100 || buffer.length > 2 * 1024 * 1024) throw new Error(`unexpected payload bytes ${buffer.length}`);
      const payload = JSON.parse(buffer.toString('utf8'));
      parseTwseInstitutionPayload(payload, tradeDate);
      fs.writeFileSync(cachePath, zlib.gzipSync(buffer, { level: 9 }), { mode: 0o600 });
      return { buffer, payload, cacheHit: false };
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(attempt * 1_500);
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

const register = db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
  (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,
   product_scope,expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,
   quality_status,rollover_flag,error)
  VALUES ('twse_spot_institutional_final',?,?,?,?,?,'regular','TWSE','','foreign_trust_dealer','TWD_100M',?,?,?,?,0,?)`);

try {
  applyMigrations(db, config.migrationsPath);
  const limit = Math.max(1, Number(process.env.V2_TWSE_GROSS_BATCH || 50));
  const start = process.env.V2_TWSE_GROSS_START || '0000-01-01';
  const end = process.env.V2_TWSE_GROSS_END || '9999-12-31';
  const dates = db.prepare(`SELECT trade_date FROM spot_institutional_daily
    WHERE trade_date BETWEEN ? AND ? AND (foreign_buy_e IS NULL OR foreign_sell_e IS NULL
      OR trust_buy_e IS NULL OR trust_sell_e IS NULL OR dealer_proprietary_buy_e IS NULL
      OR dealer_proprietary_sell_e IS NULL OR dealer_hedge_buy_e IS NULL OR dealer_hedge_sell_e IS NULL
      OR ABS((foreign_buy_e-foreign_sell_e)-foreign_net_e)>0.000001
      OR ABS((trust_buy_e-trust_sell_e)-trust_net_e)>0.000001
      OR ABS((dealer_proprietary_buy_e-dealer_proprietary_sell_e)-dealer_proprietary_net_e)>0.000001
      OR ABS((dealer_hedge_buy_e-dealer_hedge_sell_e)-dealer_hedge_net_e)>0.000001)
    ORDER BY trade_date LIMIT ?`).all(start, end, limit).map((row) => row.trade_date);
  const update = db.prepare(`UPDATE spot_institutional_daily SET
    foreign_buy_e=?,foreign_sell_e=?,trust_buy_e=?,trust_sell_e=?,
    dealer_proprietary_buy_e=?,dealer_proprietary_sell_e=?,dealer_hedge_buy_e=?,dealer_hedge_sell_e=?,
    institutional_buy_e=?,institutional_sell_e=?,foreign_net_e=?,trust_net_e=?,dealer_proprietary_net_e=?,
    dealer_hedge_net_e=?,dealer_total_net_e=?,institutional_total_e=? WHERE trade_date=?`);
  const failures = []; let imported = 0; let cacheHits = 0;
  for (const tradeDate of dates) {
    const retrievedAt = new Date().toISOString();
    try {
      const { buffer, payload, cacheHit } = await fetchPayload(tradeDate);
      const parsed = parseTwseInstitutionPayload(payload, tradeDate);
      if ([parsed.foreignBuyE, parsed.foreignSellE, parsed.trustBuyE, parsed.trustSellE,
        parsed.dealerProprietaryBuyE, parsed.dealerProprietarySellE,
        parsed.dealerHedgeBuyE, parsed.dealerHedgeSellE].some((value) => value == null)) {
        throw new Error('official final rows missing buy/sell values');
      }
      db.exec('BEGIN IMMEDIATE;');
      try {
        update.run(parsed.foreignBuyE, parsed.foreignSellE, parsed.trustBuyE, parsed.trustSellE,
          parsed.dealerProprietaryBuyE, parsed.dealerProprietarySellE,
          parsed.dealerHedgeBuyE, parsed.dealerHedgeSellE,
          parsed.institutionalBuyE, parsed.institutionalSellE, parsed.foreignNetE, parsed.trustNetE,
          parsed.dealerProprietaryNetE, parsed.dealerHedgeNetE, parsed.dealerTotalNetE,
          parsed.institutionalTotalE, tradeDate);
        register.run(tradeDate, 'success', publishedAt(tradeDate), retrievedAt, REVISION,
          SOURCE_URL, sha256(buffer), payload.data?.length || 0, 'official_final_complete', null);
        db.prepare(`INSERT OR REPLACE INTO official_backfill_files
          (dataset,period_start,period_end,source_url,payload_sha256,payload_bytes,downloaded_at,imported_rows)
          VALUES ('twse_spot_institutional_final',?,?,?,?,?,?,1)`)
          .run(tradeDate, tradeDate, SOURCE_URL, sha256(buffer), buffer.length, retrievedAt);
        db.exec('COMMIT;');
      } catch (error) { db.exec('ROLLBACK;'); throw error; }
      imported += 1; if (cacheHit) cacheHits += 1;
    } catch (error) {
      register.run(tradeDate, 'source_error', publishedAt(tradeDate), retrievedAt, REVISION,
        SOURCE_URL, null, 0, 'source_error', error.message);
      failures.push({ tradeDate, error: error.message });
    }
    await sleep(Number(process.env.V2_TWSE_GROSS_DELAY_MS || 350));
  }
  const coverage = db.prepare(`SELECT COUNT(*) total,
    SUM(foreign_buy_e IS NOT NULL AND foreign_sell_e IS NOT NULL AND trust_buy_e IS NOT NULL
      AND trust_sell_e IS NOT NULL AND dealer_proprietary_buy_e IS NOT NULL
      AND dealer_proprietary_sell_e IS NOT NULL AND dealer_hedge_buy_e IS NOT NULL
      AND dealer_hedge_sell_e IS NOT NULL) complete
    FROM spot_institutional_daily`).get();
  const report = { generatedAt: new Date().toISOString(), requested: dates.length, imported, cacheHits, failures, coverage };
  fs.writeFileSync(path.join(config.reportsPath, 'latest-twse-institution-gross-backfill.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
