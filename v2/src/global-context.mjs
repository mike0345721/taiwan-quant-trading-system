import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GLOBAL_SYMBOLS = Object.freeze([
  { key: 'SOX', yahoo: '^SOX', label: '費城半導體指數' },
  { key: 'NDX', yahoo: '^NDX', label: 'Nasdaq-100' },
  { key: 'USDTWD', yahoo: 'USDTWD=X', label: '美元／新台幣' },
  { key: 'GOLD', yahoo: 'GC=F', label: '黃金期貨研究代理' },
  { key: 'COPPER', yahoo: 'HG=F', label: '銅期貨研究代理' },
]);

const MAX_BYTES = 12 * 1024 * 1024;

function dateInZone(timestamp, timeZone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(timestamp * 1000));
}

export function parseYahooHistory(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timeZone = result?.meta?.exchangeTimezoneName || 'America/New_York';
  const rows = [];
  let previous = null;
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = Number(closes[index]);
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push({
      tradeDate: dateInZone(Number(timestamps[index]), timeZone),
      close,
      previousClose: previous,
      returnPct: previous ? (close / previous - 1) * 100 : null,
    });
    previous = close;
  }
  return rows;
}

async function fetchPayload(symbol, startDate, endDate, timeoutMs = 30_000) {
  const period1 = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000) + 86_400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v2/2.4' }, redirect: 'error' });
    if (!response.ok) throw new Error(`Yahoo ${symbol} HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error(`Yahoo ${symbol} 回應過大`);
    return { payload: JSON.parse(bytes.toString('utf8')), bytes };
  } finally { clearTimeout(timer); }
}

export async function backfillGlobalContext(db, { startDate = '2023-06-01', endDate = new Date().toISOString().slice(0, 10), cacheDir, timeoutMs } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const summary = [];
  for (const definition of GLOBAL_SYMBOLS) {
    const { payload, bytes } = await fetchPayload(definition.yahoo, startDate, endDate, timeoutMs);
    const rows = parseYahooHistory(payload).filter((row) => row.tradeDate >= startDate && row.tradeDate <= endDate);
    if (rows.length < 20) throw new Error(`${definition.label} 歷史資料不足：${rows.length}筆`);
    const fetchedAt = new Date().toISOString(); const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(cacheDir, `${definition.key}-${endDate}.json`), bytes);
    const run = db.prepare(`INSERT INTO global_import_runs(symbol, source, fetched_at, first_trade_date, last_trade_date, row_count, payload_sha256)
      VALUES (?, 'Yahoo Finance historical chart', ?, ?, ?, ?, ?)`).run(definition.key, fetchedAt, rows[0].tradeDate, rows.at(-1).tradeDate, rows.length, hash);
    const runId = Number(run.lastInsertRowid);
    const upsert = db.prepare(`INSERT INTO global_market_daily(symbol, trade_date, close, previous_close, return_pct, source_run_id)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close, previous_close=excluded.previous_close,
      return_pct=excluded.return_pct, source_run_id=excluded.source_run_id`);
    db.exec('BEGIN IMMEDIATE;');
    try { for (const row of rows) upsert.run(definition.key, row.tradeDate, row.close, row.previousClose, row.returnPct, runId); db.exec('COMMIT;'); }
    catch (error) { db.exec('ROLLBACK;'); throw error; }
    summary.push({ symbol: definition.key, label: definition.label, rows: rows.length, firstDate: rows[0].tradeDate, lastDate: rows.at(-1).tradeDate, sha256: hash });
  }
  return summary;
}
