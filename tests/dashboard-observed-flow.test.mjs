import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardObservedFlow,
  loadDashboardObservedFlow,
} from '../src/dashboard-observed-flow.mjs';

function window(windowMs, pressureRatio, classifiedCoverage, displacementPoints, pathEfficiency) {
  return {
    windowMs,
    status: 'QUALITY_INSUFFICIENT',
    unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',
    pressure: {
      status: 'QUALITY_INSUFFICIENT',
      unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',
      buyProxyVolume: 85,
      sellProxyVolume: 58,
      unknownVolume: 3,
      classifiedVolume: 143,
      totalExecutedVolume: 146,
      netAggressiveFlowProxy: 27,
      pressureRatio,
      classifiedCoverage,
      bestQuoteCrossCheck: {
        matchedCoverage: 0.87,
        matchedTicks: 90,
        buyProxyVolume: 69,
        sellProxyVolume: 58,
        insideSpreadVolume: 19,
        unavailableVolume: 0,
      },
      conflict: { count: 5, rate: 0.055 },
    },
    response: {
      status: 'READY', startPrice: 46428, endPrice: 46450,
      displacementPoints, displacementTicks: displacementPoints,
      directionRelation: 'PRESSURE_UNAVAILABLE',
    },
    pathEfficiency: {
      status: 'READY', value: pathEfficiency, unavailableReason: null,
      netDisplacementPoints: Math.abs(displacementPoints), pathLengthPoints: 202,
      tickCount: 103, maxObservedGapMs: 3828, maxAllowedGapMs: 30000,
    },
  };
}

function governedReadResult(truthState = 'HISTORICAL') {
  return {
    truthState,
    unavailableReason: null,
    snapshot: {
      schemaVersion: 'cru34-snapshot-contract-v1',
      sourceMode: 'HISTORICAL',
      instrument: 'TX', actualContract: 'TXFI6', tradeDate: '2026-08-28', session: 'DAY',
      continuityEpoch: 'TX:2', tickSize: 1,
      availableAt: '2026-08-28T09:27:59.953738+08:00',
      materializedAt: '2026-08-31T23:57:00.000Z',
      primary60s: window(60_000, 0.1888111888111888, 0.9794520547945206, 22, 0.10891089108910891),
      context300s: window(300_000, -0.22084690553745928, 0.9827144686299616, -61, 0.03263777421080792),
      quality: { status: 'QUALITY_INSUFFICIENT', reasons: ['PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE'] },
      qualityReasons: ['PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE'],
      promotionState: { marketState: 'NOT_PROVIDED', controlObservationState: 'RESEARCH_PENDING' },
      cutoffLedgerOrdinal: 163114,
      cutoffRecordHash: 'a'.repeat(64),
      maxUsedLedgerOrdinal: 163114,
      maxUsedRecordHash: 'a'.repeat(64),
      sourceLedgerIdentity: `sha256:${'b'.repeat(64)}`,
      artifactIdentity: `cru34-historical-${'c'.repeat(64)}`,
      semanticContentHash: 'd'.repeat(64),
      artifactHash: 'e'.repeat(64),
      methodology: { pressure: 'provider classification proxy; UNKNOWN preserved' },
      limitations: ['No trading direction is produced.'],
    },
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
}

test('quality-insufficient historical evidence keeps lawful descriptive 60s and 300s values', () => {
  const contract = buildDashboardObservedFlow(governedReadResult());
  assert.equal(contract.sourceState, 'HISTORICAL');
  assert.equal(contract.researchQuality.status, 'QUALITY_INSUFFICIENT');
  assert.deepEqual(contract.researchQuality.reasons, ['PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE']);
  assert.equal(contract.windows.primary60s.pressure.pressureRatio, 0.1888111888111888);
  assert.equal(contract.windows.primary60s.pressure.classifiedCoverage, 0.9794520547945206);
  assert.equal(contract.windows.primary60s.response.displacementPoints, 22);
  assert.equal(contract.windows.primary60s.pathEfficiency.value, 0.10891089108910891);
  assert.equal(contract.windows.context300s.pressure.pressureRatio, -0.22084690553745928);
  assert.equal(contract.windows.context300s.response.displacementPoints, -61);
  assert.equal(contract.formalDirection, 'NOT_PROMOTED');
  assert.equal(contract.recommendation, false);
  assert.equal(contract.executionAuthorized, false);
  assert.equal(Object.isFrozen(contract.windows.primary60s.pressure), true);
});

test('stale is a source truth state independent from research quality', () => {
  const contract = buildDashboardObservedFlow(governedReadResult('STALE'));
  assert.equal(contract.sourceState, 'STALE');
  assert.equal(contract.researchQuality.status, 'QUALITY_INSUFFICIENT');
  assert.equal(contract.source.sourceMode, 'HISTORICAL');
});

test('unavailable reader result clears all descriptive windows and exposes the exact reason', () => {
  const contract = buildDashboardObservedFlow({
    truthState: 'UNAVAILABLE', unavailableReason: 'ARTIFACT_HASH_INVALID', snapshot: null,
  });
  assert.equal(contract.sourceState, 'UNAVAILABLE');
  assert.equal(contract.unavailableReason, 'ARTIFACT_HASH_INVALID');
  assert.equal(contract.windows, null);
  assert.equal(contract.source, null);
  assert.equal(contract.formalDirection, 'NOT_PROMOTED');
});

test('consumer rejects a future unapproved LIVE producer even when a snapshot object is present', () => {
  const result = governedReadResult();
  result.truthState = 'LIVE';
  result.snapshot.sourceMode = 'LIVE';
  const contract = buildDashboardObservedFlow(result);
  assert.equal(contract.sourceState, 'UNAVAILABLE');
  assert.equal(contract.unavailableReason, 'SOURCE_MODE_NOT_AUTHORIZED');
  assert.equal(contract.windows, null);
});

test('missing configured artifact fails closed without fallback', () => {
  const contract = loadDashboardObservedFlow({ artifactPath: null });
  assert.equal(contract.sourceState, 'UNAVAILABLE');
  assert.equal(contract.unavailableReason, 'ARTIFACT_MISSING');
  assert.equal(contract.windows, null);
});
