import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  buildCru34LiveCheckpoint,
  cru34LiveCanonicalJson,
  cru34LiveHash,
  readCru34LiveCheckpoint,
  writeCru34LiveCheckpoint,
} from './cru34-live-checkpoint.mjs';
import { buildCru34SemanticPayload, CRU34_SOURCE_MODE_LIVE } from './cru34-snapshot-artifact.mjs';
import { publishCru34Snapshot } from './cru34-snapshot-publisher.mjs';
import { buildTxIntradayResearchSnapshot, CONTEXT_WINDOW_MS } from './tx-intraday-research-snapshot.mjs';
import {
  evaluateBestQuoteEligibility,
  materializeTxCanonicalObservations,
} from './tx-intraday-pressure-path-efficiency.mjs';
import {
  buildCru44MultiWindowFromCanonical,
  CRU44_WINDOW_REGISTRY,
} from './cru44-multi-window-observed-flow.mjs';

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

const LEGACY_PYTHON_CANONICAL_KINDS = new Set([
  'ix0001_index_contribution',
  'ix0001_industry_contribution',
]);
const LEGACY_PYTHON_CANONICAL_START_MS = Date.parse('2026-10-01T09:51:00+08:00');
const LEGACY_PYTHON_CANONICAL_END_MS = Date.parse('2026-10-01T13:02:00+08:00');

