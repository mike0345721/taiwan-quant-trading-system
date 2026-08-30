import {
  buildExecutedPressureWindow,
  buildSnapshotLineage,
  materializeTxCanonicalObservations,
} from './tx-intraday-pressure-path-efficiency.mjs';
import { buildPriceResponsePathEfficiencyWindow } from './tx-price-response-path-efficiency.mjs';

export const PRIMARY_WINDOW_MS = 60_000;
export const CONTEXT_WINDOW_MS = 300_000;
export const MIN_PATH_TICK_COUNT = 3;
export const MAX_PATH_GAP_MS = 30_000;

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finitePositive(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function profileOf(instrumentProfile) {
  const tickSize = finitePositive(instrumentProfile?.tickSize);
  if (tickSize == null) throw new Error('CRU34_INSTRUMENT_TICK_SIZE_REQUIRED');
  const instrument = String(instrumentProfile?.instrument || 'TX');
  const product = String(instrumentProfile?.product || 'TX');
  const market = String(instrumentProfile?.market || 'TAIFEX');
  if (instrument !== 'TX' || product !== 'TX') {
    throw new Error('CRU34_V1_TX_REFERENCE_ONLY');
  }
  return Object.freeze({ instrument, product, market, tickSize });
}

function rawTxTick(record) {
  if (record?.kind !== 'futures_tick') return false;
  const payload = record?.payload || {};
  const family = nonEmptyText(payload.productFamily) || nonEmptyText(payload._product_family);
  if (family) return family === 'TX';
  const code = nonEmptyText(payload.actualContract) || nonEmptyText(payload.targetCode)
    || nonEmptyText(payload._target_code) || nonEmptyText(payload.code)
    || nonEmptyText(record?.code) || nonEmptyText(record?.product);
  return Boolean(code && /^TXF/i.test(code));
}

function effectiveCutoffOrdinal(records, requested) {
  if (requested != null) {
    if (!Number.isInteger(requested) || requested < 1) {
      throw new Error('CRU34_CUTOFF_LEDGER_ORDINAL_INVALID');
    }
    return requested;
  }
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (rawTxTick(records[index])) return index + 1;
  }
  return null;
}

function exactPhysicalPrefix(records, cutoffLedgerOrdinal) {
  if (cutoffLedgerOrdinal == null) return records;
  return records.slice(0, cutoffLedgerOrdinal);
}

function verifyPhysicalLedgerPrefix(records) {
  if (!records.length) {
    return Object.freeze({
      status: 'UNAVAILABLE_EMPTY_PREFIX',
      verified: false,
      recordCount: 0,
      terminalHash: null,
      failingLedgerOrdinal: null,
    });
  }
  let previousHash = 'GENESIS';
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const recordHash = nonEmptyText(record?.recordHash);
    const declaredPreviousHash = nonEmptyText(record?.previousHash);
    if (!recordHash || !declaredPreviousHash || declaredPreviousHash !== previousHash) {
      return Object.freeze({
        status: !recordHash || !declaredPreviousHash
          ? 'UNVERIFIED_HASH_CHAIN_FIELDS_MISSING'
          : 'INVALID_HASH_CHAIN_CONTINUITY',
        verified: false,
        recordCount: records.length,
        terminalHash: index > 0 ? nonEmptyText(records[index - 1]?.recordHash) : null,
        failingLedgerOrdinal: index + 1,
      });
    }
    previousHash = recordHash;
  }
  return Object.freeze({
    status: 'VERIFIED_CONTIGUOUS_HASH_CHAIN_PREFIX',
    verified: true,
    recordCount: records.length,
    terminalHash: previousHash,
    failingLedgerOrdinal: null,
  });
}

