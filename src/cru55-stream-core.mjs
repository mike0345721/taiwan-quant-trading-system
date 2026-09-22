import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { materializeTxCanonicalObservations, buildExecutedPressureWindow,
  evaluateBestQuoteEligibility, timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';

// A NEW candidate state contract, not a compacted/resealed frozen checkpoint.
// The caller atomically persists every returned event/point and this checkpoint
// in immutable pages. This kernel neither discards that history nor verifies
// later mutations to bytes already archived: source archive authority remains
// an explicit candidate-store contract, not a claim of formal/LIVE integrity.
export const STREAM_VERSION = 'cru55-stream-cvd-state-v1';
export const STREAM_LIMITS = Object.freeze({ recordBytes: 8 * 1024 * 1024, checkpointBytes: 64 * 1024 });
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const source = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const identity = event => [event.actualContract, event.tradeDate, event.session, event.continuityEpoch];
const equal = (a, b) => stableJson(a) === stableJson(b);
const ordinal = n => Number.isSafeInteger(n) && n >= 0;
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function seal(state) {
  const bytes = stableJson(state);
  if (Buffer.byteLength(bytes) > STREAM_LIMITS.checkpointBytes) throw Error('STREAM_CHECKPOINT_BUDGET');
  return freeze({ state, stateHash: digest(bytes) });
}
export function createStreamCheckpoint(sourceIdentity, resolverIdentity) {
  if (!source(sourceIdentity) || typeof resolverIdentity !== 'string' || !resolverIdentity) throw Error('STREAM_SOURCE_REQUIRED');
  return seal({ schemaVersion: STREAM_VERSION, sourceLedgerIdentity: sourceIdentity, resolverIdentity,
    ordinal: 0, terminalHash: 'GENESIS', canonicalState: null,
    activeIdentity: null, activeSegment: null, segmentCount: 0, lastPoint: null,
    pendingSegment: true, quoteFenceOrdinal: 0, lastQuoteOrdinal: null,
    cutoffReceivedAt: null, snapshotAvailableAt: null, lastPhysicalMs: null, snapshotInvalid: false, ...SAFETY });
}
export function validateStreamCheckpoint(checkpoint) {
  const s = checkpoint?.state;
  if (!s || s.schemaVersion !== STREAM_VERSION || !source(s.sourceLedgerIdentity)
    || typeof s.resolverIdentity !== 'string' || !s.resolverIdentity
    || !ordinal(s.ordinal) || !ordinal(s.segmentCount) || s.segmentCount > s.ordinal
    || !ordinal(s.quoteFenceOrdinal) || s.quoteFenceOrdinal > s.ordinal
    || (s.lastQuoteOrdinal !== null && (!ordinal(s.lastQuoteOrdinal) || s.lastQuoteOrdinal <= s.quoteFenceOrdinal || s.lastQuoteOrdinal > s.ordinal))
    || (s.ordinal === 0 ? s.terminalHash !== 'GENESIS' : !hash(s.terminalHash) || !s.canonicalState)
    || typeof s.pendingSegment !== 'boolean' || typeof s.snapshotInvalid !== 'boolean'
    || (s.lastPhysicalMs !== null && !Number.isFinite(s.lastPhysicalMs))
    || (s.segmentCount === 0 ? s.activeSegment !== null || s.lastPoint !== null
      : !s.activeSegment || !s.lastPoint || s.lastPoint.segment !== s.segmentCount - 1
        || s.activeSegment.lastOrdinal !== s.lastPoint.ledgerOrdinal || s.lastPoint.ledgerOrdinal > s.ordinal)
    || Object.entries(SAFETY).some(([key, value]) => s[key] !== value)) throw Error('STREAM_CHECKPOINT_INVALID');
  const bytes = stableJson(s);
  if (Buffer.byteLength(bytes) > STREAM_LIMITS.checkpointBytes || checkpoint.stateHash !== digest(bytes)) throw Error('STREAM_CHECKPOINT_INVALID');
  return s;
}

// lookupQuote must query durable, same-source canonical history in descending
// physical ordinal and return the FIRST eligible quote after afterOrdinal.
// null means the query completed and found none, never an unavailable index.
// Query budgeting/continuations belong to the caller; throw if not complete.
export function appendStreamRecord(checkpoint, record, { resolveSessionTradeDate = null, lookupQuote } = {}) {
  const before = validateStreamCheckpoint(checkpoint);
  if (before.ordinal === Number.MAX_SAFE_INTEGER) throw Error('STREAM_ORDINAL_OVERFLOW');
  if (!record || typeof record !== 'object') throw Error('STREAM_RECORD_INVALID');
  const { recordHash, ...body } = record;
  const encoded = stableJson(body);
  if (Buffer.byteLength(encoded) > STREAM_LIMITS.recordBytes) throw Error('STREAM_RECORD_BUDGET');
  if (!hash(recordHash) || record.previousHash !== before.terminalHash
    || recordHash !== digest(`${before.terminalHash}\n${encoded}`)) throw Error('STREAM_RECORD_HASH_MISMATCH');
  const input = structuredClone(record), state = structuredClone(before);
  const canonical = materializeTxCanonicalObservations([input], {
    sourceLedgerIdentity: state.sourceLedgerIdentity, ledgerOrdinalOffset: state.ordinal,
    initialState: state.canonicalState, resolveSessionTradeDate,
  });
  const physicalMs = timestampMs(input.receivedAt);
  if (state.canonicalState && canonical.terminalState.epoch !== state.canonicalState.epoch) {
    state.lastPhysicalMs = null; state.snapshotInvalid = false;
  }
  if (physicalMs == null || (state.lastPhysicalMs != null && physicalMs < state.lastPhysicalMs)) state.snapshotInvalid = true;
  if (physicalMs != null) state.lastPhysicalMs = physicalMs;
  state.cutoffReceivedAt = input.receivedAt ?? null;
  state.snapshotAvailableAt = state.snapshotInvalid || canonical.terminalState.epochLineageInvalid ? null : state.cutoffReceivedAt;
  state.canonicalState = canonical.terminalState;
  state.ordinal += 1; state.terminalHash = recordHash;
  if (canonical.terminalState.breakPending) {
    state.pendingSegment = true; state.quoteFenceOrdinal = state.ordinal; state.lastQuoteOrdinal = null;
  }
  const event = canonical.events[0] ?? null;
  let point = null, pressure = null, segmentStarted = false;
  if (event) {
    const nextIdentity = identity(event);
    if (!equal(state.activeIdentity, nextIdentity)) {
      state.activeIdentity = nextIdentity; state.pendingSegment = true;
      state.quoteFenceOrdinal = event.ledgerOrdinal - 1; state.lastQuoteOrdinal = null;
    }
    if (event.kind === 'futures_bidask') state.lastQuoteOrdinal = event.ledgerOrdinal;
    else {
      let segment = state.activeSegment;
      if (!segment || state.pendingSegment) {
        segment = { identity: nextIdentity, startOrdinal: event.ledgerOrdinal,
          observedStart: event.eventTime, startAvailableAt: event.availableAt,
          sessionStartProven: false, scope: 'OBSERVED_FRAGMENT', captureCompleteness: 'UNPROVEN',
          nativeMissingSequenceCount: null, buyProxyVolume: 0, sellProxyVolume: 0,
          unknownVolume: 0, totalExecutedVolume: 0, tickCount: 0, invalidTickCount: 0,
          classificationConflictCount: 0, bestQuoteMatchedVolume: 0, reasons: [] };
        state.activeSegment = segment; state.segmentCount += 1; state.pendingSegment = false; segmentStarted = true;
      }
      let quote = null;
      if (state.lastQuoteOrdinal !== null) {
        if (typeof lookupQuote !== 'function') throw Error('STREAM_QUOTE_LOOKUP_REQUIRED');
        quote = lookupQuote(freeze(structuredClone(event)), Object.freeze({ afterOrdinal: state.quoteFenceOrdinal,
          beforeOrdinal: event.ledgerOrdinal, sourceLedgerIdentity: state.sourceLedgerIdentity }));
        if (quote !== null && (!quote || typeof quote !== 'object' || typeof quote.then === 'function'
          || quote.ledgerOrdinal <= state.quoteFenceOrdinal || quote.ledgerOrdinal > state.lastQuoteOrdinal
          || quote.sourceLedgerIdentity !== state.sourceLedgerIdentity
          || !evaluateBestQuoteEligibility(quote, event).eligible)) throw Error('STREAM_QUOTE_LOOKUP_INVALID');
        if (quote) quote = structuredClone(quote);
      }
      pressure = buildExecutedPressureWindow(quote ? [quote, event] : [event], event, { windowMs: 1 });
      const governed = resolveSessionTradeDate?.(event.eventTime, input);
      const boundaryInvalid = !['DAY', 'NIGHT'].includes(event.session)
        || (resolveSessionTradeDate && (governed?.session !== event.session || governed?.tradeDate !== event.tradeDate));
      if (pressure.totalExecutedVolume == null || !event.recordHash || boundaryInvalid) {
        segment.invalidTickCount += 1;
        segment.reasons = [...new Set([...segment.reasons, boundaryInvalid ? 'GOVERNED_SESSION_BOUNDARY_INVALID'
          : pressure.unavailableReason || 'CANONICAL_LINEAGE_INCOMPLETE'])];
      } else {
        for (const key of ['buyProxyVolume', 'sellProxyVolume', 'unknownVolume', 'totalExecutedVolume']) segment[key] += pressure[key];
        segment.classificationConflictCount += pressure.conflict.count;
        segment.bestQuoteMatchedVolume += pressure.bestQuoteCrossCheck.buyProxyVolume + pressure.bestQuoteCrossCheck.sellProxyVolume;
        segment.tickCount += 1;
        if (!Number.isFinite(segment.totalExecutedVolume)) throw Error('CVD_NUMERIC_OVERFLOW');
      }
      const classified = segment.buyProxyVolume + segment.sellProxyVolume;
      segment.classifiedCoverage = segment.totalExecutedVolume > 0 ? classified / segment.totalExecutedVolume : null;
      segment.value = segment.invalidTickCount || classified === 0 ? null : segment.buyProxyVolume - segment.sellProxyVolume;
      segment.quality = segment.invalidTickCount || segment.classifiedCoverage !== 1 ? 'QUALITY_INSUFFICIENT' : 'DESCRIPTIVE_ONLY';
      segment.reason = segment.reasons[0] || (classified === 0 ? 'NO_CLASSIFIED_VOLUME'
        : segment.classifiedCoverage !== 1 ? 'CLASSIFIED_COVERAGE_INCOMPLETE' : 'CAPTURE_COMPLETENESS_UNPROVEN');
      segment.lastOrdinal = event.ledgerOrdinal; segment.availableAt = event.availableAt; segment.eventTime = event.eventTime;
      point = { segment: state.segmentCount - 1, ledgerOrdinal: event.ledgerOrdinal,
        recordHash: event.recordHash, availableAt: event.availableAt, eventTime: event.eventTime,
        value: segment.value, buyProxyVolume: segment.buyProxyVolume, sellProxyVolume: segment.sellProxyVolume,
        unknownVolume: segment.unknownVolume, totalExecutedVolume: segment.totalExecutedVolume,
        classifiedCoverage: segment.classifiedCoverage, quality: segment.quality, reason: segment.reason,
        joinedContinuityStatus: event.joinedContinuityStatus, quoteConflictCount: pressure.conflict?.count ?? null };
      state.lastPoint = point;
    }
  }
  return freeze({ checkpoint: seal(state), event: event ? structuredClone(event) : null,
    point, pressure: pressure ? structuredClone(pressure) : null, segmentStarted });
}

// Current scalar truth only. History is in the caller's immutable point pages,
// never an incomplete array represented as a frozen full-history semanticHash.
export function streamCurrent(checkpoint) {
  const s = validateStreamCheckpoint(checkpoint), last = s.lastPoint;
  const invalid = s.pendingSegment || s.canonicalState?.epochLineageInvalid || s.snapshotInvalid;
  return freeze({ schemaVersion: 'cru55-stream-cvd-current-v1', sourceLedgerIdentity: s.sourceLedgerIdentity,
    resolverIdentity: s.resolverIdentity, cutoffLedgerOrdinal: s.ordinal, cutoffRecordHash: s.terminalHash,
    value: invalid ? null : last?.value ?? null, availableAt: s.snapshotAvailableAt,
    lastTradeAvailableAt: last?.availableAt ?? null, cutoffReceivedAt: s.cutoffReceivedAt,
    currentReason: invalid ? 'CONTINUITY_OR_LINEAGE_AWAITING_VALID_SEGMENT' : last?.reason ?? 'NO_LAWFUL_TRADE',
    activeIdentity: structuredClone(s.activeIdentity), segmentCount: s.segmentCount,
    captureCompleteness: 'UNPROVEN', nativeMissingSequenceCount: null, ...SAFETY });
}
