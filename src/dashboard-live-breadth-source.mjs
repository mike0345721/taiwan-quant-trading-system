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

// Walk physical lines backwards. A normal index quote near EOF needs one block,
// not a decode/split of the entire 64 MiB tail on every ledger append.
function latestFromTail(descriptor, size, budget) {
  const floor = Math.max(0, size - budget);
  let cursor = size, bytesScanned = 0, fragments = [];
  const candidate = part => {
    const line = fragments.length ? Buffer.concat([part, ...fragments]) : part;
    fragments = [];
    return latestIx0001RecordFromText(line.toString('utf8'));
  };
  while (cursor > floor) {
    const length = Math.min(64 * 1024, cursor - floor);
    const block = Buffer.allocUnsafe(length);
    const read = fs.readSync(descriptor, block, 0, length, cursor - length);
    bytesScanned += read;
    if (read !== length) return { record: null, bytesScanned, changed: true };
    cursor -= length;
    let end = length;
    for (let index = block.lastIndexOf(10); index >= 0; index = block.lastIndexOf(10, index - 1)) {
      const record = candidate(block.subarray(index + 1, end));
      if (record) return { record, bytesScanned };
      end = index;
      if (index === 0) break;
    }
    if (end) fragments.unshift(block.subarray(0, end));
  }
  // Preserve the existing bounded-tail semantics, including a complete final
  // JSON row without LF and a row exactly at the lower byte boundary.
  return { record: candidate(Buffer.alloc(0)), bytesScanned };
}

export function readLatestIx0001Record(filePath, { maxTailBytes = DEFAULT_MAX_TAIL_BYTES } = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    latestRecordCache.delete(absolute);
    return Object.freeze({ record: null, bytesScanned: 0, reason: 'LIVE_LEDGER_NOT_FOUND' });
  }
  const stat = fs.statSync(absolute);
  const cached = latestRecordCache.get(absolute);
  const parsedBudget = Number(maxTailBytes);
  const budget = Number.isFinite(parsedBudget) && parsedBudget > 0 ? Math.max(1, Math.floor(parsedBudget)) : DEFAULT_MAX_TAIL_BYTES;
  const sameFile = cached?.dev === stat.dev && cached?.ino === stat.ino && cached?.birthtimeMs === stat.birthtimeMs;
  if (sameFile && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.budget === budget) return cached.result;
  const descriptor = fs.openSync(absolute, 'r');
  let tail;
  try { tail = latestFromTail(descriptor, stat.size, budget); } finally { fs.closeSync(descriptor); }
  if (tail.changed) {
    latestRecordCache.delete(absolute);
    return Object.freeze({ record: null, bytesScanned: tail.bytesScanned, reason: 'LIVE_LEDGER_CHANGED_DURING_READ' });
  }
  // A cached earlier quote can survive append-only growth, never replacement,
  // truncation or a request for a different read budget.
  const previous = sameFile && stat.size > cached.size && cached.budget === budget ? cached.result.record : null;
  const record = tail.record || previous || null;
  const result = Object.freeze({
    record,
    bytesScanned: tail.bytesScanned,
    reason: record ? null : 'IX0001_NOT_FOUND_IN_BOUNDED_TAIL',
  });
  latestRecordCache.set(absolute, { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs, budget, result });
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