function assertRecord(record, previousHash) {
  if (record?.previousHash !== previousHash) {
    throw new Error('CRU43_LEDGER_HASH_CHAIN_INVALID');
  }

  const strictHashValid = recordHash(previousHash, record) === record?.recordHash;
  const receivedMs = Date.parse(record?.receivedAt || '');
  const legacyPythonCanonical = LEGACY_PYTHON_CANONICAL_KINDS.has(record?.kind)
    && record?.provider === 'shioaji'
    && record?.payload?.sourceVersion === '1.7.2'
    && record?.payload?.ledgerCanonicalization !== 'JS_SAFE_NUMBERS_V1'
    && Number.isFinite(receivedMs)
    && receivedMs >= LEGACY_PYTHON_CANONICAL_START_MS
    && receivedMs <= LEGACY_PYTHON_CANONICAL_END_MS
    && /^[a-f0-9]{64}$/.test(record?.recordHash || '');

  // CRU-59 briefly wrote Python-canonicalized contribution payloads into the shared ledger.
  // JSON.parse cannot recover Python's float-vs-int lexical distinction (e.g. 2495.0 vs 2495),
  // so those bounded, non-CRU34 records can only be validated for chain linkage + safety here.
  // New contribution records carry JS_SAFE_NUMBERS_V1 and must pass strict recomputation.
  if (!strictHashValid && !legacyPythonCanonical) {
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

function readCompleteBatch(filePath, offset, maxBytes, maxRecords, maxLedgerBytes = null) {
  const physicalSize = fs.statSync(filePath).size;
  const size = maxLedgerBytes == null ? physicalSize : Math.min(physicalSize, maxLedgerBytes);
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
  const payload = event.kind === 'futures_tick'
    ? {
        price: event.payload?.price ?? event.payload?.close ?? null,
        close: event.payload?.close ?? event.payload?.price ?? null,
        executedVolume: event.payload?.executedVolume ?? event.payload?.volume ?? null,
        volume: event.payload?.volume ?? event.payload?.executedVolume ?? null,
        tick_type: event.payload?.tick_type ?? null,
      }
    : event.kind === 'futures_bidask'
      ? {
          bid_price: Array.isArray(event.payload?.bid_price) ? event.payload.bid_price.slice(0, 1) : [],
          ask_price: Array.isArray(event.payload?.ask_price) ? event.payload.ask_price.slice(0, 1) : [],
        }
      : {};
  return {
    kind: event.kind,
    ledgerOrdinal: event.ledgerOrdinal,
    sourceLedgerIdentity: event.sourceLedgerIdentity,
    recordHash: event.recordHash,
    actualContract: event.actualContract,
    tradeDate: event.tradeDate,
    session: event.session,
    continuityEpoch: event.continuityEpoch,
    identityStatus: event.identityStatus,
    availabilityLineageStatus: event.availabilityLineageStatus,
    joinedContinuityStatus: event.joinedContinuityStatus,
    availableAt: event.availableAt,
    availableMs: event.availableMs,
    eventMs: event.eventMs,
    payload,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
}

function retainPressureRelevantEvents(events, cutoff) {
  const retainedQuoteOrdinals = new Set();
  for (let tickIndex = 0; tickIndex < events.length; tickIndex += 1) {
    const tick = events[tickIndex];
    if (tick.kind !== 'futures_tick') continue;
    for (let quoteIndex = tickIndex - 1; quoteIndex >= 0; quoteIndex -= 1) {
      const quote = events[quoteIndex];
      if (quote.kind !== 'futures_bidask' || quote.ledgerOrdinal >= tick.ledgerOrdinal) continue;
      if (evaluateBestQuoteEligibility(quote, tick, { maxQuoteAgeMs: 2_000 }).eligible) {
        retainedQuoteOrdinals.add(quote.ledgerOrdinal);
        break;
      }
    }
  }
  const futureQuoteFloorMs = cutoff.eventMs - 2_000;
  return events.filter((event) => event.kind === 'futures_tick'
    || (event.kind === 'futures_bidask' && (retainedQuoteOrdinals.has(event.ledgerOrdinal)
      || (Number.isFinite(event.eventMs) && event.eventMs >= futureQuoteFloorMs))));
}

function pruneRolling(events, cutoff) {
  if (!cutoff) return [];
  const floor = cutoff.availableMs - CRU44_WINDOW_REGISTRY.window14400s.windowMs - 2_000;
  const matching = retainPressureRelevantEvents(events.filter((event) => event.actualContract === cutoff.actualContract
    && event.tradeDate === cutoff.tradeDate && event.session === cutoff.session
    && event.continuityEpoch === cutoff.continuityEpoch && event.availableMs <= cutoff.availableMs), cutoff);
  let start = matching.findIndex((event) => event.availableMs >= floor);
  if (start < 0) start = Math.max(0, matching.length - 1);
  const before = matching.slice(0, start);
  const anchors = [
    before.findLast((event) => event.kind === 'futures_tick'),
    before.findLast((event) => event.kind === 'futures_bidask'),
  ].filter(Boolean).sort((left, right) => left.ledgerOrdinal - right.ledgerOrdinal);
  return [...anchors, ...matching.slice(start)].map(checkpointEvent);
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
    window900sComplete: spanMs >= CRU44_WINDOW_REGISTRY.window900s.warmupMs,
    window1800sComplete: spanMs >= CRU44_WINDOW_REGISTRY.window1800s.warmupMs,
    window3600sComplete: spanMs >= CRU44_WINDOW_REGISTRY.window3600s.warmupMs,
    window14400sComplete: spanMs >= CRU44_WINDOW_REGISTRY.window14400s.warmupMs,
  });
}

export function projectCru34LiveBatch({
  ledgerPath,
  checkpointPath,
  snapshotPath,
  instrumentProfile = { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 },
  resolveSessionTradeDate = null,
  maxBatchBytes = DEFAULT_MAX_BATCH_BYTES,
  maxBatchRecords = DEFAULT_MAX_BATCH_RECORDS,
  maxLedgerBytes = null,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = null,
  clock = () => new Date(),
  publishSnapshot = publishCru34Snapshot,
} = {}) {
  if (!ledgerPath || !checkpointPath || !snapshotPath || !fs.existsSync(ledgerPath)) {
    throw new Error('CRU43_LIVE_PROJECTION_CONFIG_INVALID');
  }
  if (!Number.isInteger(maxBatchBytes) || maxBatchBytes < 1024
      || !Number.isInteger(maxBatchRecords) || maxBatchRecords < 1
      || (maxLedgerBytes != null && (!Number.isInteger(maxLedgerBytes) || maxLedgerBytes < 1))
      || !Number.isInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error('CRU43_LIVE_PROJECTION_BOUNDS_INVALID');
  }

  let checkpoint = readCru34LiveCheckpoint(checkpointPath);
  if (checkpoint) verifyCheckpointAnchor(ledgerPath, checkpoint);
  const offset = checkpoint?.lastVerifiedEndByteOffset || 0;
  const batch = readCompleteBatch(ledgerPath, offset, maxBatchBytes, maxBatchRecords, maxLedgerBytes);
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
  if (!cutoff) {
    writeCru34LiveCheckpoint(checkpointPath, checkpoint);
    return Object.freeze({ status: 'WARMING_UP', checkpoint, snapshot: null });
  }

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
  let multiWindowPayload = buildCru44MultiWindowFromCanonical({
    canonicalEvents: rollingCanonicalEvents,
    cutoffLedgerOrdinal: cutoff.ledgerOrdinal,
    instrumentProfile,
    sourceTruthState: 'LIVE',
    compatibilitySemanticHash: semanticContentHash,
  });
  const nextCheckpoint = buildCru34LiveCheckpoint({
    ...checkpoint,
    lastEmittedSemanticHash: semanticContentHash,
  });
  // Observe age AFTER the expensive calculation, immediately before publication.
  // Explicit now remains a deterministic replay clock. Never renew availableAt/TTL.
  const publicationNow = now ?? clock();
  if (!(publicationNow instanceof Date) || !Number.isFinite(publicationNow.getTime())) {
    throw new Error('CRU43_PUBLICATION_CLOCK_INVALID');
  }
  const heartbeatAgeMs = Math.max(0, publicationNow.getTime() - Date.parse(semanticPayload.availableAt));
  const expired = heartbeatAgeMs > staleAfterMs;
  const truthState = expired ? 'STALE' : !warmup.context300sComplete ? 'WARMING_UP' : 'LIVE';
  if (expired) {
    const { contentHash: ignoredHash, ...multiBody } = multiWindowPayload;
    const windows = Object.fromEntries(Object.entries(multiBody.windows).map(([key, value]) =>
      [key, value.truthState === 'LIVE' ? Object.freeze({ ...value, truthState: 'STALE' }) : value]));
    const body = { ...multiBody, windows };
    multiWindowPayload = Object.freeze({ ...body, contentHash: cru34LiveHash(body) });
  }
  const operational = {
    schemaVersion: CRU34_LIVE_SNAPSHOT_VERSION,
    truthState,
    unavailableReason: null,
    semanticPayload,
    semanticContentHash,
    multiWindowPayload,
    observedAt: publicationNow.toISOString(),
    validUntil: new Date(Date.parse(semanticPayload.availableAt) + staleAfterMs).toISOString(),
    heartbeatAgeMs,
    staleAfterMs,
    lagBytes: Math.max(0, batch.observedSize - checkpoint.lastVerifiedEndByteOffset),
    checkpointIdentity: nextCheckpoint.checkpointHash,
    checkpointOrdinal: nextCheckpoint.lastVerifiedLedgerOrdinal,
    checkpointRecordHash: nextCheckpoint.lastVerifiedRecordHash,
    warmup,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const liveSnapshot = Object.freeze({ ...operational, snapshotHash: cru34LiveHash(operational) });
  publishSnapshot({ targetPath: snapshotPath, document: liveSnapshot });
  // Commit progress only after publication. If publication fails, even an idle
  // ledger can replay this suffix. A crash here replays verified input; it never
  // skips an unpublished suffix or appends anything to the source ledger.
  writeCru34LiveCheckpoint(checkpointPath, nextCheckpoint);
  return Object.freeze({ status: truthState, checkpoint: nextCheckpoint, snapshot: liveSnapshot });
}
