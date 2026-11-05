import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IX0001_BREADTH_CONTRACT, auditIx0001Breadth, extractIx0001Breadth } from '../src/ix0001-live-breadth.mjs';
import { classifyIx0001ForWorkspace, readLatestIx0001Record } from '../src/dashboard-live-breadth-source.mjs';

function record(overrides = {}) {
  return {
    kind: 'index_quote', code: 'IX0001', product: 'IX0001',
    exchangeTimestamp: '2026-08-14T09:01:00', receivedAt: '2026-08-14T09:01:00.100+08:00',
    payload: {
      code: 'IX0001', date: '2026-08-14', datetime: '2026-08-14T09:01:00',
      _received_at: '2026-08-14T09:01:00.100+08:00', raise_count: 700, fall_count: 200,
      flat_count: 100, limit_up_count: 10, limit_down_count: 1, no_trade: 5,
      ...(overrides.payload || {}),
    },
    ...overrides,
  };
}

test('IX0001 extractor preserves governed fields and availability lineage', () => {
  const result = extractIx0001Breadth(record());
  assert.equal(result.sourceId, 'SHIOAJI_INDEX_QUOTE_IX0001');
  assert.equal(result.session, 'DAY');
  assert.equal(result.breadth.raise_count, 700);
  assert.equal(result.availableAt, '2026-08-14T01:01:00.100Z');
  assert.equal(result.nativeSequenceAvailability, 'UNAVAILABLE');
  assert.equal(result.promotionState, 'RAW_ONLY');
  assert.equal(result.directionState, 'NOT_ELIGIBLE');
});

