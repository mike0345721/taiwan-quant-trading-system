import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart } from './dashboard-tx-chart.mjs';

const ledgerCache = new Map();

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compactTickRecord(record) {
  const payload = record.payload || {};
  return {
    kind: record.kind,
    product: record.product,
    receivedAt: record.receivedAt,
    exchangeTimestamp: record.exchangeTimestamp,
    eventId: record.eventId,
    duplicate: record.duplicate === true,
    sequenceGap: Number(record.sequenceGap) || 0,
    executionAuthorized: record.executionAuthorized,
    orderRoutesEnabled: record.orderRoutesEnabled,
    payload: {
      code: payload.code,
      datetime: payload.datetime,
      close: payload.close,
      volume: payload.volume,
      simtrade: payload.simtrade === true,
      _product_family: payload._product_family,
      _target_code: payload._target_code,
    },
  };
}

function cachePaths(sourcePath, cacheRoot) {
  if (!cacheRoot) return null;
  const identity = sha256(Buffer.from(path.resolve(sourcePath), 'utf8')).slice(0, 12);
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  return {
    records: path.join(cacheRoot, `${stem}-${identity}-tx-ticks.ndjson`),
    metadata: path.join(cacheRoot, `${stem}-${identity}-tx-ticks.meta.json`),
  };
}

function readPersistentCache(sourcePath, sourceStat, cacheRoot) {
  const files = cachePaths(sourcePath, cacheRoot);
  if (!files || !fs.existsSync(files.records) || !fs.existsSync(files.metadata)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(files.metadata, 'utf8'));
    const bytes = fs.readFileSync(files.records);
    if (metadata.schemaVersion !== 'dw2-tx-tick-cache-v1'
      || metadata.sourcePath !== path.resolve(sourcePath)
      || !Number.isInteger(metadata.sourceOffset)
      || metadata.sourceOffset < 0
      || metadata.sourceOffset > sourceStat.size
      || metadata.cacheSize !== bytes.length
      || metadata.cacheHash !== sha256(bytes)) return null;
    const records = bytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (records.length !== metadata.recordCount) return null;
    return { offset: metadata.sourceOffset, remainder: '', records, files, persistedRecordCount: records.length };
  } catch { return null; }
}

