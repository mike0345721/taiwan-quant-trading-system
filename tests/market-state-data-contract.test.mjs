import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarketStateCollectionRecord } from '../src/market-state-data-contract.mjs';

function record(overrides = {}) {
  return {
    source: 'provider',
    instrument: 'NQ',
    market: 'CME',
    tradeDate: '2026-08-10',
    session: 'night',
    eventTime: '2026-08-10T00:00:00.000Z',
    receivedAt: '2026-08-10T00:00:00.200Z',
    availableAt: '2026-08-10T00:00:00.200Z',
    rawPayloadHash: 'a'.repeat(64),
    qualityStatus: 'VALID',
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: { price: 1 },
    ...overrides,
  };
}

test('valid collection record is canonicalized and permanently non-executable', () => {
  const result = validateMarketStateCollectionRecord(record({ sourceId: 'x', sequence: 12 }));
  assert.equal(result.ok, true);
  assert.equal(result.canonical.schemaVersion, 'market-state-collection-v1');
  assert.equal(result.canonical.executionAuthorized, false);
  assert.equal(result.canonical.orderRoutesEnabled, false);
  assert.equal(result.canonical.sourceId, 'x');
  assert.equal(result.canonical.sequence, 12);
});

test('collection contract rejects missing provenance and invalid hashes', () => {
  const result = validateMarketStateCollectionRecord(record({ source: '', rawPayloadHash: 'bad' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('SOURCE_REQUIRED'));
  assert.ok(result.errors.includes('RAW_PAYLOAD_HASH_INVALID'));
});

test('collection contract rejects impossible or ambiguous time semantics', () => {
  const receivedBeforeEvent = validateMarketStateCollectionRecord(record({ receivedAt: '2026-08-09T23:59:59.900Z', availableAt: '2026-08-10T00:00:00.200Z' }));
  assert.ok(receivedBeforeEvent.errors.includes('RECEIVED_AT_BEFORE_EVENT'));

  const availableBeforeEvent = validateMarketStateCollectionRecord(record({ availableAt: '2026-08-09T23:59:59.000Z' }));
  assert.ok(availableBeforeEvent.errors.includes('AVAILABLE_AT_BEFORE_EVENT'));
  assert.ok(availableBeforeEvent.errors.includes('AVAILABLE_AT_BEFORE_RECEIVED'));

  const embargoed = validateMarketStateCollectionRecord(record({ availableAt: '2026-08-10T00:00:00.300Z' }));
  assert.equal(embargoed.ok, true);

  const invalid = validateMarketStateCollectionRecord(record({ eventTime: 'bad-time' }));
  assert.ok(invalid.errors.includes('EVENT_TIME_INVALID'));
});

test('collection contract fails closed for execution and order routing', () => {
  const execution = validateMarketStateCollectionRecord(record({ executionAuthorized: true }));
  assert.ok(execution.errors.includes('EXECUTION_MUST_BE_FALSE'));

  const route = validateMarketStateCollectionRecord(record({ orderRoutesEnabled: true }));
  assert.ok(route.errors.includes('ORDER_ROUTES_MUST_NOT_BE_ENABLED'));
});
