import crypto from 'node:crypto';
import { buildDashboardDw4Evidence } from './dashboard-dw4-evidence.mjs';
import { leadershipCopyAllowlist } from './index-leadership.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
export function stableDecisionJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function decisionDigest(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
}

function unavailable(reason) {
  return Object.freeze({ availability: 'UNAVAILABLE', value: null, reason });
}

function available(value, sourceId, availableAt) {
  return Object.freeze({ availability: 'AVAILABLE', value, sourceId, availableAt: availableAt || null });
}

function legalForwardState(runtimeTruth) {
  const row = runtimeTruth?.stateRecord;
  if (!row || row.recordType !== 'STATE' || !row.axisStateSnapshot) return null;
  return row;
}

function healthItem(dataHealth, sourceId) {
  return dataHealth.items.find((item) => item.sourceId === sourceId) || null;
}

function identityText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function currentWorkspaceIdentity(chart) {
  const tradeDate = identityText(chart?.tradeDate);
  const contract = identityText(chart?.actualContract);
  const session = identityText(chart?.session);
  if (!tradeDate || !contract || !session) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      reason: 'CURRENT_CHART_IDENTITY_INCOMPLETE',
      tradeDate: null,
      contract: null,
      session: null,
      source: 'GOVERNED_TX_CHART',
    });
  }

  const bars = Array.isArray(chart?.bars) ? chart.bars : [];
  const mismatch = bars.find((bar) => (
    (identityText(bar?.tradeDate) && identityText(bar.tradeDate) !== tradeDate)
    || (identityText(bar?.actualContract) && identityText(bar.actualContract) !== contract)
    || (identityText(bar?.session) && identityText(bar.session) !== session)
  ));
  if (mismatch) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      reason: 'CURRENT_CHART_IDENTITY_MISMATCH',
      tradeDate: null,
      contract: null,
      session: null,
      source: 'GOVERNED_TX_CHART',
    });
  }

  return Object.freeze({
    state: 'AVAILABLE',
    reason: null,
    tradeDate,
    contract,
    session,
    source: 'GOVERNED_TX_CHART',
  });
}

function safeMarketState(runtimeTruth) {
  const row = legalForwardState(runtimeTruth);
  if (!row) {
    return {
      availability: 'UNAVAILABLE',
      direction: 'UNAVAILABLE',
      globalAlignment: 'UNAVAILABLE',
      risk: 'UNAVAILABLE',
      reason: 'NO_LEGAL_FORWARD_MARKET_STATE_SNAPSHOT',
      decisionAt: null,
      availableAt: null,
      evidenceHash: null,
    };
  }
  return {
    availability: row.qualityStatus === 'CLEAN' ? 'AVAILABLE' : 'UNAVAILABLE',
    direction: row.axisStateSnapshot.direction || 'UNAVAILABLE',
    globalAlignment: row.axisStateSnapshot.globalAlignment || 'UNAVAILABLE',
    risk: row.axisStateSnapshot.risk || 'UNAVAILABLE',
    reason: row.qualityStatus === 'CLEAN' ? null : (row.unavailableReason || row.qualityStatus),
    decisionAt: row.decisionAt || null,
    availableAt: row.availableAt || null,
    evidenceHash: row.evidenceHash || row.recordHash || null,
  };
}

function buildDecisionSummary(marketState, dataHealth, evidenceConflict, chart = null) {
  const critical = ['forwardShadowRuntime', 'txTick', 'breadth', 'futuresPositioning', 'optionsEod']
    .map((sourceId) => healthItem(dataHealth, sourceId)).filter(Boolean);
  const stale = critical.find((item) => ['STALE', 'DELAYED'].includes(item.freshnessState));
  const missing = critical.find((item) => item.freshnessState === 'UNAVAILABLE');
  let noTradeReason = 'ENTRY_QUALITY_NOT_IMPLEMENTED';
  if (marketState.availability !== 'AVAILABLE') noTradeReason = 'RUNTIME_UNAVAILABLE';
  else if (missing) noTradeReason = 'DATA_INSUFFICIENT';
  else if (stale) noTradeReason = 'DATA_STALE';
  const readiness = evidenceConflict?.dataTrustState === 'PASS' && evidenceConflict?.coverageState === 'COMPLETE'
    ? 'READY_FOR_REVIEW'
    : evidenceConflict?.dataTrustState === 'BLOCKED'
      ? 'NOT_READY'
      : evidenceConflict
        ? 'DEGRADED'
        : 'UNAVAILABLE';
  const visibleFacts = [];
  if (chart?.lastPrice != null && Number.isFinite(Number(chart.lastPrice))) visibleFacts.push('TX 價格');
  if (chart?.openingRange?.status === 'READY') visibleFacts.push('Opening Range');
  if (chart?.levels?.vwap?.availability === 'AVAILABLE') visibleFacts.push(`${chart.levels.vwap.vwapSession || chart.session || 'Session'} VWAP`);
  const factSummary = visibleFacts.length
    ? `目前可直接查看：${visibleFacts.join('、')}。`
    : '目前沒有可直接顯示的合法盤中價格衍生。';
  const summary = Object.freeze({
    posture: 'MANUAL_REVIEW_ONLY',
    rawPosture: 'NO_TRADE',
    systemDirectionalSignal: false,
    readiness,
    noTradeReason,
    direction: marketState.direction,
    globalAlignment: marketState.globalAlignment,
    risk: marketState.risk,
    entryQuality: 'UNAVAILABLE',
    strongestContraryEvidence: unavailable('CONTRARY_EVIDENCE_DERIVATION_NOT_IMPLEMENTED'),
    explanation: null,
  });
  return Object.freeze({
    ...summary,
    explanation: `${factSummary} Entry Quality、Estimated Flow、最強反向證據與 RVOL 尚未形成 governed decision derivation；系統不提供交易方向。`,
  });
}

function compactNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(parsed) : null;
}

export function buildCurrentMarketFactSummary(marketChangeFeed, evidenceConflict) {
  const latest = marketChangeFeed?.presentationGroupsLatestFirst?.[0]
    || marketChangeFeed?.latestGroupsFirst?.[0]
    || null;
  let priceStructureFact = '目前沒有新的 governed 盤中結構事件。';
  if (latest?.presentationType === 'SESSION_EXTREME_STREAK') {
    const context = latest.descriptiveContext || {};
    const details = [];
    const previous = compactNumber(context.previousExtreme);
    const current = compactNumber(context.newExtreme);
    const extension = compactNumber(context.absoluteExtension);
    if (previous != null && current != null) details.push(`時段價位由 ${previous} 更新至 ${current}`);
    if (extension != null) details.push(`延伸 ${extension} 點`);
    details.push(`連續 ${context.streakCount || latest.evidenceCount} 次完成的 5 分鐘事件`);
    priceStructureFact = `${latest.headline}；${details.join('，')}。`;
  } else if (latest?.events?.length) {
    priceStructureFact = `${latest.events.map((event) => event.headline).join('、')}。`;
  }
  const eligibleFamilies = evidenceConflict?.eligibleEvidenceFamilies || [];
  const evidenceEligibilityFact = eligibleFamilies.length
    ? `目前 ${eligibleFamilies.length} 個證據家族符合方向彙總資格。`
    : '目前沒有符合方向彙總資格的證據家族。';
  return Object.freeze({
    schemaVersion: 'current-market-fact-summary-v1',
    label: '現在市場發生什麼？',
    priceStructureFact,
    evidenceEligibilityFact,
    coverageState: evidenceConflict?.coverageState || 'INSUFFICIENT',
    dataTrustState: evidenceConflict?.dataTrustState || 'BLOCKED',
    sourceEventIds: Object.freeze((latest?.events || []).map((event) => event.eventId)),
    templateMode: 'DETERMINISTIC_GOVERNED_FACTS_ONLY',
    recommendation: false,
  });
}