function writePersistentCache(sourcePath, cached, cacheRoot) {
  const files = cached.files || cachePaths(sourcePath, cacheRoot);
  if (!files || cached.remainder) return;
  fs.mkdirSync(path.dirname(files.records), { recursive: true });
  const persistedRecordCount = Number.isInteger(cached.persistedRecordCount) ? cached.persistedRecordCount : 0;
  const canAppend = cached.forceRewrite !== true && fs.existsSync(files.records) && persistedRecordCount <= cached.records.length;
  const newRecords = cached.records.slice(persistedRecordCount);
  if (canAppend) {
    if (newRecords.length) {
      fs.appendFileSync(files.records, `${newRecords.map((record) => JSON.stringify(compactTickRecord(record))).join('\n')}\n`, 'utf8');
    }
  } else {
    const recordsTemp = `${files.records}.${process.pid}.tmp`;
    const initialBytes = Buffer.from(cached.records.map((record) => JSON.stringify(compactTickRecord(record))).join('\n') + (cached.records.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(recordsTemp, initialBytes);
    fs.renameSync(recordsTemp, files.records);
  }
  const bytes = fs.existsSync(files.records) ? fs.readFileSync(files.records) : Buffer.alloc(0);
  const metadataTemp = `${files.metadata}.${process.pid}.tmp`;
  const metadata = {
    schemaVersion: 'dw2-tx-tick-cache-v1',
    sourcePath: path.resolve(sourcePath),
    sourceOffset: cached.offset,
    recordCount: cached.records.length,
    cacheSize: bytes.length,
    cacheHash: sha256(bytes),
    sourceImmutable: false,
    derivedCacheOnly: true,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  fs.writeFileSync(metadataTemp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.renameSync(metadataTemp, files.metadata);
  cached.files = files;
  cached.persistedRecordCount = cached.records.length;
  cached.forceRewrite = false;
}

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function taipeiNowParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function isOfficial(calendar, date) {
  try { return resolveGovernedTradingDay(calendar, date).officialTradingDay; }
  catch { return false; }
}

function nextOfficial(calendar, afterDate) {
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = dateShift(afterDate, offset);
    if (isOfficial(calendar, candidate)) return candidate;
  }
  throw new Error('TX_CHART_NEXT_TRADING_DATE_UNAVAILABLE');
}

function previousOfficial(calendar, beforeDate) {
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = dateShift(beforeDate, -offset);
    if (isOfficial(calendar, candidate)) return candidate;
  }
  return null;
}

export function resolveDefaultChartSelection(calendar, now = new Date()) {
  const parts = taipeiNowParts(now);
  const calendarDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 15 * 60) {
    if (!isOfficial(calendar, calendarDate)) return Object.freeze({ tradeDate: null, session: 'NIGHT', reason: 'NIGHT_SESSION_NOT_GOVERNED' });
    return Object.freeze({ tradeDate: nextOfficial(calendar, calendarDate), session: 'NIGHT', reason: null });
  }
  if (minutes <= 5 * 60) {
    const startDate = dateShift(calendarDate, -1);
    if (!isOfficial(calendar, startDate)) return Object.freeze({ tradeDate: null, session: 'NIGHT', reason: 'NIGHT_SESSION_NOT_GOVERNED' });
    return Object.freeze({ tradeDate: nextOfficial(calendar, startDate), session: 'NIGHT', reason: null });
  }
  if (isOfficial(calendar, calendarDate)) return Object.freeze({ tradeDate: calendarDate, session: 'DAY', reason: null });
  return Object.freeze({ tradeDate: null, session: 'DAY', reason: 'DAY_SESSION_NOT_GOVERNED' });
}

function relevantLedgerDates(calendar, tradeDate, session) {
  if (session === 'DAY') return [tradeDate];
  const startDate = previousOfficial(calendar, tradeDate);
  if (!startDate) return [];
  return [...new Set([startDate, dateShift(startDate, 1)])];
}

function parseCandidateLine(line, records) {
  if (!line.includes('"kind":"futures_tick"')) return false;
  if (!line.includes('"_product_family":"TX"') && !/"product":"TXF[A-L]\d"/.test(line)) return false;
  try { records.push(compactTickRecord(JSON.parse(line))); return true; } catch { return false; }
}

export function readTxLiveEventLedger(filePath, { cacheRoot = null } = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) return Object.freeze([]);
  const stat = fs.statSync(absolute);
  let cached = ledgerCache.get(absolute);
  if (!cached) cached = readPersistentCache(absolute, stat, cacheRoot);
  if (!cached || stat.size < cached.offset) cached = { offset: 0, remainder: '', records: [], files: cachePaths(absolute, cacheRoot), persistedRecordCount: 0, forceRewrite: true };
  if (stat.size === cached.offset) return Object.freeze([...cached.records]);
  const fd = fs.openSync(absolute, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let position = cached.offset;
  let pending = cached.remainder;
  try {
    while (position < stat.size) {
      const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position);
      if (!bytes) break;
      position += bytes;
      const text = pending + decoder.write(buffer.subarray(0, bytes));
      const lines = text.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) parseCandidateLine(line, cached.records);
    }
    pending += decoder.end();
  } finally { fs.closeSync(fd); }
  cached.offset = position;
  cached.remainder = pending;
  ledgerCache.set(absolute, cached);
  if (cacheRoot) writePersistentCache(absolute, cached, cacheRoot);
  return Object.freeze([...cached.records]);
}

