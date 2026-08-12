import crypto from 'node:crypto';

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

function buildDecisionSummary(marketState, dataHealth) {
  const critical = ['forwardShadowRuntime', 'txTick', 'breadth', 'futuresPositioning', 'optionsEod']
    .map((sourceId) => healthItem(dataHealth, sourceId)).filter(Boolean);
  const stale = critical.find((item) => ['STALE', 'DELAYED'].includes(item.freshnessState));
  const missing = critical.find((item) => item.freshnessState === 'UNAVAILABLE');
  let noTradeReason = 'ENTRY_QUALITY_NOT_IMPLEMENTED';
  if (marketState.availability !== 'AVAILABLE') noTradeReason = 'RUNTIME_UNAVAILABLE';
  else if (missing) noTradeReason = 'DATA_INSUFFICIENT';
  else if (stale) noTradeReason = 'DATA_STALE';
  return Object.freeze({
    posture: 'NO_TRADE',
    readiness: 'NOT_READY',
    noTradeReason,
    direction: marketState.direction,
    globalAlignment: marketState.globalAlignment,
    risk: marketState.risk,
    entryQuality: 'UNAVAILABLE',
    strongestContraryEvidence: unavailable('CONTRARY_EVIDENCE_DERIVATION_NOT_IMPLEMENTED'),
    explanation: '方向與進場品質分離；DW-1 尚未實作 OR、VWAP、RVOL 或 Flow 衍生，因此不發布進場就緒狀態。',
  });
}

export function createDecisionSnapshot({ snapshot = {}, dataHealth, runtimeTruth = null, snapshotTime = new Date().toISOString() } = {}) {
  const parsedSnapshotTime = Date.parse(snapshotTime);
  if (Number.isNaN(parsedSnapshotTime)) throw new Error('DECISION_SNAPSHOT_TIME_INVALID');
  for (const item of dataHealth?.items || []) {
    if (item.availableAt && Date.parse(item.availableAt) > parsedSnapshotTime) throw new Error('DECISION_SNAPSHOT_FUTURE_EVIDENCE');
  }
  const tx = snapshot?.futuresMarket?.data?.txDay || {};
  const futuresHealth = healthItem(dataHealth, 'futuresMarket');
  const marketState = safeMarketState(runtimeTruth);
  const body = {
    schemaVersion: 'manual-decision-snapshot-v1',
    snapshotTime: new Date(parsedSnapshotTime).toISOString(),
    contract: tx.contract || null,
    session: runtimeTruth?.stateRecord?.sessionId || tx.session || null,
    price: Number.isFinite(Number(tx.close))
      ? available(Number(tx.close), 'futuresMarket', futuresHealth?.availableAt)
      : unavailable('PRICE_UNAVAILABLE'),
    marketState,
    dataHealth,
    OR: unavailable('DERIVATION_NOT_IMPLEMENTED'),
    VWAP: unavailable('DERIVATION_NOT_IMPLEMENTED'),
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
    support: [],
    contraryEvidence: [],
    missingOrStaleInputs: (dataHealth?.items || [])
      .filter((item) => item.freshnessState === 'UNAVAILABLE' || item.freshnessState === 'STALE')
      .map((item) => ({ sourceId: item.sourceId, state: item.freshnessState, reason: item.reason })),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  return Object.freeze({ ...body, snapshotHash: decisionDigest(body) });
}

export function validateDecisionSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 'manual-decision-snapshot-v1') throw new Error('DECISION_SNAPSHOT_SCHEMA_INVALID');
  if (snapshot.formalWeight !== 0 || snapshot.researchOnly !== true || snapshot.executionAuthorized !== false) {
    throw new Error('DECISION_SNAPSHOT_AUTHORIZATION_BOUNDARY');
  }
  if (!/^[a-f0-9]{64}$/.test(snapshot.snapshotHash || '')) throw new Error('DECISION_SNAPSHOT_HASH_INVALID');
  const { snapshotHash, ...body } = snapshot;
  if (decisionDigest(body) !== snapshotHash) throw new Error('DECISION_SNAPSHOT_HASH_MISMATCH');
  return Object.freeze({ valid: true, snapshotHash });
}

