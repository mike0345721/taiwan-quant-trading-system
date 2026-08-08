import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { parseTwseMarginPayload } from '../src/twse-margin.mjs';

async function fetchJson(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v2/2.11 margin-history' } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`); error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const throttled = error.status === 307 || error.status === 428 || error.status === 429;
        await new Promise((resolve) => setTimeout(resolve, throttled ? attempt * 5_000 : attempt * 1_000));
      }
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const limit = Math.max(1, Number(process.env.TWSE_MARGIN_BATCH || 30));
  const dates = db.prepare(`SELECT s.trade_date AS tradeDate FROM spot_institutional_daily s
    JOIN futures_positions_daily f USING(trade_date)
    LEFT JOIN margin_short_daily ms USING(trade_date)
    WHERE s.foreign_net_e IS NOT NULL AND f.foreign_short IS NOT NULL AND ms.trade_date IS NULL
    ORDER BY s.trade_date LIMIT ?`).all(limit).map((row) => row.tradeDate);
  const fetchedAt = new Date().toISOString(); const failures = []; let imported = 0; let cursor = 0;
  const upsert = db.prepare(`INSERT OR REPLACE INTO margin_short_daily
    (trade_date, margin_balance_e, short_balance_lots, source_name, source_data_date, fetched_at)
    VALUES (?, ?, ?, 'TWSE MI_MARGN official history', ?, ?)`);
  const source = db.prepare(`INSERT OR REPLACE INTO data_sources
    (trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
    VALUES (?, 'twseMarginHistory', 'TWSE MI_MARGN official history', ?, ?, 1, 0, 0, NULL)`);
  async function worker() {
    while (cursor < dates.length) {
      const tradeDate = dates[cursor]; cursor += 1;
      try {
        const compact = tradeDate.replaceAll('-', '');
        const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&response=json`);
        const parsed = parseTwseMarginPayload(payload, tradeDate);
        upsert.run(tradeDate, parsed.marginBalanceE, parsed.shortBalanceLots, tradeDate, fetchedAt);
        source.run(tradeDate, tradeDate, fetchedAt);
        imported += 1;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      } catch (error) {
        failures.push({ tradeDate, error: error.message });
      }
    }
  }
  // TWSE applies strict request controls. One resumable worker is intentionally slow and safe.
  await worker();
  const remaining = db.prepare(`SELECT COUNT(*) AS n FROM spot_institutional_daily s JOIN futures_positions_daily f USING(trade_date)
    LEFT JOIN margin_short_daily ms USING(trade_date) WHERE s.foreign_net_e IS NOT NULL AND f.foreign_short IS NOT NULL AND ms.trade_date IS NULL`).get().n;
  console.log(JSON.stringify({ requested: dates.length, imported, failed: failures.length, remaining, failures: failures.slice(0, 20) }, null, 2));
} finally { db.close(); }