test('missing breadth fields and non-day records fail closed', () => {
  const missing = extractIx0001Breadth(record({ payload: { fall_count: null } }));
  assert.equal(missing.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.ok(missing.qualityReasons.includes('MISSING_OR_INVALID_FALL_COUNT'));
  const night = extractIx0001Breadth(record({
    exchangeTimestamp: '2026-08-14T19:00:00',
    payload: { datetime: '2026-08-14T19:00:00', _received_at: '2026-08-14T19:00:00.050+08:00' },
  }));
  assert.equal(night.session, 'AFTER_MARKET');
  assert.ok(night.qualityReasons.includes('SESSION_AFTER_MARKET_NOT_ELIGIBLE_FOR_LIVE_BREADTH'));
});

test('breadth replay is deterministic, future-safe and not promoted', () => {
  const records = [record(), record({
    exchangeTimestamp: '2026-08-14T09:02:00',
    payload: { datetime: '2026-08-14T09:02:00', _received_at: '2026-08-14T09:02:00.050+08:00' },
  })];
  const left = auditIx0001Breadth(records, { tradeDate: '2026-08-14', asOf: '2026-08-14T01:03:00Z' });
  const right = auditIx0001Breadth([...records].reverse(), { tradeDate: '2026-08-14', asOf: '2026-08-14T01:03:00Z' });
  assert.equal(left.status, 'RAW_VALIDATED_CANDIDATE');
  assert.equal(left.futureDataViolations, 0);
  assert.equal(left.coverageState, 'PARTIAL');
  assert.equal(left.deterministicReplayHash, right.deterministicReplayHash);
  assert.equal(left.promotionState, 'RAW_ONLY');
});

test('future availability is excluded and blocks candidate readiness', () => {
  const result = auditIx0001Breadth([record()], {
    tradeDate: '2026-08-14', asOf: '2026-08-14T01:00:00Z',
  });
  assert.equal(result.status, 'NOT_READY');
  assert.equal(result.futureDataViolations, 1);
});

test('IX0001 reuses one governed callback and prohibits duplicate collector', () => {
  assert.equal(IX0001_BREADTH_CONTRACT.callback, 'set_on_quote_idx_v1_callback');
  assert.equal(IX0001_BREADTH_CONTRACT.duplicateCollectorAllowed, false);
  assert.equal(IX0001_BREADTH_CONTRACT.maximumPromotionReadiness, 'RAW_VALIDATED_CANDIDATE');
});

test('workspace breadth is LIVE only for the current governed DAY identity', () => {
  const currentIdentity = { state: 'AVAILABLE', tradeDate: '2026-08-14', session: 'DAY', contract: 'TXFH6' };
  const live = classifyIx0001ForWorkspace(record(), {
    currentIdentity,
    asOf: '2026-08-14T01:03:00.000Z',
  });
  assert.equal(live.state, 'LIVE');
  assert.equal(live.sourceMode, 'LIVE_RAW');
  assert.equal(live.currentSessionMatch, true);
  assert.equal(live.observation.promotionState, 'RAW_ONLY');

  const night = classifyIx0001ForWorkspace(record(), {
    currentIdentity: { ...currentIdentity, session: 'NIGHT' },
    asOf: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(night.state, 'EOD_CONTEXT');
  assert.equal(night.sourceMode, 'EOD_CONTEXT');
  assert.equal(night.currentSessionMatch, false);
});

test('other-trade-date breadth is unavailable rather than silently presented as live', () => {
  const result = classifyIx0001ForWorkspace(record(), {
    currentIdentity: { state: 'AVAILABLE', tradeDate: '2026-08-15', session: 'DAY', contract: 'TXFH6' },
    asOf: '2026-08-15T01:03:00.000Z',
  });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reasonCode, 'IX0001_CURRENT_IDENTITY_MISMATCH');
});

test('latest IX0001 lookup uses a bounded tail and ignores unrelated records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ix0001-breadth-'));
  const file = path.join(root, 'fixture.ndjson');
  const older = record();
  const latest = record({
    exchangeTimestamp: '2026-08-14T09:02:00',
    payload: { datetime: '2026-08-14T09:02:00', _received_at: '2026-08-14T09:02:00.050+08:00', raise_count: 701 },
  });
  fs.writeFileSync(file, `${JSON.stringify(older)}\n${JSON.stringify({ kind: 'tick', code: 'TXFH6' })}\n${JSON.stringify(latest)}\n`);
  try {
    const found = readLatestIx0001Record(file, { maxTailBytes: 64 * 1024 });
    assert.equal(found.record.payload.raise_count, 701);
    assert.ok(found.bytesScanned <= 64 * 1024);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tailFixture(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ix0001-tail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fixture.ndjson');
  fs.writeFileSync(file, text);
  return file;
}

test('latest nearby quote avoids reading the whole growing tail and ignores torn final JSON', t => {
  const latest = record({ receivedAt: '2026-08-14T09:02:00+08:00' });
  const noise = JSON.stringify({ kind: 'tick', value: 'x'.repeat(1024) }) + '\n';
  const file = tailFixture(t, noise.repeat(2048) + JSON.stringify(latest) + '\r\n{"kind":"index_quote","code":"IX0001"');
  const original = fs.readSync;
  let readBytes = 0;
  t.mock.method(fs, 'readSync', (...args) => { const count = original(...args); readBytes += count; return count; });
  const result = readLatestIx0001Record(file);
  assert.deepEqual(result.record, latest);
  assert.equal(result.bytesScanned, readBytes);
  assert.ok(readBytes <= 64 * 1024, `unexpected whole-tail read: ${readBytes}`);
  fs.appendFileSync(file, '\n' + noise + JSON.stringify({ ...latest, receivedAt: '2026-08-14T09:03:00+08:00' }) + '\n');
  assert.equal(readLatestIx0001Record(file).record.receivedAt, '2026-08-14T09:03:00+08:00');
});

test('reverse blocks reconstruct UTF-8 and CRLF rows across boundaries in physical order', t => {
  const latest = record({ note: '繁體中文'.repeat(18000), receivedAt: '2026-08-14T09:00:00+08:00' });
  const file = tailFixture(t, JSON.stringify(record()) + '\r\n' + JSON.stringify(latest) + '\r\n' + '{"kind":"tick"}\n'.repeat(5000));
  const found = readLatestIx0001Record(file, { maxTailBytes: 512 * 1024 });
  assert.deepEqual(found.record, latest, 'latest physical row wins, not maximum timestamp');
  assert.ok(found.bytesScanned <= 512 * 1024);
});

test('bounded read does not overrun the requested bytes or borrow cache from another budget', t => {
  const file = tailFixture(t, JSON.stringify(record()) + '\n' + '{"kind":"tick"}\n'.repeat(10000));
  const result = readLatestIx0001Record(file, { maxTailBytes: 200000 });
  assert.ok(result.record);
  const small = readLatestIx0001Record(file, { maxTailBytes: 4097 });
  assert.equal(small.bytesScanned, 4097);
  assert.equal(small.record, null);
  assert.equal(small.reason, 'IX0001_NOT_FOUND_IN_BOUNDED_TAIL');
});

test('append-only cache fallback survives sparse quotes but truncation never reuses it', t => {
  const quote = record();
  const file = tailFixture(t, JSON.stringify(quote) + '\n');
  assert.deepEqual(readLatestIx0001Record(file, { maxTailBytes: 4096 }).record, quote);
  fs.appendFileSync(file, '{"kind":"tick"}\n'.repeat(500));
  assert.deepEqual(readLatestIx0001Record(file, { maxTailBytes: 4096 }).record, quote);
  fs.writeFileSync(file, '{"kind":"tick"}\n');
  assert.equal(readLatestIx0001Record(file, { maxTailBytes: 4096 }).record, null);
});

test('a missing or replaced ledger does not reuse the previous file quote', t => {
  const file = tailFixture(t, JSON.stringify(record()) + '\n');
  assert.ok(readLatestIx0001Record(file).record);
  fs.unlinkSync(file);
  assert.equal(readLatestIx0001Record(file).reason, 'LIVE_LEDGER_NOT_FOUND');
  fs.writeFileSync(file, '{"kind":"tick"}\n'.repeat(500));
  assert.equal(readLatestIx0001Record(file).record, null);
});

test('short reads caused by a concurrent truncation fail visibly without parsing uninitialized bytes', t => {
  const file = tailFixture(t, JSON.stringify(record()) + '\n');
  t.mock.method(fs, 'readSync', () => 0);
  const result = readLatestIx0001Record(file);
  assert.equal(result.record, null);
  assert.equal(result.bytesScanned, 0);
  assert.equal(result.reason, 'LIVE_LEDGER_CHANGED_DURING_READ');
});

test('chunked tail matches the original full-tail oracle for byte boundaries and malformed rows', t => {
  function oracle(bytes) {
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
      try {
        const value = JSON.parse(lines[index]);
        if (value.kind === 'index_quote' && value.code === 'IX0001' && value.product === 'IX0001') return value;
      } catch { /* same malformed-row fallback */ }
    }
    return null;
  }
  const rows = [record({ note: '最早' }), { kind: 'index_quote', code: 'IX0001', product: 'WRONG' },
    record({ note: '跨界'.repeat(22000) }), { kind: 'tick', note: 'x'.repeat(66000) }, record({ note: '最後' })];
  for (const suffix of ['', '\n', '\r\n{"kind":"index_quote","code":"IX0001"']) {
    const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\r\n') + suffix);
    for (const budget of [1, 500, 65535, 65536, 65537, 131072, bytes.length + 10]) {
      // A separate path makes this a cold-tail oracle, independent of fallback cache.
      const file = tailFixture(t, bytes);
      const result = readLatestIx0001Record(file, { maxTailBytes: budget });
      assert.deepEqual(result.record, oracle(bytes.subarray(Math.max(0, bytes.length - budget))), `budget=${budget}, suffix=${JSON.stringify(suffix)}`);
      assert.ok(result.bytesScanned <= Math.min(bytes.length, budget));
    }
  }
});