function unavailableWindow(windowMs, reason) {
  return Object.freeze({
    status: 'UNAVAILABLE',
    unavailableReason: reason,
    windowMs,
    pressure: Object.freeze({
      status: 'UNAVAILABLE',
      unavailableReason: reason,
      direction: 'UNAVAILABLE',
      pressureRatio: null,
      classifiedCoverage: null,
      relativeIntensity: 'RESEARCH_PENDING',
      controlObservationState: 'RESEARCH_PENDING',
    }),
    response: Object.freeze({
      status: 'UNAVAILABLE',
      unavailableReason: reason,
      displacementPoints: null,
      displacementTicks: null,
      directionRelation: 'PRESSURE_UNAVAILABLE',
    }),
    pathEfficiency: Object.freeze({
      status: 'UNAVAILABLE',
      value: null,
      unavailableReason: reason,
    }),
    quality: Object.freeze({ status: 'UNAVAILABLE', reasons: Object.freeze([reason]) }),
    supportingEvidence: Object.freeze([]),
    contraryEvidence: Object.freeze([]),
  });
}

function publicPressure(pressure) {
  const { usedEvents, ...result } = pressure;
  return Object.freeze(result);
}

function publicResponse(responseWindow) {
  const { usedEvents, ...result } = responseWindow;
  return Object.freeze({
    ...result.response,
    pathEfficiency: result.pathEfficiency,
    tickCount: result.tickCount,
    windowStatus: result.status,
    windowUnavailableReason: result.unavailableReason,
  });
}

function pressureDirectionalEvidenceEligible(pressure) {
  return pressure.status === 'READY'
    && pressure.pressureRatio != null
    && pressure.classifiedCoverage === 1;
}

function evidenceFor(pressure, responseWindow) {
  const supporting = [];
  const contrary = [];
  if (pressureDirectionalEvidenceEligible(pressure)) {
    if (responseWindow.response?.directionRelation === 'SAME_DIRECTION') {
      supporting.push(Object.freeze({ code: 'PRICE_RESPONSE_SAME_DIRECTION' }));
    } else if (responseWindow.response?.directionRelation === 'OPPOSITE_DIRECTION') {
      contrary.push(Object.freeze({ code: 'PRICE_RESPONSE_OPPOSITE_DIRECTION' }));
    }
  }
  if ((pressure.conflict?.count || 0) > 0) {
    contrary.push(Object.freeze({
      code: 'PROVIDER_BOOK_CLASSIFICATION_CONFLICT_PRESENT',
      count: pressure.conflict.count,
      rate: pressure.conflict.rate,
    }));
  }
  return {
    supportingEvidence: Object.freeze(supporting),
    contraryEvidence: Object.freeze(contrary),
  };
}

