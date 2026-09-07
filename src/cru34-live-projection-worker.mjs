import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCru34LiveCheckpoint,
  cru34LiveCanonicalJson,
  cru34LiveHash,
  readCru34LiveCheckpoint,
  writeCru34LiveCheckpoint,
} from './cru34-live-checkpoint.mjs';
import { buildCru34SemanticPayload, CRU34_SOURCE_MODE_LIVE } from './cru34-snapshot-artifact.mjs';
import { buildTxIntradayResearchSnapshot, CONTEXT_WINDOW_MS } from './tx-intraday-research-snapshot.mjs';
import { materializeTxCanonicalObservations } from './tx-intraday-pressure-path-efficiency.mjs';

export const CRU34_LIVE_SNAPSHOT_VERSION = 'cru34-live-snapshot-v1';
export const DEFAULT_MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_BATCH_RECORDS = 25_000;
export const DEFAULT_STALE_AFTER_MS = 30_000;

function recordHash(previousHash, record) {
  const { recordHash: ignored, ...body } = record;
  return crypto.createHash('sha256')
    .update(`${previousHash}\n${cru34LiveCanonicalJson(body)}`)
    .digest('hex');
}

function assertRecord(record, previousHash) {
  if (record?.previousHash !== previousHash || recordHash(previousHash, record) !== record?.recordHash) {
    throw new Error('CRU43_LEDGER_HASH_CHAIN_INVALID');
  }
  if (record.formalWeight !== 0 || record.researchOnly !== true
      || record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
    throw new Error('CRU43_LEDGER_SAFETY_INVALID');
  }
}

function sourceIdentity(firstRecord) {
  if (firstRecord?.previousHash !== 'GENESIS' || !/^[a-f0-9]{64}$/.test(firstRecord?.recordHash || '')) {
    throw new Error('CRU43_LEDGER_GENESIS_INVALID');
  }
  return `sha256:${cru34LiveHash({
    schemaVersion: 'cru34-live-ledger-generation-v1',
    firstRecordHash: firstRecord.recordHash,
    firstReceivedAt: firstRecord.receivedAt,
  })}`;
}

function readCompleteBatch(filePath, offset, maxBytes, maxRecords) {
  const size = fs.statSync(filePath).size;
  if (offset > size) throw new Error('CRU43_LEDGER_TRUNCATED');
  const readLength = Math.min(maxBytes, size - offset);
  if (readLength <= 0) return { rows: [], nextOffset: offset, observedSize: size };
  const buffer = Buffer.allocUnsafe(readLength);
  const fd = fs.openSync(filePath, 'r');
  let bytesRead;
  try { bytesRead = fs.readSync(fd, buffer, 0, readLength, offset); } finally { fs.closeSync(fd); }
  const slice = buffer.subarray(0, bytesRead);
  const terminal = slice.lastIndexOf(0x0a);
  if (terminal < 0) return { rows: [], nextOffset: offset, observedSize: size };
  const rows = [];
  let cursor = 0;
  for (const lineBytes of slice.subarray(0, terminal + 1).toString('utf8').split('\n')) {
    if (!lineBytes) continue;
    const encodedBytes = Buffer.byteLength(`${lineBytes}\n`, 'utf8');
    if (rows.length >= maxRecords) break;
    rows.push({
      record: JSON.parse(lineBytes),
      startOffset: offset + cursor,
      endOffset: offset + cursor + encodedBytes,
    });
    cursor += encodedBytes;
  }
  return { rows, nextOffset: offset + cursor, observedSize: size };
}

