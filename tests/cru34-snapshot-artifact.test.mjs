import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CRU34_SNAPSHOT_CONTRACT_VERSION,
  buildCru34SnapshotArtifact,
  cru34ArtifactFileName,
  cru34SelectionKey,
  readCru34SnapshotArtifact,
  selectCru34SnapshotArtifact,
  stableCru34ArtifactJson,
  validateCru34SnapshotArtifact,
  writeCru34SnapshotArtifact,
} from '../src/cru34-snapshot-artifact.mjs';
import {
  materializeCru34HistoricalLedger,
  materializeCru34HistoricalSnapshot,
} from '../src/cru34-historical-materializer.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });
const SOURCE_SHA = 'a'.repeat(64);
const EXPECTED = Object.freeze({
  schemaVersion: CRU34_SNAPSHOT_CONTRACT_VERSION,
  actualContract: 'TXFI6',
  tradeDate: '2026-08-26',
  session: 'DAY',
  continuityEpoch: 'TX:1',
});

function tick(hash, second, price, tickType = 1) {
  const eventTime = `2026-08-26T09:00:${String(second).padStart(2, '0')}.000+08:00`;
  return {
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: eventTime,
    exchangeTimestamp: eventTime, recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', eventTime,
      datetime: eventTime, tradeDate: '2026-08-26', session: 'DAY', simtrade: false,
      price, close: price, executedVolume: 1, volume: 1, tick_type: tickType,
    },
  };
}

function quote(hash, second, bid, ask) {
  const eventTime = `2026-08-26T09:00:${String(second).padStart(2, '0')}.000+08:00`;
  return {
    kind: 'futures_bidask', code: 'TXFI6', product: 'TXFI6', receivedAt: eventTime,
    exchangeTimestamp: eventTime, recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', eventTime,
      datetime: eventTime, tradeDate: '2026-08-26', session: 'DAY', simtrade: false,
      bid_price: [bid], ask_price: [ask],
    },
  };
}

function chain(records) {
  let previousHash = 'GENESIS';
  return records.map((record) => {
    const linked = { ...record, previousHash };
    previousHash = record.recordHash;
    return linked;
  });
}

function normalLedger() {
  return chain([
    quote('q1', 0, 99, 100),
    tick('t1', 1, 100, 1),
    quote('q2', 10, 100, 101),
    tick('t2', 11, 101, 2),
    quote('q3', 20, 101, 102),
    tick('t3', 21, 102, 1),
  ]);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cru36-artifact-'));
}

function materialize(root, extra = {}) {
  return materializeCru34HistoricalSnapshot({
    records: normalLedger(),
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixByteSize: 5_000,
    cutoffLedgerOrdinal: 6,
    instrumentProfile: PROFILE,
    artifactRoot: root,
    materializedAt: '2026-08-31T06:00:00.000Z',
    ...extra,
  });
}

function containsKey(value, target) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, target));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => key === target || containsKey(nested, target));
}

function writeTampered(root, original, mutate) {
  const tampered = structuredClone(original);
  mutate(tampered);
  const filePath = path.join(root, cru34ArtifactFileName(original));
  fs.writeFileSync(filePath, stableCru34ArtifactJson(tampered), 'utf8');
  return filePath;
}

test('materializes a bounded immutable historical contract without raw usedEvents', () => {
  const root = tempDir();
  const result = materialize(root);
  assert.equal(result.semanticPayload.sourceMode, 'HISTORICAL');
  assert.equal(result.semanticPayload.actualContract, 'TXFI6');
  assert.equal(result.semanticPayload.cutoffLedgerOrdinal, 6);
  assert.equal(result.semanticPayload.sourceLedgerIdentity, `sha256:${SOURCE_SHA}`);
  assert.equal(result.artifact.operationalEnvelope.materializedAt, '2026-08-31T06:00:00.000Z');
  assert.equal(containsKey(result.artifact, 'usedEvents'), false);
  assert.ok(result.write.byteSize < 4 * 1024 * 1024);
  assert.equal(result.write.reused, false);
});

test('identical source and cutoff keep semantic hash and identity stable across operational timestamps', () => {
  const first = materialize(tempDir(), { materializedAt: '2026-08-31T06:00:00.000Z' });
  const second = materialize(tempDir(), { materializedAt: '2026-08-31T07:00:00.000Z' });
  assert.equal(first.artifact.semanticContentHash, second.artifact.semanticContentHash);
  assert.equal(first.artifact.artifactIdentity, second.artifact.artifactIdentity);
  assert.notEqual(first.artifact.artifactHash, second.artifact.artifactHash);
});

