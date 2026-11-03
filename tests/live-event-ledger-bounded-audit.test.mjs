import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditLiveEventLedger, evaluateLiveEventAcceptance, replayLiveEventLedger,
  appendLiveEvent, buildLiveEventRecord } from '../src/live-event-ledger.mjs';

const file = 'synthetic-bounded-ledger.ndjson';
const limit = 64 * 1024 * 1024;
function oversized(t, size) {
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'statSync', () => ({ size }));
  const allocate = t.mock.method(Buffer, 'allocUnsafe', () => { throw new Error('UNBOUNDED_ALLOCATION_ATTEMPT'); });
  const open = t.mock.method(fs, 'openSync', () => { throw new Error('UNEXPECTED_LEDGER_OPEN'); });
  const read = t.mock.method(fs, 'readSync', () => { throw new Error('UNEXPECTED_LEDGER_READ'); });
  return { allocate, open, read };
}

for (const size of [limit + 1, 2 ** 31 + 1, 2763585397]) {
  test(`oversized ${size}-byte ledger remains unknown without allocating or reading any prefix`, t => {
    const probes = oversized(t, size);
    const audit = auditLiveEventLedger(file);
    assert.equal(audit.ok, false);
    assert.equal(audit.auditState, 'AUDIT_INCOMPLETE');
    assert.equal(audit.reason, 'ledger_audit_size_limit');
    assert.equal(audit.bytes, size);
    assert.equal(audit.maxAuditBytes, limit);
    assert.equal(audit.bytesRead, 0);
    assert.equal(audit.events, null);
    assert.equal(audit.latestHash, null);
    for (const probe of Object.values(probes)) assert.equal(probe.mock.callCount(), 0);
    const acceptance = evaluateLiveEventAcceptance(audit, { operationalHealth: { callbackErrors: 0, dropped: 0, writerErrors: 0 } });
    assert.equal(acceptance.status, 'PENDING');
    assert.equal(acceptance.passed, false);
    assert.deepEqual(acceptance.reasons, ['ledger_audit_size_limit']);
    assert.equal(acceptance.checks.integrity, null);
    assert.equal(acceptance.checks.requiredProducts, null);
    assert.equal(acceptance.evidence.requiredProductDurationMs, null);
    assert.equal(acceptance.evidence.acceptanceClockSkewEvents, null);
  });
}

test('incomplete audit does not erase independently known operational failures', t => {
  oversized(t, limit + 1);
  const acceptance = evaluateLiveEventAcceptance(auditLiveEventLedger(file), {
    operationalHealth: { callbackErrors: 1, dropped: 2, writerErrors: 3 },
  });
  assert.equal(acceptance.status, 'FAIL');
  assert.equal(acceptance.passed, false);
  assert.deepEqual(acceptance.failReasons, ['callback_error_detected', 'queue_drop_detected', 'writer_error_detected']);
  assert.deepEqual(acceptance.pendingReasons, ['ledger_audit_size_limit']);
  assert.equal(acceptance.checks.integrity, null);
});

test('incomplete audit keeps absent or invalid operational counters unknown instead of coercing them to zero', t => {
  oversized(t, limit + 1);
  const audit = auditLiveEventLedger(file);
  for (const value of [undefined, null, '', '0', '1', false, true, NaN, Infinity, -1]) {
    const acceptance = evaluateLiveEventAcceptance(audit, {
      operationalHealth: { callbackErrors: value, dropped: value, writerErrors: value },
    });
    assert.equal(acceptance.status, 'PENDING', String(value));
    assert.deepEqual(acceptance.failReasons, [], String(value));
    assert.ok(acceptance.pendingReasons.includes('operational_health_evidence_missing'), String(value));
    for (const key of ['callbackErrors', 'dropped', 'writerErrors']) assert.equal(acceptance.checks[key], null, `${key}/${String(value)}`);
  }
});