function verifyCheckpointAnchor(ledgerPath, checkpoint) {
  const genesis = readCompleteBatch(ledgerPath, 0, 1024 * 1024, 1).rows[0]?.record;
  if (!genesis) throw new Error('CRU43_LEDGER_GENESIS_UNAVAILABLE');
  assertRecord(genesis, 'GENESIS');
  if (sourceIdentity(genesis) !== checkpoint.sourceLedgerIdentity) {
    throw new Error('CRU43_CHECKPOINT_SOURCE_IDENTITY_MISMATCH');
  }
  const length = checkpoint.lastVerifiedEndByteOffset - checkpoint.lastVerifiedStartByteOffset;
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(ledgerPath, 'r');
  let bytes;
  try { bytes = fs.readSync(fd, buffer, 0, length, checkpoint.lastVerifiedStartByteOffset); }
  finally { fs.closeSync(fd); }
  if (bytes !== length) throw new Error('CRU43_CHECKPOINT_ANCHOR_TRUNCATED');
  const record = JSON.parse(buffer.toString('utf8').trim());
  assertRecord(record, record.previousHash);
  if (record.recordHash !== checkpoint.lastVerifiedRecordHash) {
    throw new Error('CRU43_CHECKPOINT_ANCHOR_MISMATCH');
  }
}

function checkpointEvent(event) {
  const { rawRecord: ignored, ...safe } = event;
  return safe;
}

function pruneRolling(events, cutoff) {
  if (!cutoff) return [];
  const floor = cutoff.availableMs - CONTEXT_WINDOW_MS - 2_000;
  const matching = events.filter((event) => event.actualContract === cutoff.actualContract
    && event.tradeDate === cutoff.tradeDate && event.session === cutoff.session
    && event.continuityEpoch === cutoff.continuityEpoch && event.availableMs <= cutoff.availableMs);
  let start = matching.findIndex((event) => event.availableMs >= floor);
  if (start < 0) start = Math.max(0, matching.length - 1);
  const priorQuote = matching.slice(0, start).findLast((event) => event.kind === 'futures_bidask');
  return [...(priorQuote ? [priorQuote] : []), ...matching.slice(start)].map(checkpointEvent);
}

