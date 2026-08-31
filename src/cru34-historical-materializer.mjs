import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  CRU34_MAX_ARTIFACT_BYTES,
  CRU34_SNAPSHOT_CONTRACT_VERSION,
  buildCru34HistoricalSemanticPayload,
  buildCru34SnapshotArtifact,
  cru34ArtifactFileName,
  readCru34SnapshotArtifact,
  stableCru34ArtifactJson,
  validateCru34SnapshotArtifact,
} from './cru34-snapshot-artifact.mjs';
import { buildTxIntradayResearchSnapshot } from './tx-intraday-research-snapshot.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function normalizeCutoffs(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('CRU36_EXPLICIT_CUTOFF_REQUIRED');
  const normalized = [...new Set(values.map((value) => Number(value)))].sort((a, b) => a - b);
  if (normalized.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('CRU36_CUTOFF_INVALID');
  }
  return normalized;
}

function parseLine(bytes, ordinal) {
  let line = bytes;
  if (line.at(-1) === 0x0a) line = line.subarray(0, line.length - 1);
  if (line.at(-1) === 0x0d) line = line.subarray(0, line.length - 1);
  if (!line.length) throw new Error(`CRU36_LEDGER_EMPTY_LINE_AT_${ordinal}`);
  try {
    return JSON.parse(line.toString('utf8'));
  } catch {
    throw new Error(`CRU36_LEDGER_JSON_INVALID_AT_${ordinal}`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function readAcceptedArtifact(filePath, expectedFileName) {
  let descriptor;
  let bytes;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > CRU34_MAX_ARTIFACT_BYTES) {
      throw new Error('CRU36_ARTIFACT_SIZE_INVALID');
    }
    bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count < 1) throw new Error('CRU36_ARTIFACT_SIZE_CHANGED_DURING_READ');
      offset += count;
    }
    const trailing = Buffer.allocUnsafe(1);
    if (fs.readSync(descriptor, trailing, 0, 1, bytes.length) !== 0) {
      throw new Error('CRU36_ARTIFACT_SIZE_CHANGED_DURING_READ');
    }
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
  let artifact;
  try { artifact = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('CRU36_ARTIFACT_JSON_INVALID'); }
  validateCru34SnapshotArtifact(artifact, { fileName: expectedFileName });
  return Object.freeze({ artifact: deepFreeze(artifact), byteSize: bytes.length });
}

function removeTempIfPresent(tempPath) {
  try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* preserve primary failure */ }
}

