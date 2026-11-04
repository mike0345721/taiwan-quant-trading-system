import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withTransaction } from './db.mjs';
import { calendarDaysUntil, estimatedOptionExpiry, monthRanges, optionContractType, optionStructure, parseFuturesCsv, parseOptionsCsv } from './taifex-csv.mjs';

const ENDPOINTS = {
  futures: { url: 'https://www.taifex.com.tw/cht/3/futDataDown', commodity: 'TX' },
  options: { url: 'https://www.taifex.com.tw/cht/3/optDataDown', commodity: 'TXO' },
};

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function compactSlash(date) { return date.replaceAll('-', '/'); }

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function dateTaipei(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function periodCacheIsImmutable(range, now = new Date()) {
  return Boolean(range?.end && range.end < dateTaipei(now));
}

function parsePeriod(dataset, range, buffer) {
  const text = new TextDecoder('big5').decode(buffer);
  const rows = dataset === 'futures' ? parseFuturesCsv(text) : parseOptionsCsv(text);
  if (!rows.length) throw new Error(`${dataset} ${range.start}..${range.end}: no TX/TXO regular-session rows`);
  return rows;
}

export async function downloadPeriod(dataset, range, cacheDir, fetchImpl = fetch, { timeoutMs = 120_000, now = new Date() } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw Error('TAIFEX_DOWNLOAD_BUDGET_INVALID');
  const endpoint = ENDPOINTS[dataset];
  const cachePath = path.join(cacheDir, `${dataset}-${range.start}-${range.end}.csv.gz`);
  let buffer; let downloadedAt; let rows; let fallbackReason = null;
  let sourceState = 'LIVE_FETCH';
  const cacheExists = fs.existsSync(cachePath);
  if (cacheExists && periodCacheIsImmutable(range, now)) {
    buffer = zlib.gunzipSync(fs.readFileSync(cachePath));
    downloadedAt = fs.statSync(cachePath).mtime.toISOString();
    rows = parsePeriod(dataset, range, buffer);
    sourceState = 'HISTORICAL_CACHE';
  } else {
    const body = new URLSearchParams({
      down_type: '1', queryStartDate: compactSlash(range.start), queryEndDate: compactSlash(range.end),
      commodity_id: endpoint.commodity, commodity_id2: '',
    });
    const controller = new AbortController();
    let timer; let failureCode = 'TAIFEX_FETCH_FAILED';
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        failureCode = 'TAIFEX_DOWNLOAD_TIMEOUT';
        controller.abort(); reject(Error(failureCode));
      }, timeoutMs);
    });
    try {
      // The same deadline covers connection, headers and the complete body.
      // Race also bounds an injected/failed transport that ignores AbortSignal.
      const received = await Promise.race([(async () => {
        const response = await fetchImpl(endpoint.url, {
          method: 'POST', body, signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'tw-chip-dashboard-v2/2.2 research-backfill' },
        });
        if (!response?.ok) {
          failureCode = `TAIFEX_HTTP_${Number.isInteger(response?.status) ? response.status : 'NO_RESPONSE'}`;
          throw Error(failureCode);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 100 || !String(response.headers.get('content-disposition') || '').toLowerCase().includes('.csv')) {
          failureCode = 'TAIFEX_INVALID_CSV'; throw Error(failureCode);
        }
        return bytes;
      })(), timeout]);
      buffer = received;
      failureCode = 'TAIFEX_INVALID_CSV';
      rows = parsePeriod(dataset, range, buffer); // Validate before replacing a good cache.
      failureCode = 'TAIFEX_CACHE_PUBLICATION_FAILED';
      fs.mkdirSync(cacheDir, { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, zlib.gzipSync(buffer, { level: 9 }), { mode: 0o600 });
      fs.renameSync(temporaryPath, cachePath);
      downloadedAt = new Date().toISOString();
    } catch (error) {
      if (!cacheExists) throw Error(failureCode);
      buffer = zlib.gunzipSync(fs.readFileSync(cachePath));
      downloadedAt = fs.statSync(cachePath).mtime.toISOString();
      rows = parsePeriod(dataset, range, buffer);
      sourceState = 'CACHE_FALLBACK'; fallbackReason = failureCode;
    } finally { clearTimeout(timer); }
  }
  return { dataset, range, url: endpoint.url, buffer, rows, sha256: hash(buffer), downloadedAt,
    sourceState, fallbackFromCache: sourceState === 'CACHE_FALLBACK', fallbackReason };
}