test('partial operational evidence preserves known good and bad counters while keeping missing counters unknown', t => {
  oversized(t, limit + 1);
  const audit = auditLiveEventLedger(file);
  for (const operationalHealth of [null, {}]) {
    const acceptance = evaluateLiveEventAcceptance(audit, { operationalHealth });
    assert.equal(acceptance.status, 'PENDING');
    assert.ok(acceptance.pendingReasons.includes('operational_health_evidence_missing'));
    assert.equal(acceptance.checks.callbackErrors, null);
  }
  const acceptance = evaluateLiveEventAcceptance(audit, { operationalHealth: { callbackErrors: 0, dropped: 1 } });
  assert.equal(acceptance.status, 'FAIL');
  assert.deepEqual(acceptance.failReasons, ['queue_drop_detected']);
  assert.ok(acceptance.pendingReasons.includes('operational_health_evidence_missing'));
  assert.equal(acceptance.checks.callbackErrors, true);
  assert.equal(acceptance.checks.dropped, false);
  assert.equal(acceptance.checks.writerErrors, null);
});

test('replay and append remain closed when a full audit exceeds the bounded contract', t => {
  oversized(t, limit + 1);
  t.mock.method(fs, 'mkdirSync', () => undefined);
  const read = t.mock.method(fs, 'readFileSync', () => { throw new Error('UNEXPECTED_REPLAY'); });
  const append = t.mock.method(fs, 'appendFileSync', () => { throw new Error('UNEXPECTED_APPEND'); });
  assert.throws(() => replayLiveEventLedger(file), /ledger_audit_failed/);
  assert.throws(() => appendLiveEvent(file, {}), /existing_ledger_invalid/);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(append.mock.callCount(), 0);
});

test('small frozen hash-chain audit retains event times and excludes later appended bytes', t => {
  const event = sequence => ({ schemaVersion: '1.0.0', provider: 'synthetic', kind: 'stock_tick', code: '2330', product: '2330',
    receivedAt: `2026-11-03T01:00:0${sequence}.000Z`, exchangeTimestamp: `2026-11-03T01:00:0${sequence}.000Z`,
    availableAt: `2026-11-03T01:00:0${sequence}.000Z`, sequence, duplicate: false, sequenceGap: 0, clockSkewMs: 0,
    executionAuthorized: false, orderRoutesEnabled: false, payload: { label: '合成資料', close: 100 + sequence } });
  const first = buildLiveEventRecord(event(1), 'GENESIS');
  const second = buildLiveEventRecord(event(2), first.recordHash);
  const third = buildLiveEventRecord(event(3), second.recordHash);
  const frozen = Buffer.from([first, second].map(row => JSON.stringify(row)).join('\n') + '\n');
  const appended = Buffer.concat([frozen, Buffer.from(JSON.stringify(third) + '\n')]);
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'statSync', () => ({ size: frozen.length }));
  t.mock.method(fs, 'openSync', () => 77);
  const read = t.mock.method(fs, 'readSync', (descriptor, buffer, offset, length, position) => {
    assert.equal(descriptor, 77);
    assert.ok(position + length <= frozen.length);
    return appended.copy(buffer, offset, position, position + length);
  });
  const close = t.mock.method(fs, 'closeSync', () => undefined);
  const audit = auditLiveEventLedger(file, { now: new Date('2026-11-03T01:00:04Z') });
  assert.equal(audit.ok, true); assert.equal(audit.events, 2);
  assert.equal(audit.bytes, frozen.length); assert.equal(audit.latestHash, second.recordHash);
  assert.equal(audit.earliestReceivedAt, first.receivedAt); assert.equal(audit.latestReceivedAt, second.receivedAt);
  assert.equal(audit.latestMarketReceivedAt, second.receivedAt); assert.equal(audit.hashFailures, 0);
  assert.equal(first.availableAt, '2026-11-03T01:00:01.000Z');
  assert.equal(read.mock.callCount(), 1); assert.equal(close.mock.callCount(), 1);
});