function qualityFor(pressure, responseWindow) {
  const reasons = [];
  if (pressure.status === 'QUALITY_INSUFFICIENT') {
    reasons.push(pressure.unavailableReason || 'PRESSURE_QUALITY_INSUFFICIENT');
  }
  if (pressure.classifiedCoverage != null && pressure.classifiedCoverage < 1) {
    reasons.push('PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  }
  if (responseWindow.status === 'QUALITY_INSUFFICIENT') {
    reasons.push(responseWindow.unavailableReason || 'RESPONSE_QUALITY_INSUFFICIENT');
  }
  if (responseWindow.pathEfficiency?.status === 'QUALITY_INSUFFICIENT') {
    reasons.push(responseWindow.pathEfficiency.unavailableReason || 'PATH_QUALITY_INSUFFICIENT');
  }
  const unavailable = pressure.status === 'UNAVAILABLE' && responseWindow.status === 'UNAVAILABLE';
  const partial = pressure.status !== 'READY'
    || pressure.pressureRatio == null
    || responseWindow.response?.status !== 'READY'
    || responseWindow.pathEfficiency?.status !== 'READY';
  const status = reasons.length ? 'QUALITY_INSUFFICIENT'
    : unavailable ? 'UNAVAILABLE'
      : partial ? 'PARTIAL' : 'READY';
  return Object.freeze({
    status,
    reasons: Object.freeze([...new Set(reasons)]),
    classifiedCoverage: pressure.classifiedCoverage ?? null,
    bestQuoteMatchedCoverage: pressure.bestQuoteCrossCheck?.matchedCoverage ?? null,
    classificationConflictRate: pressure.conflict?.rate ?? null,
    unknownVolume: pressure.unknownVolume ?? null,
  });
}

function buildWindow(events, cutoffEvent, profile, windowMs, options) {
  const pressure = buildExecutedPressureWindow(events, cutoffEvent, {
    windowMs,
    maxQuoteAgeMs: options.maxQuoteAgeMs,
  });
  const responseWindow = buildPriceResponsePathEfficiencyWindow(events, cutoffEvent, {
    windowMs,
    tickSize: profile.tickSize,
    pressureRatio: pressure.pressureRatio,
    minPathTickCount: options.minPathTickCount,
    maxGapMs: options.maxPathGapMs,
  });
  const evidence = evidenceFor(pressure, responseWindow);
  const quality = qualityFor(pressure, responseWindow);
  const publicResponseWindow = publicResponse(responseWindow);
  return {
    public: Object.freeze({
      status: quality.status,
      unavailableReason: quality.reasons[0] || pressure.unavailableReason
        || responseWindow.unavailableReason || responseWindow.pathEfficiency?.unavailableReason || null,
      windowMs,
      pressure: publicPressure(pressure),
      response: Object.freeze({
        status: publicResponseWindow.status,
        startPrice: publicResponseWindow.startPrice ?? null,
        endPrice: publicResponseWindow.endPrice ?? null,
        displacementPoints: publicResponseWindow.displacementPoints ?? null,
        displacementTicks: publicResponseWindow.displacementTicks ?? null,
        directionRelation: publicResponseWindow.directionRelation || 'PRESSURE_UNAVAILABLE',
      }),
      pathEfficiency: responseWindow.pathEfficiency,
      quality,
      ...evidence,
    }),
    usedEvents: Object.freeze([
      ...(pressure.usedEvents || []),
      ...(responseWindow.usedEvents || []),
    ]),
  };
}

function cutoffTick(events, cutoffLedgerOrdinal) {
  if (!events.length || cutoffLedgerOrdinal == null) return null;
  return events.find((event) => (
    event.ledgerOrdinal === cutoffLedgerOrdinal && event.kind === 'futures_tick'
  )) || null;
}

function unavailableSnapshot(
  profile,
  reason,
  cutoff = null,
  sourceLedgerIdentity = null,
  prefixProof = null,
) {
  return Object.freeze({
    schemaVersion: 'cru34-tx-intraday-research-snapshot-v1',
    status: 'UNAVAILABLE',
    unavailableReason: reason,
    identity: Object.freeze({
      instrument: profile.instrument,
      product: profile.product,
      market: profile.market,
      actualContract: cutoff?.actualContract || null,
      tradeDate: cutoff?.tradeDate || null,
      session: cutoff?.session || null,
      continuityEpoch: cutoff?.continuityEpoch || null,
      anchorEventTime: cutoff?.eventTime || null,
    }),
    lineage: Object.freeze({
      status: 'UNAVAILABLE',
      unavailableReason: reason,
      availableAt: cutoff?.availableAt || null,
      cutoffLedgerOrdinal: cutoff?.ledgerOrdinal || null,
      cutoffRecordHash: cutoff?.recordHash || null,
      maxUsedLedgerOrdinal: null,
      maxUsedRecordHash: null,
      sourceLedgerIdentity: cutoff?.sourceLedgerIdentity || sourceLedgerIdentity || null,
      inputPrefixStatus: prefixProof?.status || null,
      inputPrefixRecordCount: prefixProof?.recordCount ?? null,
      inputPrefixTerminalHash: prefixProof?.terminalHash || null,
      inputPrefixFailingLedgerOrdinal: prefixProof?.failingLedgerOrdinal ?? null,
    }),
    windows: Object.freeze({
      primary60s: unavailableWindow(PRIMARY_WINDOW_MS, reason),
      context300s: unavailableWindow(CONTEXT_WINDOW_MS, reason),
    }),
    quality: Object.freeze({ status: 'UNAVAILABLE', reasons: Object.freeze([reason]) }),
    supportingEvidence: Object.freeze([]),
    contraryEvidence: Object.freeze([]),
    methodology: Object.freeze({
      pressure: 'provider-side tick_type classification proxy; UNKNOWN preserved',
      response: 'first/last eligible TX Tick in physical ledger order',
      pathEfficiency: 'absolute net displacement divided by total absolute path; path directness only',
    }),
    limitations: Object.freeze([
      'Relative Intensity is not implemented.',
      'Formal Market Control and Absorption are not implemented.',
      'Market State is not generated by this engine.',
      'No trading direction, probability, confidence, strategy permission, or execution permission is produced.',
    ]),
    promotionState: Object.freeze({
      relativeIntensity: 'RESEARCH_PENDING',
      controlObservationState: 'RESEARCH_PENDING',
      absorption: 'RESEARCH_PENDING',
      marketState: 'NOT_PROVIDED',
    }),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function buildTxIntradayResearchSnapshot(records, {
  sourceLedgerIdentity,
  instrumentProfile,
  resolveSessionTradeDate = null,
  cutoffLedgerOrdinal = null,
  primaryWindowMs = PRIMARY_WINDOW_MS,
  contextWindowMs = CONTEXT_WINDOW_MS,
  maxQuoteAgeMs = 2_000,
  minPathTickCount = MIN_PATH_TICK_COUNT,
  maxPathGapMs = MAX_PATH_GAP_MS,
} = {}) {
  if (!Array.isArray(records)) throw new Error('CRU34_SNAPSHOT_RECORDS_REQUIRED');
  const profile = profileOf(instrumentProfile);
  if (primaryWindowMs !== PRIMARY_WINDOW_MS || contextWindowMs !== CONTEXT_WINDOW_MS) {
    throw new Error('CRU34_V1_WINDOW_CONTRACT_INVALID');
  }
  if (minPathTickCount !== MIN_PATH_TICK_COUNT || maxPathGapMs !== MAX_PATH_GAP_MS) {
    throw new Error('CRU34_V1_PATH_CONTRACT_INVALID');
  }

  const effectiveCutoff = effectiveCutoffOrdinal(records, cutoffLedgerOrdinal);
  const prefix = exactPhysicalPrefix(records, effectiveCutoff);
  const prefixProof = verifyPhysicalLedgerPrefix(prefix);
  if (!prefixProof.verified) {
    return unavailableSnapshot(
      profile,
      'PHYSICAL_LEDGER_PREFIX_UNVERIFIED',
      null,
      sourceLedgerIdentity,
      prefixProof,
    );
  }

  const canonical = materializeTxCanonicalObservations(prefix, {
    sourceLedgerIdentity,
    resolveSessionTradeDate,
  });
  const cutoff = cutoffTick(canonical.events, effectiveCutoff);
  if (!cutoff) {
    return unavailableSnapshot(
      profile,
      'NO_TX_TICK_CUTOFF',
      null,
      sourceLedgerIdentity,
      prefixProof,
    );
  }
  if (prefixProof.terminalHash !== cutoff.recordHash) {
    return unavailableSnapshot(
      profile,
      'CUTOFF_PREFIX_HASH_MISMATCH',
      cutoff,
      sourceLedgerIdentity,
      prefixProof,
    );
  }
  if (cutoff.identityStatus !== 'USABLE'
      || cutoff.availabilityLineageStatus !== 'USABLE'
      || !cutoff.recordHash) {
    return unavailableSnapshot(
      profile,
      'CUTOFF_LINEAGE_UNUSABLE',
      cutoff,
      sourceLedgerIdentity,
      prefixProof,
    );
  }

  const options = {
    maxQuoteAgeMs,
    minPathTickCount: MIN_PATH_TICK_COUNT,
    maxPathGapMs: MAX_PATH_GAP_MS,
  };
  const primary = buildWindow(canonical.events, cutoff, profile, PRIMARY_WINDOW_MS, options);
  const context = buildWindow(canonical.events, cutoff, profile, CONTEXT_WINDOW_MS, options);
  const allUsed = [...primary.usedEvents, ...context.usedEvents];
  const byOrdinal = new Map();
  for (const event of allUsed) byOrdinal.set(event.ledgerOrdinal, event);

  let lineage;
  try {
    lineage = Object.freeze({
      status: 'READY',
      unavailableReason: null,
      ...buildSnapshotLineage([...byOrdinal.values()], cutoff),
      inputPrefixStatus: prefixProof.status,
      inputPrefixRecordCount: prefixProof.recordCount,
      inputPrefixTerminalHash: prefixProof.terminalHash,
      inputPrefixFailingLedgerOrdinal: null,
    });
  } catch {
    return unavailableSnapshot(
      profile,
      'SNAPSHOT_LINEAGE_UNUSABLE',
      cutoff,
      sourceLedgerIdentity,
      prefixProof,
    );
  }

  const supportingEvidence = Object.freeze([
    ...primary.public.supportingEvidence.map((item) => Object.freeze({ window: 'PRIMARY_60S', ...item })),
    ...context.public.supportingEvidence.map((item) => Object.freeze({ window: 'CONTEXT_300S', ...item })),
  ]);
  const contraryEvidence = Object.freeze([
    ...primary.public.contraryEvidence.map((item) => Object.freeze({ window: 'PRIMARY_60S', ...item })),
    ...context.public.contraryEvidence.map((item) => Object.freeze({ window: 'CONTEXT_300S', ...item })),
  ]);
  const qualityReasons = Object.freeze([...new Set([
    ...primary.public.quality.reasons,
    ...context.public.quality.reasons,
  ])]);
  const qualityStatus = qualityReasons.length ? 'QUALITY_INSUFFICIENT'
    : primary.public.status === 'READY' && context.public.status === 'READY'
      ? 'READY' : 'PARTIAL';
  const partialReason = qualityReasons[0]
    || (primary.public.status !== 'READY' ? primary.public.unavailableReason : null)
    || (context.public.status !== 'READY' ? context.public.unavailableReason : null)
    || null;

  return Object.freeze({
    schemaVersion: 'cru34-tx-intraday-research-snapshot-v1',
    status: qualityStatus,
    unavailableReason: partialReason,
    identity: Object.freeze({
      instrument: profile.instrument,
      product: profile.product,
      market: profile.market,
      actualContract: cutoff.actualContract,
      tradeDate: cutoff.tradeDate,
      session: cutoff.session,
      continuityEpoch: cutoff.continuityEpoch,
      anchorEventTime: cutoff.eventTime,
    }),
    lineage,
    windows: Object.freeze({
      primary60s: primary.public,
      context300s: context.public,
    }),
    quality: Object.freeze({
      status: qualityStatus,
      reasons: qualityReasons,
      classifiedCoveragePrimary60s: primary.public.quality.classifiedCoverage,
      classifiedCoverageContext300s: context.public.quality.classifiedCoverage,
      bestQuoteMatchedCoveragePrimary60s: primary.public.quality.bestQuoteMatchedCoverage,
      bestQuoteMatchedCoverageContext300s: context.public.quality.bestQuoteMatchedCoverage,
      classificationConflictRatePrimary60s: primary.public.quality.classificationConflictRate,
      classificationConflictRateContext300s: context.public.quality.classificationConflictRate,
    }),
    supportingEvidence,
    contraryEvidence,
    methodology: Object.freeze({
      pressure: 'provider-side tick_type classification proxy; UNKNOWN preserved; directional response evidence requires complete classified coverage in V1',
      response: 'first/last eligible TX Tick in physical ledger order',
      pathEfficiency: 'absolute net displacement divided by total absolute path; path directness only; minimum 3 ticks and maximum 30000ms adjacent event-time gap',
      observationOrder: 'physical append-only ledger order',
      availableAt: 'durable ledger receivedAt wall-clock lineage',
      inputPrefix: 'full unfiltered contiguous hash-chained physical ledger prefix ending at cutoff Tick',
    }),
    limitations: Object.freeze([
      'Relative Intensity is not implemented.',
      'Formal Market Control and Absorption are not implemented.',
      'Market State is not generated by this engine.',
      'Incomplete provider classification coverage remains quality-insufficient; no sub-100% readiness threshold is authorized in V1.',
      'Best-quote cross-check uses eligible best bid/ask only; it is not five-level liquidity pressure.',
      'No trading direction, probability, confidence, strategy permission, or execution permission is produced.',
    ]),
    promotionState: Object.freeze({
      relativeIntensity: 'RESEARCH_PENDING',
      controlObservationState: 'RESEARCH_PENDING',
      absorption: 'RESEARCH_PENDING',
      marketState: 'NOT_PROVIDED',
    }),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}