test('accepted immutable artifact is reused and never overwritten by a later operational envelope', () => {
  const root = tempDir();
  const first = materialize(root, { materializedAt: '2026-08-31T06:00:00.000Z' });
  const second = materialize(root, { materializedAt: '2026-08-31T07:00:00.000Z' });
  assert.equal(second.write.reused, true);
  assert.equal(second.write.artifact.artifactHash, first.write.artifact.artifactHash);
  assert.equal(second.write.artifact.operationalEnvelope.materializedAt, '2026-08-31T06:00:00.000Z');
});

test('valid artifact reads as HISTORICAL and can be explicitly marked STALE', () => {
  const result = materialize(tempDir());
  const historical = readCru34SnapshotArtifact({ artifactPath: result.write.filePath, expectedIdentity: EXPECTED });
  assert.equal(historical.truthState, 'HISTORICAL');
  assert.equal(historical.snapshot.sourceMode, 'HISTORICAL');
  assert.equal(historical.snapshot.truthState, 'HISTORICAL');
  const stale = readCru34SnapshotArtifact({
    artifactPath: result.write.filePath,
    expectedIdentity: EXPECTED,
    freshnessCutoff: '2026-08-27T00:00:00.000Z',
  });
  assert.equal(stale.truthState, 'STALE');
  assert.notEqual(stale.snapshot.truthState, 'LIVE');
});

test('missing artifact fails closed to UNAVAILABLE', () => {
  const read = readCru34SnapshotArtifact({ artifactPath: path.join(tempDir(), 'missing.json') });
  assert.equal(read.truthState, 'UNAVAILABLE');
  assert.equal(read.unavailableReason, 'ARTIFACT_MISSING');
});

test('truncated JSON fails closed', () => {
  const root = tempDir();
  const result = materialize(root);
  fs.writeFileSync(result.write.filePath, '{"artifactSchemaVersion":', 'utf8');
  const read = readCru34SnapshotArtifact({ artifactPath: result.write.filePath });
  assert.equal(read.truthState, 'UNAVAILABLE');
  assert.equal(read.unavailableReason, 'ARTIFACT_CORRUPT_JSON');
});

test('malformed structure and unsupported schema fail closed', () => {
  const root = tempDir();
  const result = materialize(root);
  let filePath = writeTampered(root, result.artifact, (artifact) => { artifact.semanticPayload = null; });
  assert.equal(readCru34SnapshotArtifact({ artifactPath: filePath }).truthState, 'UNAVAILABLE');
  filePath = writeTampered(root, result.artifact, (artifact) => { artifact.artifactSchemaVersion = 'future-v9'; });
  const unsupported = readCru34SnapshotArtifact({ artifactPath: filePath });
  assert.equal(unsupported.unavailableReason, 'ARTIFACT_SCHEMA_UNSUPPORTED');
});

test('artifact hash mismatch and semantic content hash mismatch fail closed', () => {
  const artifactRoot = tempDir();
  const result = materialize(artifactRoot);
  let filePath = writeTampered(artifactRoot, result.artifact, (artifact) => { artifact.artifactHash = 'b'.repeat(64); });
  assert.equal(readCru34SnapshotArtifact({ artifactPath: filePath }).unavailableReason, 'ARTIFACT_HASH_INVALID');
  filePath = writeTampered(artifactRoot, result.artifact, (artifact) => {
    artifact.semanticPayload.primary60s.pressure.buyProxyVolume += 1;
  });
  assert.equal(readCru34SnapshotArtifact({ artifactPath: filePath }).unavailableReason, 'SEMANTIC_CONTENT_HASH_INVALID');
});

test('incomplete temp artifact is ignored by deterministic selection', () => {
  const root = tempDir();
  const result = materialize(root);
  fs.writeFileSync(path.join(root, `.${result.write.fileName}.999.tmp`), '{', 'utf8');
  const selected = selectCru34SnapshotArtifact({ artifactRoot: root, selector: EXPECTED });
  assert.equal(selected.truthState, 'HISTORICAL');
  assert.equal(selected.snapshot.artifactIdentity, result.artifact.artifactIdentity);
});