function ensureRawDate(db, tradeDate) {
  const payload = JSON.stringify({ schemaVersion: 2, dataMode: 'official-history', asOfDate: tradeDate, source: 'TAIFEX official historical backfill' });
  db.prepare(`INSERT OR IGNORE INTO raw_snapshots(trade_date, generated_at, as_of_date, data_mode, payload_json, payload_sha256, imported_at)
    VALUES (?, ?, ?, 'official-history', ?, ?, ?)`).run(tradeDate, new Date().toISOString(), tradeDate, payload, hash(Buffer.from(payload)), new Date().toISOString());
}

function recordSource(db, tradeDate, key, name, item) {
  // A failed current attempt is reported separately in totals.failures; it must
  // not turn an older successful source receipt into a fresh successful fetch.
  if (item.fallbackFromCache) return;
  const conflict = item.sourceState === 'HISTORICAL_CACHE' ? 'IGNORE' : 'REPLACE';
  db.prepare(`INSERT OR ${conflict} INTO data_sources(trade_date, source_key, source_name, source_data_date, fetched_at, ok, stale, fallback_from_cache, error)
    VALUES (?, ?, ?, ?, ?, 1, 1, 0, NULL)`).run(tradeDate, key, name, tradeDate, item.downloadedAt);
}

function importFutures(db, item) {
  const byDate = new Map();
  for (const row of item.rows) {
    if (!byDate.has(row.tradeDate)) byDate.set(row.tradeDate, []);
    byDate.get(row.tradeDate).push(row);
  }
  const insertContract = db.prepare(`INSERT OR REPLACE INTO futures_contract_daily
    (trade_date, product, contract, session, open, high, low, close, change, change_pct, volume, settlement, open_interest, best_bid, best_ask, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertMarket = db.prepare(`INSERT INTO market_daily(trade_date, tx_contract, tx_close, tx_change, tx_change_pct, tx_volume, tx_open_interest)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date) DO UPDATE SET tx_contract=excluded.tx_contract, tx_close=excluded.tx_close, tx_change=excluded.tx_change,
    tx_change_pct=excluded.tx_change_pct, tx_volume=excluded.tx_volume, tx_open_interest=excluded.tx_open_interest`);
  withTransaction(db, () => {
    for (const [tradeDate, rows] of byDate) {
      ensureRawDate(db, tradeDate);
      const active = [...rows].filter((row) => row.close != null).sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
      if (!active) continue;
      db.prepare(`DELETE FROM futures_contract_daily WHERE trade_date=? AND product='TX' AND session='一般'`).run(tradeDate);
      for (const row of rows) insertContract.run(tradeDate, row.product, row.contract, row.session, row.open, row.high, row.low, row.close, row.change, row.changePct, row.volume, row.settlement, row.openInterest, row.bestBid, row.bestAsk, row === active ? 1 : 0);
      upsertMarket.run(tradeDate, active.contract, active.close, active.change, active.changePct, active.volume, active.openInterest);
      recordSource(db, tradeDate, 'taifexFuturesHistory', 'TAIFEX futures daily official history', item);
    }
  });
  return { importedRows: item.rows.length, dates: byDate.size };
}

function contractGroups(rows) {
  const dates = new Map();
  for (const row of rows) {
    if (!dates.has(row.tradeDate)) dates.set(row.tradeDate, new Map());
    const contracts = dates.get(row.tradeDate);
    if (!contracts.has(row.contract)) contracts.set(row.contract, new Map());
    const strikes = contracts.get(row.contract);
    if (!strikes.has(row.strike)) strikes.set(row.strike, { strike: row.strike, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0, callClose: null, putClose: null, callSettlement: null, putSettlement: null });
    const strike = strikes.get(row.strike);
    if (row.right.includes('買')) {
      strike.callOi = row.openInterest || 0; strike.callVolume = row.volume || 0; strike.callClose = row.close; strike.callSettlement = row.settlement;
    } else if (row.right.includes('賣')) {
      strike.putOi = row.openInterest || 0; strike.putVolume = row.volume || 0; strike.putClose = row.close; strike.putSettlement = row.settlement;
    }
  }
  return dates;
}

function importOptions(db, item) {
  const dates = contractGroups(item.rows);
  const insertContract = db.prepare(`INSERT OR REPLACE INTO options_contract_daily
    (trade_date, contract, contract_type, expiry_date, days_to_expiry, is_active, call_volume, put_volume, volume_pc_ratio, call_oi, put_oi, oi_pc_ratio,
     call_wall_strike, call_wall_oi, put_wall_strike, put_wall_oi, max_pain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertStrike = db.prepare(`INSERT OR REPLACE INTO options_strike_daily
    (trade_date, contract, strike, call_oi, put_oi, call_volume, put_volume, call_close, put_close, call_settlement, put_settlement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  withTransaction(db, () => {
    for (const [tradeDate, contracts] of dates) {
      ensureRawDate(db, tradeDate);
      const summaries = [...contracts.entries()].map(([contract, strikes]) => {
        const rows = [...strikes.values()];
        const callOi = rows.reduce((sum, row) => sum + row.callOi, 0); const putOi = rows.reduce((sum, row) => sum + row.putOi, 0);
        const callVolume = rows.reduce((sum, row) => sum + row.callVolume, 0); const putVolume = rows.reduce((sum, row) => sum + row.putVolume, 0);
        const expiry = estimatedOptionExpiry(contract);
        return { contract, strikes, callOi, putOi, callVolume, putVolume, expiry, days: calendarDaysUntil(expiry, tradeDate), structure: optionStructure(strikes) };
      });
      const active = [...summaries].filter((row) => row.days == null || row.days >= 0)
        .sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || (b.callOi + b.putOi) - (a.callOi + a.putOi))[0]
        || [...summaries].sort((a, b) => (b.callOi + b.putOi) - (a.callOi + a.putOi))[0];
      db.prepare('DELETE FROM options_contract_daily WHERE trade_date=?').run(tradeDate);
      for (const summary of summaries) {
        const { callWall, putWall, maxPain } = summary.structure;
        insertContract.run(tradeDate, summary.contract, optionContractType(summary.contract), summary.expiry, summary.days, summary === active ? 1 : 0,
          summary.callVolume, summary.putVolume, summary.callVolume ? summary.putVolume / summary.callVolume : null,
          summary.callOi, summary.putOi, summary.callOi ? summary.putOi / summary.callOi : null,
          callWall?.strike ?? null, callWall?.openInterest ?? null, putWall?.strike ?? null, putWall?.openInterest ?? null, maxPain);
        for (const strike of summary.strikes.values()) insertStrike.run(tradeDate, summary.contract, strike.strike, strike.callOi, strike.putOi, strike.callVolume, strike.putVolume, strike.callClose, strike.putClose, strike.callSettlement, strike.putSettlement);
      }
      recordSource(db, tradeDate, 'taifexOptionsHistory', 'TAIFEX options daily official history', item);
    }
  });
  return { importedRows: item.rows.length, dates: dates.size };
}

function recordFile(db, item, importedRows) {
  if (item.fallbackFromCache) return;
  const conflict = item.sourceState === 'HISTORICAL_CACHE' ? 'IGNORE' : 'REPLACE';
  db.prepare(`INSERT OR ${conflict} INTO official_backfill_files(dataset, period_start, period_end, source_url, payload_sha256, payload_bytes, downloaded_at, imported_rows)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(item.dataset, item.range.start, item.range.end, item.url, item.sha256, item.buffer.length, item.downloadedAt, importedRows);
}

export function rebuildOptionOiChanges(db) {
  // Lag is by observed row within the same contract/strike, as before; weekends
  // and missing dates do not become fabricated rows. SQL subtraction retains NULL.
  return withTransaction(db, () => {
    db.exec('DELETE FROM option_oi_changes;');
    return db.prepare(`INSERT INTO option_oi_changes
      (trade_date,contract,strike,call_oi,put_oi,call_oi_delta_1d,put_oi_delta_1d,call_oi_delta_3d,put_oi_delta_3d,call_oi_delta_5d,put_oi_delta_5d)
      SELECT trade_date,contract,strike,call_oi,put_oi,
        call_oi - LAG(call_oi,1) OVER series, put_oi - LAG(put_oi,1) OVER series,
        call_oi - LAG(call_oi,3) OVER series, put_oi - LAG(put_oi,3) OVER series,
        call_oi - LAG(call_oi,5) OVER series, put_oi - LAG(put_oi,5) OVER series
      FROM options_strike_daily WINDOW series AS (PARTITION BY contract,strike ORDER BY trade_date)`).run().changes;
  });
}

export function reconcileOptionExpiriesAndActive(db) {
  const maxDate = db.prepare('SELECT MAX(trade_date) AS date FROM options_contract_daily').get()?.date;
  const contracts = db.prepare(`SELECT contract, MIN(expiry_date) AS estimated_expiry, MAX(trade_date) AS last_seen
    FROM options_contract_daily GROUP BY contract`).all();
  withTransaction(db, () => {
    for (const contract of contracts) {
      const expiredWithinSample = contract.estimated_expiry && maxDate && contract.estimated_expiry <= maxDate;
      const expiry = expiredWithinSample ? contract.last_seen : contract.estimated_expiry;
      const source = expiredWithinSample ? 'official_last_seen' : 'calendar_estimate';
      db.prepare(`UPDATE options_contract_daily SET expiry_date=?, days_to_expiry=CAST(julianday(?) - julianday(trade_date) AS INTEGER), expiry_date_source=? WHERE contract=?`)
        .run(expiry, expiry, source, contract.contract);
    }
    db.exec('UPDATE options_contract_daily SET is_active=0;');
    const dates = db.prepare('SELECT DISTINCT trade_date FROM options_contract_daily ORDER BY trade_date').all();
    const rowsForDate = db.prepare(`SELECT contract, expiry_date, call_oi + put_oi AS total_oi FROM options_contract_daily
      WHERE trade_date=? ORDER BY expiry_date, total_oi DESC`);
    const setActive = db.prepare('UPDATE options_contract_daily SET is_active=1 WHERE trade_date=? AND contract=?');
    for (const item of dates) {
      const rows = rowsForDate.all(item.trade_date);
      const active = rows.find((row) => !row.expiry_date || row.expiry_date >= item.trade_date) || rows[0];
      if (active) setActive.run(item.trade_date, active.contract);
    }
  });
  return contracts.length;
}

export async function backfillTaifex(db, { startDate, endDate, cacheDir, fetchImpl = fetch, onProgress = () => {}, downloadTimeoutMs = 120_000 }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const ranges = monthRanges(startDate, endDate);
  const totals = { futuresRows: 0, optionRows: 0, periods: ranges.length, optionChangeRows: 0, sources: [], failures: [], skippedImports: [] };
  for (const range of ranges) {
    for (const dataset of ['futures', 'options']) {
      onProgress(`Downloading ${dataset} ${range.start}..${range.end}`);
      const item = await downloadPeriod(dataset, range, cacheDir, fetchImpl, { timeoutMs: downloadTimeoutMs });
      totals.sources.push({ dataset, range, state: item.sourceState, downloadedAt: item.downloadedAt,
        payloadSha256: item.sha256, fallbackReason: item.fallbackReason,
        importState: item.fallbackFromCache ? 'SKIPPED_SOURCE_FALLBACK' : 'IMPORTED' });
      if (item.fallbackFromCache) {
        totals.failures.push({ dataset, range, reason: item.fallbackReason, attemptedAt: new Date().toISOString() });
        totals.skippedImports.push({ dataset, range, reason: 'SOURCE_FALLBACK_PRESERVE_DATABASE', cachedRows: item.rows.length });
        onProgress(`Source fallback ${dataset}: ${item.fallbackReason}; cache acquired ${item.downloadedAt}; database import skipped`);
        // A valid cache can still predate a newer qualified database import.
        // Preserve both existing rows and their success receipts; an empty DB
        // remains unknown rather than publishing fallback data as this attempt.
        await sleep(250);
        continue;
      }
      const result = dataset === 'futures' ? importFutures(db, item) : importOptions(db, item);
      recordFile(db, item, result.importedRows);
      if (dataset === 'futures') totals.futuresRows += result.importedRows;
      else totals.optionRows += result.importedRows;
      onProgress(`Imported ${dataset}: ${result.importedRows} rows / ${result.dates} dates`);
      await sleep(250);
    }
  }
  let started = Date.now();
  onProgress('Starting post-import reconcileOptionExpiriesAndActive');
  totals.reconciledContracts = reconcileOptionExpiriesAndActive(db);
  onProgress(`Completed post-import reconcileOptionExpiriesAndActive: ${totals.reconciledContracts} contracts / ${Date.now() - started}ms`);
  started = Date.now();
  onProgress('Starting post-import rebuildOptionOiChanges');
  totals.optionChangeRows = rebuildOptionOiChanges(db);
  onProgress(`Completed post-import rebuildOptionOiChanges: ${totals.optionChangeRows} rows / ${Date.now() - started}ms`);
  totals.state = totals.failures.length ? 'PARTIAL_SOURCE_FALLBACK' : 'COMPLETE';
  return totals;
}