export function copyForChatGpt(snapshot, question = null) {
  validateDecisionSnapshot(snapshot);
  const prompt = question || '請指出目前最大反向證據，並依資料缺口做 pre-trade checklist。';
  const readable = [
    'DISCUSSION CONTEXT — NOT A TRADING SIGNAL',
    `Question: ${prompt}`,
    `Snapshot: ${snapshot.snapshotTime}`,
    `Hash: ${snapshot.snapshotHash}`,
    `Contract / Session: ${snapshot.contract || 'UNAVAILABLE'} / ${snapshot.session || 'UNAVAILABLE'}`,
    `Market State: direction=${snapshot.marketState.direction}; global=${snapshot.marketState.globalAlignment}; risk=${snapshot.marketState.risk}`,
    `Data Health: ${snapshot.dataHealth.overall}; stale=${snapshot.dataHealth.staleCount}; unavailable=${snapshot.dataHealth.unavailableCount}`,
    `OR / VWAP / Entry Quality: ${snapshot.OR.availability} / ${snapshot.VWAP.availability} / ${snapshot.entryQuality.availability}`,
    `Missing or stale: ${snapshot.missingOrStaleInputs.map((item) => `${item.sourceId}:${item.reason || item.state}`).join(', ') || 'none'}`,
    '',
    'STRUCTURED SNAPSHOT',
    stableDecisionJson(snapshot).trimEnd(),
  ];
  return readable.join('\n');
}

export function buildDecisionWorkspace({ snapshot = {}, dataHealth, runtimeTruth = null, now = new Date() } = {}) {
  const lockedSnapshotCandidate = createDecisionSnapshot({ snapshot, dataHealth, runtimeTruth, snapshotTime: now.toISOString() });
  const marketState = lockedSnapshotCandidate.marketState;
  return Object.freeze({
    schemaVersion: 'dashboard-decision-workspace-v1',
    generatedAt: now.toISOString(),
    mode: 'FOCUS',
    globalStatus: {
      mode: snapshot.dataMode === 'mock' ? 'MOCK_NOT_DECISION_ELIGIBLE' : (runtimeTruth?.launchStatus || 'UNAVAILABLE'),
      actualContract: lockedSnapshotCandidate.contract,
      session: lockedSnapshotCandidate.session,
      sourceTime: snapshot.generatedAt || null,
      dataHealth: dataHealth.overall,
      staleCount: dataHealth.staleCount,
      unavailableCount: dataHealth.unavailableCount,
    },
    decisionSummary: buildDecisionSummary(marketState, dataHealth),
    priceChartSlot: {
      status: 'NOT_IMPLEMENTED',
      label: 'Decision-aware Price Chart',
      reason: 'DW-2_CHART_ENGINE_NOT_INSTALLED',
      price: lockedSnapshotCandidate.price,
      OR: lockedSnapshotCandidate.OR,
      VWAP: lockedSnapshotCandidate.VWAP,
      RVOL: unavailable('DERIVATION_NOT_IMPLEMENTED'),
    },
    againstMyTrade: {
      status: 'NOT_IMPLEMENTED',
      support: [],
      against: [],
      missingEvidence: lockedSnapshotCandidate.missingOrStaleInputs,
      entryRisk: [lockedSnapshotCandidate.entryQuality],
      invalidation: unavailable('INVALIDATION_CONTRACT_NOT_IMPLEMENTED'),
    },
    whatChanged: {
      status: 'NOT_IMPLEMENTED',
      windows: ['5m', '15m'],
      reason: 'CHANGE_DERIVATION_NOT_IMPLEMENTED',
    },
    snapshot: lockedSnapshotCandidate,
    chatGptCopy: copyForChatGpt(lockedSnapshotCandidate),
    policies: {
      directGptApi: false,
      discussionOnly: true,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    },
  });
}
