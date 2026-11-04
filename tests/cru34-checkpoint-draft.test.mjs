import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as checkpointApi from '../src/cru34-live-checkpoint.mjs';

const identity = `sha256:${'a'.repeat(64)}`;
function body(overrides = {}) {
  return { sourceLedgerIdentity: identity, segmentIdentity: identity,
    lastVerifiedLedgerOrdinal: 2, lastVerifiedRecordHash: 'b'.repeat(64),
    lastVerifiedStartByteOffset: 100, lastVerifiedEndByteOffset: 200,
    canonicalState: { lastTick: { ordinal: 2 } },
    rollingCanonicalEvents: [{ kind: 'futures_tick', ledgerOrdinal: 2,
      payload: { price: 123, volume: 2, tick_type: 1 } }],
    actualContract: 'TXFI6', tradeDate: '2026-09-07', session: 'DAY', continuityEpoch: 'TX:1',
    lastVerifiedAvailableAt: '2026-09-07T01:00:00.000Z', lastEmittedSemanticHash: null,
    ...overrides };
}

// Frozen pre-draft constructor contract from c320. It intentionally uses the
// public canonical/hash contract, independently of the new body/draft helpers.
function legacyBuild(input) {
  const { checkpointHash: ignoredHash, schemaVersion: ignoredSchema, ...clean } = input;
  const payload = { schemaVersion: 'cru34-live-checkpoint-v1', ...clean,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
  return { ...payload, checkpointHash: checkpointApi.cru34LiveHash(payload) };
}

test('draft then final build preserves the old two-build serialized checkpoint contract', () => {
  for (const input of [body(), body({ lastEmittedSemanticHash: 'c'.repeat(64) }),
    body({ schemaVersion: 'untrusted-schema', checkpointHash: 'untrusted-hash',
      formalWeight: 99, researchOnly: false, executionAuthorized: true, orderRoutesEnabled: true })]) {
    const emitted = 'd'.repeat(64);
    const expected = legacyBuild({ ...legacyBuild(input), lastEmittedSemanticHash: emitted });
    const draft = checkpointApi.buildCru34LiveCheckpointDraft(input);
    const actual = checkpointApi.buildCru34LiveCheckpoint({ ...draft, lastEmittedSemanticHash: emitted });
    assert.deepEqual(actual, expected);
    assert.equal(checkpointApi.cru34LiveCanonicalJson(actual), checkpointApi.cru34LiveCanonicalJson(expected));
    assert.equal(actual.checkpointHash, expected.checkpointHash);
    assert.equal(actual.rollingCanonicalEvents, input.rollingCanonicalEvents);
    assert.equal(Object.hasOwn(draft, 'checkpointHash'), false);
    assert.throws(() => checkpointApi.validateCru34LiveCheckpoint(draft), /CRU43_CHECKPOINT_HASH_INVALID/);
  }
});

test('cheap draft structure checks reject invalid source, anchors and oversized state without traversing events', () => {
  const oversized = new Array(250_001);
  Object.defineProperty(oversized, '0', { get() { assert.fail('shape validation must not traverse rolling rows'); } });
  for (const [overrides, reason] of [
    [{ sourceLedgerIdentity: 'unknown' }, 'SOURCE_IDENTITY'],
    [{ lastVerifiedLedgerOrdinal: 0 }, 'ANCHOR'],
    [{ lastVerifiedEndByteOffset: 100 }, 'ANCHOR'],
    [{ lastVerifiedRecordHash: null }, 'ANCHOR'],
    [{ rollingCanonicalEvents: null }, 'ROLLING_STATE'],
    [{ rollingCanonicalEvents: oversized }, 'ROLLING_STATE'],
  ]) assert.throws(() => checkpointApi.buildCru34LiveCheckpointDraft(body(overrides)),
    new RegExp(`CRU43_CHECKPOINT_${reason}_INVALID`));
});

test('worker rejects an oversized draft before any Flow calculation or publication', () => {
  // Execute the actual worker function with only boundary adapters. No native
  // files, publisher, runner, environment or service is invoked by this test.
  const source = fs.readFileSync(new URL('../src/cru34-live-projection-worker.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('export function projectCru34LiveBatch(');
  assert.ok(begin >= 0);
  const tick = { kind: 'futures_tick', ledgerOrdinal: 1, actualContract: 'TXFI6',
    tradeDate: '2026-09-07', session: 'DAY', continuityEpoch: 'TX:1', recordHash: 'b'.repeat(64) };
  const row = { record: { previousHash: 'GENESIS', recordHash: 'b'.repeat(64), receivedAt: '2026-09-07T01:00:00Z' },
    startOffset: 0, endOffset: 200 };
  const context = { DEFAULT_MAX_BATCH_BYTES: 8 * 1024 * 1024, DEFAULT_MAX_BATCH_RECORDS: 25_000,
    DEFAULT_STALE_AFTER_MS: 30_000, fs: { existsSync: () => true },
    readCru34LiveCheckpoint: () => null,
    readCompleteBatch: () => ({ rows: [row], observedSize: 200 }),
    assertRecord: () => {}, sourceIdentity: () => identity,
    materializeTxCanonicalObservations: () => ({ events: [tick], terminalState: {} }),
    checkpointEvent: value => value, pruneRolling: () => new Array(250_001),
    buildCru34LiveCheckpointDraft: checkpointApi.buildCru34LiveCheckpointDraft,
    buildCru34LiveCheckpoint: checkpointApi.buildCru34LiveCheckpoint,
    buildTxIntradayResearchSnapshot() { assert.fail('oversized draft reached Flow'); },
    publishCru34Snapshot() { assert.fail('oversized draft reached publication'); },
    writeCru34LiveCheckpoint() { assert.fail('oversized draft reached checkpoint commit'); },
  };
  vm.runInNewContext(`${source.slice(begin).replace(/^export /, '')}\nglobalThis.project = projectCru34LiveBatch;`, context);
  assert.throws(() => context.project({ ledgerPath: 'synthetic', checkpointPath: 'synthetic', snapshotPath: 'synthetic' }),
    /CRU43_CHECKPOINT_ROLLING_STATE_INVALID/);
});

test('persisted checkpoint validation still detects nested mutation after a valid build', () => {
  const checkpoint = checkpointApi.buildCru34LiveCheckpoint(body());
  checkpoint.rollingCanonicalEvents[0].payload.price = 999;
  assert.throws(() => checkpointApi.validateCru34LiveCheckpoint(checkpoint), /CRU43_CHECKPOINT_HASH_INVALID/);
});
