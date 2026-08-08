import crypto from 'node:crypto';

export const PP1_POLICY_VERSION = 'PP1_MARKET_SEMANTICS_V1';
export const OWNER_QUALITY_POLICY = 'OWNER_POLICY_V1';

export const LINEAGE_MODES = Object.freeze({
  LIVE: 'LIVE',
  HISTORICAL_REPLAY: 'HISTORICAL_REPLAY',
  OFFICIAL_BATCH: 'OFFICIAL_BATCH',
});

export const CONTRACT_ROLES = Object.freeze([
  'NEAREST_ELIGIBLE_MONTH',
  'NEXT_MONTHLY',
  'OBSERVED_LIQUIDITY_LEAD',
  'SESSION_FROZEN_LIQUIDITY_LEAD',
  'SELECTED_RESEARCH',
  'SELECTED_TRADING',
]);

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`PP1_REQUIRED:${label}`);
  return value.trim();
}

function epoch(value, label) {
  const parsed = Date.parse(requireText(value, label));
  if (!Number.isFinite(parsed)) throw new Error(`PP1_INVALID_TIMESTAMP:${label}`);
  return parsed;
}

function iso(value, label) { return new Date(epoch(value, label)).toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function maxIso(values) {
  const present = values.filter(Boolean);
  if (!present.length) throw new Error('PP1_AVAILABLE_AT_INPUT_REQUIRED');
  return new Date(Math.max(...present.map((value, index) => epoch(value, `availableAt[${index}]`)))).toISOString();
}

export function buildTimestampLineage(input) {
  const mode = requireText(input?.lineageMode, 'lineageMode');
  if (!Object.values(LINEAGE_MODES).includes(mode)) throw new Error(`PP1_LINEAGE_MODE_UNKNOWN:${mode}`);
  const exchangeTimestamp = input.exchangeTimestamp ? iso(input.exchangeTimestamp, 'exchangeTimestamp') : null;
  const sourcePublishedAt = input.sourcePublishedAt ? iso(input.sourcePublishedAt, 'sourcePublishedAt') : null;
  const receivedTimestamp = input.receivedTimestamp ? iso(input.receivedTimestamp, 'receivedTimestamp') : null;
  const replayAvailableAt = input.replayAvailableAt ? iso(input.replayAvailableAt, 'replayAvailableAt') : null;
  const officialAvailableAt = input.officialAvailableAt ? iso(input.officialAvailableAt, 'officialAvailableAt') : null;
  if (mode === LINEAGE_MODES.LIVE && (!exchangeTimestamp || !receivedTimestamp)) {
    throw new Error('PP1_LINEAGE_LIVE_REQUIRES_EXCHANGE_AND_RECEIVED');
  }
  if (mode === LINEAGE_MODES.HISTORICAL_REPLAY && (!exchangeTimestamp || !replayAvailableAt)) {
    throw new Error('PP1_LINEAGE_REPLAY_REQUIRES_EXCHANGE_AND_REPLAY_AVAILABLE');
  }
  if (mode === LINEAGE_MODES.OFFICIAL_BATCH && !sourcePublishedAt && !officialAvailableAt) {
    throw new Error('PP1_LINEAGE_BATCH_REQUIRES_PUBLICATION_EVIDENCE');
  }
  const modeAvailableAt = mode === LINEAGE_MODES.LIVE
    ? receivedTimestamp
    : mode === LINEAGE_MODES.HISTORICAL_REPLAY ? replayAvailableAt : (sourcePublishedAt || officialAvailableAt);
  const necessaryInputAvailableAts = (input.necessaryInputAvailableAts || []).map((value, index) => iso(value, `necessaryInputAvailableAts[${index}]`));
  const featureAvailableAt = maxIso([modeAvailableAt, ...necessaryInputAvailableAts]);
  return Object.freeze({
    lineageMode: mode,
    exchangeTimestamp,
    sourcePublishedAt,
    receivedTimestamp,
    replayAvailableAt,
    officialAvailableAt,
    necessaryInputAvailableAts,
    featureAvailableAt,
  });
}

export function canonicalContractIdentity({ provider, providerCode, providerAlias = null, product = 'TX' }) {
  const normalized = requireText(providerCode, 'providerCode').replaceAll(' ', '').toUpperCase();
  const match = normalized.match(/^(?:TX)?(20\d{4})$/);
  if (!match) throw new Error(`PP1_UNKNOWN_CONTRACT:${normalized}`);
  return Object.freeze({
    canonicalContractId: `${product.toUpperCase()}-${match[1]}`,
    exchange: 'TAIFEX',
    product: product.toUpperCase(),
    contractCode: match[1],
    contractMonth: match[1],
    provider: requireText(provider, 'provider'),
    providerCode: normalized,
    providerAlias: providerAlias || null,
  });
}

export function classifySession(eventTimestamp, calendarSnapshot) {
  const eventMs = epoch(eventTimestamp, 'eventTimestamp');
  const sessions = calendarSnapshot?.sessions || [];
  const match = sessions.find((session) => eventMs >= epoch(session.sessionStart, 'sessionStart')
    && eventMs <= epoch(session.sessionEnd, 'sessionEnd'));
  if (!match) throw new Error('PP1_SESSION_UNKNOWN');
  return Object.freeze({
    calendarDate: new Date(eventMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
    tradeDate: match.sessionTradeDate,
    sessionTradeDate: match.sessionTradeDate,
    sessionId: requireText(match.sessionId, 'sessionId'),
    sessionType: requireText(match.sessionType, 'sessionType'),
    sessionStart: iso(match.sessionStart, 'sessionStart'),
    sessionEnd: iso(match.sessionEnd, 'sessionEnd'),
    crossMidnight: new Date(match.sessionStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
      !== new Date(match.sessionEnd).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
    isSettlementTradeDate: Boolean(match.isSettlementTradeDate),
    calendarSourceHash: requireText(calendarSnapshot.sourceDataHash, 'calendarSourceHash'),
  });
}

export function eligibleMonthlyContracts(contracts, sessionStart) {
  const at = epoch(sessionStart, 'sessionStart');
  return contracts
    .filter((item) => item.product === 'TX' && /^20\d{4}$/.test(item.contractCode)
      && epoch(item.finalTradingTimestamp, 'finalTradingTimestamp') >= at)
    .sort((left, right) => left.contractMonth.localeCompare(right.contractMonth));
}

function selectionRecord(base, role, contract, extras = {}) {
  return Object.freeze({
    selectionId: hash([base.selectionSetId, role, contract?.contractCode || null]),
    selectionSetId: base.selectionSetId,
    sessionId: base.sessionId,
    contractRole: role,
    canonicalContractId: contract?.canonicalContractId || null,
    contractCode: contract?.contractCode || null,
    contractMonth: contract?.contractMonth || null,
    selectedAt: base.selectedAt,
    effectiveFrom: base.effectiveFrom,
    effectiveUntil: base.effectiveUntil,
    selectionReason: extras.selectionReason || null,
    fallbackReason: extras.fallbackReason || null,
    qualityState: extras.qualityState || (contract ? 'PASS' : 'UNAVAILABLE'),
    tradeEligible: Boolean(extras.tradeEligible),
    sourceDataHash: base.sourceDataHash,
    policySpecHash: base.policySpecHash,
    policyVersion: base.policyVersion,
    isFinalTradingSessionForSelectedContract: Boolean(contract?.finalTradingTimestamp
      && epoch(contract.finalTradingTimestamp, 'finalTradingTimestamp') <= epoch(base.effectiveUntil, 'effectiveUntil')),
    selectedContractExpiryDate: contract?.expiryDate || null,
    selectedContractFinalTradingTimestamp: contract?.finalTradingTimestamp || null,
    timestampLineage: base.timestampLineage,
  });
}

export function buildContractSelectionSet({
  sessionContext,
  contracts,
  completedReferenceVolumes,
  previousFrozenContractCode = null,
  selectedAt,
  policySpecHash,
  policyVersion = PP1_POLICY_VERSION,
  sourceDataHash,
  timestampLineage,
}) {
  const eligible = eligibleMonthlyContracts(contracts, sessionContext.sessionStart);
  const nearest = eligible[0] || null;
  const next = eligible[1] || null;
  const selectionSetId = hash([sessionContext.sessionId, selectedAt, policySpecHash, sourceDataHash]);
  const base = {
    selectionSetId,
    sessionId: sessionContext.sessionId,
    selectedAt: iso(selectedAt, 'selectedAt'),
    effectiveFrom: sessionContext.sessionStart,
    effectiveUntil: sessionContext.sessionEnd,
    policySpecHash: requireText(policySpecHash, 'policySpecHash'),
    policyVersion,
    sourceDataHash: requireText(sourceDataHash, 'sourceDataHash'),
    timestampLineage: buildTimestampLineage(timestampLineage),
  };
  const candidates = [nearest, next].filter(Boolean);
  const volumeAvailable = candidates.length === 2
    && candidates.every((item) => Number.isFinite(Number(completedReferenceVolumes?.[item.contractCode])));
  let observed = null;
  let observedReason = null;
  let fallbackReason = null;
  if (volumeAvailable) {
    const [a, b] = candidates;
    const av = Number(completedReferenceVolumes[a.contractCode]);
    const bv = Number(completedReferenceVolumes[b.contractCode]);
    const denominator = Math.max(av, bv);
    if (denominator > 0 && Math.abs(av - bv) / denominator > 0.05) {
      observed = av > bv ? a : b;
      observedReason = 'COMPLETED_REFERENCE_SESSION_VOLUME_LEAD_GT_5PCT';
    } else {
      observedReason = 'VOLUME_TIE_WITHIN_5PCT';
    }
  } else {
    observedReason = 'REFERENCE_VOLUME_UNAVAILABLE';
  }
  const previous = candidates.find((item) => item.contractCode === previousFrozenContractCode) || null;
  const frozen = observed || previous || nearest;
  if (!observed) fallbackReason = previous ? 'TIE_OR_UNAVAILABLE_KEEP_PREVIOUS_SESSION' : 'FALLBACK_NEAREST_ELIGIBLE';
  const qualityState = volumeAvailable ? 'PASS' : 'UNAVAILABLE';
  const researchTradeEligible = Boolean(frozen);
  const tradingTradeEligible = Boolean(frozen && volumeAvailable);
  const records = [
    selectionRecord(base, 'NEAREST_ELIGIBLE_MONTH', nearest, { selectionReason: 'EARLIEST_NOT_FINISHED', tradeEligible: false }),
    selectionRecord(base, 'NEXT_MONTHLY', next, { selectionReason: 'SECOND_EARLIEST_NOT_FINISHED', tradeEligible: false }),
    selectionRecord(base, 'OBSERVED_LIQUIDITY_LEAD', observed, { selectionReason: observedReason, qualityState, tradeEligible: false }),
    selectionRecord(base, 'SESSION_FROZEN_LIQUIDITY_LEAD', frozen, { selectionReason: observed ? observedReason : 'POLICY_FALLBACK', fallbackReason, qualityState, tradeEligible: tradingTradeEligible }),
    selectionRecord(base, 'SELECTED_RESEARCH', frozen, { selectionReason: 'T0_V1_EQUALS_SESSION_FROZEN_LIQUIDITY_LEAD', fallbackReason, qualityState, tradeEligible: researchTradeEligible }),
    selectionRecord(base, 'SELECTED_TRADING', frozen, { selectionReason: 'T0_V1_EQUALS_SESSION_FROZEN_LIQUIDITY_LEAD', fallbackReason, qualityState, tradeEligible: tradingTradeEligible }),
  ];
  return Object.freeze({
    selectionSetId,
    sessionId: sessionContext.sessionId,
    policySpecHash: base.policySpecHash,
    policyVersion,
    records,
  });
}

export function closeQuality(sessionType, closeAgeSeconds) {
  const age = Number(closeAgeSeconds);
  if (!Number.isFinite(age) || age < 0) return 'UNAVAILABLE';
  if (sessionType === 'DAY') return age <= 2 ? 'PASS' : age <= 10 ? 'DEGRADED' : 'UNAVAILABLE';
  if (sessionType === 'NIGHT') return age <= 20 ? 'PASS' : age <= 60 ? 'DEGRADED' : 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

export function buildGapObservation({ definition, source, target, timestampLineage }) {
  const lineage = buildTimestampLineage(timestampLineage);
  const base = {
    gapObservationId: hash([definition, source.sessionId, target.sessionId, source.contractCode, target.contractCode]),
    gapDefinition: definition,
    sourceSessionId: source.sessionId,
    sourceTradeDate: source.tradeDate,
    sourceContractCode: source.contractCode,
    targetSessionId: target.sessionId,
    targetTradeDate: target.tradeDate,
    targetContractCode: target.contractCode,
    thresholdPolicyStatus: OWNER_QUALITY_POLICY,
    optimizedOnTradingTarget: false,
    timestampLineage: lineage,
  };
  if (source.contractCode !== target.contractCode) {
    return Object.freeze({ ...base, gapState: 'ROLL_TRANSITION', rawGap: null, qualityState: 'UNAVAILABLE', descriptiveOnly: true, tradeEligible: false });
  }
  const delay = (epoch(target.exchangeTimestamp, 'target.exchangeTimestamp') - epoch(target.sessionStart, 'target.sessionStart')) / 1000;
  const sourceQuality = closeQuality(source.sessionType, source.closeAgeSeconds);
  if (target.openingType === 'FIRST_LEGAL_TRADE' && delay > 60) {
    return Object.freeze({ ...base, gapState: 'TARGET_DELAYED', rawGap: null, qualityState: 'UNAVAILABLE', descriptiveOnly: true, tradeEligible: false });
  }
  const openingQuality = target.openingType === 'OPENING_AUCTION' && delay === 0
    ? 'PASS' : target.openingType === 'FIRST_LEGAL_TRADE' && delay <= 60 ? 'DEGRADED' : 'UNAVAILABLE';
  const qualityState = sourceQuality === 'PASS' && openingQuality === 'PASS'
    ? 'PASS' : sourceQuality !== 'UNAVAILABLE' && openingQuality !== 'UNAVAILABLE' ? 'DEGRADED' : 'UNAVAILABLE';
  const rawGap = qualityState === 'UNAVAILABLE' ? null : Number(target.openPrice) - Number(source.closePrice);
  return Object.freeze({
    ...base,
    gapState: qualityState === 'UNAVAILABLE' ? 'SOURCE_OR_TARGET_UNAVAILABLE' : 'AVAILABLE',
    rawGap,
    qualityState,
    descriptiveOnly: qualityState !== 'PASS',
    tradeEligible: qualityState === 'PASS',
  });
}

export function buildContinuousSeries(points, { baseIndex = 1000, seriesAsOf, adjustmentKnowledgeAt, asOfReconstruction = 'TRUE_AS_OF', revisionNumber = 1 } = {}) {
  const sorted = [...points].sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
  const unadjusted = sorted.map((point) => ({ ...point, continuousValue: Number(point.price), seriesType: 'CONTINUOUS_UNADJUSTED' }));
  let index = baseIndex;
  let prior = null;
  const returnLinked = sorted.map((point) => {
    if (prior && prior.contractCode === point.contractCode) index *= Number(point.price) / Number(prior.price);
    const result = { ...point, continuousValue: index, seriesType: 'CONTINUOUS_RETURN_LINKED_INDEX', historicalModelEligible: true };
    prior = point;
    return result;
  });
  const rollAdjustments = [];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1].contractCode !== sorted[i].contractCode) {
      if (!Number.isFinite(Number(sorted[i].rollOldReferencePrice)) || !Number.isFinite(Number(sorted[i].rollNewReferencePrice))) continue;
      rollAdjustments.push({ index: i, points: Number(sorted[i].rollNewReferencePrice) - Number(sorted[i].rollOldReferencePrice) });
    }
  }
  const backAdjusted = sorted.map((point, indexValue) => {
    const futureAdjustment = rollAdjustments.filter((roll) => roll.index > indexValue).reduce((sum, roll) => sum + roll.points, 0);
    const eligible = asOfReconstruction === 'TRUE_AS_OF';
    return {
      ...point,
      continuousValue: Number(point.price) + futureAdjustment,
      seriesType: 'CONTINUOUS_BACK_ADJUSTED_POINTS',
      seriesAsOf: seriesAsOf || null,
      adjustmentKnowledgeAt: adjustmentKnowledgeAt || null,
      asOfReconstruction,
      revisionNumber,
      historicalModelEligible: eligible,
    };
  });
  return Object.freeze({ unadjusted, backAdjusted, returnLinked });
}

export function adaptLegacyIntradayArchive(payload, { calendarSnapshot, provider = 'LEGACY_ARCHIVE', replayAvailableAt }) {
  if (!payload?.contract || !payload?.session || !Array.isArray(payload?.bars)) throw new Error('PP1_LEGACY_ARCHIVE_INVALID');
  const identity = canonicalContractIdentity({ provider, providerCode: payload.contract });
  const first = payload.bars[0];
  if (!first?.timestamp) throw new Error('PP1_LEGACY_ARCHIVE_EMPTY');
  const sessionContext = classifySession(first.timestamp, calendarSnapshot);
  const adapted = payload.bars.map((bar) => ({
    ...bar,
    calendarDate: new Date(bar.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
    tradeDate: sessionContext.tradeDate,
    sessionTradeDate: sessionContext.sessionTradeDate,
    sessionId: sessionContext.sessionId,
    sessionType: sessionContext.sessionType,
    contractCode: identity.contractCode,
    contractMonth: identity.contractMonth,
    sourceType: 'HISTORICAL_OHLCV',
    timestampLineage: buildTimestampLineage({
      lineageMode: LINEAGE_MODES.HISTORICAL_REPLAY,
      exchangeTimestamp: bar.timestamp,
      replayAvailableAt,
    }),
    qualityState: bar.complete === false ? 'DEGRADED' : 'PASS',
  }));
  return Object.freeze({ identity, sessionContext, bars: adapted });
}

