import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DW4_COLLECTION_ACTIVATION_BOUNDARY,
  validateDw4ForwardCollectionRecord,
} from '../src/dw4-forward-collection-contract.mjs';

function record(overrides = {}) {
  return {
    source: 'shioaji', sourceId: 'IX0001_QUOTE', instrument: 'IX0001', market: 'TWSE',
    tradeDate: '2026-08-14', session: 'DAY', contract: 'IX0001', expiry: null,
    eventTime: '2026-08-14T05:30:00.000Z', receivedAt: '2026-08-14T05:30:00.050Z',
    availableAt: '2026-08-14T05:30:00.050Z', nativeSequenceAvailability: 'UNAVAILABLE',
    nativeSequence: null, rawPayloadHash: 'a'.repeat(64), qualityStatus: 'AVAILABLE',
    qualityReasons: [], collectionRunId: 'run-20260814', collectorVersion: 'bridge-v1',
    payload: { raiseCount: 291, fallCount: 702, flatCount: 95 },
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    ...overrides,
  };
}

test('canonical forward record preserves provenance, availability and safety', () => {
  const result = validateDw4ForwardCollectionRecord(record());
  assert.equal(result.ok, true);
  assert.equal(result.canonical.sourceId, 'IX0001_QUOTE');
  assert.equal(result.canonical.nativeSequenceAvailability, 'UNAVAILABLE');
  assert.equal(result.canonical.nativeSequence, null);
  assert.equal(result.canonical.researchOnly, true);
  assert.equal(result.canonical.executionAuthorized, false);
  assert.equal(result.canonical.orderRoutesEnabled, false);
});

test('native sequence truth is not fabricated and malformed provenance fails closed', () => {
  const sequence = validateDw4ForwardCollectionRecord(record({ nativeSequence: 10 }));
  assert.ok(sequence.errors.includes('NATIVE_SEQUENCE_MUST_BE_NULL'));
  const provenance = validateDw4ForwardCollectionRecord(record({ sourceId: '', rawPayloadHash: 'bad' }));
  assert.ok(provenance.errors.includes('SOURCEID_REQUIRED'));
  assert.ok(provenance.errors.includes('RAW_PAYLOAD_HASH_INVALID'));
});

test('timestamp lineage insufficiency is retained rather than discarded', () => {
  const result = validateDw4ForwardCollectionRecord(record({
    receivedAt: '2026-08-14T05:29:59.900Z',
    availableAt: '2026-08-14T05:30:00.000Z',
    qualityStatus: 'QUALITY_INSUFFICIENT',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.canonical.timestampLineageQuality, 'QUALITY_INSUFFICIENT');
  assert.ok(result.canonical.qualityReasons.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
  const falseGreen = validateDw4ForwardCollectionRecord(record({
    receivedAt: '2026-08-14T05:29:59.900Z', availableAt: '2026-08-14T05:30:00.000Z',
  }));
  assert.ok(falseGreen.errors.includes('TIMESTAMP_LINEAGE_REQUIRES_QUALITY_INSUFFICIENT'));
});

test('collection activation remains default-off and duplicate collectors are prohibited', () => {
  assert.equal(DW4_COLLECTION_ACTIVATION_BOUNDARY.existingCollectorReuseRequired, true);
  assert.equal(DW4_COLLECTION_ACTIVATION_BOUNDARY.duplicateCollectorAllowed, false);
  assert.equal(DW4_COLLECTION_ACTIVATION_BOUNDARY.productionActivationApproved, false);
  assert.equal(DW4_COLLECTION_ACTIVATION_BOUNDARY.continuitySupervisorActivated, false);
});
