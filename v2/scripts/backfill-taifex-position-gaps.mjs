import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';
import { parseTaifexPositionCsv } from '../src/taifex-position-parser.mjs';

function slash(date) { return date.replaceAll('-', '/'); }

async function fetchPositions(startDate, endDate) {
  const body = new URLSearchParams({ queryStartDate: slash(startDate), queryEndDate: slash(endDate), commodityId: 'TXF' });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch('https://www.taifex.com.tw/cht/3/futContractsDateDown', {
      method: 'POST', body, signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tw-chip-dashboard-v2/2.2 position-gap-backfill' },
    });
    if (!response.ok) throw new Error(`TAIFEX positions ${startDate}..${endDate}: HTTP ${response.status}`);
    const text = new TextDecoder('big5').decode(await response.arrayBuffer());
    return parseTaifexPositionCsv(text);
  } finally { clearTimeout(timer); }
}

function monthPeriods(dates) {
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  return months.map((month) => {
    const inMonth = dates.filter((date) => date.startsWith(month)).sort();
    return { startDate: inMonth[0], endDate: inMonth.at(-1) };
  });
}

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const researchStart = process.env.V2_RESEARCH_START || db.prepare('SELECT MIN(trade_date) AS date FROM market_daily WHERE tx_close IS NOT NULL').get()?.date;
  const gaps = db.prepare(`SELECT m.trade_date FROM market_daily m LEFT JOIN futures_positions_daily f USING(trade_date)
    WHERE m.trade_date>=? AND m.tx_close IS NOT NULL AND (
      f.foreign_net IS NULL OR EXISTS (
        SELECT 1 FROM data_sources s
        WHERE s.trade_date=m.trade_date AND s.source_key='futuresInstitutional'
          AND (s.ok=0 OR s.stale=1 OR s.fallback_from_cache=1)
      )
    ) ORDER BY m.trade_date`).all(researchStart);
  const gapDates = new Set(gaps.map((item) => item.trade_date));
  let datesBackfilled = 0;
  for (const period of monthPeriods([...gapDates])) {
    console.log(`Backfilling TAIFEX positions ${period.startDate}..${period.endDate}`);
    const byDate = await fetchPositions(period.startDate, period.endDate);
    for (const [tradeDate, data] of byDate) {
      if (!gapDates.has(tradeDate) || !data.foreign) continue;
      db.prepare(`INSERT INTO futures_positions_daily(trade_date, foreign_long, foreign_short, foreign_net, dealer_net, trust_net)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(trade_date) DO UPDATE SET foreign_long=excluded.foreign_long, foreign_short=excluded.foreign_short,
      foreign_net=excluded.foreign_net, dealer_net=excluded.dealer_net, trust_net=excluded.trust_net`)
        .run(tradeDate, data.foreign.long, data.foreign.short, data.foreign.net, data.dealer?.net ?? null, data.trust?.net ?? null);
      db.prepare(`INSERT OR REPLACE INTO data_sources(trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
      VALUES (?, 'taifexPositionGapBackfill', 'TAIFEX institutional position gap backfill', ?, ?, 1, 1, 0, NULL)`)
        .run(tradeDate, tradeDate, new Date().toISOString());
      datesBackfilled += 1;
    }
  }
  rebuildFeatures(db);
  const quality = runQualityChecks(db);
  console.log(JSON.stringify({ ok: true, researchStart, requestedGaps: gaps.length, datesBackfilled, coverage: quality.coverage, issues: quality.issues, byRule: quality.byRule }, null, 2));
} finally { db.close(); }