export function createDecisionSnapshot({
  snapshot = {}, dataHealth, runtimeTruth = null, chart = null, evidenceConflict = null,
  marketChangeFeed = null, currentMarketFactSummary = null, liveBreadth = null,
  indexLeadership = null, observedFlow = null, marketPulse = null,
  decisionReadiness = 'NOT_READY', snapshotTime = new Date().toISOString(),
} = {}) {
  const parsedSnapshotTime = Date.parse(snapshotTime);
  if (Number.isNaN(parsedSnapshotTime)) throw new Error('DECISION_SNAPSHOT_TIME_INVALID');
  for (const item of dataHealth?.items || []) {
    if (item.availableAt && Date.parse(item.availableAt) > parsedSnapshotTime) throw new Error('DECISION_SNAPSHOT_FUTURE_EVIDENCE');
  }
  const chartAvailableTimes = [
    chart?.availableAt,
    chart?.openingRange?.availableAt,
    ...Object.values(chart?.levels || {}).map((level) => level?.availableAt),
  ].filter(Boolean);
  if (chartAvailableTimes.some((value) => Date.parse(value) > parsedSnapshotTime)) throw new Error('DECISION_SNAPSHOT_FUTURE_CHART_EVIDENCE');
  if (indexLeadership?.lastAvailableAt && Date.parse(indexLeadership.lastAvailableAt) > parsedSnapshotTime) throw new Error('DECISION_SNAPSHOT_FUTURE_LEADERSHIP_EVIDENCE');
  if (observedFlow?.source?.availableAt && Date.parse(observedFlow.source.availableAt) > parsedSnapshotTime) {
    throw new Error('DECISION_SNAPSHOT_FUTURE_OBSERVED_FLOW_EVIDENCE');
  }
  const pulseTimes = [
    marketPulse?.rvol?.completedBarAvailableAt,
    marketPulse?.basis?.futuresAvailableAt,
    marketPulse?.basis?.spotAvailableAt,
  ].filter(Boolean);
  if (pulseTimes.some((value) => Date.parse(value) > parsedSnapshotTime)) {
    throw new Error('DECISION_SNAPSHOT_FUTURE_MARKET_PULSE_EVIDENCE');
  }
  const tx = snapshot?.futuresMarket?.data?.txDay || {};
  const futuresHealth = healthItem(dataHealth, 'futuresMarket');
  const marketState = safeMarketState(runtimeTruth);
  const identity = currentWorkspaceIdentity(chart);
  const body = {
    schemaVersion: 'manual-decision-snapshot-v1',
    snapshotTime: new Date(parsedSnapshotTime).toISOString(),
    identityState: identity.state,
    identityReason: identity.reason,
    identitySource: identity.source,
    tradeDate: identity.tradeDate,
    contract: identity.contract,
    session: identity.session,
    price: Number.isFinite(Number(chart?.lastPrice ?? tx.close))
      ? available(Number(chart?.lastPrice ?? tx.close), chart?.source || 'futuresMarket', chart?.availableAt || futuresHealth?.availableAt)
      : unavailable('PRICE_UNAVAILABLE'),
    marketState,
    dataHealth,
    OR: chart?.openingRange?.status === 'READY'
      ? available({ high: chart.openingRange.high, low: chart.openingRange.low }, chart.openingRange.source, chart.openingRange.availableAt)
      : unavailable(chart?.openingRange?.reason || 'DERIVATION_NOT_IMPLEMENTED'),
    VWAP: chart?.levels?.vwap?.availability === 'AVAILABLE'
      ? available(chart.levels.vwap.value, chart.levels.vwap.source, chart.levels.vwap.availableAt)
      : unavailable(chart?.levels?.vwap?.reason || 'DERIVATION_NOT_IMPLEMENTED'),
    entryQuality: unavailable('CONTRACT_NOT_FROZEN'),
    breadth: liveBreadth?.observation && ['LIVE', 'EOD_CONTEXT'].includes(liveBreadth.state)
      ? available({
        ...liveBreadth.observation.breadth,
        tradeDate: liveBreadth.observation.tradeDate,
        session: liveBreadth.observation.session,
        eventTime: liveBreadth.observation.eventTime,
        receivedAt: liveBreadth.observation.receivedAt,
        freshness: liveBreadth.freshnessState,
        quality: liveBreadth.observation.qualityStatus,
        promotion: liveBreadth.observation.promotionState,
        sourceMode: liveBreadth.sourceMode,
      }, liveBreadth.observation.sourceId, liveBreadth.observation.availableAt)
      : snapshot?.marketBreadth?.ok
        ? available({
          ...snapshot.marketBreadth.data,
          tradeDate: snapshot.marketBreadth.dataDate || null,
          sourceMode: 'EOD',
        }, 'breadth', snapshot.marketBreadth.fetchedAt)
      : unavailable('SOURCE_UNAVAILABLE'),
    estimatedFlow: unavailable('DERIVATION_NOT_IMPLEMENTED'),
    options: snapshot?.options?.ok
      ? available({
        contract: snapshot.options.data?.contract || null,
        oiPcRatio: snapshot.options.data?.oiPcRatio ?? null,
        callWall: snapshot.options.data?.callWall ?? null,
        putWall: snapshot.options.data?.putWall ?? null,
        maxPain: snapshot.options.data?.maxPain ?? null,
      }, 'optionsEod', snapshot.options.fetchedAt)
      : unavailable('SOURCE_UNAVAILABLE'),
    global: snapshot?.marketOverview?.ok || snapshot?.researchDecision?.globalContext?.latest?.some((row) => row.symbol === 'SOX')
      ? available({
        vix: snapshot?.marketOverview?.data?.vix ?? null,
        usdTwd: snapshot?.marketOverview?.data?.usdtwd ?? null,
        sox: snapshot?.researchDecision?.globalContext?.latest?.find((row) => row.symbol === 'SOX') || null,
        ndxProxy: snapshot?.researchDecision?.globalContext?.latest?.find((row) => row.symbol === 'NDX') || null,
        trueNq: { availability: 'UNAVAILABLE', reason: 'SOURCE_GAP_OWNER_DECISION_REQUIRED' },
      }, snapshot?.researchDecision?.globalContext?.latest?.some((row) => row.symbol === 'SOX')
        ? 'soxResearchContext' : 'marketOverview',
      snapshot?.researchDecision?.globalContext?.latest?.find((row) => row.symbol === 'SOX')?.availableAt
        || snapshot?.marketOverview?.fetchedAt)
      : unavailable('SOURCE_UNAVAILABLE'),
    decisionReadiness,
    evidenceConflict: evidenceConflict || buildDashboardDw4Evidence(dataHealth),
    currentMarketFactSummary,
    observedFlow,
    marketPulse,
    ...leadershipCopyAllowlist(indexLeadership),
    governedMarketChanges: Object.freeze((marketChangeFeed?.latestFirst || marketChangeFeed?.events || []).slice(0, 5).map((event) => Object.freeze({
      eventId: event.eventId || null,
      eventType: event.eventType || null,
      observedAt: event.observedAt || event.eventTime || event.availableAt || null,
      summary: event.summary || event.label || null,
      dataTrust: event.dataTrust || null,
    }))),
    support: [],
    contraryEvidence: [],
    missingOrStaleInputs: (dataHealth?.items || [])
      .filter((item) => item.freshnessState === 'UNAVAILABLE' || item.freshnessState === 'STALE')
      .map((item) => ({ sourceId: item.sourceId, state: item.freshnessState, reason: item.reason })),
    formalWeight: 0,
    researchOnly: true,
    recommendation: false,
    systemDirectionalSignal: false,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  return Object.freeze({ ...body, snapshotHash: decisionDigest(body) });
}

export function validateDecisionSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 'manual-decision-snapshot-v1') throw new Error('DECISION_SNAPSHOT_SCHEMA_INVALID');
  if (snapshot.formalWeight !== 0 || snapshot.researchOnly !== true || snapshot.recommendation !== false || snapshot.systemDirectionalSignal !== false || snapshot.executionAuthorized !== false || snapshot.orderRoutesEnabled !== false
    || snapshot.LEADERSHIP_DESCRIPTIVE_ONLY !== true || snapshot.NOT_PROMOTED !== true || snapshot.NOT_A_TRADING_SIGNAL !== true) {
    throw new Error('DECISION_SNAPSHOT_AUTHORIZATION_BOUNDARY');
  }
  if (snapshot.observedFlow && (snapshot.observedFlow.formalWeight !== 0
      || snapshot.observedFlow.researchOnly !== true
      || snapshot.observedFlow.executionAuthorized !== false
      || snapshot.observedFlow.orderRoutesEnabled !== false
      || snapshot.observedFlow.recommendation !== false
      || snapshot.observedFlow.systemDirectionalSignal !== false)) {
    throw new Error('DECISION_SNAPSHOT_OBSERVED_FLOW_AUTHORIZATION_BOUNDARY');
  }
  if (snapshot.marketPulse && (snapshot.marketPulse.formalWeight !== 0
      || snapshot.marketPulse.researchOnly !== true
      || snapshot.marketPulse.executionAuthorized !== false
      || snapshot.marketPulse.orderRoutesEnabled !== false
      || snapshot.marketPulse.recommendation !== false
      || snapshot.marketPulse.systemDirectionalSignal !== false)) {
    throw new Error('DECISION_SNAPSHOT_MARKET_PULSE_AUTHORIZATION_BOUNDARY');
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')) throw new Error('DECISION_SNAPSHOT_HASH_INVALID');
  if (snapshot.identityState != null) {
    const identityComplete = Boolean(snapshot.tradeDate && snapshot.contract && snapshot.session);
    const identityPresent = Boolean(snapshot.tradeDate || snapshot.contract || snapshot.session);
    if (snapshot.identityState === 'AVAILABLE' && !identityComplete) throw new Error('DECISION_SNAPSHOT_IDENTITY_INCOMPLETE');
    if (snapshot.identityState !== 'AVAILABLE' && identityPresent) throw new Error('DECISION_SNAPSHOT_IDENTITY_FAIL_CLOSED');
  }
  const { snapshotHash, ...body } = snapshot;
  if (decisionDigest(body) !== snapshotHash) throw new Error('DECISION_SNAPSHOT_HASH_MISMATCH');
  return Object.freeze({ valid: true, snapshotHash });
}

