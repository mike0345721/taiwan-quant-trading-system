import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';

function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replace(/<[^>]+>/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(date) { return date.replaceAll('-', ''); }

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v2/2.2 official-gap-backfill' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

async function fetchTwii(date) {
  const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact(date)}&type=IND&response=json`);
  if (payload?.stat !== 'OK') throw new Error(`TWSE index ${date}: ${payload?.stat || 'invalid response'}`);
  const row = (payload.tables || []).flatMap((table) => table.data || []).find((item) => String(item?.[0] || '').includes('發行量加權股價指數'));
  if (!row) throw new Error(`TWSE index ${date}: TAIEX row not found`);
  const sign = String(row[2] || '').includes('-') ? -1 : 1;
  const change = number(row[3]);
  const changePct = number(row[4]);
  return { close: number(row[1]), change: change == null ? null : sign * change, changePct: changePct == null ? null : sign * changePct };
}

async function fetchSpot(date) {
  const payload = await fetchJson(`https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${compact(date)}&type=day`);
  if (payload?.stat !== 'OK' || payload.date !== compact(date)) throw new Error(`TWSE institutions ${date}: ${payload?.stat || 'wrong date'}`);
  const result = { foreignNetE: null, trustNetE: null, dealerProprietaryNetE: null, dealerHedgeNetE: null };
  for (const row of payload.data || []) {
    const name = String(row[0] || ''); const netE = number(row[3]) / 1e8;
    if (name.includes('外資') && name.includes('陸資')) result.foreignNetE = netE;
    else if (name.includes('投信')) result.trustNetE = netE;
    else if (name.includes('自營商') && name.includes('自行')) result.dealerProprietaryNetE = netE;
    else if (name.includes('自營商') && name.includes('避險')) result.dealerHedgeNetE = netE;
  }
  result.dealerTotalNetE = Number(result.dealerProprietaryNetE || 0) + Number(result.dealerHedgeNetE || 0);
  result.institutionalTotalE = Number(result.foreignNetE || 0) + Number(result.trustNetE || 0) + result.dealerTotalNetE;
  return result;
}

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const researchStart = db.prepare('SELECT MIN(trade_date) AS date FROM spot_institutional_daily WHERE foreign_net_e IS NOT NULL').get()?.date;
  const gaps = db.prepare(`SELECT r.trade_date FROM raw_snapshots r LEFT JOIN market_daily m USING(trade_date)
    LEFT JOIN spot_institutional_daily s USING(trade_date)
    WHERE r.trade_date>=? AND m.tx_close IS NOT NULL AND (m.twii_close IS NULL OR s.foreign_net_e IS NULL) ORDER BY r.trade_date`).all(researchStart);
  for (const item of gaps) {
    console.log(`Backfilling TWSE ${item.trade_date}`);
    const [twii, spot] = await Promise.all([fetchTwii(item.trade_date), fetchSpot(item.trade_date)]);
    db.prepare(`UPDATE market_daily SET twii_close=?, twii_change=?, twii_change_pct=?, basis=tx_close-? WHERE trade_date=?`).run(twii.close, twii.change, twii.changePct, twii.close, item.trade_date);
    db.prepare(`INSERT INTO spot_institutional_daily
      (trade_date, foreign_net_e, trust_net_e, dealer_proprietary_net_e, dealer_hedge_net_e, dealer_total_net_e, institutional_total_e)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_date) DO UPDATE SET
        foreign_net_e=excluded.foreign_net_e,
        trust_net_e=excluded.trust_net_e,
        dealer_proprietary_net_e=excluded.dealer_proprietary_net_e,
        dealer_hedge_net_e=excluded.dealer_hedge_net_e,
        dealer_total_net_e=excluded.dealer_total_net_e,
        institutional_total_e=excluded.institutional_total_e`).run(
      item.trade_date, spot.foreignNetE, spot.trustNetE, spot.dealerProprietaryNetE,
      spot.dealerHedgeNetE, spot.dealerTotalNetE, spot.institutionalTotalE,
    );
    const now = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO data_sources(trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
      VALUES (?, 'twseOfficialGapBackfill', 'TWSE official historical gap backfill', ?, ?, 1, 1, 0, NULL)`).run(item.trade_date, item.trade_date, now);
  }
  rebuildFeatures(db);
  const quality = runQualityChecks(db);
  console.log(JSON.stringify({ ok: true, researchStart, datesBackfilled: gaps.map((item) => item.trade_date), coverage: quality.coverage, issues: quality.issues, byRule: quality.byRule }, null, 2));
} finally { db.close(); }
