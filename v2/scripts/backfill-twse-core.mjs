import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { parseTwseIndexPayload, parseTwseInstitutionPayload } from '../src/twse-core-history.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v2/2.11 core-history' } });
      if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep([307, 428, 429].includes(error.status) ? attempt * 5_000 : attempt * 1_000);
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const limit = Math.max(1, Number(process.env.TWSE_CORE_BATCH || 30));
  const gaps = db.prepare(`SELECT m.trade_date AS tradeDate, m.twii_close AS twiiClose, s.foreign_net_e AS foreignNet
    FROM market_daily m LEFT JOIN spot_institutional_daily s USING(trade_date)
    WHERE m.tx_close IS NOT NULL AND (m.twii_close IS NULL OR s.foreign_net_e IS NULL)
    ORDER BY m.trade_date LIMIT ?`).all(limit);
  const failures = []; let imported = 0;
  for (const gap of gaps) {
    try {
      const compact = gap.tradeDate.replaceAll('-', '');
      const indexPayload = gap.twiiClose == null
        ? await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact}&type=IND&response=json`) : null;
      await sleep(700);
      const spotPayload = gap.foreignNet == null
        ? await fetchJson(`https://www.twse.com.tw/fund/BFI82U?dayDate=${compact}&type=day&response=json`) : null;
      const index = indexPayload ? parseTwseIndexPayload(indexPayload, gap.tradeDate) : null;
      const spot = spotPayload ? parseTwseInstitutionPayload(spotPayload, gap.tradeDate) : null;
      db.exec('BEGIN IMMEDIATE;');
      try {
        if (index) db.prepare(`UPDATE market_daily SET twii_close=?, twii_change=?, twii_change_pct=?, basis=CASE WHEN tx_close IS NULL THEN basis ELSE tx_close-? END WHERE trade_date=?`)
          .run(index.close, index.change, index.changePct, index.close, gap.tradeDate);
        if (spot) db.prepare(`INSERT OR REPLACE INTO spot_institutional_daily VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(gap.tradeDate, spot.foreignNetE, spot.trustNetE, spot.dealerProprietaryNetE, spot.dealerHedgeNetE, spot.dealerTotalNetE, spot.institutionalTotalE);
        db.prepare(`INSERT OR REPLACE INTO data_sources(trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
          VALUES (?, 'twseCoreHistory', 'TWSE official index and institutional history', ?, ?, 1, 0, 0, NULL)`)
          .run(gap.tradeDate, gap.tradeDate, new Date().toISOString());
        db.exec('COMMIT;'); imported += 1;
      } catch (error) { db.exec('ROLLBACK;'); throw error; }
      await sleep(1_200);
    } catch (error) {
      failures.push({ tradeDate: gap.tradeDate, error: error.message });
      await sleep(3_000);
    }
  }
  console.log(JSON.stringify({ requested: gaps.length, imported, failed: failures.length, failures, remaining: db.prepare(`SELECT COUNT(*) AS n FROM market_daily m LEFT JOIN spot_institutional_daily s USING(trade_date) WHERE m.tx_close IS NOT NULL AND (m.twii_close IS NULL OR s.foreign_net_e IS NULL)`).get().n }, null, 2));
} finally { db.close(); }
