import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { applyMigrations, openDatabase } from '../src/db.mjs';
import { fetchOfficialLargeTraders } from '../../src/taifex-official.mjs';

const SOURCE_URL = 'https://www.taifex.com.tw/cht/3/largeTraderFutQry';

function isoDate(date) { return date.toISOString().slice(0, 10); }

function weekdays(start, end) {
  const dates = [];
  for (let cursor = new Date(`${start}T12:00:00Z`); cursor <= new Date(`${end}T12:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(isoDate(cursor));
  }
  return dates;
}

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

const config = v2Config();
const startDate = process.env.V2_LARGE_TRADER_START || '2023-07-01';
const endDate = process.env.V2_LARGE_TRADER_END || new Date().toISOString().slice(0, 10);
const delayMs = Number(process.env.V2_LARGE_TRADER_DELAY_MS || 350);
const cacheDir = path.join(config.root, 'data', 'large-trader-cache');
fs.mkdirSync(cacheDir, { recursive: true });

const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const stored = new Set(db.prepare(`SELECT trade_date FROM large_trader_futures_daily WHERE expiry_scope='all_contracts'`).all().map((row) => row.trade_date));
  const upsert = db.prepare(`INSERT OR REPLACE INTO large_trader_futures_daily
    (trade_date, product_scope, expiry_scope, expiry_label,
     top5_long, top5_long_specific, top10_long, top10_long_specific,
     top5_short, top5_short_specific, top10_short, top10_short_specific,
     market_open_interest, source_url, fetched_at)
    VALUES (?, 'TX_MTX_TMF_EQUIVALENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let imported = 0; let skipped = 0; const failures = [];
  for (const date of weekdays(startDate, endDate)) {
    if (stored.has(date)) { skipped += 1; continue; }
    const cachePath = path.join(cacheDir, `${date}.json`);
    try {
      const parsed = fs.existsSync(cachePath)
        ? JSON.parse(fs.readFileSync(cachePath, 'utf8'))
        : await fetchOfficialLargeTraders([date], { timeoutMs: 30_000 });
      if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
      const rows = parsed.data.scopes || [parsed.data];
      for (const row of rows) {
        upsert.run(parsed.dataDate, row.scope, row.scopeLabel,
          row.top5Long, row.top5LongSpecific, row.top10Long, row.top10LongSpecific,
          row.top5Short, row.top5ShortSpecific, row.top10Short, row.top10ShortSpecific,
          row.marketOi, SOURCE_URL, new Date().toISOString());
      }
      imported += 1;
      if (imported % 20 === 0) console.log(`Imported ${imported} trading days through ${date}`);
    } catch (error) {
      // Weekdays can still be exchange holidays. Keep a compact audit trail,
      // but do not manufacture a zero-position row.
      failures.push({ date, error: error.message });
    }
    await sleep(delayMs);
  }
  const result = { generatedAt: new Date().toISOString(), startDate, endDate, imported, skipped, failures };
  fs.writeFileSync(path.join(config.reportsPath, 'latest-large-trader-backfill.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, failures: failures.length }, null, 2));
} finally {
  db.close();
}

