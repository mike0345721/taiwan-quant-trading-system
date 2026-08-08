import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations, withTransaction } from '../src/db.mjs';
import { rebuildFeatures } from '../src/features.mjs';
import { runQualityChecks } from '../src/quality.mjs';

const TARGET_DATES = Object.freeze([
  '2023-07-03', '2023-07-04', '2023-07-05', '2023-07-06', '2023-07-07',
  '2023-07-10', '2023-07-11', '2023-07-12', '2023-07-13',
]);
const API_URL = new URL('https://api.finmindtrade.com/api/v4/data');
API_URL.search = new URLSearchParams({
  dataset: 'TaiwanFuturesInstitutionalInvestors',
  data_id: 'TX',
  start_date: TARGET_DATES[0],
  end_date: '2023-07-14',
}).toString();

function participantKey(label) {
  if (label === '自營商') return 'dealer';
  if (label === '投信') return 'trust';
  if (label === '外資') return 'foreign';
  return null;
}

function normalizeRows(payload) {
  if (payload?.status !== 200 || !Array.isArray(payload.data)) {
    throw new Error(`FINMIND_RESPONSE_INVALID:${payload?.status ?? 'missing'}`);
  }
  const byDate = new Map();
  for (const row of payload.data) {
    if (!TARGET_DATES.includes(row.date) || row.futures_id !== 'TX') continue;
    const key = participantKey(row.institutional_investors);
    if (!key) continue;
    const item = {
      tradeLong: Number(row.long_deal_volume),
      tradeShort: Number(row.short_deal_volume),
      long: Number(row.long_open_interest_balance_volume),
      short: Number(row.short_open_interest_balance_volume),
    };
    if (Object.values(item).some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error(`FINMIND_NUMERIC_INVALID:${row.date}:${key}`);
    }
    item.tradeNet = item.tradeLong - item.tradeShort;
    item.net = item.long - item.short;
    const current = byDate.get(row.date) || {};
    if (current[key]) throw new Error(`FINMIND_DUPLICATE:${row.date}:${key}`);
    current[key] = item;
    byDate.set(row.date, current);
  }
  for (const date of TARGET_DATES) {
    const row = byDate.get(date);
    if (!row?.dealer || !row?.trust || !row?.foreign) {
      throw new Error(`FINMIND_PARTICIPANTS_INCOMPLETE:${date}`);
    }
  }
  return byDate;
}