export function copyForChatGpt(snapshot, question = null) {
  validateDecisionSnapshot(snapshot);
  const prompt = question || '請指出目前最大反向證據，並依資料缺口做 pre-trade checklist。';
  const descriptiveEvidence = (snapshot.evidenceConflict?.evidence || []).map((item) => {
    const values = (item.detail?.descriptiveValues || []).map((entry) => `${entry.label}=${entry.value}${entry.unit || ''}`).join(', ');
    return `${item.family}: ${values || 'UNAVAILABLE'}; availability=${item.availabilityState}; quality=${item.qualityState}; promotion=${item.promotionState}; directionalEligible=${item.eligibleDirectionalEvidence}`;
  });
  const contributionLine = (rows) => (rows || []).slice(0, 5)
    .map((row) => `${row.name || row.categoryName || '名稱未提供'}:${row.points ?? 'UNAVAILABLE'}pt`).join(', ') || 'UNAVAILABLE';
  const readable = [
    'DISCUSSION CONTEXT — NOT A TRADING SIGNAL',
    `Snapshot: ${snapshot.snapshotTime}`,
    `Hash: ${snapshot.snapshotHash}`,
    `Trade Date: ${snapshot.tradeDate || 'UNAVAILABLE'}`,
    `Contract / Session: ${snapshot.contract || 'UNAVAILABLE'} / ${snapshot.session || 'UNAVAILABLE'}`,
    `Current identity: ${snapshot.identityState || 'UNAVAILABLE'}; source=${snapshot.identitySource || 'UNAVAILABLE'}; reason=${snapshot.identityReason || 'none'}`,
    `Decision Readiness: ${snapshot.decisionReadiness || 'UNAVAILABLE'}`,
    `DW-4: conflict=${snapshot.evidenceConflict?.conflictState || 'NO_DIRECTIONAL_EVIDENCE'}; coverage=${snapshot.evidenceConflict?.coverageState || 'INSUFFICIENT'}; dataTrust=${snapshot.evidenceConflict?.dataTrustState || 'BLOCKED'}`,
    `Eligible evidence: ${(snapshot.evidenceConflict?.eligibleEvidenceFamilies || []).join(', ') || 'none'}`,
    `Excluded evidence: unavailable=${(snapshot.evidenceConflict?.unavailableEvidenceFamilies || []).join(', ') || 'none'}; stale=${(snapshot.evidenceConflict?.staleEvidenceFamilies || []).join(', ') || 'none'}; quality=${(snapshot.evidenceConflict?.qualityExcludedFamilies || []).join(', ') || 'none'}; promotion=${(snapshot.evidenceConflict?.promotionExcludedFamilies || []).join(', ') || 'none'}`,
    'Descriptive family values (display only; not directional evidence):',
    ...(descriptiveEvidence.length ? descriptiveEvidence.map((line) => `- ${line}`) : ['- UNAVAILABLE']),
    `Market State: direction=${snapshot.marketState.direction}; global=${snapshot.marketState.globalAlignment}; risk=${snapshot.marketState.risk}`,
    `Data Health: ${snapshot.dataHealth.overall}; stale=${snapshot.dataHealth.staleCount}; unavailable=${snapshot.dataHealth.unavailableCount}`,
    `OR / VWAP / Entry Quality: ${snapshot.OR.availability} / ${snapshot.VWAP.availability} / ${snapshot.entryQuality.availability}`,
    `Market Pulse: RVOL state=${snapshot.marketPulse?.rvol?.state || 'UNAVAILABLE'} ratio=${snapshot.marketPulse?.rvol?.ratio ?? 'UNAVAILABLE'} percentile=${snapshot.marketPulse?.rvol?.percentile ?? 'UNAVAILABLE'} sampleDays=${snapshot.marketPulse?.rvol?.sampleDays ?? 0}; Basis label=${snapshot.marketPulse?.basis?.label || '基差'} state=${snapshot.marketPulse?.basis?.state || 'UNAVAILABLE'} points=${snapshot.marketPulse?.basis?.points ?? 'UNAVAILABLE'} pct=${snapshot.marketPulse?.basis?.pct ?? 'UNAVAILABLE'} referenceMode=${snapshot.marketPulse?.basis?.referenceMode || 'UNAVAILABLE'}`,
    `IX0001 Leadership: state=${snapshot.leadershipSource?.state || 'UNAVAILABLE'}; mode=${snapshot.leadershipSource?.sourceMode || 'UNAVAILABLE'}; tradeDate=${snapshot.leadershipSource?.sourceTradeDate || 'UNAVAILABLE'}; quality=${snapshot.leadershipSource?.quality || 'QUALITY_INSUFFICIENT'}; descriptiveOnly=${snapshot.LEADERSHIP_DESCRIPTIVE_ONLY}; notPromoted=${snapshot.NOT_PROMOTED}; notTradingSignal=${snapshot.NOT_A_TRADING_SIGNAL}`,
    `IX0001 top positive contribution: ${contributionLine(snapshot.indexLeadership?.topPositive)}`,
    `IX0001 top negative contribution: ${contributionLine(snapshot.indexLeadership?.topNegative)}`,
    observedFlowCopyLine(snapshot.observedFlow),
    `Recent governed changes: ${snapshot.governedMarketChanges.map((item) => `${item.observedAt || 'time unavailable'}:${item.eventType || item.summary || 'UNAVAILABLE'}`).join(', ') || 'none'}`,
    `Current governed fact summary: ${snapshot.currentMarketFactSummary?.priceStructureFact || 'UNAVAILABLE'} ${snapshot.currentMarketFactSummary?.evidenceEligibilityFact || ''}`,
    `Missing or stale: ${snapshot.missingOrStaleInputs.map((item) => `${item.sourceId}:${item.reason || item.state}`).join(', ') || 'none'}`,
    `Safety: recommendation=false; systemDirectionalSignal=false; formalWeight=${snapshot.formalWeight}; researchOnly=${snapshot.researchOnly}; executionAuthorized=${snapshot.executionAuthorized}; orderRoutesEnabled=${snapshot.orderRoutesEnabled}`,
    '',
    'STRUCTURED SNAPSHOT',
    stableDecisionJson(discussionSnapshot(snapshot)).trimEnd(),
    '',
    `USER QUESTION: ${prompt}`,
  ];
  return readable.join('\n');
}

