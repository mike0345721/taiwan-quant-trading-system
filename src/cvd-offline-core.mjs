import crypto from 'node:crypto';
import { materializeTxCanonicalObservations, buildExecutedPressureWindow } from './tx-intraday-pressure-path-efficiency.mjs';

export const CVD_VERSION = 'cru50-cvd-offline-v1';
export const SAFETY = Object.freeze({ formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false });
export function stableJson(value) {
  const sort = (x) => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(value));
}
export const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const seal = (state) => ({ state, stateHash: digest(stableJson(state)) });
const identity = (e) => [e.actualContract, e.tradeDate, e.session, e.continuityEpoch];

export function createCvdCheckpoint(sourceLedgerIdentity, resolverIdentity = 'explicit-only') {
  if (typeof sourceLedgerIdentity !== 'string' || !sourceLedgerIdentity.trim()) throw new Error('CVD_SOURCE_REQUIRED');
  return seal({ schemaVersion: CVD_VERSION, sourceLedgerIdentity, resolverIdentity,
    ordinal: 0, terminalHash: 'GENESIS', canonicalState: null, quotes: [], segments: [], series: [],
    ...SAFETY });
}

export function validateCvdCheckpoint(checkpoint) {
  const s = checkpoint?.state;
  if (!s || s.schemaVersion !== CVD_VERSION || checkpoint.stateHash !== digest(stableJson(s))
      || !Number.isSafeInteger(s.ordinal) || s.ordinal < 0 || !s.sourceLedgerIdentity
      || !s.resolverIdentity || !Array.isArray(s.quotes) || !Array.isArray(s.segments) || !Array.isArray(s.series)
      || Object.entries(SAFETY).some(([k, v]) => s[k] !== v)
      || (s.ordinal > 0 && (!s.canonicalState || !/^[a-f0-9]{64}$/.test(s.terminalHash)))) {
    throw new Error('CVD_CHECKPOINT_INVALID');
  }
  return s;
}

