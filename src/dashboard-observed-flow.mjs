import { readCru34SnapshotArtifact } from './cru34-snapshot-artifact.mjs';

export const DASHBOARD_OBSERVED_FLOW_SCHEMA_VERSION = 'dashboard-observed-flow-v1';

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

function windowContract(label, source) {
  const pressure = source?.pressure || {};
  const response = source?.response || {};
  const pathEfficiency = source?.pathEfficiency || {};
  return {
    label,
    windowMs: source?.windowMs ?? pressure.windowMs ?? null,
    status: source?.status || 'UNAVAILABLE',
    unavailableReason: source?.unavailableReason || null,
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
  if (!['HISTORICAL', 'STALE'].includes(readResult.truthState)
      || snapshot.sourceMode !== 'HISTORICAL') {
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
      primary60s: windowContract('60s', snapshot.primary60s),
      context300s: windowContract('300s', snapshot.context300s),
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
      artifactIdentity: snapshot.artifactIdentity,
      semanticContentHash: snapshot.semanticContentHash,
      artifactHash: snapshot.artifactHash,
    },
    methodology: snapshot.methodology,
    limitations: snapshot.limitations || [],
    ...safetyBoundary(),
  });
}

export function loadDashboardObservedFlow({ artifactPath = null, freshnessCutoff = null } = {}) {
  return buildDashboardObservedFlow(readCru34SnapshotArtifact({ artifactPath, freshnessCutoff }));
}
