const FRESHNESS_STATES = Object.freeze([
  'LIVE',
  'FRESH',
  'DELAYED',
  'STALE',
  'SESSION_CLOSED',
  'UNAVAILABLE',
]);

const SOURCE_STATES = Object.freeze(['SOURCE_AVAILABLE', 'PARTIAL', 'SOURCE_MISSING']);
const READINESS_STATES = Object.freeze([
  'READY',
  'DERIVATION_NOT_IMPLEMENTED',
  'DERIVATION_FAILURE',
  'QUALITY_INSUFFICIENT',
  'CONTRACT_NOT_FROZEN',
  'RAW_VALIDATED_CANDIDATE',
]);

export const DATA_HEALTH_ENUMS = Object.freeze({
  freshnessState: FRESHNESS_STATES,
  sourceAvailability: SOURCE_STATES,
  readinessState: READINESS_STATES,
});

function iso(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function sourceFreshness(source, now) {
  if (!source?.ok) return 'UNAVAILABLE';
  if (source.stale === true || source.freshness === 'stale') return 'STALE';
  const availableAt = iso(source.fetchedAt || source.availableAt);
  if (!availableAt) return 'DELAYED';
  const ageMs = now.getTime() - Date.parse(availableAt);
  if (ageMs < -1_000) return 'UNAVAILABLE';
  if (ageMs <= 15 * 60_000) return 'FRESH';
  if (source.release && /收盤後|時段結束後|交易日/.test(source.release)) return 'SESSION_CLOSED';
  return ageMs <= 24 * 60 * 60_000 ? 'DELAYED' : 'STALE';
}

function record({
  sourceId,
  sourceType,
  instrument = null,
  actualContract = null,
  session = null,
  sessionState = 'UNAVAILABLE',
  exchangeTimestamp = null,
  receivedAt = null,
  availableAt = null,
  freshnessState = 'UNAVAILABLE',
  reason = null,
  quality = 'UNAVAILABLE',
  coverage = null,
  startup = 'UNKNOWN',
  reconnect = 'UNKNOWN',
  lineage = null,
  sourceAvailability = 'SOURCE_MISSING',
  readinessState = 'QUALITY_INSUFFICIENT',
  subscriptionState = 'NOT_APPLICABLE',
  simtradeState = 'NOT_APPLICABLE',
  restorationState = 'NOT_APPLICABLE',
  promotionState = 'NOT_PROMOTED',
}) {
  if (!FRESHNESS_STATES.includes(freshnessState)) throw new Error('DATA_HEALTH_FRESHNESS_INVALID');
  if (!SOURCE_STATES.includes(sourceAvailability)) throw new Error('DATA_HEALTH_SOURCE_AVAILABILITY_INVALID');
  if (!READINESS_STATES.includes(readinessState)) throw new Error('DATA_HEALTH_READINESS_INVALID');
  return Object.freeze({
    sourceId,
    sourceType,
    instrument,
    actualContract,
    session,
    sessionState,
    exchangeTimestamp: iso(exchangeTimestamp),
    receivedAt: iso(receivedAt),
    availableAt: iso(availableAt),
    freshnessState,
    reason,
    quality,
    coverage,
    startup,
    reconnect,
    lineage,
    sourceAvailability,
    readinessState,
    subscriptionState,
    simtradeState,
    restorationState,
    promotionState,
  });
}

function batchRecord(sourceId, sourceType, source, now, options = {}) {
  const freshnessState = sourceFreshness(source, now);
  const available = Boolean(source?.ok);
  return record({
    sourceId,
    sourceType,
    instrument: options.instrument || null,
    actualContract: options.actualContract || null,
    session: options.session || 'EOD',
    sessionState: freshnessState === 'SESSION_CLOSED' ? 'SESSION_CLOSED' : 'OFFICIAL_BATCH',
    receivedAt: source?.fetchedAt,
    availableAt: source?.fetchedAt,
    freshnessState,
    reason: available ? null : (source?.error || 'SOURCE_NOT_AVAILABLE'),
    quality: available ? (source.stale ? 'DEGRADED' : 'PASS') : 'UNAVAILABLE',
    coverage: source?.scope || null,
    startup: 'AUTO_START',
    reconnect: 'UNKNOWN',
    lineage: source?.source || null,
    sourceAvailability: available ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: available ? 'READY' : 'QUALITY_INSUFFICIENT',
  });
}

function auditedLiveRecord(sourceId, kind, instrument, auditContract, actualContract, bridge, audit, now) {
  const kindCount = Number(audit?.acceptance?.requiredKindCounts?.[auditContract]?.[kind] || 0);
  const capabilityAvailable = audit?.acceptance?.status === 'PASS' && kindCount > 0;
  const connected = bridge?.connected === true && bridge?.safetyVerified === true;
  const lastReceivedAt = iso(bridge?.latestReceivedAt);
  const ageMs = lastReceivedAt ? now.getTime() - Date.parse(lastReceivedAt) : Infinity;
  const freshnessState = connected
    ? (ageMs <= 60_000 ? 'LIVE' : ageMs <= 5 * 60_000 ? 'DELAYED' : 'STALE')
    : 'UNAVAILABLE';
  const continuity = bridge?.continuity || {};
  const dataTrustReady = continuity.dataTrust === 'PASS';
  return record({
    sourceId,
    sourceType: kind === 'tick' ? 'EXECUTED_TRADE_EVENTS' : 'BIDASK_EVENTS',
    instrument,
    actualContract: actualContract || auditContract || null,
    session: bridge?.marketSession?.state || null,
    sessionState: bridge?.marketSession?.state || 'UNAVAILABLE',
    receivedAt: lastReceivedAt,
    availableAt: lastReceivedAt,
    freshnessState,
    reason: connected ? (dataTrustReady ? null : 'TIMESTAMP_LINEAGE_INSUFFICIENT') : (continuity.reasonCode || bridge?.error || 'LIVE_BRIDGE_NOT_CONNECTED'),
    quality: connected ? (dataTrustReady ? 'PASS' : 'QUALITY_INSUFFICIENT') : capabilityAvailable ? 'HISTORICAL_CAPABILITY_ONLY' : 'UNAVAILABLE',
    coverage: capabilityAvailable ? `${kindCount} accepted audit events` : null,
    startup: 'AUTO_START',
    reconnect: continuity.state === 'RECOVERING' ? 'RECOVERING'
      : continuity.state === 'HEALTHY' && continuity.lastHealthyAt ? 'BOUNDED_RECOVERY_READY'
        : audit?.acceptance?.checks?.reconnectEvidence ? 'RESTART_EVIDENCE_ONLY' : 'UNKNOWN',
    lineage: audit?.ledgerFile || 'Shioaji market-data-only bridge',
    sourceAvailability: capabilityAvailable ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: connected && dataTrustReady ? 'READY' : 'QUALITY_INSUFFICIENT',
  });
}

function continuityRecord(bridge) {
  const continuity = bridge?.continuity || {};
  const healthy = bridge?.connected === true && continuity.state === 'HEALTHY';
  const trustReady = continuity.dataTrust === 'PASS';
  return record({
    sourceId: 'shioajiContinuity',
    sourceType: 'MARKET_DATA_RUNTIME_CONTINUITY',
    session: bridge?.marketSession?.state || null,
    sessionState: continuity.state || 'UNAVAILABLE',
    receivedAt: continuity.lastHealthyAt || bridge?.checkedAt || null,
    availableAt: continuity.lastHealthyAt || bridge?.checkedAt || null,
    freshnessState: healthy ? 'FRESH' : continuity.state === 'RECOVERING' ? 'DELAYED' : 'UNAVAILABLE',
    reason: healthy ? (trustReady ? null : 'TIMESTAMP_LINEAGE_INSUFFICIENT') : continuity.reasonCode || bridge?.error || 'BRIDGE_HEALTH_UNAVAILABLE',
    quality: continuity.dataTrust || 'UNAVAILABLE',
    coverage: Array.isArray(continuity.requiredSubscriptions)
      ? continuity.requiredSubscriptions.map((item) => `${item.product}:${item.state}`).join(', ')
      : null,
    startup: continuity.recoveryLimit ? 'AUTO_START' : 'UNKNOWN',
    reconnect: continuity.state === 'RECOVERING' ? 'RECOVERING' : continuity.recoveryResult === 'RECOVERED' ? 'AUTO_RECONNECT' : 'UNKNOWN',
    lineage: 'Shioaji market-data-only bridge health allowlist',
    sourceAvailability: bridge?.safetyVerified === true ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: healthy && trustReady ? 'READY' : 'QUALITY_INSUFFICIENT',
  });
}

function txoCollectionRecord(bridge) {
  const txo = bridge?.txoCollection || {};
  const enabled = txo.enabled === true;
  const healthy = enabled && txo.collectorState === 'HEALTHY'
    && txo.expectedSubscriptionCount > 0
    && txo.restoredSubscriptionCount === txo.expectedSubscriptionCount;
  return record({
    sourceId: 'txoLiveChainRaw',
    sourceType: 'SHIOAJI_TXO_LIVE_CHAIN_RAW',
    instrument: 'TXO',
    receivedAt: txo.lastQuoteAt || null,
    availableAt: txo.lastQuoteAt || null,
    freshnessState: healthy ? 'LIVE' : 'UNAVAILABLE',
    reason: healthy ? 'RAW_ONLY_NOT_PROMOTED' : enabled ? 'TXO_COLLECTION_DEGRADED' : 'PRODUCTION_ACTIVATION_NOT_APPROVED',
    quality: healthy ? 'RESEARCH_ONLY' : 'UNAVAILABLE',
    coverage: `${txo.restoredSubscriptionCount || 0}/${txo.expectedSubscriptionCount || 0} subscriptions`,
    startup: 'DEFAULT_OFF',
    reconnect: 'USES_EXISTING_SINGLE_BRIDGE',
    lineage: 'Shioaji TXO Tick/BidAsk; raw only; no IV promotion',
    sourceAvailability: 'SOURCE_AVAILABLE',
    readinessState: healthy ? 'RAW_VALIDATED_CANDIDATE'
      : enabled ? 'QUALITY_INSUFFICIENT' : 'CONTRACT_NOT_FROZEN',
  });
}

function liveBreadthRecord(liveBreadth) {
  const observation = liveBreadth?.observation;
  const sourceAvailable = Boolean(observation);
  const rawCandidate = liveBreadth?.state === 'LIVE' || liveBreadth?.state === 'EOD_CONTEXT';
  return record({
    sourceId: 'ix0001LiveBreadth',
    sourceType: 'SHIOAJI_IX0001_LIVE_RAW_BREADTH',
    instrument: 'IX0001',
    actualContract: 'IX0001',
    session: observation?.session || null,
    sessionState: liveBreadth?.state || 'UNAVAILABLE',
    exchangeTimestamp: observation?.eventTime || null,
    receivedAt: observation?.receivedAt || null,
    availableAt: observation?.availableAt || null,
    freshnessState: liveBreadth?.freshnessState || 'UNAVAILABLE',
    reason: liveBreadth?.reasonCode || null,
    quality: observation?.qualityStatus === 'AVAILABLE' ? 'PASS'
      : sourceAvailable ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE',
    coverage: observation?.tradeDate ? `${observation.tradeDate}:${observation.session}` : null,
    startup: 'REUSES_EXISTING_8790_CALLBACK',
    reconnect: 'USES_EXISTING_SINGLE_BRIDGE',
    lineage: 'SHIOAJI_INDEX_QUOTE_IX0001',
    sourceAvailability: sourceAvailable ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: rawCandidate ? 'RAW_VALIDATED_CANDIDATE' : 'QUALITY_INSUFFICIENT',
  });
}

function indexLeadershipRecord(indexLeadership, key) {
  const item = indexLeadership?.dataHealth?.[key] || {};
  const sourceAvailable = item.sourceAvailability === 'SOURCE_AVAILABLE';
  const restored = item.subscriptionState === 'RESTORED';
  return record({
    sourceId: key,
    sourceType: item.sourceType || (key === 'ix0001IndexContribution'
      ? 'SHIOAJI_IX0001_INDEX_CONTRIBUTION' : 'SHIOAJI_IX0001_INDUSTRY_CONTRIBUTION'),
    instrument: 'IX0001',
    actualContract: 'IX0001',
    session: 'DAY',
    sessionState: indexLeadership?.state || 'UNAVAILABLE',
    receivedAt: item.availableAt || null,
    availableAt: item.availableAt || null,
    freshnessState: item.freshnessState || 'UNAVAILABLE',
    reason: indexLeadership?.reasonCode || (sourceAvailable ? null : 'LIVE_DAY_EVENT_ACCEPTANCE_PENDING'),
    quality: item.quality || 'UNAVAILABLE',
    coverage: item.tradeDate ? `${item.tradeDate}:DAY` : null,
    startup: 'REUSES_EXISTING_8790_CALLBACK',
    reconnect: item.reconnectState || 'USES_EXISTING_SINGLE_BRIDGE',
    lineage: key === 'ix0001IndexContribution'
      ? 'SHIOAJI_INDEX_CONTRIBUTION_IX0001' : 'SHIOAJI_INDUSTRY_CONTRIBUTION_IX0001',
    sourceAvailability: sourceAvailable ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: sourceAvailable && restored ? 'RAW_VALIDATED_CANDIDATE' : 'QUALITY_INSUFFICIENT',
    subscriptionState: item.subscriptionState || 'UNKNOWN',
    simtradeState: item.simtradeState || 'NO_LIVE_EVENT',
    restorationState: item.restorationState || 'PENDING',
    promotionState: 'NOT_PROMOTED',
  });
}

function soxResearchContextRecord(globalContext) {
  const sox = globalContext?.latest?.find((row) => row.symbol === 'SOX') || null;
  return record({
    sourceId: 'soxResearchContext',
    sourceType: 'SOX_EOD_RESEARCH_CONTEXT',
    instrument: 'SOX',
    session: 'EOD',
    sessionState: 'SESSION_CLOSED',
    receivedAt: sox?.availableAt || null,
    availableAt: sox?.availableAt || null,
    freshnessState: sox ? 'DELAYED' : 'UNAVAILABLE',
    reason: sox ? 'EOD_DELAYED_RESEARCH_CONTEXT' : 'SOX_RESEARCH_CONTEXT_UNAVAILABLE',
    quality: sox ? 'PASS' : 'UNAVAILABLE',
    coverage: sox?.tradeDate || null,
    startup: 'DAILY_UPDATE',
    reconnect: 'NOT_APPLICABLE',
    lineage: sox?.source || null,
    sourceAvailability: sox ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState: sox ? 'READY' : 'QUALITY_INSUFFICIENT',
  });
}

function derivedRecord(sourceId, sourceType, sourceIds, reason = 'DERIVATION_NOT_IMPLEMENTED') {
  return record({
    sourceId,
    sourceType,
    freshnessState: 'UNAVAILABLE',
    reason,
    quality: 'NOT_IMPLEMENTED',
    coverage: `Required sources: ${sourceIds.join(', ')}`,
    startup: 'UNKNOWN',
    reconnect: 'UNKNOWN',
    lineage: sourceIds,
    sourceAvailability: 'SOURCE_AVAILABLE',
    readinessState: 'DERIVATION_NOT_IMPLEMENTED',
  });
}

function runtimeRecord(runtimeTruth) {
  if (!runtimeTruth?.governed) {
    return record({
      sourceId: 'forwardShadowRuntime',
      sourceType: 'GOVERNED_RUNTIME_STATUS',
      freshnessState: 'UNAVAILABLE',
      reason: runtimeTruth?.reason || 'RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD',
      quality: 'UNAVAILABLE',
      sourceAvailability: 'SOURCE_MISSING',
      readinessState: 'QUALITY_INSUFFICIENT',
      lineage: runtimeTruth?.lineage || null,
    });
  }
  const tasksReady = runtimeTruth.stateTask?.enabled === true && runtimeTruth.outcomeTask?.enabled === true;
  return record({
    sourceId: 'forwardShadowRuntime',
    sourceType: 'GOVERNED_RUNTIME_STATUS',
    session: runtimeTruth.stateRecord?.sessionId || null,
    sessionState: runtimeTruth.stateRecord?.qualityStatus || 'SCHEDULED',
    receivedAt: runtimeTruth.checkedAt,
    availableAt: runtimeTruth.checkedAt,
    freshnessState: tasksReady ? 'FRESH' : 'UNAVAILABLE',
    reason: tasksReady ? null : 'RUNTIME_TASK_STATUS_UNAVAILABLE',
    quality: tasksReady ? 'PASS' : 'PARTIAL',
    coverage: runtimeTruth.runId || null,
    startup: tasksReady ? 'AUTO_START' : 'UNKNOWN',
    reconnect: 'UNKNOWN',
    lineage: runtimeTruth.lineage,
    sourceAvailability: 'SOURCE_AVAILABLE',
    readinessState: tasksReady ? 'READY' : 'QUALITY_INSUFFICIENT',
  });
}

function chartDerivedRecord(sourceId, sourceType, chart, {
  ready = false,
  reason = null,
  now = new Date(),
} = {}) {
  const hasSource = chart?.sourceEventCount > 0;
  const availableAt = iso(chart?.availableAt);
  const ageMs = availableAt ? now.getTime() - Date.parse(availableAt) : Infinity;
  const qualityReady = ready && chart?.qualityStatus === 'PASS';
  const readinessState = qualityReady
    ? 'READY'
    : chart?.status === 'OWNER_DECISION_REQUIRED'
      ? 'CONTRACT_NOT_FROZEN'
      : ready
        ? 'QUALITY_INSUFFICIENT'
        : 'DERIVATION_FAILURE';
  const freshnessState = ready
    ? ageMs <= 60_000 ? 'LIVE' : ageMs <= 5 * 60_000 ? 'DELAYED' : 'STALE'
    : 'UNAVAILABLE';
  return record({
    sourceId,
    sourceType,
    instrument: 'TX',
    actualContract: chart?.actualContract || null,
    session: chart?.session || null,
    sessionState: chart?.sessionId || 'UNAVAILABLE',
    exchangeTimestamp: chart?.lastEventTime,
    receivedAt: availableAt,
    availableAt,
    freshnessState,
    reason: qualityReady ? null : ready ? 'CHART_QUALITY_INSUFFICIENT' : (reason || chart?.reason || 'DERIVATION_FAILURE'),
    quality: ready ? chart?.qualityStatus || 'PASS' : 'UNAVAILABLE',
    coverage: chart?.bars ? `${chart.bars.length} ${chart.timeframe || ''} bars` : null,
    startup: 'ON_DEMAND',
    reconnect: 'USES_EXISTING_TX_TICK_LEDGER',
    lineage: chart?.source || 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    sourceAvailability: hasSource ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    readinessState,
  });
}

export function buildDataHealthContract({
  snapshot = {}, service = {}, runtimeTruth = null, futuresAudit = null, chart = null,
  liveBreadth = null, indexLeadership = null, globalContext = null, now = new Date(),
} = {}) {
  const actualContract = snapshot?.futuresMarket?.data?.txDay?.contract || null;
  const txCode = futuresAudit?.productFamilies?.TX?.targetCode || null;
  const mtxCode = futuresAudit?.productFamilies?.MTX?.targetCode || null;
  const tmfCode = futuresAudit?.productFamilies?.TMF?.targetCode || null;
  const bridge = service?.brokerMarketData || {};
  const sources = snapshot.sources || {};

  const items = [
    runtimeRecord(runtimeTruth),
    continuityRecord(bridge),
    txoCollectionRecord(bridge),
    liveBreadthRecord(liveBreadth),
    indexLeadershipRecord(indexLeadership, 'ix0001IndexContribution'),
    indexLeadershipRecord(indexLeadership, 'ix0001IndustryContribution'),
    soxResearchContextRecord(globalContext),
    auditedLiveRecord('txTick', 'tick', 'TX', txCode, actualContract, bridge, futuresAudit, now),
    auditedLiveRecord('txBidAsk', 'bidAsk', 'TX', txCode, actualContract, bridge, futuresAudit, now),
    auditedLiveRecord('mtxTick', 'tick', 'MTX', mtxCode, actualContract, bridge, futuresAudit, now),
    auditedLiveRecord('mtxBidAsk', 'bidAsk', 'MTX', mtxCode, actualContract, bridge, futuresAudit, now),
    auditedLiveRecord('tmfTick', 'tick', 'TMF', tmfCode, actualContract, bridge, futuresAudit, now),
    auditedLiveRecord('tmfBidAsk', 'bidAsk', 'TMF', tmfCode, actualContract, bridge, futuresAudit, now),
    batchRecord('marketOverview', 'MARKET_OVERVIEW', sources.marketOverview, now),
    batchRecord('breadth', 'TWSE_TPEX_BREADTH', sources.marketBreadth, now),
    batchRecord('cashInstitutional', 'TWSE_INSTITUTIONAL_BATCH', sources.spotInstitutional, now),
    batchRecord('futuresMarket', 'TAIFEX_FUTURES_BATCH', sources.futuresMarket, now, { instrument: 'TX', actualContract }),
    batchRecord('futuresPositioning', 'TAIFEX_INSTITUTIONAL_BATCH', sources.futuresInstitutional, now, { instrument: 'TX' }),
    batchRecord('optionsEod', 'TAIFEX_OPTIONS_BATCH', sources.options, now, { instrument: 'TXO', actualContract: snapshot?.options?.data?.contract }),
    batchRecord('taiwanVix', 'TAIFEX_VOLATILITY_BATCH', sources.taiwanVix, now),
    chartDerivedRecord('chartBar', 'GOVERNED_TX_CHART_BAR', chart, { ready: chart?.status === 'READY' && chart?.bars?.length > 0, now }),
    chartDerivedRecord('chartHistory', 'GOVERNED_TX_CHART_HISTORY', chart, { ready: chart?.status === 'READY' && chart?.bars?.length > 0, now }),
    derivedRecord('estimatedCvd', 'ESTIMATED_TRADE_DIRECTION', ['txTick']),
    derivedRecord('orderBookPressure', 'ORDER_BOOK_PRESSURE', ['txBidAsk'], 'DERIVATION_NOT_IMPLEMENTED'),
    chartDerivedRecord('liveVwap', 'LIVE_VWAP', chart, { ready: chart?.levels?.vwap?.availability === 'AVAILABLE', reason: chart?.levels?.vwap?.reason, now }),
    chartDerivedRecord('openingRange', 'OPENING_RANGE', chart, { ready: chart?.openingRange?.status === 'READY', reason: chart?.openingRange?.reason, now }),
    derivedRecord('rvol', 'RELATIVE_VOLUME', ['txTick']),
  ];

  const counts = Object.fromEntries(FRESHNESS_STATES.map((state) => [state, items.filter((item) => item.freshnessState === state).length]));
  const staleCount = counts.STALE + counts.DELAYED;
  const unavailableCount = counts.UNAVAILABLE;
  const overall = unavailableCount > 0 ? 'UNAVAILABLE' : staleCount > 0 ? 'DELAYED' : counts.LIVE > 0 ? 'LIVE' : 'FRESH';
  return Object.freeze({
    schemaVersion: 'dashboard-data-health-v1',
    generatedAt: now.toISOString(),
    overall,
    counts,
    staleCount,
    unavailableCount,
    items,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
}