function observedFlowCopyLine(observedFlow) {
  if (!observedFlow || observedFlow.sourceState === 'UNAVAILABLE' || !observedFlow.windows) {
    return `Observed Flow: source=UNAVAILABLE; reason=${observedFlow?.unavailableReason || 'ARTIFACT_MISSING'}; formalDirection=NOT_PROMOTED`;
  }
  const primary = observedFlow.windows.primary60s;
  const context = observedFlow.windows.context300s;
  const compact = (window) => [
    `pressureRatio=${window?.pressure?.pressureRatio ?? 'UNAVAILABLE'}`,
    `classifiedCoverage=${window?.pressure?.classifiedCoverage ?? 'UNAVAILABLE'}`,
    `responsePoints=${window?.response?.displacementPoints ?? 'UNAVAILABLE'}`,
    `pathEfficiency=${window?.pathEfficiency?.value ?? 'UNAVAILABLE'}`,
  ].join(',');
  return `Observed Flow: source=${observedFlow.sourceState}; identity=${observedFlow.identity?.actualContract || 'UNAVAILABLE'}/${observedFlow.identity?.tradeDate || 'UNAVAILABLE'}/${observedFlow.identity?.session || 'UNAVAILABLE'}; availableAt=${observedFlow.source?.availableAt || 'UNAVAILABLE'}; 60s[${compact(primary)}]; 300s[${compact(context)}]; quality=${observedFlow.researchQuality?.status || 'UNAVAILABLE'}; formalDirection=${observedFlow.formalDirection || 'NOT_PROMOTED'}`;
}

