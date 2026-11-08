import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase } from '../src/db.mjs';
import { monthRanges } from '../src/taifex-csv.mjs';
import { parseTaifexPositionCsv } from '../src/taifex-position-parser.mjs';
import {
  DOMESTIC_INSTITUTION_SOURCE_URL as SOURCE_URL,
  dateTaipei,
  downloadDomesticInstitutionPeriod,
  parseDomesticOpenApiValues,
  reconcileDomesticInstitutionNets,
  selectDomesticInstitutionRanges,
  upsertDomesticInstitutionRows,
} from '../src/domestic-institution-backfill.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const startDate = process.env.V2_DOMESTIC_START || db.prepare('SELECT MIN(trade_date) AS date FROM market_daily WHERE tx_close IS NOT NULL').get()?.date || '2023-07-01';
const taipeiToday = dateTaipei();
// The download endpoint rejects weekends and holidays.  The main TAIFEX daily
// collector runs first, so its latest official TX date is the safe upper bound.
const latestOfficialMarketDate = db.prepare('SELECT MAX(trade_date) AS date FROM market_daily WHERE tx_close IS NOT NULL AND trade_date<=?').get(taipeiToday)?.date;
const endDate = process.env.V2_DOMESTIC_END || latestOfficialMarketDate || taipeiToday;
const cacheDir = path.join(config.dataRoot, 'data', 'domestic-institution-cache');
fs.mkdirSync(cacheDir, { recursive: true });

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function seedExistingNets() {
  const insert = db.prepare(`INSERT OR IGNORE INTO institutional_futures_detail_daily
    (trade_date, institution_type, open_interest_net, source_url, fetched_at)
    VALUES (?, ?, ?, 'legacy:futures_positions_daily', ?)`);
  let rows = 0; const now = new Date().toISOString();
  for (const item of db.prepare('SELECT trade_date, trust_net, dealer_net FROM futures_positions_daily ORDER BY trade_date').all()) {
    if (item.trust_net != null) { insert.run(item.trade_date, 'investment_trust', item.trust_net, now); rows += 1; }
    if (item.dealer_net != null) { insert.run(item.trade_date, 'dealer', item.dealer_net, now); rows += 1; }
  }
  return rows;
}

async function syncLatestOpenApi() {
  const url = 'https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let payload;
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v2/3.6 domestic-institution-latest' } });
    if (!response.ok) throw new Error(`TAIFEX OpenAPI latest: HTTP ${response.status}`);
    payload = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const tx = payload.filter((row) => String(row.ContractCode || '').trim() === '臺股期貨');
  const date = String(tx[0]?.Date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const mapped = new Map();
  for (const row of tx) {
    const item = parseDomesticOpenApiValues(row);
    if (String(row.Item).includes('投信')) mapped.set('trust', item);
    if (String(row.Item).includes('自營商')) mapped.set('dealer', item);
  }
  return upsertDomesticInstitutionRows(db, new Map([[date, Object.fromEntries(mapped)]]), { sourceUrl: url, fetchedAt: new Date().toISOString() });
}

try {
  applyMigrations(db, config.migrationsPath);
  const seededRows = seedExistingNets();
  let latestRows = 0; const failures = [];
  let importedRows = 0; const files = [];
  const ranges = selectDomesticInstitutionRanges(monthRanges(startDate, endDate), {
    skipHistory: process.env.V2_DOMESTIC_SKIP_HISTORY === '1',
  });
  for (const range of ranges) {
    console.log(`Collecting domestic institutions ${range.start}..${range.end}`);
    let downloaded;
    try { downloaded = await downloadDomesticInstitutionPeriod(range, cacheDir); } catch (error) { failures.push({ ...range, error: error.message }); break; }
    const { buffer } = downloaded;
    const fetchedAt = downloaded.downloadedAt;
    const parsed = parseTaifexPositionCsv(new TextDecoder('big5').decode(buffer));
    const rows = upsertDomesticInstitutionRows(db, parsed, { sourceUrl: SOURCE_URL, fetchedAt }); importedRows += rows;
    db.prepare(`INSERT OR REPLACE INTO official_backfill_files
      (dataset, period_start, period_end, source_url, payload_sha256, payload_bytes, downloaded_at, imported_rows)
      VALUES ('domestic_institutional_positions', ?, ?, ?, ?, ?, ?, ?)`)
      .run(range.start, range.end, SOURCE_URL, hash(buffer), buffer.length, fetchedAt, rows);
    files.push({ ...range, rows, cacheHit: downloaded.cacheHit, fallbackFromCache: downloaded.fallbackFromCache,
      refreshError: downloaded.refreshError || null });
    await sleep(500);
  }
  // The latest OpenAPI snapshot has the highest recency and must be applied
  // after any monthly continuity fallback.
  try { latestRows = await syncLatestOpenApi(); } catch (error) { failures.push({ dataset: 'latest_openapi', error: error.message }); }
  const reconciliation = reconcileDomesticInstitutionNets(db);
  const futuresCoverage = db.prepare(`SELECT institution_type, COUNT(*) AS rows, MIN(trade_date) AS first_date, MAX(trade_date) AS last_date,
    SUM(open_interest_long IS NOT NULL AND open_interest_short IS NOT NULL) AS complete_oi_days,
    SUM(trade_long IS NOT NULL AND trade_short IS NOT NULL) AS complete_trade_days
    FROM institutional_futures_detail_daily GROUP BY institution_type ORDER BY institution_type`).all();
  const spotCoverage = db.prepare(`SELECT COUNT(*) AS rows, MIN(trade_date) AS first_date, MAX(trade_date) AS last_date,
    SUM(trust_net_e IS NOT NULL) AS trust_days,
    SUM(dealer_proprietary_net_e IS NOT NULL) AS dealer_proprietary_days,
    SUM(dealer_hedge_net_e IS NOT NULL) AS dealer_hedge_days FROM spot_institutional_daily`).get();
  const report = { generatedAt: new Date().toISOString(), startDate, endDate, seededRows, latestRows, importedRows, files, failures,
    reconciliation, futuresCoverage, spotCoverage,
    limitations: ['Public data identifies investment trusts and dealers, but does not separately identify government funds, life insurers or every domestic institution.', 'Dealer futures data is an aggregate; spot proprietary and hedge flows remain separate in spot_institutional_daily.'] };
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'latest-domestic-institution-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ seededRows, latestRows, importedRows, failures, reconciliation, futuresCoverage, spotCoverage }, null, 2));
} finally { db.close(); }