function readPriorDayLevel(archiveDir, calendar, tradeDate, selectedContract, contractMonth) {
  const priorTradeDate = previousOfficial(calendar, tradeDate);
  if (!priorTradeDate) return null;
  const filePath = path.join(archiveDir, `${priorTradeDate}-day.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const bars = Array.isArray(payload.bars) ? payload.bars : [];
    if (payload.product !== 'TX' || payload.session !== 'day' || !bars.length) return null;
    const availableAt = fs.statSync(filePath).mtime.toISOString();
    if (String(payload.contract) !== String(contractMonth)) return Object.freeze({ actualContract: `MISMATCH:${payload.contract}` });
    const base = {
      availability: 'AVAILABLE',
      source: 'PP1_GOVERNED_ACTUAL_CONTRACT_5M_REPLAY',
      tradeDate: priorTradeDate,
      session: 'DAY',
      eventTime: bars.at(-1).timestamp,
      availableAt,
      actualContract: selectedContract,
      qualityStatus: 'PASS',
    };
    return Object.freeze({
      actualContract: selectedContract,
      high: Object.freeze({ ...base, name: 'PREVIOUS_DAY_HIGH', value: Math.max(...bars.map((bar) => Number(bar.high))) }),
      low: Object.freeze({ ...base, name: 'PREVIOUS_DAY_LOW', value: Math.min(...bars.map((bar) => Number(bar.low))) }),
      close: Object.freeze({ ...base, name: 'PREVIOUS_CLOSE', value: Number(bars.at(-1).close) }),
    });
  } catch { return null; }
}

function priorUnavailable(name, reason) {
  return Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason });
}

function attachPriorDayLevels(chart, priorDay, cutoff) {
  const legal = priorDay?.close?.availableAt && Date.parse(priorDay.close.availableAt) <= Date.parse(cutoff);
  if (legal) {
    return Object.freeze({
      ...chart,
      levels: Object.freeze({
        ...chart.levels,
        previousDayHigh: priorDay.high,
        previousDayLow: priorDay.low,
        previousClose: priorDay.close,
      }),
    });
  }
  if (priorDay?.actualContract?.startsWith('MISMATCH:')) {
    return Object.freeze({
      ...chart,
      levels: Object.freeze({
        ...chart.levels,
        previousDayHigh: priorUnavailable('PREVIOUS_DAY_HIGH', 'ACTUAL_CONTRACT_MISMATCH'),
        previousDayLow: priorUnavailable('PREVIOUS_DAY_LOW', 'ACTUAL_CONTRACT_MISMATCH'),
        previousClose: priorUnavailable('PREVIOUS_CLOSE', 'ACTUAL_CONTRACT_MISMATCH'),
      }),
    });
  }
  return chart;
}

export function loadTxDecisionChart({
  dataRoot,
  calendar,
  timeframe = '5m',
  mode = 'LIVE',
  tradeDate = null,
  session = null,
  actualContract = null,
  asOf = null,
  now = new Date(),
  cacheRoot = null,
} = {}) {
  if (!dataRoot || !calendar) throw new Error('TX_CHART_SOURCE_CONFIG_REQUIRED');
  const defaults = resolveDefaultChartSelection(calendar, now);
  const selectedTradeDate = tradeDate || defaults.tradeDate;
  const selectedSession = session || defaults.session;
  const cutoff = asOf || now.toISOString();
  if (!selectedTradeDate) return buildTxDecisionChart([], { calendar, timeframe, asOf: cutoff, tradeDate: null, session: selectedSession, mode });
  const ledgerDates = relevantLedgerDates(calendar, selectedTradeDate, selectedSession);
  const records = ledgerDates.flatMap((date) => readTxLiveEventLedger(path.join(dataRoot, 'live-events', `${date}.ndjson`), { cacheRoot }));
  const initial = buildTxDecisionChart(records, {
    calendar, timeframe, asOf: cutoff, tradeDate: selectedTradeDate, session: selectedSession, actualContract, mode,
  });
  const priorDay = initial.actualContract && initial.contractMonth
    ? readPriorDayLevel(path.join(dataRoot, 'intraday', 'archive'), calendar, selectedTradeDate, initial.actualContract, initial.contractMonth)
    : null;
  const result = attachPriorDayLevels(initial, priorDay, cutoff);
  return Object.freeze({
    ...result,
    sourceLedgerDates: Object.freeze(ledgerDates),
    sourceLedgerIdentity: Object.freeze(ledgerDates.map((date) => `live-events:${date}:TX_EXECUTED_TICK`)),
  });
}

export function clearTxChartLedgerCache() {
  ledgerCache.clear();
}
