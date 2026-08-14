import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DW4_EVIDENCE_CONTRACT,
  DW4_SOURCE_IDENTITY_GUARDS,
  createDw4EvidenceObservation,
  summarizeDw4Evidence,
} from '../src/dw4-evidence-conflict-monitor.mjs';

function observation(family, directionState, overrides = {}) {
  return createDw4EvidenceObservation({
    evidenceId: `${family}-evidence`, family, directionState,
    availabilityState: 'AVAILABLE', qualityState: 'PASS', promotionState: 'ELIGIBLE',
    sourceId: `${family}-source`, eventTime: '2026-08-14T05:00:00.000Z',
    availableAt: '2026-08-14T05:00:01.000Z', ...overrides,
  });
}

test('one quality-insufficient source does not erase valid mixed conflict', () => {
  const result = summarizeDw4Evidence([
    observation('Price', 'NOT_ELIGIBLE', {
      qualityState: 'QUALITY_INSUFFICIENT',
      qualityReasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'],
    }),
    observation('Breadth', 'SUPPORTS_UP'),
    observation('Futures', 'SUPPORTS_UP'),
    observation('Options', 'SUPPORTS_UP'),
    observation('Global', 'SUPPORTS_DOWN'),
  ], { expectedEvidenceFamilies: ['Price', 'Breadth', 'Futures', 'Options', 'Global'] });
  assert.equal(result.conflictState, 'MIXED');
  assert.equal(result.coverageState, 'PARTIAL');
  assert.equal(result.dataTrustState, 'QUALITY_INSUFFICIENT');
  assert.deepEqual(result.qualityExcludedFamilies, ['Price']);
  assert.equal(result.eligibleFamilies, 4);
  assert.equal(result.expectedFamilies, 5);
});

test('all directional evidence unavailable stays blocked and never becomes neutral', () => {
  const unavailable = observation('Price', 'NOT_ELIGIBLE', {
    availabilityState: 'UNAVAILABLE', eventTime: null, availableAt: null,
  });
  const result = summarizeDw4Evidence([unavailable], { expectedEvidenceFamilies: ['Price', 'Breadth'] });
  assert.equal(result.conflictState, 'NO_DIRECTIONAL_EVIDENCE');
  assert.equal(result.coverageState, 'INSUFFICIENT');
  assert.equal(result.dataTrustState, 'BLOCKED');
  assert.deepEqual(result.unavailableEvidenceFamilies, ['Price']);
  assert.deepEqual(result.missingEvidenceFamilies, ['Breadth']);
  assert.throws(() => observation('bad', 'SUPPORTS_UP', { availabilityState: 'STALE' }), /NON_ELIGIBLE/);
});

test('eligible directions create transparent alignment or mixed without scoring', () => {
  assert.equal(summarizeDw4Evidence([observation('Price', 'SUPPORTS_UP')]).conflictState, 'ALIGNED_UP');
  assert.equal(summarizeDw4Evidence([observation('Price', 'SUPPORTS_DOWN')]).conflictState, 'ALIGNED_DOWN');
  const mixed = summarizeDw4Evidence([
    observation('Price', 'SUPPORTS_UP'), observation('Breadth', 'SUPPORTS_DOWN'),
  ]);
  assert.equal(mixed.conflictState, 'MIXED');
  assert.equal(mixed.coverageState, 'COMPLETE');
  assert.equal(mixed.dataTrustState, 'PASS');
  assert.equal(mixed.score, null);
  assert.equal(mixed.confidence, null);
});

test('stale and not-promoted observations are excluded and degrade trust', () => {
  const result = summarizeDw4Evidence([
    observation('Price', 'SUPPORTS_UP'),
    observation('Options', 'NOT_ELIGIBLE', { availabilityState: 'STALE' }),
    observation('Breadth', 'NOT_ELIGIBLE', { promotionState: 'RAW_ONLY' }),
  ]);
  assert.equal(result.conflictState, 'ALIGNED_UP');
  assert.equal(result.coverageState, 'PARTIAL');
  assert.equal(result.dataTrustState, 'DEGRADED');
  assert.deepEqual(result.staleEvidenceFamilies, ['Options']);
  assert.deepEqual(result.promotionExcludedFamilies, ['Breadth']);
});

test('contract prohibits hidden weights, trading signals and promotion shortcuts', () => {
  assert.equal(DW4_EVIDENCE_CONTRACT.hiddenWeightsAllowed, false);
  assert.equal(DW4_EVIDENCE_CONTRACT.numericScoreAllowed, false);
  assert.equal(DW4_EVIDENCE_CONTRACT.tradingSignalAllowed, false);
  assert.deepEqual(DW4_EVIDENCE_CONTRACT.allowedConflictStates,
    ['ALIGNED_UP', 'ALIGNED_DOWN', 'MIXED', 'NO_DIRECTIONAL_EVIDENCE']);
});

test('NDX proxy, 2330 price and raw options cannot be silently relabeled', () => {
  assert.equal(DW4_SOURCE_IDENTITY_GUARDS.ndx, 'NDX_PROXY');
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.ndx, 'NQ_FUTURES');
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.tsmcPrice, DW4_SOURCE_IDENTITY_GUARDS.tsmcContribution);
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.rawOptions, 'VALIDATED_IV');
});