// Physical suffix only. No event-time sorting, timestamp deduplication, or live state imports.
export function appendCvdRecords(checkpoint, records, { sourceLedgerIdentity, ledgerOrdinalOffset,
  resolveSessionTradeDate = null, resolverIdentity = 'explicit-only', maxRecords = 10_000,
  deadline = Infinity } = {}) {
  const before = validateCvdCheckpoint(checkpoint);
  if (sourceLedgerIdentity !== before.sourceLedgerIdentity || resolverIdentity !== before.resolverIdentity) throw new Error('CVD_SOURCE_MISMATCH');
  if (ledgerOrdinalOffset !== before.ordinal) throw new Error('CVD_ORDINAL_MISMATCH');
  if (!Array.isArray(records) || before.ordinal + records.length > maxRecords) throw new Error('CVD_RECORD_BUDGET');
  const state = structuredClone(before);
  for (const record of records) {
    if (Date.now() > deadline) throw new Error('CVD_DURATION_BUDGET');
    const { recordHash, ...body } = record;
    if (record.previousHash !== state.terminalHash
        || recordHash !== digest(`${state.terminalHash}\n${stableJson(body)}`)) throw new Error('CVD_RECORD_HASH_MISMATCH');
    const canonical = materializeTxCanonicalObservations([record], {
      sourceLedgerIdentity, ledgerOrdinalOffset: state.ordinal, initialState: state.canonicalState, resolveSessionTradeDate,
    });
    state.canonicalState = canonical.terminalState;
    state.ordinal += 1;
    state.terminalHash = recordHash;
    for (const event of canonical.events) {
      // Retain all prior quotes within the bounded prefix: late ticks may need an older eligible quote.
      if (event.kind === 'futures_bidask') { state.quotes.push(event); continue; }
      let segment = state.segments.at(-1);
      if (!segment || stableJson(segment.identity) !== stableJson(identity(event))) {
        segment = { identity: identity(event), startOrdinal: event.ledgerOrdinal,
          observedStart: event.eventTime, startAvailableAt: event.availableAt,
          sessionStartProven: false, scope: 'OBSERVED_FRAGMENT', buyProxyVolume: 0, sellProxyVolume: 0,
          unknownVolume: 0, totalExecutedVolume: 0, tickCount: 0, invalidTickCount: 0,
          classificationConflictCount: 0, bestQuoteMatchedVolume: 0, reasons: [] };
        state.segments.push(segment);
      }
      // One tick plus physically prior quotes reuses the exact validation and provider mapping.
      const pressure = buildExecutedPressureWindow([...state.quotes, event], event, { windowMs: 1 });
      if (pressure.totalExecutedVolume == null || !event.recordHash) {
        segment.invalidTickCount += 1;
        segment.reasons = [...new Set([...segment.reasons, pressure.unavailableReason || 'CANONICAL_LINEAGE_INCOMPLETE'])];
      } else {
        for (const key of ['buyProxyVolume', 'sellProxyVolume', 'unknownVolume', 'totalExecutedVolume']) segment[key] += pressure[key];
        segment.classificationConflictCount += pressure.conflict.count;
        segment.bestQuoteMatchedVolume += pressure.bestQuoteCrossCheck.buyProxyVolume + pressure.bestQuoteCrossCheck.sellProxyVolume;
        segment.tickCount += 1;
        if (!Number.isFinite(segment.totalExecutedVolume)) throw new Error('CVD_NUMERIC_OVERFLOW');
      }
      const classified = segment.buyProxyVolume + segment.sellProxyVolume;
      segment.classifiedCoverage = segment.totalExecutedVolume > 0 ? classified / segment.totalExecutedVolume : null;
      segment.value = segment.invalidTickCount || classified === 0 ? null : segment.buyProxyVolume - segment.sellProxyVolume;
      segment.quality = segment.invalidTickCount || segment.classifiedCoverage !== 1 ? 'QUALITY_INSUFFICIENT' : 'DESCRIPTIVE_ONLY';
      segment.reason = segment.reasons[0] || (classified === 0 ? 'NO_CLASSIFIED_VOLUME' : segment.classifiedCoverage !== 1 ? 'CLASSIFIED_COVERAGE_INCOMPLETE' : 'CAPTURE_COMPLETENESS_UNPROVEN');
      segment.lastOrdinal = event.ledgerOrdinal;
      segment.availableAt = event.availableAt;
      segment.eventTime = event.eventTime;
      state.series.push({ segment: state.segments.length - 1, ledgerOrdinal: event.ledgerOrdinal,
        recordHash: event.recordHash, availableAt: event.availableAt, eventTime: event.eventTime,
        value: segment.value, buyProxyVolume: segment.buyProxyVolume, sellProxyVolume: segment.sellProxyVolume,
        unknownVolume: segment.unknownVolume, totalExecutedVolume: segment.totalExecutedVolume,
        classifiedCoverage: segment.classifiedCoverage, quality: segment.quality, reason: segment.reason,
        joinedContinuityStatus: event.joinedContinuityStatus, quoteConflictCount: pressure.conflict?.count ?? null });
    }
  }
  return seal(state);
}

export function cvdSemanticResult(checkpoint) {
  const s = validateCvdCheckpoint(checkpoint);
  const semantic = { schemaVersion: CVD_VERSION, sourceLedgerIdentity: s.sourceLedgerIdentity,
    resolverIdentity: s.resolverIdentity, cutoffLedgerOrdinal: s.ordinal, cutoffRecordHash: s.terminalHash,
    status: 'HISTORICAL_OFFLINE', value: s.segments.at(-1)?.value ?? null,
    availableAt: s.series.at(-1)?.availableAt ?? null, segments: s.segments, series: s.series, ...SAFETY };
  return { semantic, semanticHash: digest(stableJson(semantic)) };
}