function compactAvailability(value) {
  if (!value || typeof value !== 'object') return value;
  return Object.freeze({
    availability: value.availability || 'UNAVAILABLE',
    value: value.value ?? null,
    sourceId: value.sourceId || null,
    availableAt: value.availableAt || null,
    reason: value.reason || null,
  });
}

function discussionEvidence(item) {
  return Object.freeze({
    family: item.family,
    directionState: item.directionState,
    availabilityState: item.availabilityState,
    qualityState: item.qualityState,
    promotionState: item.promotionState,
    eligibleDirectionalEvidence: item.eligibleDirectionalEvidence,
    eventTime: item.eventTime || null,
    availableAt: item.availableAt || null,
    sourceId: item.sourceId || null,
    qualityReasons: item.qualityReasons || [],
    descriptiveValues: item.detail?.descriptiveValues || [],
    sourceMode: item.detail?.displaySourceLabel || null,
    sourceTradeDate: item.detail?.sourceTradeDate || null,
  });
}

export function discussionSnapshot(snapshot) {
  return Object.freeze({
    schemaVersion: 'chatgpt-discussion-snapshot-v1',
    snapshotTime: snapshot.snapshotTime,
    snapshotHash: snapshot.snapshotHash,
    tradeDate: snapshot.tradeDate,
    contract: snapshot.contract,
    session: snapshot.session,
    identityState: snapshot.identityState,
    identityReason: snapshot.identityReason,
    identitySource: snapshot.identitySource,
    decisionReadiness: snapshot.decisionReadiness,
    price: compactAvailability(snapshot.price),
    OR: compactAvailability(snapshot.OR),
    VWAP: compactAvailability(snapshot.VWAP),
    breadth: compactAvailability(snapshot.breadth),
    options: compactAvailability(snapshot.options),
    global: compactAvailability(snapshot.global),
    marketState: {
      availability: snapshot.marketState?.availability || 'UNAVAILABLE',
      direction: snapshot.marketState?.direction || 'UNAVAILABLE',
      globalAlignment: snapshot.marketState?.globalAlignment || 'UNAVAILABLE',
      risk: snapshot.marketState?.risk || 'UNAVAILABLE',
      reason: snapshot.marketState?.reason || null,
      decisionAt: snapshot.marketState?.decisionAt || null,
      availableAt: snapshot.marketState?.availableAt || null,
      evidenceHash: snapshot.marketState?.evidenceHash || null,
    },
    evidenceConflict: {
      conflictState: snapshot.evidenceConflict?.conflictState || 'NO_DIRECTIONAL_EVIDENCE',
      coverageState: snapshot.evidenceConflict?.coverageState || 'INSUFFICIENT',
      dataTrustState: snapshot.evidenceConflict?.dataTrustState || 'BLOCKED',
      eligibleEvidenceFamilies: snapshot.evidenceConflict?.eligibleEvidenceFamilies || [],
      unavailableEvidenceFamilies: snapshot.evidenceConflict?.unavailableEvidenceFamilies || [],
      staleEvidenceFamilies: snapshot.evidenceConflict?.staleEvidenceFamilies || [],
      qualityExcludedFamilies: snapshot.evidenceConflict?.qualityExcludedFamilies || [],
      promotionExcludedFamilies: snapshot.evidenceConflict?.promotionExcludedFamilies || [],
      evidence: (snapshot.evidenceConflict?.evidence || []).map(discussionEvidence),
    },
    governedMarketChanges: snapshot.governedMarketChanges,
    currentMarketFactSummary: snapshot.currentMarketFactSummary,
    observedFlow: discussionObservedFlow(snapshot.observedFlow),
    marketPulse: snapshot.marketPulse,
    indexLeadership: snapshot.indexLeadership,
    industryLeadership: snapshot.industryLeadership,
    leadershipSource: snapshot.leadershipSource,
    LEADERSHIP_DESCRIPTIVE_ONLY: true,
    NOT_PROMOTED: true,
    NOT_A_TRADING_SIGNAL: true,
    dataHealthWarnings: (snapshot.dataHealth?.items || []).filter((item) => (
      item.freshnessState === 'UNAVAILABLE' || item.freshnessState === 'STALE'
      || item.quality === 'QUALITY_INSUFFICIENT'
    )).map((item) => ({
      sourceId: item.sourceId,
      freshness: item.freshnessState,
      quality: item.quality,
      availableAt: item.availableAt,
      reasonCode: item.reason,
      readiness: item.readinessState,
    })),
    recommendation: false,
    systemDirectionalSignal: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    notice: 'NOT A TRADING SIGNAL',
  });
}

