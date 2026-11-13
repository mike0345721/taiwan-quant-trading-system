import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart, buildOneMinuteBars, buildTxDecisionChartFromOrderedTicks, classifyTxChartSession } from './dashboard-tx-chart.mjs';
import {readTxChartHistory,txChartHistoryPath,clearTxChartHistoryCache} from './dashboard-tx-chart-store.mjs';
import { buildChartTrendStrength } from './trend-strength-adx.mjs';
import { attachTimestampDependencyQuality } from './chart-timestamp-dependency-quality.mjs';
import { attachSourceTimeStructureEligibility, createSourceTimeStructureAudit } from './source-time-structure.mjs';
import { CAPTURE_EVENT_KINDS, compactCaptureEvidence } from './chart-capture-coverage.mjs';
import { readBoundedFile } from './daily-data-operations-files.mjs';
import { chartCatchupProgress } from './dashboard-tx-chart-catchup.mjs';

const ledgerCache = new Map();
let stagedAudit = null;
let completedAudit = null;
let timestampLineageCache = new WeakMap();
const TAIPEI_OFFSET = '+08:00';
const PERSISTENT_CACHE_CHECKPOINT_BYTES = 64 * 1024 * 1024;

export const TX_CHART_SOURCE_LIMITS = Object.freeze({
  maxSourceBytes: 4 * 1024 * 1024, maxCacheFileBytes: 48 * 1024 * 1024,
  maxCacheBytes: 64 * 1024 * 1024, maxRecords: 200_000, maxResidentLedgers: 4,
});
export function createTxChartReadBudget(limits = {}) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
      || Object.keys(limits).some(key => !Object.hasOwn(TX_CHART_SOURCE_LIMITS, key))) throw Error('TX_CHART_SOURCE_LIMIT_INVALID');
  const value = { ...TX_CHART_SOURCE_LIMITS, ...limits };
  for (const key of Object.keys(TX_CHART_SOURCE_LIMITS)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > TX_CHART_SOURCE_LIMITS[key]) throw Error('TX_CHART_SOURCE_LIMIT_INVALID');
  }
  return { ...value, remainingSourceBytes: value.maxSourceBytes, remainingCacheBytes: value.maxCacheBytes,
    remainingRecords: value.maxRecords, remainingCacheWriteBytes: value.maxCacheBytes,
    sourceBytesRead: 0, cacheBytesRead: 0, cacheBytesWritten: 0 };
}
const limitError = code => Object.assign(new Error(code), { chartLimit: true });
const requestBudgetError = () => Object.assign(limitError('TX_CHART_CACHE_REQUEST_BUDGET_EXCEEDED'), { requestBudget: true });

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compactTickRecord(record) {
  const capture = compactCaptureEvidence(record);
  if (capture) return capture;
  const payload = record.payload || {};
  return {
    kind: record.kind,
    product: record.product,
    receivedAt: record.receivedAt,
    exchangeTimestamp: record.exchangeTimestamp,
    eventId: record.eventId,
    duplicate: record.duplicate === true,
    // Preserve unknown/malformed raw evidence for capability checks. Consumers
    // may not infer an explicit zero from an absent field.
    sequenceGap: record.sequenceGap,
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

function readPersistentCache(sourcePath, sourceStat, cacheRoot, budget = null) {
  const files = cachePaths(sourcePath, cacheRoot);
  if (!files || !fs.existsSync(files.records) || !fs.existsSync(files.metadata)) return null;
  try {
    let metadataBytes;
    if (budget) {
      const metadataSize = fs.statSync(files.metadata).size;
      if (metadataSize > 64 * 1024) throw limitError('TX_CHART_CACHE_BUDGET_EXCEEDED');
      if (metadataSize > budget.remainingCacheBytes) throw requestBudgetError();
      budget.remainingCacheBytes -= metadataSize; budget.cacheBytesRead += metadataSize;
      metadataBytes = readBoundedFile(files.metadata, metadataSize).toString('utf8');
    } else metadataBytes = fs.readFileSync(files.metadata, 'utf8');
    const metadata = JSON.parse(metadataBytes);
    if (metadata.schemaVersion !== 'dw2-tx-tick-cache-v3'
      || metadata.sourcePath !== path.resolve(sourcePath)
      || !Number.isSafeInteger(metadata.sourceOffset) || metadata.sourceOffset < 0 || metadata.sourceOffset > sourceStat.size
      || !Number.isSafeInteger(metadata.recordCount) || metadata.recordCount < 0) return null;
    if (budget) {
      const size = fs.statSync(files.records).size;
      if (!Number.isSafeInteger(metadata.cacheSize) || metadata.cacheSize !== size
          || size > budget.maxCacheFileBytes || metadata.recordCount > budget.maxRecords) throw limitError('TX_CHART_CACHE_BUDGET_EXCEEDED');
      if (size > budget.remainingCacheBytes || metadata.recordCount > budget.remainingRecords) throw requestBudgetError();
      budget.remainingCacheBytes -= size;
      budget.cacheBytesRead += size;
    }
    const bytes = budget ? readBoundedFile(files.records, Math.min(budget.maxCacheFileBytes, metadata.cacheSize)) : fs.readFileSync(files.records);
    const cacheHashState = crypto.createHash('sha256').update(bytes);
    if (metadata.schemaVersion !== 'dw2-tx-tick-cache-v3'
      || metadata.sourcePath !== path.resolve(sourcePath)
      || !Number.isInteger(metadata.sourceOffset)
      || metadata.sourceOffset < 0
      || metadata.sourceOffset > sourceStat.size
      || metadata.cacheSize !== bytes.length
      || metadata.cacheHash !== cacheHashState.copy().digest('hex')) return null;
    const records = [], text = bytes.toString('utf8');
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline;
      if (end > offset) {
        if (records.length >= metadata.recordCount) return null;
        records.push(JSON.parse(text.slice(offset, end)));
      }
      offset = end + 1;
    }
    if (records.length !== metadata.recordCount) return null;
    return {
      offset: metadata.sourceOffset,
      remainder: '',
      records,
      files,
      persistedRecordCount: records.length,
      persistedSourceOffset: metadata.sourceOffset,
      cacheHashState,
      persistedCacheSize: bytes.length,
    };
  } catch (error) { if (error.chartLimit) throw error; return null; }
}

function writePersistentCache(sourcePath, cached, cacheRoot, budget = null) {
  const files = cached.files || cachePaths(sourcePath, cacheRoot);
  if (!files || cached.remainder) return;
  const persistedRecordCount = Number.isInteger(cached.persistedRecordCount) ? cached.persistedRecordCount : 0;
  const canAppend = cached.forceRewrite !== true && cached.cacheHashState && fs.existsSync(files.records)
    && fs.statSync(files.records).size === cached.persistedCacheSize && persistedRecordCount <= cached.records.length;
  const newRecords = cached.records.slice(persistedRecordCount);
  // Count UTF-8 bytes before publication. An oversized derived cache must not
  // replace a valid checkpoint or make the next reader exceed its own limit.
  const serialize = (records, existingBytes = 0) => {
    const parts = []; let size = 0;
    for (const record of records) {
      const line = JSON.stringify(compactTickRecord(record)) + '\n';
      size += Buffer.byteLength(line);
      if (budget && (size + existingBytes > budget.maxCacheFileBytes || size > budget.remainingCacheWriteBytes)) throw limitError('TX_CHART_CACHE_WRITE_BUDGET_EXCEEDED');
      parts.push(line);
    }
    if (budget) { budget.remainingCacheWriteBytes -= size; budget.cacheBytesWritten += size; }
    return Buffer.from(parts.join(''), 'utf8');
  };
  let cacheHashState, cacheSize;
  if (canAppend) {
    const appended = serialize(newRecords, cached.persistedCacheSize);
    cacheHashState = cached.cacheHashState.copy().update(appended);
    cacheSize = cached.persistedCacheSize + appended.length;
    if (newRecords.length) {
      fs.appendFileSync(files.records, appended);
    }
  } else {
    const recordsTemp = `${files.records}.${process.pid}.tmp`;
    const initialBytes = serialize(cached.records);
    fs.mkdirSync(path.dirname(files.records), { recursive: true });
    fs.writeFileSync(recordsTemp, initialBytes);
    fs.renameSync(recordsTemp, files.records);
    cacheHashState = crypto.createHash('sha256').update(initialBytes);
    cacheSize = initialBytes.length;
  }
  const metadataTemp = `${files.metadata}.${process.pid}.tmp`;
  const metadata = {
    schemaVersion: 'dw2-tx-tick-cache-v3',
    sourcePath: path.resolve(sourcePath),
    sourceOffset: cached.offset,
    recordCount: cached.records.length,
    cacheSize,
    cacheHash: cacheHashState.copy().digest('hex'),
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
  cached.persistedSourceOffset = cached.offset;
  cached.forceRewrite = false;
  cached.cacheHashState = cacheHashState;
  cached.persistedCacheSize = cacheSize;
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

function relevantLedgerDates(calendar, tradeDate, session, timeframe = '5m') {
  if (timeframe === '1D') {
    const nightStartDate = previousOfficial(calendar, tradeDate);
    return nightStartDate
      ? [...new Set([nightStartDate, dateShift(nightStartDate, 1), tradeDate])]
      : [tradeDate];
  }
  if (session === 'DAY') return [tradeDate];
  const startDate = previousOfficial(calendar, tradeDate);
  if (!startDate) return [];
  return [...new Set([startDate, dateShift(startDate, 1)])];
}

function parseCandidateLine(line, records) {
  if (CAPTURE_EVENT_KINDS.some(kind => line.includes(`"kind":"${kind}"`))) {
    try { const evidence = compactCaptureEvidence(JSON.parse(line)); if (evidence) { records.push(evidence); return true; } } catch { return false; }
  }
  if (!line.includes('"kind":"futures_tick"')) return false;
  if (!line.includes('"_product_family":"TX"') && !/"product":"TXF[A-L]\d"/.test(line)) return false;
  try { records.push(compactTickRecord(JSON.parse(line))); return true; } catch { return false; }
}

export function readTxLiveEventLedger(filePath, { cacheRoot = null, includeCaptureEvidence = false, budget = null, withProgress = false } = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) return withProgress ? { records: [], progress: { sourceDate: path.basename(absolute), state: 'MISSING', complete: false, reasonCodes: ['TX_CHART_SOURCE_MISSING'] } } : Object.freeze([]);
  const stat = fs.statSync(absolute);
  let cached = ledgerCache.get(absolute);
  const reasons = []; let preserveExistingCache = false;
  if (!cached) {
    try { cached = readPersistentCache(absolute, stat, cacheRoot, budget); }
    catch (error) {
      if (!error.chartLimit) throw error;
      // Exhausting this request's remainder says nothing about whether the
      // checkpoint is reusable by a later single-date request. Leave residency
      // untouched and do not fall back to scanning its raw source in this call.
      if (error.requestBudget) return withProgress ? { records: [], progress: { sourceDate: path.basename(absolute),
        state: 'REQUEST_BUDGET_EXHAUSTED', complete: false, observedSize: stat.size,
        reasonCodes: [error.message] } } : Object.freeze([]);
      reasons.push(error.message); preserveExistingCache = true;
    }
  }
  if (!cached || stat.size < cached.offset) cached = {
    offset: 0,
    remainder: '',
    records: [],
    files: cachePaths(absolute, cacheRoot),
    persistedRecordCount: 0,
    persistedSourceOffset: 0,
    forceRewrite: true,
    persistenceBlocked: preserveExistingCache,
  };
  // Remember a restored checkpoint even when no new suffix has arrived.
  ledgerCache.set(absolute, cached);
  if (budget) {
    ledgerCache.delete(absolute); ledgerCache.set(absolute, cached);
    let residentRecords = [...ledgerCache.values()].reduce((count, value) => count + value.records.length, 0);
    while (ledgerCache.size > 1 && (ledgerCache.size > budget.maxResidentLedgers || residentRecords > budget.maxRecords)) {
      const oldest = ledgerCache.keys().next().value;
      residentRecords -= ledgerCache.get(oldest).records.length; ledgerCache.delete(oldest);
    }
  }
  if (stat.size > cached.offset && (!budget || cached.records.length <= budget.remainingRecords)) {
    const fd = fs.openSync(absolute, 'r');
    try {
      while (cached.offset < stat.size) {
        const length = Math.min(8 * 1024 * 1024, stat.size - cached.offset, budget?.remainingSourceBytes ?? Infinity);
        if (!length) { reasons.push('TX_CHART_SOURCE_BUDGET_EXCEEDED'); break; }
        const buffer = Buffer.allocUnsafe(length);
        const bytes = fs.readSync(fd, buffer, 0, length, cached.offset);
        if (budget) { budget.remainingSourceBytes -= bytes; budget.sourceBytesRead += bytes; }
        if (!bytes) break;
        const terminal = buffer.subarray(0, bytes).lastIndexOf(0x0a);
        if (terminal < 0) { cached.remainder = 'PENDING_COMPLETE_LINE'; reasons.push('TX_CHART_COMPLETE_LINE_PENDING'); break; }
        const added = [];
        for (const line of buffer.subarray(0, terminal + 1).toString('utf8').split('\n')) parseCandidateLine(line, added);
        if (budget && cached.records.length + added.length > budget.remainingRecords) { reasons.push('TX_CHART_RECORD_BUDGET_EXCEEDED'); break; }
        // A complete prefix and its records commit together; retry never duplicates a partial batch.
        for (const record of added) cached.records.push(record);
        cached.offset += terminal + 1;
        cached.remainder = '';
        if (terminal + 1 < bytes && cached.offset + bytes - terminal - 1 === stat.size) {
          reasons.push('TX_CHART_COMPLETE_LINE_PENDING'); break;
        }
      }
    } finally { fs.closeSync(fd); }
  }
  const withinRecords = !budget || cached.records.length <= budget.remainingRecords;
  if (budget) {
    let residentRecords = [...ledgerCache.values()].reduce((count, value) => count + value.records.length, 0);
    while (ledgerCache.size > 1 && residentRecords > budget.maxRecords) {
      const oldest = ledgerCache.keys().next().value;
      residentRecords -= ledgerCache.get(oldest).records.length; ledgerCache.delete(oldest);
    }
  }
  if (!withinRecords) reasons.push('TX_CHART_RECORD_BUDGET_EXCEEDED');
  const selected = withinRecords ? cached.records : [];
  if (budget) budget.remainingRecords -= selected.length;
  const complete = withinRecords && cached.offset === stat.size;
  if (!complete && !reasons.length) reasons.push('TX_CHART_SOURCE_CATCHUP_PENDING');
  const uncheckpointedBytes = cached.offset - (cached.persistedSourceOffset || 0);
  const checkpointBytes = budget ? Math.min(PERSISTENT_CACHE_CHECKPOINT_BYTES, budget.maxSourceBytes) : PERSISTENT_CACHE_CHECKPOINT_BYTES;
  if (cached.persistenceBlocked) reasons.push('TX_CHART_EXISTING_CACHE_PRESERVED');
  if (cacheRoot && !cached.persistenceBlocked && withinRecords && cached.records.length && (cached.forceRewrite === true || uncheckpointedBytes >= checkpointBytes)) {
    try { writePersistentCache(absolute, cached, cacheRoot, budget); }
    catch (error) {
      // A failed atomic metadata publication must not make the next append duplicate bytes.
      cached.forceRewrite = true;
      if (!budget) throw error;
      reasons.push(error.chartLimit ? error.message : 'TX_CHART_CACHE_CHECKPOINT_FAILED');
    }
  }
  const records = Object.freeze(includeCaptureEvidence ? [...selected] : selected.filter(record => record.kind === 'futures_tick'));
  return withProgress ? { records, progress: { sourceDate: path.basename(absolute), complete,
    state: complete ? 'COMPLETE' : 'CATCHUP_PENDING', sourceOffset: cached.offset, observedSize: stat.size,
    reasonCodes: [...new Set(reasons)] } } : records;
}

function chartTimestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}${TAIPEI_OFFSET}`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestampLineageForChart(records, calendar) {
  const violations = [];
  let byRecord = timestampLineageCache.get(calendar);
  if (!byRecord) { byRecord = new WeakMap(); timestampLineageCache.set(calendar, byRecord); }
  const normalizedRecords = (records || []).map((record) => {
    const cached = record && byRecord.get(record);
    if (cached) {
      if (cached.violation) violations.push(cached.violation);
      return cached.normalized;
    }
    if (record?.kind !== 'futures_tick' || record?.duplicate === true) return record;
    const payload = record.payload || {};
    const exchangeTimestamp = String(payload.datetime || record.exchangeTimestamp || '');
    const receivedAt = record.receivedAt || payload._received_at || null;
    const exchangeMs = chartTimestampMs(exchangeTimestamp);
    const receivedMs = chartTimestampMs(receivedAt);
    if (exchangeMs == null || receivedMs == null || receivedMs >= exchangeMs) return record;
    let context;
    try { context = classifyTxChartSession(exchangeTimestamp, calendar); } catch { return record; }
    const effectiveAvailableAt = new Date(exchangeMs).toISOString();
    const violation = Object.freeze({
      eventId: record.eventId || null,
      actualContract: String(payload._target_code || record.product || payload.code || ''),
      exchangeTimestamp: new Date(exchangeMs).toISOString(),
      receivedAt: new Date(receivedMs).toISOString(),
      effectiveAvailableAt,
      deltaMs: receivedMs - exchangeMs,
      ...context,
    });
    violations.push(violation);
    const normalized = Object.freeze({
      ...record,
      receivedAt: effectiveAvailableAt,
      timestampLineageAdjusted: true,
      rawReceivedAt: receivedAt,
    });
    byRecord.set(record, { normalized, violation });
    return normalized;
  });
  return Object.freeze({ records: Object.freeze(normalizedRecords), violations: Object.freeze(violations) });
}

function scopedTimestampLineageViolations(violations, { tradeDate, session, timeframe, cutoff }) {
  const cutoffMs = chartTimestampMs(cutoff);
  return Object.freeze((violations || []).filter((violation) => {
    const effectiveMs = chartTimestampMs(violation.effectiveAvailableAt);
    if (cutoffMs != null && (effectiveMs == null || effectiveMs > cutoffMs)) return false;
    if (tradeDate && violation.sessionTradeDate !== tradeDate) return false;
    if (timeframe !== '1D' && session && violation.session !== session) return false;
    return true;
  }));
}

function attachTimestampLineageQuality(chart, violations, { timeframe, tradeDate, session, cutoff }) {
  const scoped = scopedTimestampLineageViolations(violations, { tradeDate, session, timeframe, cutoff });
  if (!scoped.length) return chart;
  const qualityReasons = [...new Set([...(chart.qualityReasons || []), 'TIMESTAMP_LINEAGE_INSUFFICIENT'])];
  const hasEvidence = Number(chart.sourceEventCount) > 0;
  const next = {
    ...chart,
    qualityStatus: hasEvidence ? 'QUALITY_INSUFFICIENT' : chart.qualityStatus,
    qualityReasons: Object.freeze(qualityReasons),
    timeLineageViolationCount: scoped.length,
    timestampLineagePolicy: 'EFFECTIVE_AVAILABLE_AT_MAX_RECEIVED_EXCHANGE',
    timestampLineageAdjustedEventCount: scoped.length,
  };
  if (timeframe === '1D' && chart.sessionCoverage) {
    const nightCount = scoped.filter((violation) => violation.session === 'NIGHT').length;
    const dayCount = scoped.filter((violation) => violation.session === 'DAY').length;
    const adjustCoverage = (coverage, count) => Object.freeze({
      ...coverage,
      timeLineageViolationCount: count,
      qualityStatus: count > 0 && Number(coverage?.eventCount) > 0 ? 'QUALITY_INSUFFICIENT' : coverage?.qualityStatus,
    });
    next.sessionCoverage = Object.freeze({
      night: adjustCoverage(chart.sessionCoverage.night, nightCount),
      day: adjustCoverage(chart.sessionCoverage.day, dayCount),
    });
    if (hasEvidence && chart.windowState === 'CLOSED' && chart.status === 'READY') next.status = 'QUALITY_INSUFFICIENT';
  }
  return attachTimestampDependencyQuality(Object.freeze(next), scoped, { cutoff });
}

function readPriorDayLevel(archiveDir, calendar, tradeDate, selectedContract, contractMonth, budget = null) {
  const priorTradeDate = previousOfficial(calendar, tradeDate);
  if (!priorTradeDate) return null;
  const filePath = path.join(archiveDir, `${priorTradeDate}-day.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    let bytes;
    if (budget) {
      const size = fs.statSync(filePath).size;
      if (size > Math.min(2 * 1024 * 1024, budget.remainingCacheBytes)) return null;
      budget.remainingCacheBytes -= size; budget.cacheBytesRead += size;
      bytes = readBoundedFile(filePath, size).toString('utf8');
    } else bytes = fs.readFileSync(filePath, 'utf8');
    const payload = JSON.parse(bytes);
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

const CURRENT_SOURCE_LEVELS = new Set(['currentDayHigh', 'currentDayLow', 'nightHigh', 'nightLow', 'vwap', 'openingRangeHigh', 'openingRangeLow']);
function restrictPartialSource(value) {
  if (!value || typeof value !== 'object') return value;
  const reason = 'SOURCE_CATCHUP_PENDING';
  return { ...value, ...(value.status === 'READY' ? { status: 'QUALITY_INSUFFICIENT' } : {}),
    qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons: [...new Set([...(value.qualityReasons || []), reason])],
    fullSessionVerified: false, sourceComplete: false, coverageState: 'PARTIAL', sourceReadReason: reason,
    captureCoverage: { ...value.captureCoverage, state: value.captureCoverage?.state === 'KNOWN_INTERRUPTION' ? 'KNOWN_INTERRUPTION' : 'SOURCE_PARTIAL',
      completeMarketWindow: false, sourceComplete: false, reason },
    structureEligibility: { ...value.structureEligibility, state: 'BLOCKED',
      reasonCodes: [...new Set([...(value.structureEligibility?.reasonCodes || []), reason])], executionAuthorized: false },
  };
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
  sourceBudget = null,
  staged = false,
  holdCompletedAudit = false,
  minimumCutoff = null,
} = {}) {
  if (!dataRoot || !calendar) throw new Error('TX_CHART_SOURCE_CONFIG_REQUIRED');
  if (minimumCutoff !== null && (!holdCompletedAudit || typeof minimumCutoff !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(minimumCutoff)
      || !Number.isFinite(Date.parse(minimumCutoff)) || new Date(minimumCutoff).toISOString() !== minimumCutoff))
    throw Error('CHART_SELECTION_INVALID');
  const defaults = resolveDefaultChartSelection(calendar, now);
  const selectedTradeDate = tradeDate || defaults.tradeDate;
  const selectedSession = timeframe === '1D' ? 'NIGHT_PLUS_DAY' : (session || defaults.session);
  const cutoff = asOf || now.toISOString();
  const auditKey=JSON.stringify([path.resolve(dataRoot),cacheRoot,calendar,timeframe,mode,selectedTradeDate,selectedSession,actualContract,asOf],
    (_key,value)=>value instanceof Map?[...value]:value instanceof Set?[...value]:value);
  // Capture is a temporary consumer of the same source prefix, not a different data selection.
  // The lease is never renewed by polling, so abandoned captures cannot freeze LIVE forever.
  if(stagedAudit?.captureStartedAt!=null&&(now.getTime()<stagedAudit.captureStartedAt
      ||now.getTime()-stagedAudit.captureStartedAt>=10000))stagedAudit=null;
  // A new ordinary audit must not evict the last reusable completed prefix.
  // Keep at most one of each; neither clock rollback nor polling renews a lease.
  if(completedAudit&&(now.getTime()<completedAudit.completedAt
      ||(completedAudit.captureStartedAt==null?now.getTime()-completedAudit.completedAt>10000
        :now.getTime()<completedAudit.captureStartedAt||now.getTime()-completedAudit.captureStartedAt>=10000)))completedAudit=null;
  if(stagedAudit?.completedAt!=null&&stagedAudit.captureStartedAt==null)stagedAudit=null;
  const meetsCutoff=job=>minimumCutoff===null||Date.parse(job.cutoff)>=Date.parse(minimumCutoff);
  if(staged&&sourceBudget&&completedAudit?.key===auditKey){
    let retirement;
    try{retirement=completedAudit.lease.supersededByOwnWrite(sourceBudget);}
    catch(error){completedAudit=null;stagedAudit=null;throw error;}
    if(retirement==='PENDING'){
      if(holdCompletedAudit){
        if(completedAudit.captureStartedAt==null)completedAudit.captureStartedAt=now.getTime();
        if(stagedAudit?.key===auditKey&&stagedAudit.captureStartedAt==null)stagedAudit.captureStartedAt=now.getTime();
      }
      // Do not call the stale lease's strict step or select a new audit while
      // retirement proof is incomplete. Keep the displayed cutoff constraint.
      const pending=stagedAudit?.key===auditKey?stagedAudit:completedAudit;
      if(meetsCutoff(pending))return finishTxDecisionChart(pending.base,{...pending.context,sourceBudget,auditPending:true,
        auditProgress:{state:'PENDING',phase:'SOURCE_PROOF',processedRecords:pending.lease.processedRecords,
          totalRecords:pending.lease.totalRecords,cutoff:pending.cutoff,evaluatedAt:now.toISOString()}});
      // A newer minimum has no eligible frozen frame yet. Continue through the
      // ordinary bounded input-warmup path, without relabelling the old cutoff.
    }
    if(retirement==='SUPERSEDED'){
      if(stagedAudit===completedAudit)stagedAudit=null;
      completedAudit=null;
    }
  }
  const reusable=completedAudit?.key===auditKey&&meetsCutoff(completedAudit)
    &&(holdCompletedAudit||completedAudit.captureStartedAt!=null)?completedAudit:null;
  const job=reusable??(stagedAudit?.key===auditKey&&meetsCutoff(stagedAudit)?stagedAudit:null);
  if(staged&&sourceBudget&&job){
    if(holdCompletedAudit&&job.captureStartedAt==null)job.captureStartedAt=now.getTime();
    try{
      const complete=job.lease.step(job.audit.append,sourceBudget);
      const progress={state:complete?'COMPLETE':'PENDING',processedRecords:job.lease.processedRecords,
        totalRecords:job.lease.totalRecords,cutoff:job.cutoff,evaluatedAt:now.toISOString()};
      if(complete&&job.completedAt==null){job.completedAt=now.getTime();completedAudit=job;}
      return finishTxDecisionChart(complete?job.audit.finish({now:now.toISOString()}):job.base,
        {...job.context,sourceBudget,auditPending:!complete,auditProgress:progress});
    }catch(error){if(stagedAudit===job)stagedAudit=null;if(completedAudit===job)completedAudit=null;throw error;}
  }
  stagedAudit=null;
  if (!selectedTradeDate) {
    const empty = buildTxDecisionChart([], { calendar, timeframe, asOf: cutoff, tradeDate: null, session: selectedSession, mode });
    return Object.freeze({ ...empty, trendStrength: buildChartTrendStrength(empty) });
  }
  const ledgerDates = relevantLedgerDates(calendar, selectedTradeDate, selectedSession, timeframe);
  const files=ledgerDates.map(date=>path.join(dataRoot,'live-events',`${date}.ndjson`));
  let history=null,sources;
  const useHistory=()=>{
    // Retain old files as evidence/migration inputs. Drop only their in-memory
    // working set when switching to the durable streaming projection.
    ledgerCache.clear();
    return readTxChartHistory({dataRoot,cacheRoot,files,budget:sourceBudget,calendar,
      decode:line=>{const rows=[];parseCandidateLine(line,rows);return rows[0]??null;},
      normalize:record=>{const lineage=normalizeTimestampLineageForChart([record],calendar),normalized=lineage.records[0];
        const tick=buildOneMinuteBars([normalized],{calendar}).ticks[0]??null;
        return {record:normalized,key:tick,violation:lineage.violations[0]??null};}});
  };
  if(cacheRoot&&sourceBudget&&fs.existsSync(txChartHistoryPath(dataRoot,cacheRoot)))history=useHistory();
  else{
    sources=files.map(file=>readTxLiveEventLedger(file,{cacheRoot,includeCaptureEvidence:true,budget:sourceBudget,withProgress:true}));
    if(cacheRoot&&sourceBudget&&sources.some(source=>source.progress.reasonCodes?.some(reason=>
      ['TX_CHART_RECORD_BUDGET_EXCEEDED','TX_CHART_CACHE_BUDGET_EXCEEDED','TX_CHART_CACHE_WRITE_BUDGET_EXCEEDED',
        'TX_CHART_CACHE_REQUEST_BUDGET_EXCEEDED'].includes(reason)))){
      sources=null;history=useHistory();
    }
  }
  if(history)sources=history.sources;
  const records=history?history.raw:sources.flatMap(source=>source.records);
  const lineage=history?{violations:history.violations}:normalizeTimestampLineageForChart(records,calendar);
  const initial = (history?buildTxDecisionChartFromOrderedTicks:buildTxDecisionChart)(history?history.ordered:lineage.records, {
    calendar, timeframe, asOf: cutoff, tradeDate: selectedTradeDate,
    session: timeframe === '1D' ? null : selectedSession,
    actualContract, mode,
  });
  const governedInitial = attachTimestampLineageQuality(initial, lineage.violations, {
    timeframe,
    tradeDate: selectedTradeDate,
    session: selectedSession,
    cutoff,
  });
  const priorDay = governedInitial.actualContract && governedInitial.contractMonth
    ? readPriorDayLevel(path.join(dataRoot, 'intraday', 'archive'), calendar, selectedTradeDate, governedInitial.actualContract, governedInitial.contractMonth, sourceBudget)
    : null;
  const base=attachPriorDayLevels(governedInitial,priorDay,cutoff);
  if(staged&&sourceBudget&&history&&sources.every(source=>source.progress.complete)
    &&mode==='LIVE'&&timeframe==='5m'&&asOf==null){
    const lease=history.createRawReadLease(),audit=createSourceTimeStructureAudit(base,{calendar,cutoff});
    stagedAudit={key:auditKey,cutoff,lease,audit,base,captureStartedAt:holdCompletedAudit?now.getTime():null,context:{sources,history,ledgerDates}};
    // Never combine full ordered-chart work and a full physical-order audit in
    // one worker request. The next request advances this exact frozen snapshot.
    return finishTxDecisionChart(base,{sources,history,ledgerDates,sourceBudget,auditPending:true,
      auditProgress:{state:'PENDING',processedRecords:0,totalRecords:lease.totalRecords,cutoff}});
  }
  const result = attachSourceTimeStructureEligibility(base, records,
    { calendar, cutoff, explicitAsOf: asOf != null });
  return finishTxDecisionChart(result,{sources,sourceBudget,history,ledgerDates});
}

