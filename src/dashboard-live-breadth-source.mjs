import fs from 'node:fs';
import path from 'node:path';
import { extractIx0001Breadth } from './ix0001-live-breadth.mjs';

const DEFAULT_MAX_TAIL_BYTES = 64 * 1024 * 1024;
const latestRecordCache = new Map();

function latestIx0001RecordFromText(text) {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes('"IX0001"') || !line.includes('"index_quote"')) continue;
    try {
      const record = JSON.parse(line);
      if (record.kind === 'index_quote' && record.code === 'IX0001' && record.product === 'IX0001') return record;
    } catch {
      // A torn final append is ignored; the append-only ledger remains untouched.
    }
  }
  return null;
}

export function readLatestIx0001Record(filePath, { maxTailBytes = DEFAULT_MAX_TAIL_BYTES } = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) return Object.freeze({ record: null, bytesScanned: 0, reason: 'LIVE_LEDGER_NOT_FOUND' });
  const stat = fs.statSync(absolute);
  const cached = latestRecordCache.get(absolute);
  if (cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs) return cached.result;

  const bytesScanned = Math.min(stat.size, Math.max(1, Number(maxTailBytes) || DEFAULT_MAX_TAIL_BYTES));
  const start = stat.size - bytesScanned;
  const buffer = Buffer.allocUnsafe(bytesScanned);
  const descriptor = fs.openSync(absolute, 'r');
  try { fs.readSync(descriptor, buffer, 0, bytesScanned, start); } finally { fs.closeSync(descriptor); }
  const record = latestIx0001RecordFromText(buffer.toString('utf8')) || cached?.result?.record || null;
  const result = Object.freeze({
    record,
    bytesScanned,
    reason: record ? null : 'IX0001_NOT_FOUND_IN_BOUNDED_TAIL',
  });
  latestRecordCache.set(absolute, { size: stat.size, mtimeMs: stat.mtimeMs, result });
  return result;
}

function minutesBetween(later, earlier) {
  const delta = Date.parse(later || '') - Date.parse(earlier || '');
  return Number.isFinite(delta) ? delta / 60_000 : Infinity;
}

export function classifyIx0001ForWorkspace(record, {
  currentIdentity,
  asOf = new Date().toISOString(),
  liveFreshnessMinutes = 5,
} = {}) {
  if (!record) return Object.freeze({
    state: 'UNAVAILABLE',
    reasonCode: 'IX0001_LIVE_BREADTH_UNAVAILABLE',
    sourceMode: 'UNAVAILABLE',
    currentSessionMatch: false,
    observation: null,
  });
  const observation = extractIx0001Breadth(record);
  const identityAvailable = currentIdentity?.state === 'AVAILABLE';
  const sameTradeDate = identityAvailable && observation.tradeDate === currentIdentity.tradeDate;
  const sameSession = sameTradeDate && currentIdentity.session === 'DAY' && observation.session === 'DAY';
  const futureViolation = !observation.availableAt || Date.parse(observation.availableAt) > Date.parse(asOf);
  const ageMinutes = minutesBetween(asOf, observation.availableAt);
  const live = sameSession && !futureViolation && ageMinutes >= 0 && ageMinutes <= liveFreshnessMinutes;

  if (live) return Object.freeze({
    state: 'LIVE',
    reasonCode: observation.qualityStatus === 'AVAILABLE' ? null : 'TIMESTAMP_LINEAGE_INSUFFICIENT',
    sourceMode: 'LIVE_RAW',
    currentSessionMatch: true,
    freshnessState: 'LIVE',
    ageMinutes,
    observation,
  });

  const sameTradeDateDayContext = sameTradeDate && observation.session === 'DAY' && !futureViolation;
  if (sameTradeDateDayContext) return Object.freeze({
    state: 'EOD_CONTEXT',
    reasonCode: sameSession ? 'IX0001_LIVE_BREADTH_STALE' : 'CURRENT_SESSION_NOT_TWSE_DAY',
    sourceMode: 'EOD_CONTEXT',
    currentSessionMatch: sameSession,
    freshnessState: ageMinutes <= 24 * 60 ? 'SESSION_CLOSED' : 'STALE',
    ageMinutes,
    observation,
  });

  return Object.freeze({
    state: 'UNAVAILABLE',
    reasonCode: futureViolation ? 'IX0001_FUTURE_DATA_VIOLATION' : 'IX0001_CURRENT_IDENTITY_MISMATCH',
    sourceMode: 'UNAVAILABLE',
    currentSessionMatch: false,
    freshnessState: 'UNAVAILABLE',
    ageMinutes,
    observation,
  });
}

export function loadIx0001BreadthForWorkspace({
  dataRoot,
  currentIdentity,
  asOf = new Date().toISOString(),
  maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
} = {}) {
  const tradeDate = currentIdentity?.tradeDate;
  if (!dataRoot || !tradeDate) return classifyIx0001ForWorkspace(null, { currentIdentity, asOf });
  const source = readLatestIx0001Record(path.join(dataRoot, 'live-events', `${tradeDate}.ndjson`), { maxTailBytes });
  return Object.freeze({
    ...classifyIx0001ForWorkspace(source.record, { currentIdentity, asOf }),
    bytesScanned: source.bytesScanned,
    boundedRead: true,
    sourceReason: source.reason,
  });
}
