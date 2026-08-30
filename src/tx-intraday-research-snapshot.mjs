import {
  buildExecutedPressureWindow,
  buildSnapshotLineage,
  materializeTxCanonicalObservations,
} from './tx-intraday-pressure-path-efficiency.mjs';
import { buildPriceResponsePathEfficiencyWindow } from './tx-price-response-path-efficiency.mjs';

export const PRIMARY_WINDOW_MS = 60_000;
export const CONTEXT_WINDOW_MS = 300_000;

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

function evidenceFor(pressure, responseWindow) {
  const supporting = [];
  const contrary = [];
  if (pressure.direction === 'BUY_SIDE' || pressure.direction === 'SELL_SIDE') {
    supporting.push(Object.freeze({
      code: 'EXECUTED_PRESSURE_DIRECTION_OBSERVED',
      direction: pressure.direction,
      pressureRatio: pressure.pressureRatio,
      classifiedCoverage: pressure.classifiedCoverage,
    }));
  }
  if (responseWindow.response?.directionRelation === 'SAME_DIRECTION') {
    supporting.push(Object.freeze({ code: 'PRICE_RESPONSE_SAME_DIRECTION' }));
  } else if (responseWindow.response?.directionRelation === 'OPPOSITE_DIRECTION') {
    contrary.push(Object.freeze({ code: 'PRICE_RESPONSE_OPPOSITE_DIRECTION' }));
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
  if (responseWindow.status === 'QUALITY_INSUFFICIENT') {
    reasons.push(responseWindow.unavailableReason || 'RESPONSE_QUALITY_INSUFFICIENT');
  }
  if (responseWindow.pathEfficiency?.status === 'QUALITY_INSUFFICIENT') {
    reasons.push(responseWindow.pathEfficiency.unavailableReason || 'PATH_QUALITY_INSUFFICIENT');
  }
  const unavailable = pressure.status === 'UNAVAILABLE' && responseWindow.status === 'UNAVAILABLE';
  const partial = pressure.status !== 'READY'
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
        || responseWindow.unavailableReason || null,
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

function exactPhysicalPrefix(records, cutoffLedgerOrdinal) {
  if (cutoffLedgerOrdinal == null) return records;
  if (!Number.isInteger(cutoffLedgerOrdinal) || cutoffLedgerOrdinal < 1) {
    throw new Error('CRU34_CUTOFF_LEDGER_ORDINAL_INVALID');
  }
  return records.slice(0, cutoffLedgerOrdinal);
}

function cutoffTick(events, cutoffLedgerOrdinal) {
  if (!events.length) return null;
  if (cutoffLedgerOrdinal == null) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].kind === 'futures_tick') return events[index];
    }
    return null;
  }
  return events.find((event) => (
    event.ledgerOrdinal === cutoffLedgerOrdinal && event.kind === 'futures_tick'
  )) || null;
}

function unavailableSnapshot(profile, reason, cutoff = null) {
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
      sourceLedgerIdentity: cutoff?.sourceLedgerIdentity || null,
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
  minPathTickCount = 3,
  maxPathGapMs = 30_000,
} = {}) {
  if (!Array.isArray(records)) throw new Error('CRU34_SNAPSHOT_RECORDS_REQUIRED');
  const profile = profileOf(instrumentProfile);
  if (primaryWindowMs !== PRIMARY_WINDOW_MS || contextWindowMs !== CONTEXT_WINDOW_MS) {
    throw new Error('CRU34_V1_WINDOW_CONTRACT_INVALID');
  }
  const prefix = exactPhysicalPrefix(records, cutoffLedgerOrdinal);
  const canonical = materializeTxCanonicalObservations(prefix, {
    sourceLedgerIdentity,
    resolveSessionTradeDate,
  });
  const cutoff = cutoffTick(canonical.events, cutoffLedgerOrdinal);
  if (!cutoff) return unavailableSnapshot(profile, 'NO_TX_TICK_CUTOFF');
  if (cutoff.identityStatus !== 'USABLE'
      || cutoff.availabilityLineageStatus !== 'USABLE'
      || !cutoff.recordHash) {
    return unavailableSnapshot(profile, 'CUTOFF_LINEAGE_UNUSABLE', cutoff);
  }

  const options = { maxQuoteAgeMs, minPathTickCount, maxPathGapMs };
  const primary = buildWindow(canonical.events, cutoff, profile, PRIMARY_WINDOW_MS, options);
  const context = buildWindow(canonical.events, cutoff, profile, CONTEXT_WINDOW_MS, options);
  const allUsed = [...primary.usedEvents, ...context.usedEvents];
  const byOrdinal = new Map();
  for (const event of allUsed) byOrdinal.set(event.ledgerOrdinal, event);

  let lineage;
  try {
    lineage = Object.freeze({ status: 'READY', unavailableReason: null,
      ...buildSnapshotLineage([...byOrdinal.values()], cutoff) });
  } catch {
    return unavailableSnapshot(profile, 'SNAPSHOT_LINEAGE_UNUSABLE', cutoff);
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

  return Object.freeze({
    schemaVersion: 'cru34-tx-intraday-research-snapshot-v1',
    status: qualityStatus,
    unavailableReason: qualityReasons[0] || null,
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
      pressure: 'provider-side tick_type classification proxy; UNKNOWN preserved',
      response: 'first/last eligible TX Tick in physical ledger order',
      pathEfficiency: 'absolute net displacement divided by total absolute path; path directness only',
      observationOrder: 'physical append-only ledger order',
      availableAt: 'durable ledger receivedAt wall-clock lineage',
    }),
    limitations: Object.freeze([
      'Relative Intensity is not implemented.',
      'Formal Market Control and Absorption are not implemented.',
      'Market State is not generated by this engine.',
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
