import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DW4_EVIDENCE_CONTRACT,
  DW4_SOURCE_IDENTITY_GUARDS,
  createDw4EvidenceObservation,
  summarizeDw4Evidence,
} from '../src/dw4-evidence-conflict-monitor.mjs';

function observation(evidenceId, state, overrides = {}) {
  return createDw4EvidenceObservation({
    evidenceId, state, group: 'TEST', sourceId: `${evidenceId}-source`,
    eventTime: '2026-08-14T05:00:00.000Z', availableAt: '2026-08-14T05:00:01.000Z',
    ...overrides,
  });
}

test('missing, stale and quality-insufficient evidence never become neutral', () => {
  assert.equal(summarizeDw4Evidence([observation('missing', 'UNAVAILABLE')]).state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(summarizeDw4Evidence([observation('stale', 'STALE')]).state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(summarizeDw4Evidence([observation('quality', 'QUALITY_INSUFFICIENT')]).state, 'QUALITY_BLOCKED');
  assert.throws(() => observation('missing-direction', 'UNAVAILABLE', { direction: 'UP' }), /NON_DIRECTIONAL/);
});

test('transparent evidence states create alignment or mixed without scoring', () => {
  const aligned = summarizeDw4Evidence([
    observation('price', 'SUPPORTS_UP'), observation('breadth', 'SUPPORTS_UP'), observation('options', 'NEUTRAL'),
  ]);
  assert.equal(aligned.state, 'ALIGNED_UP');
  assert.equal(aligned.score, null);
  assert.equal(aligned.confidence, null);
  const mixed = summarizeDw4Evidence([
    observation('price', 'SUPPORTS_UP'), observation('breadth', 'SUPPORTS_DOWN'),
  ]);
  assert.equal(mixed.state, 'MIXED');
});

test('contract prohibits hidden weights, trading signals and promotion shortcuts', () => {
  assert.equal(DW4_EVIDENCE_CONTRACT.hiddenWeightsAllowed, false);
  assert.equal(DW4_EVIDENCE_CONTRACT.numericScoreAllowed, false);
  assert.equal(DW4_EVIDENCE_CONTRACT.tradingSignalAllowed, false);
  assert.deepEqual(DW4_EVIDENCE_CONTRACT.promotionRequired, [
    'RAW_COLLECTION', 'COVERAGE_AUDIT', 'QUALITY_AUDIT', 'AVAILABLE_AT_AUDIT',
    'DETERMINISTIC_REPLAY', 'DESCRIPTIVE_VALIDATION', 'OWNER_REVIEW', 'DW4_EVIDENCE_CANDIDATE',
  ]);
});

test('NDX proxy, 2330 price and raw options cannot be silently relabeled', () => {
  assert.equal(DW4_SOURCE_IDENTITY_GUARDS.ndx, 'NDX_PROXY');
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.ndx, 'NQ_FUTURES');
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.tsmcPrice, DW4_SOURCE_IDENTITY_GUARDS.tsmcContribution);
  assert.notEqual(DW4_SOURCE_IDENTITY_GUARDS.rawOptions, 'VALIDATED_IV');
  assert.equal(DW4_SOURCE_IDENTITY_GUARDS.providerGreeks, 'FUTURE_NOT_REQUIRED');
});
