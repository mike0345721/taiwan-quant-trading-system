import fs from 'node:fs';
import { readCru34SnapshotArtifact } from './cru34-snapshot-artifact.mjs';
import { cru34LiveHash } from './cru34-live-checkpoint.mjs';
import { CRU34_LIVE_SNAPSHOT_VERSION } from './cru34-live-projection-worker.mjs';
import { CRU44_MULTI_WINDOW_SCHEMA_VERSION } from './cru44-multi-window-observed-flow.mjs';

export const DASHBOARD_OBSERVED_FLOW_SCHEMA_VERSION = 'dashboard-observed-flow-v1';

export function observedFlowAtChart(flow, chart) {
  if (!flow || flow.sourceState === 'UNAVAILABLE') return flow;
  const identity = chart?.marketObservation?.identity || chart;
  const cutoff = Date.parse(chart?.asOf), availableAt = Date.parse(flow.source?.availableAt);
  const reason = !Number.isFinite(cutoff) || !Number.isFinite(availableAt) || availableAt > cutoff
    ? 'FLOW_OUTSIDE_CAPTURE_CUTOFF'
    : ['actualContract', 'tradeDate', 'session'].some(key => !identity?.[key] || flow.identity?.[key] !== identity[key])
      || (identity?.continuityEpoch != null && flow.identity?.continuityEpoch !== identity.continuityEpoch)
      ? 'FLOW_CAPTURE_IDENTITY_MISMATCH'
      : chart?.marketObservation?.identity && (!identity.sourceLedgerIdentity || flow.lineage?.sourceLedgerIdentity !== identity.sourceLedgerIdentity)
        ? 'FLOW_CAPTURE_SOURCE_MISMATCH' : null;
  return reason ? freeze({ ...unavailable(reason), excludedSource: flow.source, excludedIdentity: flow.identity }) : flow;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

function safetyBoundary() {
  return {
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    recommendation: false,
    systemDirectionalSignal: false,
  };
}

function unavailable(reason = 'ARTIFACT_MISSING') {
  return freeze({
    schemaVersion: DASHBOARD_OBSERVED_FLOW_SCHEMA_VERSION,
    sourceState: 'UNAVAILABLE',
    unavailableReason: reason,
    source: null,
    identity: null,
    windows: null,
    researchQuality: {
      status: 'UNAVAILABLE',
      reasons: [reason],
    },
    formalDirection: 'NOT_PROMOTED',
    promotionState: null,
    lineage: null,
    artifact: null,
    methodology: null,
    limitations: [],
    ...safetyBoundary(),
  });
}

function windowContract(label, source, truthState = null, unavailableReason = null) {
  const pressure = source?.pressure || {};
  const response = source?.response || {};
  const pathEfficiency = source?.pathEfficiency || {};
  return {
    label,
    truthState,
    windowMs: source?.windowMs ?? pressure.windowMs ?? null,
    status: source?.status || 'UNAVAILABLE',
    unavailableReason: unavailableReason || source?.unavailableReason || null,
    pressure: {
      status: pressure.status || 'UNAVAILABLE',
      unavailableReason: pressure.unavailableReason || null,
      buyProxyVolume: pressure.buyProxyVolume ?? null,
      sellProxyVolume: pressure.sellProxyVolume ?? null,
      unknownVolume: pressure.unknownVolume ?? null,
      classifiedVolume: pressure.classifiedVolume ?? null,
      totalExecutedVolume: pressure.totalExecutedVolume ?? null,
      netAggressiveFlowProxy: pressure.netAggressiveFlowProxy ?? null,
      pressureRatio: pressure.pressureRatio ?? null,
      direction: pressure.direction || 'UNAVAILABLE',
      classifiedCoverage: pressure.classifiedCoverage ?? null,
      bestQuoteCrossCheck: pressure.bestQuoteCrossCheck ? {
        matchedCoverage: pressure.bestQuoteCrossCheck.matchedCoverage ?? null,
        matchedTicks: pressure.bestQuoteCrossCheck.matchedTicks ?? null,
        buyProxyVolume: pressure.bestQuoteCrossCheck.buyProxyVolume ?? null,
        sellProxyVolume: pressure.bestQuoteCrossCheck.sellProxyVolume ?? null,
        insideSpreadVolume: pressure.bestQuoteCrossCheck.insideSpreadVolume ?? null,
        unavailableVolume: pressure.bestQuoteCrossCheck.unavailableVolume ?? null,
      } : null,
      conflict: pressure.conflict ? {
        count: pressure.conflict.count ?? null,
        rate: pressure.conflict.rate ?? null,
      } : null,
    },
    response: {
      status: response.status || 'UNAVAILABLE',
      startPrice: response.startPrice ?? null,
      endPrice: response.endPrice ?? null,
      displacementPoints: response.displacementPoints ?? null,
      displacementTicks: response.displacementTicks ?? null,
      directionRelation: response.directionRelation || null,
    },
    pathEfficiency: {
      status: pathEfficiency.status || 'UNAVAILABLE',
      value: pathEfficiency.value ?? null,
      unavailableReason: pathEfficiency.unavailableReason || null,
      netDisplacementPoints: pathEfficiency.netDisplacementPoints ?? null,
      pathLengthPoints: pathEfficiency.pathLengthPoints ?? null,
      tickCount: pathEfficiency.tickCount ?? null,
      maxObservedGapMs: pathEfficiency.maxObservedGapMs ?? null,
      maxAllowedGapMs: pathEfficiency.maxAllowedGapMs ?? null,
    },
  };
}

export function buildDashboardObservedFlow(readResult) {
  if (!readResult || readResult.truthState === 'UNAVAILABLE' || !readResult.snapshot) {
    return unavailable(readResult?.unavailableReason || 'ARTIFACT_MISSING');
  }
  const snapshot = readResult.snapshot;
  const historical = ['HISTORICAL', 'STALE'].includes(readResult.truthState)
    && snapshot.sourceMode === 'HISTORICAL';
  const live = ['LIVE', 'WARMING_UP', 'STALE'].includes(readResult.truthState)
    && snapshot.sourceMode === 'LIVE'
    && typeof readResult.operational?.checkpointIdentity === 'string'
    && typeof readResult.operational?.validUntil === 'string';
  if (!historical && !live) {
    return unavailable('SOURCE_MODE_NOT_AUTHORIZED');
  }
  return freeze({
    schemaVersion: DASHBOARD_OBSERVED_FLOW_SCHEMA_VERSION,
    sourceState: readResult.truthState,
    unavailableReason: null,
    source: {
      sourceMode: snapshot.sourceMode,
      truthState: readResult.truthState,
      tradeDate: snapshot.tradeDate,
      availableAt: snapshot.availableAt,
      materializedAt: snapshot.materializedAt,
      observedAt: readResult.operational?.observedAt || null,
      validUntil: readResult.operational?.validUntil || null,
    },
    identity: {
      instrument: snapshot.instrument,
      actualContract: snapshot.actualContract,
      tradeDate: snapshot.tradeDate,
      session: snapshot.session,
      continuityEpoch: snapshot.continuityEpoch,
      tickSize: snapshot.tickSize,
    },
    windows: {
      primary60s: windowContract('1分', snapshot.primary60s),
      context300s: windowContract('5分', snapshot.context300s),
      window900s: windowContract('15分', snapshot.window900s?.evidence,
        readResult.truthState === 'STALE' ? 'STALE' : snapshot.window900s?.truthState,
        snapshot.window900s?.unavailableReason),
      window1800s: windowContract('30分', snapshot.window1800s?.evidence,
        readResult.truthState === 'STALE' ? 'STALE' : snapshot.window1800s?.truthState,
        snapshot.window1800s?.unavailableReason),
      window3600s: windowContract('1小時', snapshot.window3600s?.evidence,
        readResult.truthState === 'STALE' ? 'STALE' : snapshot.window3600s?.truthState,
        snapshot.window3600s?.unavailableReason),
      window14400s: windowContract('4小時', snapshot.window14400s?.evidence,
        readResult.truthState === 'STALE' ? 'STALE' : snapshot.window14400s?.truthState,
        snapshot.window14400s?.unavailableReason),
    },
    researchQuality: {
      status: snapshot.quality?.status || 'UNAVAILABLE',
      reasons: snapshot.qualityReasons || snapshot.quality?.reasons || [],
    },
    formalDirection: 'NOT_PROMOTED',
    promotionState: snapshot.promotionState,
    lineage: {
      availableAt: snapshot.availableAt,
      cutoffLedgerOrdinal: snapshot.cutoffLedgerOrdinal,
      cutoffRecordHash: snapshot.cutoffRecordHash,
      maxUsedLedgerOrdinal: snapshot.maxUsedLedgerOrdinal,
      maxUsedRecordHash: snapshot.maxUsedRecordHash,
      sourceLedgerIdentity: snapshot.sourceLedgerIdentity,
    },
    artifact: {
      artifactIdentity: snapshot.artifactIdentity || null,
      semanticContentHash: snapshot.semanticContentHash || readResult.operational?.semanticContentHash || null,
      artifactHash: snapshot.artifactHash || null,
    },
    operational: readResult.operational || null,
    methodology: snapshot.methodology,
    limitations: snapshot.limitations || [],
    ...safetyBoundary(),
  });
}

function readJson(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('LIVE_SNAPSHOT_SIZE_INVALID');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readCru34LiveSnapshot({ snapshotPath, statusPath = null, now = new Date() } = {}) {
  try {
    const snapshot = readJson(snapshotPath);
    if (!snapshot) return { truthState: 'UNAVAILABLE', unavailableReason: 'LIVE_SNAPSHOT_MISSING', snapshot: null };
    const { snapshotHash, ...body } = snapshot;
    const observedMs = Date.parse(snapshot.observedAt);
    const validUntilMs = Date.parse(snapshot.validUntil);
    const availableMs = Date.parse(snapshot.semanticPayload?.availableAt);
    if (snapshot.schemaVersion !== CRU34_LIVE_SNAPSHOT_VERSION
        || cru34LiveHash(body) !== snapshotHash
        || cru34LiveHash(snapshot.semanticPayload) !== snapshot.semanticContentHash
        || snapshot.semanticPayload?.sourceMode !== 'LIVE'
        || !['LIVE', 'WARMING_UP', 'STALE'].includes(snapshot.truthState)
        || !Number.isFinite(observedMs) || !Number.isFinite(validUntilMs) || !Number.isFinite(availableMs)
        || validUntilMs < availableMs
        || !/^[a-f0-9]{64}$/.test(snapshot.checkpointIdentity || '')
        || snapshot.formalWeight !== 0 || snapshot.researchOnly !== true
        || snapshot.executionAuthorized !== false || snapshot.orderRoutesEnabled !== false) {
      return { truthState: 'UNAVAILABLE', unavailableReason: 'LIVE_SNAPSHOT_INVALID', snapshot: null };
    }
    const workerStatus = readJson(statusPath, 64 * 1024);
    if (workerStatus?.status === 'UNAVAILABLE'
        && Date.parse(workerStatus.observedAt) >= Date.parse(snapshot.observedAt)) {
      return { truthState: 'UNAVAILABLE', unavailableReason: workerStatus.reason || 'LIVE_WORKER_UNAVAILABLE', snapshot: null };
    }
    const expired = now.getTime() > validUntilMs;
    const multi = snapshot.multiWindowPayload || null;
    if (multi && (multi.schemaVersion !== CRU44_MULTI_WINDOW_SCHEMA_VERSION
        || cru34LiveHash(Object.fromEntries(Object.entries(multi).filter(([key]) => key !== 'contentHash'))) !== multi.contentHash
        || multi.compatibility?.cru34SemanticPayloadHash !== snapshot.semanticContentHash
        || multi.formalWeight !== 0 || multi.researchOnly !== true
        || multi.executionAuthorized !== false || multi.orderRoutesEnabled !== false)) {
      return { truthState: 'UNAVAILABLE', unavailableReason: 'CRU44_MULTI_WINDOW_PAYLOAD_INVALID', snapshot: null };
    }
    return {
      truthState: expired ? 'STALE' : snapshot.truthState,
      unavailableReason: null,
      snapshot: {
        ...snapshot.semanticPayload,
        window900s: multi?.windows?.window900s || null,
        window1800s: multi?.windows?.window1800s || null,
        window3600s: multi?.windows?.window3600s || null,
        window14400s: multi?.windows?.window14400s || null,
        semanticContentHash: snapshot.semanticContentHash,
        multiWindowContentHash: multi?.contentHash || null,
      },
      operational: {
        observedAt: snapshot.observedAt,
        validUntil: snapshot.validUntil,
        semanticContentHash: snapshot.semanticContentHash,
        heartbeatAgeMs: Math.max(0, now.getTime() - availableMs),
        staleAfterMs: snapshot.staleAfterMs,
        lagBytes: snapshot.lagBytes,
        checkpointIdentity: snapshot.checkpointIdentity,
        checkpointOrdinal: snapshot.checkpointOrdinal,
        checkpointRecordHash: snapshot.checkpointRecordHash,
        warmup: snapshot.warmup,
      },
    };
  } catch (error) {
    return { truthState: 'UNAVAILABLE', unavailableReason: String(error?.message || 'LIVE_SNAPSHOT_UNREADABLE'), snapshot: null };
  }
}

export function loadDashboardObservedFlow({
  artifactPath = null,
  freshnessCutoff = null,
  liveSnapshotPath = null,
  liveStatusPath = null,
  now = new Date(),
} = {}) {
  if (liveSnapshotPath) {
    return buildDashboardObservedFlow(readCru34LiveSnapshot({
      snapshotPath: liveSnapshotPath,
      statusPath: liveStatusPath,
      now,
    }));
  }
  return buildDashboardObservedFlow(readCru34SnapshotArtifact({ artifactPath, freshnessCutoff }));
}