function writeCacheAtomically(target, text) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }), { mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

const response = await fetch(API_URL, { headers: { 'User-Agent': 'tw-chip-dashboard-v2/3.9.7 data-quality backfill' } });
if (!response.ok) throw new Error(`FINMIND_HTTP_${response.status}`);
const raw = await response.text();
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const fetchedAt = new Date().toISOString();
const byDate = normalizeRows(JSON.parse(raw));

// This official-page value was independently confirmed before the free three-year window advanced.
const crossCheck = byDate.get('2023-07-03');
if (crossCheck.foreign.long !== 40290 || crossCheck.foreign.short !== 36823 || crossCheck.foreign.net !== 3467
    || crossCheck.dealer.net !== -9367 || crossCheck.trust.net !== 2448) {
  throw new Error('OFFICIAL_CROSS_CHECK_2023_07_03_FAILED');
}

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const missing = db.prepare(`SELECT m.trade_date
    FROM market_daily m LEFT JOIN futures_positions_daily f USING(trade_date)
    WHERE m.trade_date IN (${TARGET_DATES.map(() => '?').join(',')})
      AND m.tx_close IS NOT NULL AND f.foreign_net IS NULL
    ORDER BY m.trade_date`).all(...TARGET_DATES).map((row) => row.trade_date);
  if (missing.length === 0) {
    console.log(JSON.stringify({ ok: true, state: 'already_complete', targetDates: TARGET_DATES }, null, 2));
    process.exit(0);
  }
  if (missing.length !== TARGET_DATES.length) {
    throw new Error(`TARGET_SCOPE_CHANGED: expected ${TARGET_DATES.length} missing rows, found ${missing.length}`);
  }

  writeCacheAtomically(
    path.join(config.root, 'data', 'secondary-cache', 'finmind', 'tx-institutional-2023-07-03-2023-07-13.json.gz'),
    raw,
  );

  withTransaction(db, () => {
    const upsertFinal = db.prepare(`INSERT INTO futures_positions_daily
      (trade_date, foreign_long, foreign_short, foreign_net, dealer_net, trust_net)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_date) DO UPDATE SET
        foreign_long=CASE WHEN futures_positions_daily.foreign_net IS NULL THEN excluded.foreign_long ELSE futures_positions_daily.foreign_long END,
        foreign_short=CASE WHEN futures_positions_daily.foreign_net IS NULL THEN excluded.foreign_short ELSE futures_positions_daily.foreign_short END,
        foreign_net=COALESCE(futures_positions_daily.foreign_net, excluded.foreign_net),
        dealer_net=COALESCE(futures_positions_daily.dealer_net, excluded.dealer_net),
        trust_net=COALESCE(futures_positions_daily.trust_net, excluded.trust_net)`);
    const upsertDetail = db.prepare(`INSERT INTO institutional_futures_detail_daily
      (trade_date, institution_type, trade_long, trade_short, trade_net,
       open_interest_long, open_interest_short, open_interest_net, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_date, institution_type) DO UPDATE SET
        trade_long=excluded.trade_long, trade_short=excluded.trade_short, trade_net=excluded.trade_net,
        open_interest_long=excluded.open_interest_long, open_interest_short=excluded.open_interest_short,
        open_interest_net=excluded.open_interest_net, source_url=excluded.source_url, fetched_at=excluded.fetched_at`);
    const upsertSource = db.prepare(`INSERT OR REPLACE INTO data_sources
      (trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
      VALUES (?, 'finmindTaifexPositionGapBackfill', ?, ?, ?, 1, 0, 0, NULL)`);
    for (const tradeDate of TARGET_DATES) {
      const { foreign, dealer, trust } = byDate.get(tradeDate);
      upsertFinal.run(tradeDate, foreign.long, foreign.short, foreign.net, dealer.net, trust.net);
      for (const [type, values] of [['dealer', dealer], ['investment_trust', trust]]) {
        upsertDetail.run(tradeDate, type, values.tradeLong, values.tradeShort, values.tradeNet,
          values.long, values.short, values.net, API_URL.href, fetchedAt);
      }
      upsertSource.run(tradeDate, `FinMind TAIFEX-derived history; sha256=${sha256}`, tradeDate, fetchedAt);
    }
  });

  rebuildFeatures(db);
  const quality = runQualityChecks(db);
  const verification = db.prepare(`SELECT trade_date, foreign_long, foreign_short, foreign_net, dealer_net, trust_net
    FROM futures_positions_daily WHERE trade_date IN (${TARGET_DATES.map(() => '?').join(',')})
    ORDER BY trade_date`).all(...TARGET_DATES);
  if (verification.length !== TARGET_DATES.length
      || verification.some((row) => row.foreign_net == null || row.foreign_long - row.foreign_short !== row.foreign_net)) {
    throw new Error('POST_WRITE_VERIFICATION_FAILED');
  }
  const report = {
    schemaVersion: '3.9.7-finmind-position-gap-backfill-v1',
    generatedAt: new Date().toISOString(),
    source: API_URL.href,
    sourceClassification: 'secondary-provider-taifex-derived',
    targetDates: TARGET_DATES,
    datesBackfilled: TARGET_DATES.length,
    payloadSha256: sha256,
    fetchedAt,
    officialCrossCheck: {
      tradeDate: '2023-07-03',
      foreignLong: 40290,
      foreignShort: 36823,
      foreignNet: 3467,
      dealerNet: -9367,
      trustNet: 2448,
      passed: true,
    },
    verification,
    quality: { coverage: quality.coverage, issues: quality.issues, byRule: quality.byRule },
    estimated: false,
    officialOnly: false,
    executionAuthorized: false,
  };
  const reportPath = path.join(config.reportsPath, 'finmind-position-gap-backfill.json');
  const temporary = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, reportPath);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
