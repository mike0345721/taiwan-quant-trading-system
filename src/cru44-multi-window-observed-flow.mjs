import {
  buildTxIntradayResearchSnapshot,
  buildTxObservedFlowWindow,
  MAX_PATH_GAP_MS,
  MIN_PATH_TICK_COUNT,
} from './tx-intraday-research-snapshot.mjs';
import { materializeTxCanonicalObservations } from './tx-intraday-pressure-path-efficiency.mjs';
import { buildCru34SemanticPayload } from './cru34-snapshot-artifact.mjs';
import { cru34LiveHash } from './cru34-live-checkpoint.mjs';

export const CRU44_MULTI_WINDOW_SCHEMA_VERSION = 'cru44-multi-window-observed-flow-v1';

export const CRU44_WINDOW_REGISTRY = Object.freeze({
  primary60s: Object.freeze({ key: '1m', label: '1m', windowMs: 60_000, warmupMs: 60_000,
    sessionPolicy: 'SAME_GOVERNED_SESSION', tradeDatePolicy: 'SAME_TRADE_DATE',
    continuityPolicy: 'SAME_CONTINUITY_EPOCH', version: 1, compatibilityAnchor: true }),
  context300s: Object.freeze({ key: '5m', label: '5m', windowMs: 300_000, warmupMs: 300_000,
    sessionPolicy: 'SAME_GOVERNED_SESSION', tradeDatePolicy: 'SAME_TRADE_DATE',
    continuityPolicy: 'SAME_CONTINUITY_EPOCH', version: 1, compatibilityAnchor: true }),
  window900s: Object.freeze({ key: '15m', label: '15m', windowMs: 900_000, warmupMs: 900_000,
    sessionPolicy: 'SAME_GOVERNED_SESSION', tradeDatePolicy: 'SAME_TRADE_DATE',
    continuityPolicy: 'SAME_CONTINUITY_EPOCH', version: 1, compatibilityAnchor: false }),
  window1800s: Object.freeze({ key: '30m', label: '30m', windowMs: 1_800_000, warmupMs: 1_800_000,
    sessionPolicy: 'SAME_GOVERNED_SESSION', tradeDatePolicy: 'SAME_TRADE_DATE',
    continuityPolicy: 'SAME_CONTINUITY_EPOCH', version: 1, compatibilityAnchor: false }),
});

function sameIdentity(event, cutoff) {
  return event.actualContract === cutoff.actualContract && event.tradeDate === cutoff.tradeDate
    && event.session === cutoff.session && event.continuityEpoch === cutoff.continuityEpoch;
}

function warmupSpan(events, cutoff) {
  const first = events.find((event) => event.kind === 'futures_tick' && sameIdentity(event, cutoff));
  return first ? Math.max(0, cutoff.availableMs - first.availableMs) : 0;
}

function windowEnvelope(events, cutoff, profile, definition, sourceTruthState = 'LIVE') {
  const rawObservedSpanMs = warmupSpan(events, cutoff);
  const observedSpanMs = Math.min(rawObservedSpanMs, definition.warmupMs);
  if (rawObservedSpanMs < definition.warmupMs) {
    return Object.freeze({
      key: definition.key, label: definition.label, windowMs: definition.windowMs,
      truthState: 'WARMING_UP', unavailableReason: 'WARMING_UP_WINDOW_INCOMPLETE',
      observedSpanMs, requiredSpanMs: definition.warmupMs, evidence: null,
    });
  }
  const result = buildTxObservedFlowWindow(events, cutoff, profile, definition.windowMs, {
    maxQuoteAgeMs: 2_000,
    minPathTickCount: MIN_PATH_TICK_COUNT,
    maxPathGapMs: MAX_PATH_GAP_MS,
  });
  return Object.freeze({
    key: definition.key, label: definition.label, windowMs: definition.windowMs,
    truthState: sourceTruthState === 'STALE' ? 'STALE' : 'LIVE',
    unavailableReason: null, observedSpanMs, requiredSpanMs: definition.warmupMs,
    evidence: result.public,
  });
}