function discussionObservedFlow(observedFlow) {
  if (!observedFlow || observedFlow.sourceState === 'UNAVAILABLE' || !observedFlow.windows) {
    return Object.freeze({
      sourceState: 'UNAVAILABLE',
      unavailableReason: observedFlow?.unavailableReason || 'ARTIFACT_MISSING',
      formalDirection: 'NOT_PROMOTED',
    });
  }
  const window = (value) => Object.freeze({
    pressureRatio: value?.pressure?.pressureRatio ?? null,
    classifiedCoverage: value?.pressure?.classifiedCoverage ?? null,
    responsePoints: value?.response?.displacementPoints ?? null,
    pathEfficiency: value?.pathEfficiency?.value ?? null,
  });
  return Object.freeze({
    sourceState: observedFlow.sourceState,
    sourceMode: observedFlow.source?.sourceMode || null,
    availableAt: observedFlow.source?.availableAt || null,
    identity: observedFlow.identity,
    primary60s: window(observedFlow.windows.primary60s),
    context300s: window(observedFlow.windows.context300s),
    researchQuality: observedFlow.researchQuality,
    formalDirection: observedFlow.formalDirection,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function buildDecisionWorkspace({
  snapshot = {}, dataHealth, runtimeTruth = null, chart = null, marketChangeFeed = null,
  dw4EvidenceObservations = null, liveBreadth = null, indexLeadership = null, observedFlow = null,
  marketPulse = null, runtimeVersion = null, productSurface = null, now = new Date(),
} = {}) {
  const evidenceConflict = buildDashboardDw4Evidence(dataHealth, {
    observations: dw4EvidenceObservations,
    snapshotBlocked: !dataHealth,
    snapshot,
    chart,
    liveBreadth,
  });
  const marketState = safeMarketState(runtimeTruth);
  const decisionSummary = buildDecisionSummary(marketState, dataHealth, evidenceConflict, chart);
  const currentMarketFactSummary = buildCurrentMarketFactSummary(marketChangeFeed, evidenceConflict);
  const lockedSnapshotCandidate = createDecisionSnapshot({
    snapshot,
    dataHealth,
    runtimeTruth,
    chart,
    evidenceConflict,
    marketChangeFeed,
    currentMarketFactSummary,
    liveBreadth,
    indexLeadership,
    observedFlow,
    marketPulse,
    decisionReadiness: decisionSummary.readiness,
    snapshotTime: now.toISOString(),
  });
  return Object.freeze({
    schemaVersion: 'dashboard-decision-workspace-v1',
    generatedAt: now.toISOString(),
    mode: 'FOCUS',
    globalStatus: {
      mode: snapshot.dataMode === 'mock' ? 'MOCK_NOT_DECISION_ELIGIBLE' : (runtimeTruth?.launchStatus || 'UNAVAILABLE'),
      identityState: lockedSnapshotCandidate.identityState,
      identityReason: lockedSnapshotCandidate.identityReason,
      identitySource: lockedSnapshotCandidate.identitySource,
      actualContract: lockedSnapshotCandidate.contract,
      session: lockedSnapshotCandidate.session,
      tradeDate: lockedSnapshotCandidate.tradeDate,
      sourceTime: snapshot.generatedAt || null,
      asOf: chart?.asOf || chart?.availableAt || snapshot.generatedAt || null,
      decisionReadiness: decisionSummary.readiness,
      dataTrust: evidenceConflict.dataTrustState,
      dataHealth: dataHealth.overall,
      staleCount: dataHealth.staleCount,
      unavailableCount: dataHealth.unavailableCount,
    },
    runtimeVersion,
    productSurface,
    decisionSummary,
    currentMarketFactSummary,
    indexLeadership,
    observedFlow,
    marketPulse,
    evidenceConflict,
    forwardShadowStatus: runtimeTruth?.statusExplanation || {
      status: 'UNKNOWN',
      reasonCode: 'UNKNOWN_INSUFFICIENT_EVIDENCE',
      reasonSummary: '沒有足夠的官方證據判定 Forward Shadow 狀態',
      tradeDate: null,
      expectedAt: null,
      observedAt: null,
      lastSuccessfulStage: null,
      failedStage: 'UNKNOWN',
      evidenceSource: 'UNAVAILABLE',
      dataTrust: 'UNAVAILABLE',
    },
    priceChartSlot: {
      status: chart?.status || 'UNAVAILABLE',
      label: 'Governed Multi-Timeframe TX Decision Chart',
      reason: chart?.reason || null,
      price: lockedSnapshotCandidate.price,
      OR: lockedSnapshotCandidate.OR,
      VWAP: lockedSnapshotCandidate.VWAP,
      RVOL: marketPulse?.rvol?.state === 'READY'
        ? available(`${marketPulse.rvol.ratio.toFixed(2)}× · P${Math.round(marketPulse.rvol.percentile)} · n=${marketPulse.rvol.sampleDays}`,
          'TX_RVOL20_SAME_5M_SLOT', marketPulse.rvol.completedBarAvailableAt)
        : unavailable(marketPulse?.rvol?.reason || 'RVOL_UNAVAILABLE'),
      timeframe: chart?.timeframe || '5m',
      session: chart?.session || null,
      actualContract: chart?.actualContract || null,
      qualityStatus: chart?.qualityStatus || 'UNAVAILABLE',
      barSemanticsOwnerDecisionRequired: chart?.barSemanticsOwnerDecisionRequired === true,
    },
    againstMyTrade: {
      status: 'NOT_IMPLEMENTED',
      support: [],
      against: [],
      missingEvidence: lockedSnapshotCandidate.missingOrStaleInputs,
      entryRisk: [lockedSnapshotCandidate.entryQuality],
      invalidation: unavailable('INVALIDATION_CONTRACT_NOT_IMPLEMENTED'),
    },
    whatChanged: marketChangeFeed
      ? {
        ...marketChangeFeed,
        label: 'Market Change Feed V1',
        observationCadence: 'COMPLETED_5M_ONLY',
      }
      : {
        status: 'UNAVAILABLE',
        observationCadence: 'COMPLETED_5M_ONLY',
        reason: 'MARKET_CHANGE_FEED_UNAVAILABLE',
        events: [],
        latestFirst: [],
        futureDataViolations: 0,
        formalWeight: 0,
        researchOnly: true,
        executionAuthorized: false,
      },
    snapshot: lockedSnapshotCandidate,
    chatGptCopy: copyForChatGpt(lockedSnapshotCandidate),
    policies: {
      directGptApi: false,
      chatGptHandoff: 'COPY_AND_OPEN_CHATGPT',
      discussionOnly: true,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    },
  });
}