function finishTxDecisionChart(result,{sources,sourceBudget,history,ledgerDates,auditPending=false,auditProgress=null}){
  const complete = !auditPending&&sources.every(source => source.progress.complete);
  const limited = sourceBudget && !complete;
  const qualityReasons = [...new Set([...(result.qualityReasons || []), ...(limited ? ['SOURCE_CATCHUP_PENDING'] : [])])];
  const chart = Object.freeze({
    ...result,
    ...(auditProgress?{sourceAuditProgress:Object.freeze(auditProgress)}:{}),
    ...(sourceBudget ? { sourceComplete: complete, sourceReadState: complete ? 'COMPLETE' : 'CATCHUP_PENDING',
      sourceProgress: sources.map(source => source.progress), sourceReadBytes: sourceBudget.sourceBytesRead,
      cacheReadBytes: history?null:sourceBudget.cacheBytesRead, cacheWriteBytes: sourceBudget.cacheBytesWritten,
      ...(history?{historyReadMode:'PRIVATE_SQLITE_STREAM',historyPageCacheKiB:8192,
        historyReadBytes:'NOT_MEASURED',cacheWriteMeasurement:'SERIALIZED_LOGICAL_ROWS_NOT_PHYSICAL_IO'}:{}) } : {}),
    ...(limited ? { ...restrictPartialSource(result), status: result.bars?.length ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE',
      reason: 'SOURCE_CATCHUP_PENDING', qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons,
      coverageState: 'PARTIAL', fullSessionVerified: false,
      bars: (result.bars || []).map(restrictPartialSource), vwap: (result.vwap || []).map(restrictPartialSource),
      openingRange: restrictPartialSource(result.openingRange),
      ...(result.sessionCoverage ? { sessionCoverage: Object.fromEntries(Object.entries(result.sessionCoverage).map(([key, value]) => [key, restrictPartialSource(value)])) } : {}),
      levels: Object.fromEntries(Object.entries(result.levels || {}).map(([key, value]) => [key,
        CURRENT_SOURCE_LEVELS.has(key) ? restrictPartialSource(value) : value])) } : {}),
    sourceLedgerDates: Object.freeze(ledgerDates),
    sourceLedgerIdentity: Object.freeze(ledgerDates.map((date) => `live-events:${date}:TX_EXECUTED_TICK`)),
  });
  // Derive only after the existing source/capture restrictions have been applied.
  // This reads the already bounded OHLC projection, never the raw ledger again.
  return Object.freeze({ ...chart, trendStrength: buildChartTrendStrength(chart), catchupProgress: chartCatchupProgress(chart) });
}

export function releaseTxChartAudit(){
  if(stagedAudit?.captureStartedAt!=null)stagedAudit=null;
  if(completedAudit?.captureStartedAt!=null)completedAudit=null;
}
export function clearTxChartLedgerCache() {
  stagedAudit=null;
  completedAudit=null;
  ledgerCache.clear();
  clearTxChartHistoryCache();
  timestampLineageCache = new WeakMap();
}