test('corrupt newest exact-identity candidate blocks fallback to an older artifact', () => {
  const root = tempDir();
  materialize(root);
  const key = cru34SelectionKey(EXPECTED);
  fs.writeFileSync(path.join(root, `${key}.0000000000000007.${'f'.repeat(64)}.json`), '{', 'utf8');
  const selected = selectCru34SnapshotArtifact({ artifactRoot: root, selector: EXPECTED });
  assert.equal(selected.truthState, 'UNAVAILABLE');
  assert.equal(selected.unavailableReason, 'ARTIFACT_CORRUPT_JSON');
});

test('wrong contract, trade date, session, or continuity epoch is never selected', () => {
  const root = tempDir();
  materialize(root);
  for (const [key, value] of [
    ['actualContract', 'TXFJ6'],
    ['tradeDate', '2026-08-27'],
    ['session', 'NIGHT'],
    ['continuityEpoch', 'TX:2'],
  ]) {
    const selected = selectCru34SnapshotArtifact({ artifactRoot: root, selector: { ...EXPECTED, [key]: value } });
    assert.equal(selected.truthState, 'UNAVAILABLE');
    assert.equal(selected.unavailableReason, 'ARTIFACT_NOT_FOUND_FOR_IDENTITY');
  }
});

test('invalid source identity cannot be built or accepted', () => {
  const result = materialize(tempDir());
  const payload = structuredClone(result.semanticPayload);
  payload.sourceLedgerIdentity = `sha256:${'b'.repeat(64)}`;
  assert.throws(() => buildCru34SnapshotArtifact(payload, {
    materializedAt: '2026-08-31T06:00:00.000Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 1,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 1,
  }), /CRU36_SOURCE_IDENTITY_SHA_MISMATCH/);
});

test('immutable conflict fails closed instead of replacing a corrupt accepted path', () => {
  const root = tempDir();
  const result = materialize(root);
  fs.writeFileSync(result.write.filePath, '{}\n', 'utf8');
  assert.throws(() => writeCru34SnapshotArtifact(root, result.artifact));
});

test('artifact adapter is isolated from ledger, chart-cache, latest, Shioaji, and CRU-34 recomputation imports', () => {
  const source = fs.readFileSync(new URL('../src/cru34-snapshot-artifact.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /live-event-ledger|dashboard-tx-chart|\/latest|shioaji|buildTxIntradayResearchSnapshot/i);
});

test('explicit ledger job verifies source SHA, materializes, and bounded adapter reads it', async () => {
  const root = tempDir();
  const ledgerPath = path.join(root, 'governed.ndjson');
  const bytes = Buffer.from(`${normalLedger().map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(ledgerPath, bytes);
  const sourceSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const report = await materializeCru34HistoricalLedger({
    ledgerPath,
    artifactRoot: path.join(root, 'artifacts'),
    cutoffLedgerOrdinals: [6],
    expectedSourceSha256: sourceSha,
    expectedIdentity: EXPECTED,
    instrumentProfile: PROFILE,
    materializedAt: '2026-08-31T06:00:00.000Z',
  });
  assert.equal(report.status, 'PASS');
  assert.equal(report.sourceLedgerSha256, sourceSha);
  assert.equal(report.prefixRecordCount, 6);
  assert.equal(report.prefixByteSize, bytes.length);
  assert.equal(report.snapshotCount, 1);
  assert.ok(report.snapshots[0].adapterReadMs >= 0);
  assert.equal(report.executionAuthorized, false);
});

test('ledger job rejects a mismatched persisted source SHA', async () => {
  const root = tempDir();
  const ledgerPath = path.join(root, 'governed.ndjson');
  fs.writeFileSync(ledgerPath, `${normalLedger().map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  await assert.rejects(materializeCru34HistoricalLedger({
    ledgerPath,
    artifactRoot: path.join(root, 'artifacts'),
    cutoffLedgerOrdinals: [6],
    expectedSourceSha256: 'f'.repeat(64),
    expectedIdentity: EXPECTED,
    instrumentProfile: PROFILE,
  }), /CRU36_SOURCE_SHA256_MISMATCH/);
});

test('artifact validator rejects a consumer-visible LIVE source mode', () => {
  const result = materialize(tempDir());
  const artifact = structuredClone(result.artifact);
  artifact.semanticPayload.sourceMode = 'LIVE';
  assert.throws(() => validateCru34SnapshotArtifact(artifact), /CRU36_SOURCE_MODE_INVALID/);
});
