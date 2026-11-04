import crypto from 'node:crypto';
import { materializeTxCanonicalObservations, buildExecutedPressureWindow, createBestQuoteLookup, timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';

// Selectively adapted from accepted CRU-50 core @ 6c8f35b. Classification stays in CRU-34.
export const CVD_VERSION = 'cru54-cvd-observation-state-v1';
export const SAFETY = Object.freeze({ formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false });
export const LIMITS = Object.freeze({ batchBytes: 8 * 1024 * 1024, batchRecords: 25_000,
  stateRecords: 250_000, quoteCount: 25_000, artifactBytes: 128 * 1024 * 1024, durationMs: 30_000 });
export function stableJson(value) {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(value));
}
export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Same JSON bytes as stableJson for persisted JSON values, without a second
// full object graph and giant string during legacy-cache verification.
export function stableJsonDigest(value) {
  const hash=crypto.createHash('sha256');let buffer='';
  const emit=text=>{buffer+=text;if(buffer.length>=32768){hash.update(buffer);buffer='';}};
  const visit=x=>{
    if(Array.isArray(x)){emit('[');x.forEach((v,i)=>{if(i)emit(',');visit(v);});emit(']');}
    else if(x&&typeof x==='object'){
      emit('{');const keys=Object.keys(Object.fromEntries(Object.keys(x).sort().map(k=>[k,null])));
      keys.forEach((key,i)=>{if(i)emit(',');emit(JSON.stringify(key)+':');visit(x[key]);});emit('}');
    }else emit(JSON.stringify(x));
  };
  visit(value);if(buffer)hash.update(buffer);return hash.digest('hex');
}
const seal = state => ({ state, stateHash: digest(stableJson(state)) });
const identity = e => [e.actualContract, e.tradeDate, e.session, e.continuityEpoch];
export function createCvdCheckpoint(sourceLedgerIdentity, resolverIdentity) {
  if (!/^sha256:[a-f0-9]{64}$/.test(sourceLedgerIdentity || '') || !resolverIdentity) throw new Error('CVD_SOURCE_REQUIRED');
  return seal({ schemaVersion: CVD_VERSION, sourceLedgerIdentity, resolverIdentity,
    ordinal: 0, terminalHash: 'GENESIS', canonicalState: null, quotes: [], segments: [], series: [],
    activeIdentity: null, pendingSegment: true, cutoffReceivedAt: null, snapshotAvailableAt: null,
    lastPhysicalMs: null, snapshotAvailabilityInvalid: false, ...SAFETY });
}
export function validateCvdCheckpoint(checkpoint) {
  const s = checkpoint?.state;
  if (!s || s.schemaVersion !== CVD_VERSION || checkpoint.stateHash !== digest(stableJson(s))
      || !Number.isSafeInteger(s.ordinal) || s.ordinal < 0 || s.ordinal > LIMITS.stateRecords
      || !/^sha256:[a-f0-9]{64}$/.test(s.sourceLedgerIdentity || '') || !s.resolverIdentity
      || !Array.isArray(s.quotes) || s.quotes.length > LIMITS.quoteCount
      || !Array.isArray(s.segments) || !Array.isArray(s.series) || s.series.length > s.ordinal
      || Object.entries(SAFETY).some(([k, v]) => s[k] !== v)
      || (s.ordinal > 0 && (!s.canonicalState || !/^[a-f0-9]{64}$/.test(s.terminalHash)))) {
    throw new Error('CVD_CHECKPOINT_INVALID');
  }
  return s;
}

// Shared canonical accumulator: caller owns a private working clone. Classification remains CRU34.
export function accumulateCanonicalCvdEvents(state, events, { resolveSessionTradeDate = null, record = null, storage = null } = {}) {
    const quoteFor = storage ? tick => ({quote:storage.quoteFor(tick)}) : events.some(event => event.kind === 'futures_tick')
      ? createBestQuoteLookup([...state.quotes, ...events], { maxQuoteAgeMs: 2000 }) : null;
    let quoteFloor = storage ? (state.quoteFloor ?? events[0]?.ledgerOrdinal ?? Infinity)
      : state.quotes[0]?.ledgerOrdinal ?? events[0]?.ledgerOrdinal ?? Infinity;
    for (const event of events) {
      const nextIdentity = identity(event);
      if (stableJson(state.activeIdentity) !== stableJson(nextIdentity)) {
        state.activeIdentity = nextIdentity; state.pendingSegment = true;
        // Identity change is an explicit new observation segment, including a quote-only boundary.
        state.quotes = [];
        quoteFloor = event.ledgerOrdinal;
        if (storage) state.quoteFloor = quoteFloor;
      }
      if (event.kind === 'futures_bidask') {
        if (storage) { storage.appendQuote(event); continue; }
        if (state.quotes.length >= LIMITS.quoteCount) throw new Error('CVD_QUOTE_STATE_BUDGET');
        state.quotes.push(event); continue;
      }
      let segment = state.segments.at(-1);
      if (!segment || state.pendingSegment) {
        segment = { identity: nextIdentity, startOrdinal: event.ledgerOrdinal,
          observedStart: event.eventTime, startAvailableAt: event.availableAt,
          sessionStartProven: false, scope: 'OBSERVED_FRAGMENT', captureCompleteness: 'UNPROVEN',
          nativeMissingSequenceCount: null, buyProxyVolume: 0, sellProxyVolume: 0,
          unknownVolume: 0, totalExecutedVolume: 0, tickCount: 0, invalidTickCount: 0,
          classificationConflictCount: 0, bestQuoteMatchedVolume: 0, reasons: [] };
        state.segments.push(segment); state.pendingSegment = false;
      }
      // The frozen selector already enforces physical order, age, identity and
      // availability. An identity-return cannot reuse quotes cleared in between.
      const selected = quoteFor?.(event)?.quote;
      const quote = selected && selected.ledgerOrdinal >= quoteFloor ? selected : null;
      const pressure = buildExecutedPressureWindow(quote ? [quote, event] : [event], event, { windowMs: 1 });
      // Canonical fields remain untouched. Contradictory explicit identity is rejected at this consumer boundary.
      const governed = resolveSessionTradeDate?.(event.eventTime, record);
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
      if (storage) {
        storage.appendPoint(state.series.at(-1));
        // The complete series is committed by the caller in the same transaction.
        // This terminal witness is sufficient for the next cumulative update.
        state.series = state.series.slice(-1);
      }
    }
  return state;
}

