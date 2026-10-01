import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cru34LiveCanonicalJson, cru34LiveHash } from '../src/cru34-live-checkpoint.mjs';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { buildCru34SemanticPayload } from '../src/cru34-snapshot-artifact.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';
import { readCru34LiveSnapshot } from '../src/dashboard-observed-flow.mjs';

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cru43-live-')); }

function chain(rows, previousHash = 'GENESIS') {
  return rows.map((row) => {
    const body = {
      schemaVersion: '1.0.0', provider: 'shioaji', code: row.code || 'TXFI6',
      product: row.code || 'TXFI6', receivedAt: row.receivedAt,
      exchangeTimestamp: row.receivedAt, sequence: null, eventId: crypto.randomUUID(),
      duplicate: false, sequenceGap: 0, clockSkewMs: 0, formalWeight: 0,
      researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      kind: row.kind, payload: row.payload || {}, previousHash,
    };
    const recordHash = crypto.createHash('sha256')
      .update(`${previousHash}\n${cru34LiveCanonicalJson(body)}`).digest('hex');
    previousHash = recordHash;
    return { ...body, recordHash };
  });
}

function records({ seconds = 330, startSecond = 0 } = {}) {
  const rows = [];
  for (let second = startSecond; second <= seconds; second += 30) {
    const at = new Date(Date.parse('2026-09-07T01:00:00.000Z') + second * 1_000).toISOString();
    const common = { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-07', session: 'DAY', datetime: at, eventTime: at, simtrade: false };
    rows.push({ kind: 'futures_bidask', receivedAt: at, payload: { ...common, bid_price: [99 + second / 30], ask_price: [100 + second / 30] } });
    rows.push({ kind: 'futures_tick', receivedAt: at, payload: { ...common, close: 100 + second / 30, price: 100 + second / 30, volume: 2, executedVolume: 2, tick_type: second % 60 === 0 ? 1 : 2 } });
  }
  return chain(rows);
}

function fixture(initialRecords = records()) {
  const root = temp();
  const ledgerPath = path.join(root, 'ledger.ndjson');
  fs.writeFileSync(ledgerPath, `${initialRecords.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return { root, ledgerPath, checkpointPath: path.join(root, 'checkpoint.json'), snapshotPath: path.join(root, 'latest.json'), records: initialRecords };
}

const profile = { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 };

test('bounded worker produces LIVE and matches full GENESIS LIVE semantics', () => {
  const value = fixture();
  const now = new Date('2026-09-07T01:05:35.000Z');
  const result = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000, staleAfterMs: 30_000, now });
  assert.equal(result.status, 'LIVE');
  assert.equal(result.snapshot.warmup.primary60sComplete, true);
  assert.equal(result.snapshot.warmup.context300sComplete, true);
  const full = buildTxIntradayResearchSnapshot(value.records, {
    sourceLedgerIdentity: result.checkpoint.sourceLedgerIdentity,
    instrumentProfile: profile,
  });
  const fullLive = buildCru34SemanticPayload(full, { tickSize: 1, sourceMode: 'LIVE' });
  assert.deepEqual(result.snapshot.semanticPayload, fullLive);
});

test('idle NO_COMPLETE_SUFFIX preserves checkpoint and published snapshot bytes', () => {
  const value = fixture();
  projectCru34LiveBatch({ ...value, instrumentProfile: profile,
    maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000,
    staleAfterMs: 30_000, now: new Date('2026-09-07T01:05:35.000Z') });
  const checkpointBefore = fs.readFileSync(value.checkpointPath);
  const snapshotBefore = fs.readFileSync(value.snapshotPath);
  const idle = projectCru34LiveBatch({ ...value, instrumentProfile: profile,
    maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000,
    staleAfterMs: 30_000, now: new Date('2026-09-07T01:05:36.000Z') });
  assert.equal(idle.status, 'NO_COMPLETE_SUFFIX');
  assert.equal(idle.snapshot, null);
  assert.deepEqual(fs.readFileSync(value.checkpointPath), checkpointBefore);
  assert.deepEqual(fs.readFileSync(value.snapshotPath), snapshotBefore);
});

test('checkpoint restart consumes only appended suffix and corrupt checkpoint fails closed', () => {
  const all = records();
  const value = fixture(all.slice(0, 12));
  const first = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000, now: new Date('2026-09-07T01:02:31Z') });
  assert.equal(first.status, 'WARMING_UP');
  fs.appendFileSync(value.ledgerPath, `${all.slice(12).map(JSON.stringify).join('\n')}\n`, 'utf8');
  const second = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000, now: new Date('2026-09-07T01:05:35Z') });
  assert.equal(second.status, 'LIVE');
  assert.ok(second.checkpoint.lastVerifiedLedgerOrdinal > first.checkpoint.lastVerifiedLedgerOrdinal);
  fs.writeFileSync(value.checkpointPath, '{}\n', 'utf8');
  assert.throws(() => projectCru34LiveBatch({ ...value, instrumentProfile: profile }), /CHECKPOINT_SCHEMA_INVALID/);
  fs.appendFileSync(value.ledgerPath, '\n', 'utf8');
});

test('checkpoint restart re-verifies ledger generation and anchor bytes', () => {
  const value = fixture();
  projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 4096, maxBatchRecords: 3 });
  const checkpoint = JSON.parse(fs.readFileSync(value.checkpointPath, 'utf8'));
  const ledger = fs.readFileSync(value.ledgerPath, 'utf8');
  const firstBreak = ledger.indexOf('\n');
  const first = JSON.parse(ledger.slice(0, firstBreak));
  first.receivedAt = '2026-09-07T00:59:59.000Z';
  fs.writeFileSync(value.ledgerPath, `${JSON.stringify(first)}${ledger.slice(firstBreak)}`, 'utf8');
  assert.throws(() => projectCru34LiveBatch({ ...value, instrumentProfile: profile }), /LEDGER_HASH_CHAIN_INVALID/);

  fs.writeFileSync(value.ledgerPath, ledger, 'utf8');
  const anchorLength = checkpoint.lastVerifiedEndByteOffset - checkpoint.lastVerifiedStartByteOffset;
  const fd = fs.openSync(value.ledgerPath, 'r+');
  try {
    const buffer = Buffer.alloc(anchorLength);
    fs.readSync(fd, buffer, 0, anchorLength, checkpoint.lastVerifiedStartByteOffset);
    const anchor = JSON.parse(buffer.toString('utf8').trim());
    anchor.receivedAt = '2026-09-07T01:00:01.000Z';
    const replacement = Buffer.from(`${JSON.stringify(anchor)}\n`);
    assert.equal(replacement.length, anchorLength);
    fs.writeSync(fd, replacement, 0, replacement.length, checkpoint.lastVerifiedStartByteOffset);
  } finally { fs.closeSync(fd); }
  assert.throws(() => projectCru34LiveBatch({ ...value, instrumentProfile: profile }), /LEDGER_HASH_CHAIN_INVALID/);
});

test('legacy Python-canonicalized IX0001 contribution preserves chain continuity without becoming CRU34 evidence', () => {
  const firstAt = '2026-10-01T01:51:30.000Z';
  const nextAt = '2026-10-01T01:51:45.000Z';
  const common = {
    code: 'TXFJ6', productFamily: 'TX', actualContract: 'TXFJ6',
    tradeDate: '2026-10-01', session: 'DAY', simtrade: false,
  };
  const prefix = chain([
    { kind: 'futures_bidask', receivedAt: firstAt, payload: { ...common, datetime: firstAt, bid_price: [99], ask_price: [100] } },
    { kind: 'futures_tick', receivedAt: firstAt, payload: { ...common, datetime: firstAt, eventTime: firstAt, close: 100, price: 100, volume: 2, executedVolume: 2, tick_type: 1 } },
  ]);
  const priorHash = prefix.at(-1).recordHash;
  const legacyBody = {
    schemaVersion: '1.0.0', provider: 'shioaji', code: 'ix0001_index_contribution',
    product: 'ix0001_index_contribution', receivedAt: '2026-10-01T09:51:39.019885+08:00',
    exchangeTimestamp: null, sequence: null, eventId: crypto.randomUUID(),
    duplicate: false, sequenceGap: 0, clockSkewMs: null, formalWeight: 0,
    researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    kind: 'ix0001_index_contribution',
    payload: { sourceVersion: '1.7.2', entries: [{ code: '2330', price: 2495, reference: 2480, priceChange: 15, points: 119.73 }] },
    previousHash: priorHash,
  };
  const legacy = { ...legacyBody, recordHash: 'a'.repeat(64) };
  assert.notEqual(
    crypto.createHash('sha256').update(`${priorHash}\n${cru34LiveCanonicalJson(legacyBody)}`).digest('hex'),
    legacy.recordHash,
  );
  const suffix = chain([
    { kind: 'futures_bidask', receivedAt: nextAt, payload: { ...common, datetime: nextAt, bid_price: [100], ask_price: [101] } },
    { kind: 'futures_tick', receivedAt: nextAt, payload: { ...common, datetime: nextAt, eventTime: nextAt, close: 101, price: 101, volume: 1, executedVolume: 1, tick_type: 1 } },
  ], legacy.recordHash);
  const value = fixture([...prefix, legacy, ...suffix]);
  const result = projectCru34LiveBatch({
    ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000,
    now: new Date('2026-10-01T01:52:00.000Z'),
  });
  assert.equal(result.checkpoint.lastVerifiedLedgerOrdinal, 5);
  assert.equal(result.checkpoint.rollingCanonicalEvents.some((event) => event.kind.includes('contribution')), false);
});

test('legacy contribution compatibility still fails closed on broken linkage and marked new records require strict hash', () => {
  const base = records({ seconds: 0 });
  const priorHash = base.at(-1).recordHash;
  const body = {
    schemaVersion: '1.0.0', provider: 'shioaji', code: 'ix0001_index_contribution',
    product: 'ix0001_index_contribution', receivedAt: '2026-10-01T09:51:39.019885+08:00',
    exchangeTimestamp: null, sequence: null, eventId: crypto.randomUUID(),
    duplicate: false, sequenceGap: 0, clockSkewMs: null, formalWeight: 0,
    researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    kind: 'ix0001_index_contribution', payload: { sourceVersion: '1.7.2', entries: [{ price: 2495 }] }, previousHash: priorHash,
  };
  const brokenLink = { ...body, previousHash: 'b'.repeat(64), recordHash: 'c'.repeat(64) };
  assert.throws(
    () => projectCru34LiveBatch({ ...fixture([...base, brokenLink]), instrumentProfile: profile }),
    /LEDGER_HASH_CHAIN_INVALID/,
  );
  const marked = {
    ...body,
    payload: { ...body.payload, ledgerCanonicalization: 'JS_SAFE_NUMBERS_V1' },
    recordHash: 'd'.repeat(64),
  };
  assert.throws(
    () => projectCru34LiveBatch({ ...fixture([...base, marked]), instrumentProfile: profile }),
    /LEDGER_HASH_CHAIN_INVALID/,
  );
});

test('record and byte bounds advance through checkpoints without an unbounded scan', () => {
  const value = fixture();
  const first = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 4096, maxBatchRecords: 3 });
  assert.equal(first.checkpoint.lastVerifiedLedgerOrdinal, 3);
  const second = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 4096, maxBatchRecords: 3 });
  assert.equal(second.checkpoint.lastVerifiedLedgerOrdinal, 6);
});

test('read side downgrades expired LIVE and rejects corrupt snapshots', () => {
  const value = fixture();
  projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000, staleAfterMs: 30_000, now: new Date('2026-09-07T01:05:35Z') });
  const live = readCru34LiveSnapshot({ snapshotPath: value.snapshotPath, now: new Date('2026-09-07T01:05:40Z') });
  assert.equal(live.truthState, 'LIVE');
  const stale = readCru34LiveSnapshot({ snapshotPath: value.snapshotPath, now: new Date('2026-09-07T01:06:01Z') });
  assert.equal(stale.truthState, 'STALE');
  const raw = JSON.parse(fs.readFileSync(value.snapshotPath, 'utf8'));
  const validRaw = structuredClone(raw);
  raw.semanticPayload.primary60s.pressure.pressureRatio = 0.123456;
  fs.writeFileSync(value.snapshotPath, `${JSON.stringify(raw)}\n`, 'utf8');
  assert.equal(readCru34LiveSnapshot({ snapshotPath: value.snapshotPath }).truthState, 'UNAVAILABLE');

  const invalidTime = validRaw;
  invalidTime.validUntil = 'not-a-time';
  const { snapshotHash: ignored, ...body } = invalidTime;
  invalidTime.snapshotHash = cru34LiveHash(body);
  fs.writeFileSync(value.snapshotPath, `${JSON.stringify(invalidTime)}\n`, 'utf8');
  assert.equal(readCru34LiveSnapshot({ snapshotPath: value.snapshotPath }).truthState, 'UNAVAILABLE');
});

test('continuity, contract, session, and trade-date boundaries reset rolling identity', () => {
  const base = records({ seconds: 330 });
  const lastHash = base.at(-1).recordHash;
  const boundaryAt = '2026-09-07T01:06:00.000Z';
  const suffix = chain([
    { kind: 'quote_type_reconnect_resubscribe', code: 'bridge', receivedAt: boundaryAt, payload: { product: 'TX' } },
    { kind: 'futures_bidask', receivedAt: boundaryAt, payload: { code: 'TXFJ6', productFamily: 'TX', actualContract: 'TXFJ6', tradeDate: '2026-09-08', session: 'NIGHT', datetime: boundaryAt, bid_price: [110], ask_price: [111] } },
    { kind: 'futures_tick', receivedAt: boundaryAt, payload: { code: 'TXFJ6', productFamily: 'TX', actualContract: 'TXFJ6', tradeDate: '2026-09-08', session: 'NIGHT', datetime: boundaryAt, close: 111, volume: 1, tick_type: 1 } },
  ], lastHash);
  const value = fixture([...base, ...suffix]);
  const result = projectCru34LiveBatch({ ...value, instrumentProfile: profile, maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000 });
  assert.equal(result.status, 'WARMING_UP');
  assert.equal(result.checkpoint.actualContract, 'TXFJ6');
  assert.equal(result.checkpoint.tradeDate, '2026-09-08');
  assert.equal(result.checkpoint.session, 'NIGHT');
  assert.equal(result.checkpoint.continuityEpoch, 'TX:2');
  assert.ok(result.checkpoint.rollingCanonicalEvents.every((event) => event.actualContract === 'TXFJ6'));
});

test('projection runner remains resident for continuous bounded polling', () => {
  const runner = fs.readFileSync(new URL('../scripts/run-cru34-live-projection.mjs', import.meta.url), 'utf8');
  assert.match(runner, /setInterval\(\(\) => \{ void runSingleFlight\(\); \}, pollMs\);/);
  assert.match(runner, /if \(runInFlight \|\| stopping\) return;/);
  assert.match(runner, /process\.stderr\.on\('error'/);
  assert.doesNotMatch(runner, /\.unref\(\)/);
  assert.match(runner, /worker\.lock/);
  assert.match(runner, /acquireCru34WorkerLockSync/);
  const workerLock = fs.readFileSync(new URL('../src/cru34-worker-lock.mjs', import.meta.url), 'utf8');
  assert.match(workerLock, /signalProcess\(record.pid, 0\)/);
  assert.match(workerLock, /STALE_TAKEOVER_BUSY/);
});