function safety() {
  return { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
}

export function buildCru44MultiWindowFromCanonical({
  canonicalEvents,
  cutoffLedgerOrdinal,
  instrumentProfile = { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 },
  sourceTruthState = 'LIVE',
  compatibilitySemanticHash = null,
} = {}) {
  if (!Array.isArray(canonicalEvents) || !canonicalEvents.length) {
    throw new Error('CRU44_CANONICAL_EVENTS_REQUIRED');
  }
  const cutoff = canonicalEvents.find((event) => event.kind === 'futures_tick'
    && event.ledgerOrdinal === cutoffLedgerOrdinal);
  if (!cutoff || cutoff.identityStatus !== 'USABLE' || cutoff.availabilityLineageStatus !== 'USABLE') {
    throw new Error('CRU44_CUTOFF_LINEAGE_UNUSABLE');
  }
  const body = {
    schemaVersion: CRU44_MULTI_WINDOW_SCHEMA_VERSION,
    registryVersion: 1,
    registry: CRU44_WINDOW_REGISTRY,
    identity: {
      instrument: instrumentProfile.instrument || 'TX', actualContract: cutoff.actualContract,
      tradeDate: cutoff.tradeDate, session: cutoff.session, continuityEpoch: cutoff.continuityEpoch,
    },
    lineage: {
      availableAt: cutoff.availableAt, cutoffLedgerOrdinal: cutoff.ledgerOrdinal,
      cutoffRecordHash: cutoff.recordHash, sourceLedgerIdentity: cutoff.sourceLedgerIdentity,
      observationOrder: 'PHYSICAL_APPEND_ORDER',
    },
    compatibility: {
      cru34SemanticPayloadHash: compatibilitySemanticHash,
      primary60sUnchanged: true,
      context300sUnchanged: true,
    },
    windows: {
      window900s: windowEnvelope(canonicalEvents, cutoff, instrumentProfile,
        CRU44_WINDOW_REGISTRY.window900s, sourceTruthState),
      window1800s: windowEnvelope(canonicalEvents, cutoff, instrumentProfile,
        CRU44_WINDOW_REGISTRY.window1800s, sourceTruthState),
    },
    methodology: {
      pressureResponsePath: 'CRU-34 frozen semantics reused',
      maxPathGapMs: MAX_PATH_GAP_MS,
      observationOrder: 'physical append-only ledger order; never eventTime sort',
      boundary: 'same actualContract + tradeDate + session + continuityEpoch',
    },
    ...safety(),
  };
  return Object.freeze({ ...body, contentHash: cru34LiveHash(body) });
}

export function buildCru44MultiWindowReference(records, options = {}) {
  const ordinalOffset = options.ledgerOrdinalOffset || 0;
  const requestedCutoff = options.cutoffLedgerOrdinal;
  const governedRecords = Number.isInteger(requestedCutoff)
    ? records.slice(0, Math.max(0, requestedCutoff - ordinalOffset))
    : records;
  const compatibilitySnapshot = buildTxIntradayResearchSnapshot(governedRecords, options);
  const compatibilityPayload = buildCru34SemanticPayload(compatibilitySnapshot, {
    tickSize: options.instrumentProfile?.tickSize,
    sourceMode: options.sourceMode || 'LIVE',
  });
  const cutoffLedgerOrdinal = compatibilitySnapshot.lineage.cutoffLedgerOrdinal;
  const prefix = governedRecords.slice(0, cutoffLedgerOrdinal - ordinalOffset);
  const canonical = materializeTxCanonicalObservations(prefix, {
    sourceLedgerIdentity: options.sourceLedgerIdentity,
    resolveSessionTradeDate: options.resolveSessionTradeDate || null,
    ledgerOrdinalOffset: ordinalOffset,
    initialState: options.initialCanonicalState || null,
  });
  return Object.freeze({
    compatibilitySnapshot,
    compatibilityPayload,
    multiWindow: buildCru44MultiWindowFromCanonical({
      canonicalEvents: canonical.events,
      cutoffLedgerOrdinal,
      instrumentProfile: options.instrumentProfile,
      sourceTruthState: options.sourceTruthState || 'LIVE',
      compatibilitySemanticHash: cru34LiveHash(compatibilityPayload),
    }),
  });
}
