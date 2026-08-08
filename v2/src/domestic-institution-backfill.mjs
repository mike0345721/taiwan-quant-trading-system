import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseTaifexPositionCsv } from './taifex-position-parser.mjs';

export const DOMESTIC_INSTITUTION_SOURCE_URL = 'https://www.taifex.com.tw/cht/3/futContractsDateDown';

export function dateTaipei(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function periodCacheIsImmutable(range, now = new Date()) {
  const currentMonth = dateTaipei(now).slice(0, 7);
  return Boolean(range?.end && /^\d{4}-\d{2}/.test(range.end) && range.end.slice(0, 7) < currentMonth);
}

export function selectDomesticInstitutionRanges(ranges, { skipHistory = false, now = new Date() } = {}) {
  if (!skipHistory) return ranges;
  return ranges.filter((range) => !periodCacheIsImmutable(range, now));
}

function slash(value) { return value.replaceAll('-', '/'); }
function defaultSleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export function validDomesticInstitutionBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) return false;
  try {
    return parseTaifexPositionCsv(new TextDecoder('big5').decode(buffer)).size > 0;
  } catch {
    return false;
  }
}

function readValidCache(cachePath, validateBuffer) {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const buffer = zlib.gunzipSync(fs.readFileSync(cachePath));
    return validateBuffer(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

function replaceCacheAtomically(cachePath, buffer) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, zlib.gzipSync(buffer, { level: 9 }), { mode: 0o600 });
    fs.renameSync(temporaryPath, cachePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

export async function downloadDomesticInstitutionPeriod(range, cacheDir, {
  fetchImpl = fetch,
  now = new Date(),
  sleep = defaultSleep,
  maxAttempts = 5,
  validateBuffer = validDomesticInstitutionBuffer,
} = {}) {
  const cachePath = path.join(cacheDir, `${range.start}-${range.end}.csv.gz`);
  const cached = readValidCache(cachePath, validateBuffer);
  if (cached && periodCacheIsImmutable(range, now)) {
    return {
      buffer: cached,
      cachePath,
      cacheHit: true,
      fallbackFromCache: false,
      downloadedAt: fs.statSync(cachePath).mtime.toISOString(),
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetchImpl(DOMESTIC_INSTITUTION_SOURCE_URL, {
        method: 'POST', signal: controller.signal,
        body: new URLSearchParams({ queryStartDate: slash(range.start), queryEndDate: slash(range.end), commodityId: 'TXF' }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tw-chip-dashboard-v2/3.7 domestic-institution-backfill' },
      });
      if (!response.ok) throw new Error(`${range.start}..${range.end}: HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!validateBuffer(buffer)) throw new Error(`${range.start}..${range.end}: response is not a valid TAIFEX institutional CSV`);
      replaceCacheAtomically(cachePath, buffer);
      return {
        buffer,
        cachePath,
        cacheHit: false,
        fallbackFromCache: false,
        downloadedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts) await sleep(2_000 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  // A current-period cache is only a continuity fallback.  It is never allowed
  // to suppress a successful refresh, and an invalid cache is never imported.
  if (cached) {
    return {
      buffer: cached,
      cachePath,
      cacheHit: true,
      fallbackFromCache: true,
      downloadedAt: fs.statSync(cachePath).mtime.toISOString(),
      refreshError: lastError?.message || 'official refresh failed',
    };
  }
  throw lastError || new Error(`${range.start}..${range.end}: official download failed`);
}

export function upsertDomesticInstitutionRows(db, byDate, { sourceUrl = DOMESTIC_INSTITUTION_SOURCE_URL, fetchedAt = new Date().toISOString() } = {}) {
  const upsert = db.prepare(`INSERT INTO institutional_futures_detail_daily
    (trade_date, institution_type, trade_long, trade_short, trade_net,
     open_interest_long, open_interest_short, open_interest_net, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, institution_type) DO UPDATE SET
      trade_long=COALESCE(excluded.trade_long, institutional_futures_detail_daily.trade_long),
      trade_short=COALESCE(excluded.trade_short, institutional_futures_detail_daily.trade_short),
      trade_net=COALESCE(excluded.trade_net, institutional_futures_detail_daily.trade_net),
      open_interest_long=COALESCE(excluded.open_interest_long, institutional_futures_detail_daily.open_interest_long),
      open_interest_short=COALESCE(excluded.open_interest_short, institutional_futures_detail_daily.open_interest_short),
      open_interest_net=COALESCE(excluded.open_interest_net, institutional_futures_detail_daily.open_interest_net),
      source_url=excluded.source_url,
      fetched_at=excluded.fetched_at`);
  let rows = 0;
  for (const [tradeDate, data] of byDate) {
    for (const [type, item] of [['investment_trust', data.trust], ['dealer', data.dealer]]) {
      if (!item) continue;
      upsert.run(tradeDate, type, item.tradeLong, item.tradeShort, item.tradeNet, item.long, item.short, item.net, sourceUrl, fetchedAt);
      rows += 1;
    }
  }
  return rows;
}

export function auditInstitutionalFuturesOiConsistency(db) {
  const rows = db.prepare(`WITH comparison AS (
      SELECT f.trade_date, 'investment_trust' AS institution_type, f.trust_net AS final_net,
        d.open_interest_long, d.open_interest_short, d.open_interest_net AS detail_net
      FROM futures_positions_daily f
      LEFT JOIN institutional_futures_detail_daily d
        ON d.trade_date=f.trade_date AND d.institution_type='investment_trust'
      WHERE f.trust_net IS NOT NULL
      UNION ALL
      SELECT f.trade_date, 'dealer' AS institution_type, f.dealer_net AS final_net,
        d.open_interest_long, d.open_interest_short, d.open_interest_net AS detail_net
      FROM futures_positions_daily f
      LEFT JOIN institutional_futures_detail_daily d
        ON d.trade_date=f.trade_date AND d.institution_type='dealer'
      WHERE f.dealer_net IS NOT NULL
    ) SELECT *,
      CASE WHEN detail_net IS NOT NULL AND detail_net<>final_net THEN 1 ELSE 0 END AS cross_table_mismatch,
      CASE WHEN open_interest_long IS NOT NULL AND open_interest_short IS NOT NULL AND detail_net IS NOT NULL
        AND open_interest_long-open_interest_short<>detail_net THEN 1 ELSE 0 END AS internal_mismatch
    FROM comparison ORDER BY trade_date,institution_type`).all();
  const compared = rows.filter((row) => row.detail_net != null);
  const mismatchDates = rows.filter((row) => row.detail_net == null || row.cross_table_mismatch || row.internal_mismatch);
  return {
    summary: {
      expected_rows: rows.length,
      compared_rows: compared.length,
      missing_detail_rows: rows.length - compared.length,
      cross_table_mismatch_rows: rows.filter((row) => row.cross_table_mismatch).length,
      internal_mismatch_rows: rows.filter((row) => row.internal_mismatch).length,
      passed: rows.length > 0 && rows.length === compared.length
        && !rows.some((row) => row.cross_table_mismatch || row.internal_mismatch),
    },
    mismatchDates,
  };
}

export function reconcileDomesticInstitutionNets(db, { fetchedAt = new Date().toISOString() } = {}) {
  const before = auditInstitutionalFuturesOiConsistency(db);
  const update = db.prepare(`UPDATE institutional_futures_detail_daily SET open_interest_net=?, fetched_at=?
    WHERE trade_date=? AND institution_type=?`);
  const reconciled = [];
  for (const row of before.mismatchDates) {
    if (row.detail_net == null || !row.cross_table_mismatch) continue;
    update.run(row.final_net, fetchedAt, row.trade_date, row.institution_type);
    reconciled.push({
      tradeDate: row.trade_date,
      institutionType: row.institution_type,
      previousNet: row.detail_net,
      finalNet: row.final_net,
    });
  }
  return { reconciled, audit: auditInstitutionalFuturesOiConsistency(db) };
}
