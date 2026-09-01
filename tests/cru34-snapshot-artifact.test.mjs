import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CRU34_SNAPSHOT_CONTRACT_VERSION,
  CRU34_MAX_ARTIFACT_BYTES,
  CRU34_MAX_SELECTION_CANDIDATES,
  buildCru34HistoricalSemanticPayload,
  buildCru34SnapshotArtifact,
  cru34ArtifactFileName,
  cru34SelectionKey,
  readCru34SnapshotArtifact,
  selectCru34SnapshotArtifact,
  stableCru34ArtifactJson,
  validateCru34SnapshotArtifact,
} from '../src/cru34-snapshot-artifact.mjs';
import { materializeCru34HistoricalLedger } from '../src/cru34-historical-materializer.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });
const SOURCE_SHA = 'a'.repeat(64);
const EXPECTED = Object.freeze({
  schemaVersion: CRU34_SNAPSHOT_CONTRACT_VERSION,
  instrument: 'TX',
  actualContract: 'TXFI6',
  tradeDate: '2026-08-26',
  session: 'DAY',
  continuityEpoch: 'TX:1',
  tickSize: 1,
  sourceLedgerIdentity: `sha256:${SOURCE_SHA}`,
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
  const sourceLedgerSha256 = extra.sourceLedgerSha256 || SOURCE_SHA;
  const materializedAt = extra.materializedAt || '2026-08-31T06:00:00.000Z';
  const snapshot = buildTxIntradayResearchSnapshot(normalLedger(), {
    sourceLedgerIdentity: `sha256:${sourceLedgerSha256}`,
    instrumentProfile: PROFILE,
    cutoffLedgerOrdinal: 6,
  });
  const semanticPayload = buildCru34HistoricalSemanticPayload(snapshot, { tickSize: PROFILE.tickSize });
  const artifact = buildCru34SnapshotArtifact(semanticPayload, {
    materializedAt,
    sourceLedgerSha256,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 5_000,
  });
  fs.mkdirSync(root, { recursive: true });
  const fileName = cru34ArtifactFileName(artifact);
  const filePath = path.join(root, fileName);
  const reused = fs.existsSync(filePath);
  if (!reused) fs.writeFileSync(filePath, stableCru34ArtifactJson(artifact), 'utf8');
  const accepted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateCru34SnapshotArtifact(accepted, { fileName });
  return Object.freeze({
    snapshot,
    semanticPayload,
    artifact: accepted,
    write: Object.freeze({ filePath, fileName, artifact: accepted, reused, byteSize: fs.statSync(filePath).size }),
  });
}

function governedFixture(root, expectedIdentity = EXPECTED) {
  const ledgerPath = path.join(root, 'governed.ndjson');
  const bytes = Buffer.from(`${normalLedger().map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(ledgerPath, bytes);
  return {
    ledgerPath,
    bytes,
    sourceSha: crypto.createHash('sha256').update(bytes).digest('hex'),
    artifactRoot: path.join(root, 'artifacts'),
    expectedIdentity,
  };
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

test('accepts legitimate sparse CRU-34 quality-insufficient variants without relaxing exact keys', () => {
  for (const invalidPrice of [false, true]) {
    const records = structuredClone(normalLedger());
    records[1].payload.executedVolume = invalidPrice ? 1 : 0;
    records[1].payload.volume = invalidPrice ? 1 : 0;
    if (invalidPrice) {
      records[1].payload.price = 0;
      records[1].payload.close = 0;
    }
    const snapshot = buildTxIntradayResearchSnapshot(records, {
      sourceLedgerIdentity: `sha256:${SOURCE_SHA}`,
      instrumentProfile: PROFILE,
      cutoffLedgerOrdinal: 6,
    });
    assert.equal(snapshot.status, 'QUALITY_INSUFFICIENT');
    assert.equal(snapshot.windows.primary60s.pressure.status, 'QUALITY_INSUFFICIENT');
    assert.equal(snapshot.windows.primary60s.response.status, invalidPrice ? 'UNAVAILABLE' : 'READY');
    const payload = buildCru34HistoricalSemanticPayload(snapshot, { tickSize: PROFILE.tickSize });
    const artifact = buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: 6,
      sourcePrefixByteSize: 5_000,
    });
    assert.doesNotThrow(() => validateCru34SnapshotArtifact(artifact));
  }
});

test('accepts lawful CRU-34 path boundary states', () => {
  const regression = chain([
    tick('r1', 20, 100, 1),
    tick('r2', 10, 101, 1),
    tick('r3', 30, 102, 1),
  ]).map((record, index) => ({
    ...record,
    receivedAt: `2026-08-26T09:01:0${index}.000+08:00`,
  }));
  const cases = [
    { records: chain([tick('s1', 1, 100, 1)]), status: 'UNAVAILABLE', reason: 'INSUFFICIENT_OBSERVATIONS' },
    { records: chain([tick('z1', 1, 100, 1), tick('z2', 2, 100, 1), tick('z3', 3, 100, 1)]), status: 'UNAVAILABLE', reason: 'UNAVAILABLE_ZERO_PATH' },
    { records: regression, status: 'QUALITY_INSUFFICIENT', reason: 'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION' },
    { records: chain([tick('g1', 0, 100, 1), tick('g2', 1, 101, 1), tick('g3', 40, 102, 1)]), status: 'QUALITY_INSUFFICIENT', reason: 'QUALITY_INSUFFICIENT_LONG_GAP' },
  ];
  for (const item of cases) {
    const snapshot = buildTxIntradayResearchSnapshot(item.records, {
      sourceLedgerIdentity: `sha256:${SOURCE_SHA}`,
      instrumentProfile: PROFILE,
      cutoffLedgerOrdinal: item.records.length,
    });
    const payload = buildCru34HistoricalSemanticPayload(snapshot, { tickSize: 1 });
    assert.equal(payload.primary60s.pathEfficiency.status, item.status);
    assert.equal(payload.primary60s.pathEfficiency.unavailableReason, item.reason);
    assert.doesNotThrow(() => buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: item.records.length,
      sourcePrefixByteSize: 5_000,
    }));
  }
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
  assert.throws(() => { historical.snapshot.primary60s.pressure.status = 'MUTATED'; }, TypeError);
});

test('bounded reader detects post-fstat growth without reading the appended payload', () => {
  const result = materialize(tempDir());
  const originalSize = fs.statSync(result.write.filePath).size;
  const originalReadSync = fs.readSync;
  let grew = false;
  let bytesRead = 0;
  fs.readSync = (...args) => {
    if (!grew) {
      grew = true;
      fs.appendFileSync(result.write.filePath, Buffer.alloc(CRU34_MAX_ARTIFACT_BYTES));
    }
    const count = originalReadSync(...args);
    bytesRead += count;
    return count;
  };
  try {
    const read = readCru34SnapshotArtifact({ artifactPath: result.write.filePath });
    assert.equal(read.truthState, 'UNAVAILABLE');
    assert.equal(read.unavailableReason, 'ARTIFACT_SIZE_INVALID');
    assert.ok(bytesRead <= originalSize + 1);
  } finally {
    fs.readSync = originalReadSync;
  }
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
    artifact.semanticPayload.methodology.pressure = `${artifact.semanticPayload.methodology.pressure} tampered`;
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
    ['instrument', 'NOT_TX'],
    ['actualContract', 'TXFJ6'],
    ['tradeDate', '2026-08-27'],
    ['session', 'NIGHT'],
    ['continuityEpoch', 'TX:2'],
    ['tickSize', 2],
  ]) {
    const selected = selectCru34SnapshotArtifact({ artifactRoot: root, selector: { ...EXPECTED, [key]: value } });
    assert.equal(selected.truthState, 'UNAVAILABLE');
    assert.equal(selected.unavailableReason, 'ARTIFACT_NOT_FOUND_FOR_IDENTITY');
  }
});

test('unsupported selector schema and invalid freshness cutoff fail closed without throwing', () => {
  const root = tempDir();
  const result = materialize(root);
  const unsupported = selectCru34SnapshotArtifact({
    artifactRoot: root,
    selector: { ...EXPECTED, schemaVersion: 'future-v9' },
  });
  assert.equal(unsupported.truthState, 'UNAVAILABLE');
  assert.equal(unsupported.unavailableReason, 'ARTIFACT_SCHEMA_UNSUPPORTED');
  const invalidFreshness = readCru34SnapshotArtifact({
    artifactPath: result.write.filePath,
    expectedIdentity: EXPECTED,
    freshnessCutoff: 'not-a-time',
  });
  assert.equal(invalidFreshness.truthState, 'UNAVAILABLE');
  assert.equal(invalidFreshness.unavailableReason, 'FRESHNESS_CUTOFF_INVALID');
});

test('lineage timestamps require a complete timezone-bearing ISO timestamp', () => {
  const result = materialize(tempDir());
  for (const timestamp of [
    '2026',
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+14:01',
  ]) {
    const payload = structuredClone(result.semanticPayload);
    payload.availableAt = timestamp;
    assert.throws(() => buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: 6,
      sourcePrefixByteSize: 5_000,
    }), /CRU36_AVAILABLE_AT_REQUIRED/);
  }
  assert.throws(() => buildCru34SnapshotArtifact(result.semanticPayload, {
    materializedAt: '2026-02-30T00:00:00Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 5_000,
  }), /CRU36_MATERIALIZED_AT_INVALID/);
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

test('inconsistent duplicated consumer views and false prefix scale are rejected', () => {
  const result = materialize(tempDir());
  const inconsistent = structuredClone(result.semanticPayload);
  inconsistent.pressure.primary60s.buyProxyVolume += 1;
  assert.throws(() => buildCru34SnapshotArtifact(inconsistent, {
    materializedAt: '2026-08-31T06:00:00.000Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 5_000,
  }), /CRU36_CONTRACT_VIEW_INCONSISTENT/);
  assert.throws(() => buildCru34SnapshotArtifact(result.semanticPayload, {
    materializedAt: '2026-08-31T06:00:00.000Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 5,
    sourcePrefixByteSize: 5_000,
  }), /CRU36_SOURCE_SCALE_LINEAGE_MISMATCH/);
});

test('equal cutoff and max-used ordinals require the same record hash', () => {
  const result = materialize(tempDir());
  const payload = structuredClone(result.semanticPayload);
  assert.equal(payload.cutoffLedgerOrdinal, payload.maxUsedLedgerOrdinal);
  payload.maxUsedRecordHash = 'contradictory-hash';
  assert.throws(
    () => buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: 6,
      sourcePrefixByteSize: 5_000,
    }),
    /CRU36_LINEAGE_HASH_CONTRADICTION/,
  );
});

test('hash-consistent but semantically empty contract structure is rejected', () => {
  const result = materialize(tempDir());
  const payload = structuredClone(result.semanticPayload);
  payload.primary60s = { windowMs: 60_000 };
  payload.context300s = { windowMs: 300_000 };
  payload.pressure = {};
  payload.response = {};
  payload.pathEfficiency = {};
  payload.quality = { status: 'READY', reasons: [] };
  payload.qualityReasons = [];
  payload.promotionState = {};
  payload.methodology = {};
  assert.throws(
    () => buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: 6,
      sourcePrefixByteSize: 5_000,
    }),
    /CRU36_CONTRACT_/,
  );
});

test('core pressure, response, and evidence schema cannot be omitted or malformed consistently', () => {
  const result = materialize(tempDir());
  for (const mutate of [
    (payload) => {
      delete payload.primary60s.pressure.buyProxyVolume;
      delete payload.pressure.primary60s.buyProxyVolume;
    },
    (payload) => {
      delete payload.primary60s.response.startPrice;
      delete payload.response.primary60s.startPrice;
    },
    (payload) => { payload.primary60s.supportingEvidence = [123]; },
    (payload) => {
      payload.primary60s.pressure.classifiedCoverage = 2;
      payload.pressure.primary60s.classifiedCoverage = 2;
    },
    (payload) => { payload.quality.classifiedCoveragePrimary60s = 0; },
    (payload) => {
      payload.primary60s.pathEfficiency.value = null;
      payload.pathEfficiency.primary60s.value = null;
    },
    (payload) => {
      payload.primary60s.pathEfficiency.value = 0.5;
      payload.pathEfficiency.primary60s.value = 0.5;
    },
    (payload) => {
      payload.primary60s.pathEfficiency.tickCount = 4;
      payload.pathEfficiency.primary60s.tickCount = 4;
    },
    (payload) => {
      payload.primary60s.pathEfficiency.netDisplacementPoints = 999;
      payload.pathEfficiency.primary60s.netDisplacementPoints = 999;
    },
    (payload) => {
      payload.primary60s.pressure.bestQuoteCrossCheck.matchedCoverage = 0;
      payload.pressure.primary60s.bestQuoteCrossCheck.matchedCoverage = 0;
    },
    (payload) => {
      payload.primary60s.response.displacementTicks = 999;
      payload.response.primary60s.displacementTicks = 999;
    },
    (payload) => {
      payload.primary60s.response.startPrice = -100;
      payload.primary60s.response.endPrice = -98;
      payload.response.primary60s.startPrice = -100;
      payload.response.primary60s.endPrice = -98;
    },
    (payload) => { payload.primary60s.contraryEvidence = []; },
    (payload) => { payload.brokerSignal = { side: 'BUY' }; },
    (payload) => {
      payload.primary60s.pressure.executionAuthorized = true;
      payload.pressure.primary60s.executionAuthorized = true;
    },
    (payload) => { payload.pressure.executionAuthorized = true; },
    (payload) => { payload.response.brokerSignal = { side: 'BUY' }; },
    (payload) => { payload.methodology.observationOrder = 'event-time sorted'; },
    (payload) => { payload.limitations[5] = 'Trading direction is provided.'; },
  ]) {
    const payload = structuredClone(result.semanticPayload);
    mutate(payload);
    assert.throws(() => buildCru34SnapshotArtifact(payload, {
      materializedAt: '2026-08-31T06:00:00.000Z',
      sourceLedgerSha256: SOURCE_SHA,
      sourceLedgerByteSize: 10_000,
      sourcePrefixRecordCount: 6,
      sourcePrefixByteSize: 5_000,
    }), /CRU36_CONTRACT_/);
  }
});

test('canonical quality-insufficient reasons cannot be replaced by fabricated explanations', () => {
  const records = structuredClone(normalLedger());
  records[5].payload.tick_type = 0;
  const snapshot = buildTxIntradayResearchSnapshot(records, {
    sourceLedgerIdentity: `sha256:${SOURCE_SHA}`,
    instrumentProfile: PROFILE,
    cutoffLedgerOrdinal: 6,
  });
  const payload = structuredClone(buildCru34HistoricalSemanticPayload(snapshot, { tickSize: 1 }));
  payload.primary60s.pressure.unavailableReason = 'FABRICATED_REASON';
  payload.pressure.primary60s.unavailableReason = 'FABRICATED_REASON';
  assert.throws(() => buildCru34SnapshotArtifact(payload, {
    materializedAt: '2026-08-31T06:00:00.000Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 5_000,
  }), /CRU36_CONTRACT_PRESSURE_STATUS_INVALID/);
});

test('selector binds the governed source identity and fails closed on an unreadable root', () => {
  const root = tempDir();
  const sourceA = materialize(root);
  const sourceBHash = 'b'.repeat(64);
  const sourceB = materialize(root, { sourceLedgerSha256: sourceBHash });
  const selectedA = selectCru34SnapshotArtifact({ artifactRoot: root, selector: EXPECTED });
  const selectedB = selectCru34SnapshotArtifact({
    artifactRoot: root,
    selector: { ...EXPECTED, sourceLedgerIdentity: `sha256:${sourceBHash}` },
  });
  assert.equal(selectedA.snapshot.artifactIdentity, sourceA.artifact.artifactIdentity);
  assert.equal(selectedB.snapshot.artifactIdentity, sourceB.artifact.artifactIdentity);
  assert.notEqual(selectedA.snapshot.artifactIdentity, selectedB.snapshot.artifactIdentity);

  const fileRoot = path.join(tempDir(), 'not-a-directory');
  fs.writeFileSync(fileRoot, 'x', 'utf8');
  const unreadable = selectCru34SnapshotArtifact({ artifactRoot: fileRoot, selector: EXPECTED });
  assert.equal(unreadable.truthState, 'UNAVAILABLE');
  assert.equal(unreadable.unavailableReason, 'ARTIFACT_ROOT_UNREADABLE');
});

test('selector candidate scan is explicitly bounded', () => {
  const root = tempDir();
  const key = cru34SelectionKey(EXPECTED);
  for (let index = 1; index <= CRU34_MAX_SELECTION_CANDIDATES + 1; index += 1) {
    const ordinal = String(index).padStart(16, '0');
    fs.writeFileSync(path.join(root, `${key}.${ordinal}.${String(index).padStart(64, '0')}.json`), '{}', 'utf8');
  }
  const selected = selectCru34SnapshotArtifact({ artifactRoot: root, selector: EXPECTED });
  assert.equal(selected.truthState, 'UNAVAILABLE');
  assert.equal(selected.unavailableReason, 'ARTIFACT_SELECTION_CANDIDATE_LIMIT_EXCEEDED');
});

test('wrong expected target identity fails before any artifact is published', async () => {
  const root = path.join(tempDir(), 'not-created');
  const fixture = governedFixture(tempDir());
  await assert.rejects(materializeCru34HistoricalLedger({
    ledgerPath: fixture.ledgerPath,
    expectedSourceSha256: fixture.sourceSha,
    cutoffLedgerOrdinals: [6],
    instrumentProfile: PROFILE,
    artifactRoot: root,
    expectedIdentity: { ...EXPECTED, actualContract: 'TXFJ6' },
  }), /CRU36_TARGET_ACTUALCONTRACT_MISMATCH/);
  assert.equal(fs.existsSync(root), false);
  await assert.rejects(materializeCru34HistoricalLedger({
    ledgerPath: fixture.ledgerPath,
    expectedSourceSha256: fixture.sourceSha,
    cutoffLedgerOrdinals: [6],
    instrumentProfile: PROFILE,
    artifactRoot: root,
    expectedIdentity: { ...EXPECTED, instrument: 'NOT_TX' },
  }), /CRU36_TARGET_INSTRUMENT_MISMATCH/);
});

test('immutable conflict fails closed instead of replacing a corrupt accepted path', async () => {
  const root = tempDir();
  const fixture = governedFixture(root);
  const args = {
    ledgerPath: fixture.ledgerPath,
    artifactRoot: fixture.artifactRoot,
    cutoffLedgerOrdinals: [6],
    expectedSourceSha256: fixture.sourceSha,
    expectedIdentity: EXPECTED,
    instrumentProfile: PROFILE,
  };
  await materializeCru34HistoricalLedger(args);
  const artifactPath = fs.readdirSync(fixture.artifactRoot)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(fixture.artifactRoot, name))[0];
  fs.writeFileSync(artifactPath, '{}\n', 'utf8');
  await assert.rejects(materializeCru34HistoricalLedger(args));
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), '{}\n');
});

test('artifact adapter is isolated from ledger, chart-cache, latest, Shioaji, and CRU-34 recomputation imports', () => {
  const source = fs.readFileSync(new URL('../src/cru34-snapshot-artifact.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /live-event-ledger|dashboard-tx-chart|\/latest|shioaji|buildTxIntradayResearchSnapshot/i);
  assert.doesNotMatch(source, /export function writeCru34SnapshotArtifact/);
  const materializerSource = fs.readFileSync(new URL('../src/cru34-historical-materializer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(materializerSource, /export (?:async )?function (?:readGovernedLedgerPrefix|materializeCru34HistoricalSnapshot)/);
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
  const repeated = await materializeCru34HistoricalLedger({
    ledgerPath,
    artifactRoot: path.join(root, 'artifacts'),
    cutoffLedgerOrdinals: [6],
    expectedSourceSha256: sourceSha,
    expectedIdentity: EXPECTED,
    instrumentProfile: PROFILE,
    materializedAt: '2026-08-31T07:00:00.000Z',
  });
  assert.equal(repeated.snapshots[0].artifactReused, true);
  assert.equal(repeated.snapshots[0].artifactHash, report.snapshots[0].artifactHash);
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

test('exported ledger materializer requires a persisted expected source SHA', async () => {
  await assert.rejects(materializeCru34HistoricalLedger({
    ledgerPath: path.join(tempDir(), 'missing.ndjson'),
    artifactRoot: tempDir(),
    cutoffLedgerOrdinals: [6],
    expectedIdentity: EXPECTED,
    instrumentProfile: PROFILE,
  }), /CRU36_EXPECTED_SOURCE_SHA256_REQUIRED/);
});

test('artifact validator rejects a consumer-visible LIVE source mode', () => {
  const result = materialize(tempDir());
  const payload = structuredClone(result.semanticPayload);
  payload.sourceMode = 'LIVE';
  assert.throws(() => buildCru34SnapshotArtifact(payload, {
    materializedAt: '2026-08-31T06:00:00.000Z',
    sourceLedgerSha256: SOURCE_SHA,
    sourceLedgerByteSize: 10_000,
    sourcePrefixRecordCount: 6,
    sourcePrefixByteSize: 5_000,
  }), /CRU36_SOURCE_MODE_INVALID/);
});

test('unavailable CRU-34 result preserves a safe diagnostic reason', () => {
  const snapshot = buildTxIntradayResearchSnapshot(chain([quote('q1', 0, 99, 100)]), {
    sourceLedgerIdentity: `sha256:${SOURCE_SHA}`,
    instrumentProfile: PROFILE,
    cutoffLedgerOrdinal: 1,
  });
  assert.throws(() => buildCru34HistoricalSemanticPayload(snapshot, { tickSize: 1 }),
    /CRU36_CRU34_SNAPSHOT_UNAVAILABLE:NO_TX_TICK_CUTOFF/);
});