function warmupFor(events, cutoff) {
  const ticks = events.filter((event) => event.kind === 'futures_tick'
    && event.actualContract === cutoff.actualContract && event.tradeDate === cutoff.tradeDate
    && event.session === cutoff.session && event.continuityEpoch === cutoff.continuityEpoch);
  const spanMs = ticks.length ? cutoff.availableMs - ticks[0].availableMs : 0;
  return Object.freeze({
    observedSpanMs: Math.max(0, spanMs),
    primary60sComplete: spanMs >= 60_000,
    context300sComplete: spanMs >= 300_000,
  });
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(fd, `${cru34LiveCanonicalJson(value)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, filePath);
  try {
    const directoryFd = fs.openSync(path.dirname(filePath), 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
}

export function projectCru34LiveBatch({
  ledgerPath,
  checkpointPath,
  snapshotPath,
  instrumentProfile = { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 },
  resolveSessionTradeDate = null,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  maxBatchRecords = DEFAULT_MAX_BATCH_RECORDS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = new Date(),
} = {}) {
  if (!ledgerPath || !checkpointPath || !snapshotPath || !fs.existsSync(ledgerPath)) {
    throw new Error('CRU43_LIVE_PROJECTION_CONFIG_INVALID');
  }
  if (!Number.isInteger(maxBatchBytes) || maxBatchBytes < 1024
      || !Number.isInteger(maxBatchRecords) || maxBatchRecords < 1
      || !Number.isInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error('CRU43_LIVE_PROJECTION_BOUNDS_INVALID');
  }

  let checkpoint = readCru34LiveCheckpoint(checkpointPath);
  if (checkpoint) verifyCheckpointAnchor(ledgerPath, checkpoint);
  const offset = checkpoint?.lastVerifiedEndByteOffset || 0;
  const batch = readCompleteBatch(ledgerPath, offset, maxBatchBytes, maxBatchRecords);
  if (!batch.rows.length) return Object.freeze({ status: 'NO_COMPLETE_SUFFIX', checkpoint, snapshot: null });

  let previousHash = checkpoint?.lastVerifiedRecordHash || 'GENESIS';
  for (const row of batch.rows) {
    assertRecord(row.record, previousHash);
    previousHash = row.record.recordHash;
  }
  const identity = checkpoint?.sourceLedgerIdentity || sourceIdentity(batch.rows[0].record);
  const ordinalOffset = checkpoint?.lastVerifiedLedgerOrdinal || 0;
  const canonical = materializeTxCanonicalObservations(batch.rows.map((row) => row.record), {
    sourceLedgerIdentity: identity,
    resolveSessionTradeDate,
    ledgerOrdinalOffset: ordinalOffset,
    initialState: checkpoint?.canonicalState || null,
  });
  const combined = [...(checkpoint?.rollingCanonicalEvents || []), ...canonical.events.map(checkpointEvent)];
  const cutoff = [...combined].reverse().find((event) => event.kind === 'futures_tick') || null;
  const rollingCanonicalEvents = pruneRolling(combined, cutoff);
  const last = batch.rows.at(-1);
  checkpoint = buildCru34LiveCheckpoint({
    sourceLedgerIdentity: identity,
    segmentIdentity: identity,
    lastVerifiedLedgerOrdinal: ordinalOffset + batch.rows.length,
    lastVerifiedRecordHash: last.record.recordHash,
    lastVerifiedStartByteOffset: last.startOffset,
    lastVerifiedEndByteOffset: last.endOffset,
    canonicalState: canonical.terminalState,
    rollingCanonicalEvents,
    actualContract: cutoff?.actualContract || null,
    tradeDate: cutoff?.tradeDate || null,
    session: cutoff?.session || null,
    continuityEpoch: cutoff?.continuityEpoch || null,
    lastVerifiedAvailableAt: last.record.receivedAt,
    lastEmittedSemanticHash: checkpoint?.lastEmittedSemanticHash || null,
  });
  writeCru34LiveCheckpoint(checkpointPath, checkpoint);
  if (!cutoff) return Object.freeze({ status: 'WARMING_UP', checkpoint, snapshot: null });

  const prefixProof = Object.freeze({
    status: 'VERIFIED_CHECKPOINT_PREFIX',
    verified: true,
    recordCount: cutoff.ledgerOrdinal,
    terminalHash: cutoff.recordHash,
    failingLedgerOrdinal: null,
  });
  const researchSnapshot = buildTxIntradayResearchSnapshot([], {
    sourceLedgerIdentity: identity,
    instrumentProfile,
    cutoffLedgerOrdinal: cutoff.ledgerOrdinal,
    checkpointCanonicalEvents: rollingCanonicalEvents,
    verifiedPrefixProof: prefixProof,
  });
  const semanticPayload = buildCru34SemanticPayload(researchSnapshot, {
    tickSize: instrumentProfile.tickSize,
    sourceMode: CRU34_SOURCE_MODE_LIVE,
  });
  const semanticContentHash = cru34LiveHash(semanticPayload);
  const warmup = warmupFor(rollingCanonicalEvents, cutoff);
  const heartbeatAgeMs = Math.max(0, now.getTime() - Date.parse(semanticPayload.availableAt));
  const truthState = !warmup.context300sComplete ? 'WARMING_UP'
    : heartbeatAgeMs > staleAfterMs ? 'STALE' : 'LIVE';
  const operational = {
    schemaVersion: CRU34_LIVE_SNAPSHOT_VERSION,
    truthState,
    unavailableReason: null,
    semanticPayload,
    semanticContentHash,
    observedAt: now.toISOString(),
    validUntil: new Date(Date.parse(semanticPayload.availableAt) + staleAfterMs).toISOString(),
    heartbeatAgeMs,
    staleAfterMs,
    lagBytes: Math.max(0, batch.observedSize - checkpoint.lastVerifiedEndByteOffset),
    checkpointIdentity: checkpoint.checkpointHash,
    checkpointOrdinal: checkpoint.lastVerifiedLedgerOrdinal,
    checkpointRecordHash: checkpoint.lastVerifiedRecordHash,
    warmup,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const liveSnapshot = Object.freeze({ ...operational, snapshotHash: cru34LiveHash(operational) });
  atomicWriteJson(snapshotPath, liveSnapshot);
  const nextCheckpoint = buildCru34LiveCheckpoint({
    ...checkpoint,
    lastEmittedSemanticHash: semanticContentHash,
  });
  writeCru34LiveCheckpoint(checkpointPath, nextCheckpoint);
  return Object.freeze({ status: truthState, checkpoint: nextCheckpoint, snapshot: liveSnapshot });
}