function flushDirectoryBestEffort(root) {
  let descriptor;
  try {
    descriptor = fs.openSync(root, 'r');
    fs.fsyncSync(descriptor);
  } catch {
    // Windows may not permit opening a directory; absence after a crash remains fail-closed and rerunnable.
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function publishCru34SnapshotArtifact(artifactRoot, artifact) {
  validateCru34SnapshotArtifact(artifact);
  const root = path.resolve(String(artifactRoot || ''));
  if (!artifactRoot) throw new Error('CRU36_ARTIFACT_ROOT_REQUIRED');
  fs.mkdirSync(root, { recursive: true });
  const fileName = cru34ArtifactFileName(artifact);
  const filePath = path.join(root, fileName);
  const bytes = Buffer.from(stableCru34ArtifactJson(artifact), 'utf8');
  if (bytes.length > CRU34_MAX_ARTIFACT_BYTES) throw new Error('CRU36_ARTIFACT_SIZE_INVALID');
  if (fs.existsSync(filePath)) {
    const existing = readAcceptedArtifact(filePath, fileName);
    if (existing.artifact.artifactIdentity !== artifact.artifactIdentity
        || existing.artifact.semanticContentHash !== artifact.semanticContentHash) {
      throw new Error('CRU36_IMMUTABLE_ARTIFACT_CONFLICT');
    }
    return Object.freeze({ filePath, fileName, artifact: existing.artifact, reused: true, byteSize: existing.byteSize });
  }

  const tempPath = path.join(root, `.${fileName}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    readAcceptedArtifact(tempPath, fileName);
    try {
      fs.linkSync(tempPath, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readAcceptedArtifact(filePath, fileName);
      if (existing.artifact.artifactIdentity !== artifact.artifactIdentity
          || existing.artifact.semanticContentHash !== artifact.semanticContentHash) {
        throw new Error('CRU36_IMMUTABLE_ARTIFACT_CONFLICT');
      }
      removeTempIfPresent(tempPath);
      return Object.freeze({ filePath, fileName, artifact: existing.artifact, reused: true, byteSize: existing.byteSize });
    }
    flushDirectoryBestEffort(root);
    removeTempIfPresent(tempPath);
    const accepted = readAcceptedArtifact(filePath, fileName);
    return Object.freeze({ filePath, fileName, artifact: accepted.artifact, reused: false, byteSize: accepted.byteSize });
  } catch (error) {
    if (handle != null) fs.closeSync(handle);
    removeTempIfPresent(tempPath);
    throw error;
  }
}

async function readGovernedLedgerPrefix(filePath, cutoffLedgerOrdinals, {
  expectedSourceSha256,
} = {}) {
  const resolved = path.resolve(filePath || '');
  if (!filePath || !fs.existsSync(resolved)) throw new Error('CRU36_LEDGER_SOURCE_MISSING');
  const before = fs.statSync(resolved);
  if (!before.isFile() || before.size < 1) throw new Error('CRU36_LEDGER_SOURCE_INVALID');
  const cutoffs = normalizeCutoffs(cutoffLedgerOrdinals);
  const maximumCutoff = cutoffs.at(-1);
  const cutoffSet = new Set(cutoffs);
  const prefixByteSizes = new Map();
  const records = [];
  const digest = crypto.createHash('sha256');
  let remainder = Buffer.alloc(0);
  let parsedBytes = 0;
  let ordinal = 0;
  let prefixComplete = false;

  for await (const chunk of fs.createReadStream(resolved)) {
    digest.update(chunk);
    if (prefixComplete) continue;
    remainder = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
    let cursor = 0;
    while (cursor < remainder.length) {
      const newline = remainder.indexOf(0x0a, cursor);
      if (newline < 0) break;
      const next = newline + 1;
      const physicalLine = remainder.subarray(cursor, next);
      ordinal += 1;
      parsedBytes += physicalLine.length;
      records.push(parseLine(physicalLine, ordinal));
      if (cutoffSet.has(ordinal)) prefixByteSizes.set(ordinal, parsedBytes);
      cursor = next;
      if (ordinal === maximumCutoff) {
        prefixComplete = true;
        remainder = Buffer.alloc(0);
        break;
      }
    }
    if (!prefixComplete) remainder = remainder.subarray(cursor);
  }

  if (!prefixComplete && remainder.length) {
    ordinal += 1;
    parsedBytes += remainder.length;
    records.push(parseLine(remainder, ordinal));
    if (cutoffSet.has(ordinal)) prefixByteSizes.set(ordinal, parsedBytes);
  }
  if (records.length < maximumCutoff) throw new Error('CRU36_LEDGER_SHORTER_THAN_CUTOFF');
  const after = fs.statSync(resolved);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('CRU36_LEDGER_CHANGED_DURING_READ');
  }
  const sourceLedgerSha256 = digest.digest('hex');
  if (expectedSourceSha256 != null) {
    const expected = String(expectedSourceSha256).toLowerCase();
    if (!SHA256_PATTERN.test(expected)) throw new Error('CRU36_EXPECTED_SOURCE_SHA256_INVALID');
    if (expected !== sourceLedgerSha256) throw new Error('CRU36_SOURCE_SHA256_MISMATCH');
  }
  return Object.freeze({
    records: Object.freeze(records),
    cutoffs: Object.freeze(cutoffs),
    prefixByteSizes,
    sourceLedgerSha256,
    sourceLedgerByteSize: after.size,
  });
}

function assertTargetIdentity(snapshot, expected) {
  const identity = snapshot?.identity || {};
  for (const key of ['instrument', 'actualContract', 'tradeDate', 'session', 'continuityEpoch']) {
    if (identity[key] !== expected[key]) throw new Error(`CRU36_TARGET_${key.toUpperCase()}_MISMATCH`);
  }
}

function materializeCru34HistoricalSnapshot({
  records,
  sourceLedgerSha256,
  sourceLedgerByteSize,
  sourcePrefixByteSize,
  cutoffLedgerOrdinal,
  instrumentProfile,
  artifactRoot,
  materializedAt = new Date().toISOString(),
  resolveSessionTradeDate = null,
  expectedIdentity = null,
} = {}) {
  const sourceSha = String(sourceLedgerSha256 || '').toLowerCase();
  if (!SHA256_PATTERN.test(sourceSha)) throw new Error('CRU36_SOURCE_SHA256_REQUIRED');
  const snapshot = buildTxIntradayResearchSnapshot(records, {
    sourceLedgerIdentity: `sha256:${sourceSha}`,
    instrumentProfile,
    cutoffLedgerOrdinal,
    resolveSessionTradeDate,
  });
  if (expectedIdentity?.instrument != null && expectedIdentity.instrument !== instrumentProfile?.instrument) {
    throw new Error('CRU36_TARGET_INSTRUMENT_MISMATCH');
  }
  if (expectedIdentity?.tickSize != null && Number(expectedIdentity.tickSize) !== Number(instrumentProfile?.tickSize)) {
    throw new Error('CRU36_TARGET_TICKSIZE_MISMATCH');
  }
  if (expectedIdentity) assertTargetIdentity(snapshot, {
    ...expectedIdentity,
    instrument: instrumentProfile?.instrument,
  });
  const semanticPayload = buildCru34HistoricalSemanticPayload(snapshot, {
    tickSize: instrumentProfile?.tickSize,
  });
  const artifact = buildCru34SnapshotArtifact(semanticPayload, {
    materializedAt,
    sourceLedgerSha256: sourceSha,
    sourceLedgerByteSize,
    sourcePrefixRecordCount: cutoffLedgerOrdinal,
    sourcePrefixByteSize,
  });
  const write = publishCru34SnapshotArtifact(artifactRoot, artifact);
  return Object.freeze({ snapshot, semanticPayload, artifact: write.artifact, write });
}

export async function materializeCru34HistoricalLedger({
  ledgerPath,
  artifactRoot,
  cutoffLedgerOrdinals,
  expectedSourceSha256,
  expectedIdentity,
  instrumentProfile,
  materializedAt = new Date().toISOString(),
  resolveSessionTradeDate = null,
} = {}) {
  const expectedSourceSha = String(expectedSourceSha256 || '').toLowerCase();
  if (!SHA256_PATTERN.test(expectedSourceSha)) {
    throw new Error('CRU36_EXPECTED_SOURCE_SHA256_REQUIRED');
  }
  if (!expectedIdentity || typeof expectedIdentity !== 'object') {
    throw new Error('CRU36_EXPECTED_TARGET_IDENTITY_REQUIRED');
  }
  for (const key of ['actualContract', 'tradeDate', 'session', 'continuityEpoch']) {
    if (typeof expectedIdentity[key] !== 'string' || !expectedIdentity[key].trim()) {
      throw new Error(`CRU36_EXPECTED_${key.toUpperCase()}_REQUIRED`);
    }
  }
  const startedAt = performance.now();
  const source = await readGovernedLedgerPrefix(ledgerPath, cutoffLedgerOrdinals, {
    expectedSourceSha256: expectedSourceSha,
  });
  const snapshots = [];
  for (const cutoffLedgerOrdinal of source.cutoffs) {
    const snapshotStartedAt = performance.now();
    const result = materializeCru34HistoricalSnapshot({
      records: source.records,
      sourceLedgerSha256: source.sourceLedgerSha256,
      sourceLedgerByteSize: source.sourceLedgerByteSize,
      sourcePrefixByteSize: source.prefixByteSizes.get(cutoffLedgerOrdinal),
      cutoffLedgerOrdinal,
      instrumentProfile,
      artifactRoot,
      materializedAt,
      resolveSessionTradeDate,
      expectedIdentity,
    });
    const materializationMs = performance.now() - snapshotStartedAt;
    const readStartedAt = performance.now();
    const readResult = readCru34SnapshotArtifact({
      artifactPath: result.write.filePath,
      expectedIdentity: {
        schemaVersion: CRU34_SNAPSHOT_CONTRACT_VERSION,
        ...expectedIdentity,
        instrument: instrumentProfile.instrument,
        tickSize: instrumentProfile.tickSize,
        sourceLedgerIdentity: `sha256:${source.sourceLedgerSha256}`,
      },
    });
    const adapterReadMs = performance.now() - readStartedAt;
    if (readResult.truthState !== 'HISTORICAL') throw new Error('CRU36_ACCEPTED_ARTIFACT_READ_FAILED');
    snapshots.push(Object.freeze({
      cutoffLedgerOrdinal,
      cutoffRecordHash: result.semanticPayload.cutoffRecordHash,
      maxUsedLedgerOrdinal: result.semanticPayload.maxUsedLedgerOrdinal,
      maxUsedRecordHash: result.semanticPayload.maxUsedRecordHash,
      availableAt: result.semanticPayload.availableAt,
      semanticContentHash: result.artifact.semanticContentHash,
      artifactIdentity: result.artifact.artifactIdentity,
      artifactHash: result.artifact.artifactHash,
      artifactByteSize: result.write.byteSize,
      artifactReused: result.write.reused,
      materializationMs,
      adapterReadMs,
      quality: result.semanticPayload.quality?.status || null,
      qualityReasons: result.semanticPayload.qualityReasons,
    }));
  }
  const resource = process.resourceUsage();
  return Object.freeze({
    status: 'PASS',
    sourceLedgerIdentity: `sha256:${source.sourceLedgerSha256}`,
    sourceLedgerSha256: source.sourceLedgerSha256,
    sourceLedgerByteSize: source.sourceLedgerByteSize,
    prefixRecordCount: source.cutoffs.at(-1),
    prefixByteSize: source.prefixByteSizes.get(source.cutoffs.at(-1)),
    snapshotCount: snapshots.length,
    elapsedMs: performance.now() - startedAt,
    approximateMaxRssBytes: Number(resource.maxRSS) * 1024,
    snapshots: Object.freeze(snapshots),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}
