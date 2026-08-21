import crypto from 'node:crypto';
import { buildDashboardDw4Evidence } from './dashboard-dw4-evidence.mjs';

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
  marketChangeFeed = null, currentMarketFactSummary = null, decisionReadiness = 'NOT_READY', snapshotTime = new Date().toISOString(),
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
    breadth: snapshot?.marketBreadth?.ok
      ? available(snapshot.marketBreadth.data, 'breadth', snapshot.marketBreadth.fetchedAt)
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
    global: snapshot?.marketOverview?.ok
      ? available({
        vix: snapshot.marketOverview.data?.vix ?? null,
        usdTwd: snapshot.marketOverview.data?.usdtwd ?? null,
      }, 'marketOverview', snapshot.marketOverview.fetchedAt)
      : unavailable('SOURCE_UNAVAILABLE'),
    decisionReadiness,
    evidenceConflict: evidenceConflict || buildDashboardDw4Evidence(dataHealth),
    currentMarketFactSummary,
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
  if (snapshot.formalWeight !== 0 || snapshot.researchOnly !== true || snapshot.recommendation !== false || snapshot.systemDirectionalSignal !== false || snapshot.executionAuthorized !== false || snapshot.orderRoutesEnabled !== false) {
    throw new Error('DECISION_SNAPSHOT_AUTHORIZATION_BOUNDARY');
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
    `Recent governed changes: ${snapshot.governedMarketChanges.map((item) => `${item.observedAt || 'time unavailable'}:${item.eventType || item.summary || 'UNAVAILABLE'}`).join(', ') || 'none'}`,
    `Current governed fact summary: ${snapshot.currentMarketFactSummary?.priceStructureFact || 'UNAVAILABLE'} ${snapshot.currentMarketFactSummary?.evidenceEligibilityFact || ''}`,
    `Missing or stale: ${snapshot.missingOrStaleInputs.map((item) => `${item.sourceId}:${item.reason || item.state}`).join(', ') || 'none'}`,
    `Safety: recommendation=false; systemDirectionalSignal=false; formalWeight=${snapshot.formalWeight}; researchOnly=${snapshot.researchOnly}; executionAuthorized=${snapshot.executionAuthorized}; orderRoutesEnabled=${snapshot.orderRoutesEnabled}`,
    '',
    'STRUCTURED SNAPSHOT',
    stableDecisionJson(snapshot).trimEnd(),
    '',
    `USER QUESTION: ${prompt}`,
  ];
  return readable.join('\n');
}

export function buildDecisionWorkspace({
  snapshot = {}, dataHealth, runtimeTruth = null, chart = null, marketChangeFeed = null,
  dw4EvidenceObservations = null, now = new Date(),
} = {}) {
  const evidenceConflict = buildDashboardDw4Evidence(dataHealth, {
    observations: dw4EvidenceObservations,
    snapshotBlocked: !dataHealth,
    snapshot,
    chart,
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
    decisionSummary,
    currentMarketFactSummary,
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
      RVOL: unavailable('DERIVATION_NOT_IMPLEMENTED'),
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
      discussionOnly: true,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    },
  });
}