// A timeframe is deliberately not an accumulator input. Only new physical suffix records advance it.
export function appendCvdRecords(checkpoint, records, { sourceLedgerIdentity, ledgerOrdinalOffset,
  resolveSessionTradeDate = null, resolverIdentity, maxRecords = LIMITS.batchRecords, deadline = Infinity } = {}) {
  const before = validateCvdCheckpoint(checkpoint);
  if (sourceLedgerIdentity !== before.sourceLedgerIdentity || resolverIdentity !== before.resolverIdentity) throw new Error('CVD_SOURCE_MISMATCH');
  if (ledgerOrdinalOffset !== before.ordinal) throw new Error('CVD_ORDINAL_MISMATCH');
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > LIMITS.batchRecords
      || !Array.isArray(records) || records.length > maxRecords || before.ordinal + records.length > LIMITS.stateRecords) throw new Error('CVD_RECORD_BUDGET');
  const state = structuredClone(before);
  for (const record of records) {
    if (Date.now() > deadline) throw new Error('CVD_DURATION_BUDGET');
    const { recordHash, ...body } = record;
    if (record.previousHash !== state.terminalHash
        || recordHash !== digest(`${state.terminalHash}\n${stableJson(body)}`)) throw new Error('CVD_RECORD_HASH_MISMATCH');
    const canonical = materializeTxCanonicalObservations([record], {
      sourceLedgerIdentity, ledgerOrdinalOffset: state.ordinal, initialState: state.canonicalState, resolveSessionTradeDate,
    });
    const physicalMs = timestampMs(record.receivedAt);
    if (state.canonicalState && canonical.terminalState.epoch !== state.canonicalState.epoch) {
      state.lastPhysicalMs = null; state.snapshotAvailabilityInvalid = false;
    }
    if (physicalMs == null || (state.lastPhysicalMs != null && physicalMs < state.lastPhysicalMs)) state.snapshotAvailabilityInvalid = true;
    if (physicalMs != null) state.lastPhysicalMs = physicalMs;
    state.cutoffReceivedAt = record.receivedAt ?? null;
    state.snapshotAvailableAt = state.snapshotAvailabilityInvalid || canonical.terminalState.epochLineageInvalid
      ? null : state.cutoffReceivedAt;
    state.canonicalState = canonical.terminalState;
    state.ordinal += 1;
    state.terminalHash = recordHash;
    // A break observed after the last trade must also invalidate the current value until a new segment exists.
    if (canonical.terminalState.breakPending) { state.pendingSegment = true; state.quotes = []; }
    accumulateCanonicalCvdEvents(state, canonical.events, { resolveSessionTradeDate, record });
  }
  return seal(state);
}
export function cvdSemanticResult(checkpoint) {
  return canonicalCvdSemanticResult(validateCvdCheckpoint(checkpoint));
}

// Both consumers validate their own envelope before invoking this shared projection.
export function canonicalCvdSemanticResult(s, { sourceMode = 'ISOLATED_READ_ONLY_LEDGER' } = {}) {
  const last = s.series.at(-1);
  const invalidTail = s.pendingSegment || s.canonicalState?.epochLineageInvalid || s.snapshotAvailabilityInvalid;
  const semantic = { schemaVersion: 'cru54-cvd-observation-snapshot-v1', sourceLedgerIdentity: s.sourceLedgerIdentity,
    resolverIdentity: s.resolverIdentity, cutoffLedgerOrdinal: s.ordinal, cutoffRecordHash: s.terminalHash,
    sourceMode, status: 'OBSERVATION_CANDIDATE',
    value: invalidTail ? null : last?.value ?? null, availableAt: s.snapshotAvailableAt,
    lastTradeAvailableAt: last?.availableAt ?? null, cutoffReceivedAt: s.cutoffReceivedAt,
    currentReason: invalidTail ? 'CONTINUITY_OR_LINEAGE_AWAITING_VALID_SEGMENT' : last?.reason ?? 'NO_LAWFUL_TRADE',
    activeIdentity: s.activeIdentity, captureCompleteness: 'UNPROVEN', nativeMissingSequenceCount: null,
    segments: s.segments, series: s.series, ...SAFETY };
  return { semantic, semanticHash: digest(stableJson(semantic)) };
}
