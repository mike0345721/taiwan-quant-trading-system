import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { createCvdCheckpoint, appendCvdRecords, SAFETY } from '../src/cvd-observation-core.mjs';
import { createStreamStore, STREAM_STORE_LIMITS } from '../src/cru55-stream-store.mjs';

const sourceLedgerIdentity = 'sha256:' + 'a'.repeat(64), resolverIdentity = 'paged-store-test-v1';
function row(kind = 'futures_tick', payload = {}) {
  return { kind, code: 'TXFI6', receivedAt: '2026-09-11T09:00:01+08:00', ...SAFETY,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-11', session: 'DAY',
      eventTime: '2026-09-11T09:00:01+08:00', close: 100, volume: 2, tick_type: 1, ...payload } };
}
function chain(rows, previous = 'GENESIS') {
  return rows.map(r => { const record = buildLiveEventRecord(r, previous); previous = record.recordHash; return record; });
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru55-stream-store-'));
  t.after(() => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('TEST_CLEANUP_OUTSIDE_ROOT');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const open = () => createStreamStore({ root, sourceLedgerIdentity, resolverIdentity });
  return { root, open, store: open() };
}
const currentBytes = root => fs.readFileSync(path.join(root, 'latest.json'), 'utf8');
function appendOne(store, value) {
  return store.append(chain([value], store.read().checkpoint.state.terminalHash));
}

test('immutable pages exceed 1024 points, resume checkpoints, exact retry and full-chain audit', t => {
  const f = fixture(t), records = chain(Array.from({ length: 1100 }, (_, i) => row('futures_tick', { tick_type: i % 3, volume: i % 7 + 1 })));
  const expected = appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity, resolverIdentity), records,
    { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  let store = f.store, previousHash = null, last;
  const points = [];
  for (let start = 0; start < records.length; start += STREAM_STORE_LIMITS.records) {
    const batch = records.slice(start, start + STREAM_STORE_LIMITS.records);
    last = store.append(batch); assert.equal(last.state, 'PUBLISHED');
    assert.equal(last.current.previousPageHash, previousHash); previousHash = last.headPageHash;
    points.push(...last.current.facts.map(x => x.point));
    const pointer = currentBytes(f.root);
    assert.equal(store.append(batch).state, 'UNCHANGED'); assert.equal(currentBytes(f.root), pointer);
    store = f.open(); // no parent-process state required
  }
  assert.deepEqual(points, expected.state.series);
  assert.deepEqual(last.checkpoint.state.activeSegment, expected.state.segments[0]);
  assert.equal(store.read().verification, 'CURRENT_PAGE_ONLY');
  let audit = store.auditHistory({ maxPages: 2 }), rounds = 0;
  while (audit.state === 'PENDING') { rounds++; audit = f.open().auditHistory({ auditCursor: audit.cursor, maxPages: 2 }); }
  assert.ok(rounds > 1); assert.equal(audit.checkedRecords, 1100); assert.equal(audit.checkedPages, 9);
  assert.equal(audit.originalRawPrefixVerified, false);
});

test('late quote search resumes durable cursor across process instances and never substitutes null on budget', t => {
  const f = fixture(t);
  appendOne(f.store, row('futures_bidask', { eventTime: '2026-09-11T09:00:00+08:00', bid_price: [99], ask_price: [100] }));
  for (let i = 0; i < 5; i++) {
    appendOne(f.store, row('futures_bidask', { eventTime: '2026-09-11T09:00:02+08:00', bid_price: [199], ask_price: [200] }));
    appendOne(f.store, row('stock_tick'));
  }
  const before = f.store.read(), records = chain([row(), row()], before.checkpoint.state.terminalHash), pointer = currentBytes(f.root);
  let quoteCursor, pendingCount = 0, result;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { result = f.open().append(records, { quoteCursor, maxQueryPages: 2 }); break; }
    catch (error) {
      assert.equal(error.code, 'STREAM_QUOTE_QUERY_PENDING'); assert.match(error.cursor, /^[a-f0-9]{64}$/);
      quoteCursor = error.cursor; pendingCount++;
      assert.equal(currentBytes(f.root), pointer); assert.equal(f.store.read().checkpoint.state.ordinal, before.checkpoint.state.ordinal);
      assert.ok(!fs.existsSync(path.join(f.root, 'writer.lock')));
    }
  }
  assert.ok(result); assert.ok(pendingCount >= 4);
  assert.equal(result.checkpoint.state.activeSegment.bestQuoteMatchedVolume, 4);
  assert.equal(result.checkpoint.state.activeSegment.value, 4);
  assert.equal(f.store.auditHistory().state, 'COMPLETE');
});

test('cursor binds exact batch, source, resolver and checkpoint head; too-small byte budget fails explicitly', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) appendOne(f.store, row('futures_bidask', { eventTime: '2026-09-11T09:00:02+08:00' }));
  const before = f.store.read(), records = chain([row()], before.checkpoint.state.terminalHash);
  let cursor;
  assert.throws(() => f.store.append(records, { maxQueryPages: 1 }), e => { cursor = e.cursor; return e.code === 'STREAM_QUOTE_QUERY_PENDING'; });
  assert.throws(() => f.store.append(chain([row('futures_tick', { volume: 3 })], before.checkpoint.state.terminalHash),
    { quoteCursor: cursor }), /CURSOR_BINDING/);
  assert.throws(() => f.store.append(records, { maxQueryBytes: 1 }), /PAGE_EXCEEDS_QUERY_BUDGET/);
  appendOne(f.store, row('stock_tick'));
  assert.throws(() => f.store.append(chain([row()], f.store.read().checkpoint.state.terminalHash), { quoteCursor: cursor }), /CURSOR_BINDING/);
  assert.throws(() => createStreamStore({ root: f.root, sourceLedgerIdentity: 'sha256:' + 'b'.repeat(64), resolverIdentity }).read(), /POINTER/);
  assert.throws(() => createStreamStore({ root: f.root, sourceLedgerIdentity, resolverIdentity: 'changed' }).read(), /POINTER/);
});

test('many distinct completed quote proofs resume without unbudgeted historical page rereads', t => {
  const f = fixture(t);
  for (let i = 1; i <= 6; i++) appendOne(f.store, row('futures_bidask', {
    eventTime: `2026-09-11T09:00:0${i}+08:00`, bid_price: [99], ask_price: [100],
  }));
  const records = chain(Array.from({ length: 6 }, (_, i) => ({ ...row('futures_tick', {
    eventTime: `2026-09-11T09:00:0${i + 1}+08:00`,
  }), receivedAt: '2026-09-11T09:00:20+08:00' })), f.store.read().checkpoint.state.terminalHash);
  let quoteCursor, complete, pendingCount = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const original = fs.readFileSync; let pageReads = 0;
    try {
      fs.readFileSync = (file, ...args) => {
        if (String(file).startsWith(f.root) && String(file).endsWith('.page.json')) pageReads++;
        return original(file, ...args);
      };
      complete = f.open().append(records, { quoteCursor, maxQueryPages: 1 });
      assert.ok(pageReads <= 3, 'current page + one scan page + commit readback'); break;
    } catch (error) {
      assert.equal(error.code, 'STREAM_QUOTE_QUERY_PENDING');
      assert.equal(error.queryPages, 1); assert.ok(error.queryBytes <= STREAM_STORE_LIMITS.queryBytes);
      assert.ok(pageReads <= 2, 'current page + one scan page, no completed-proof page rereads');
      quoteCursor = error.cursor; pendingCount++;
    } finally { fs.readFileSync = original; }
  }
  assert.ok(complete); assert.ok(pendingCount >= 15);
  assert.equal(complete.checkpoint.state.activeSegment.bestQuoteMatchedVolume, 12);
});

test('oversized persisted quote proof fails closed instead of deleting facts or inventing missing quote', t => {
  const f = fixture(t);
  appendOne(f.store, row('futures_bidask', { bid_price: [99], ask_price: [100], padding: 'x'.repeat(140 * 1024) }));
  appendOne(f.store, row('futures_bidask', { eventTime: '2026-09-11T09:00:02+08:00' }));
  const before = currentBytes(f.root), records = chain([row(), row()], f.store.read().checkpoint.state.terminalHash);
  assert.throws(() => f.store.append(records, { maxQueryPages: 2 }), /ARTIFACT_BUDGET/);
  assert.equal(currentBytes(f.root), before);
});

test('quote-only identity changes preserve segment fences and immutable old point', t => {
  const f = fixture(t), a = appendOne(f.store, row('futures_bidask', { bid_price: [99], ask_price: [100] }));
  const first = appendOne(f.store, row()), old = fs.readFileSync(path.join(f.root, first.headPageHash + '.page.json'));
  appendOne(f.store, row('futures_bidask', { actualContract: 'TXFJ6', bid_price: [99], ask_price: [100] }));
  const final = appendOne(f.open(), row());
  assert.equal(final.checkpoint.state.segmentCount, 2);
  assert.equal(final.checkpoint.state.activeSegment.bestQuoteMatchedVolume, 0);
  assert.deepEqual(fs.readFileSync(path.join(f.root, first.headPageHash + '.page.json')), old);
  assert.equal(f.store.auditHistory().checkedRecords, 4); assert.ok(a.headPageHash);
});

test('tampered accessed pages fail closed; old nonquote history is verified explicitly by audit', t => {
  const f = fixture(t), old = appendOne(f.store, row('stock_tick'));
  const next = appendOne(f.store, row()), file = path.join(f.root, old.headPageHash + '.page.json');
  fs.writeFileSync(file, '{}');
  assert.equal(f.store.read().verification, 'CURRENT_PAGE_ONLY');
  assert.throws(() => f.store.auditHistory(), /PAGE_INVALID/);
  fs.writeFileSync(path.join(f.root, next.headPageHash + '.page.json'), '{}');
  assert.throws(() => f.store.read(), /PAGE_INVALID/);
});

test('tampered historical quote page prevents append; no successful empty quote fallback', t => {
  const f = fixture(t), quote = appendOne(f.store, row('futures_bidask', { bid_price: [99], ask_price: [100] }));
  appendOne(f.store, row('stock_tick')); const pointer = currentBytes(f.root);
  fs.writeFileSync(path.join(f.root, quote.headPageHash + '.page.json'), '{broken');
  assert.throws(() => appendOne(f.store, row())); assert.equal(currentBytes(f.root), pointer);
});

test('failure after immutable page publication leaves old pointer; orphan pages/temp never become current', t => {
  const f = fixture(t), first = appendOne(f.store, row()), pointer = currentBytes(f.root);
  const records = chain([row()], first.checkpoint.state.terminalHash), original = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === path.join(f.root, 'latest.json')) throw Error('INJECTED_BEFORE_POINTER_RENAME'); return original(from, to); };
    assert.throws(() => f.store.append(records), /INJECTED/);
  } finally { fs.renameSync = original; }
  assert.equal(currentBytes(f.root), pointer); assert.equal(f.open().read().checkpoint.state.ordinal, 1);
  assert.equal(fs.readdirSync(f.root).filter(x => x.endsWith('.page.json')).length, 2);
  fs.writeFileSync(path.join(f.root, 'interrupted.tmp'), '{');
  assert.equal(f.open().append(records).checkpoint.state.ordinal, 2);
  assert.equal(f.store.auditHistory().checkedRecords, 2);
});

test('foreign lock, replay overlap, partial/corrupt pointer and batch budgets never advance state', t => {
  const f = fixture(t), records = chain([row(), row()]); f.store.append(records);
  const lock = path.join(f.root, 'writer.lock'); fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner.json'), '{"token":"foreign"}');
  const pointer = currentBytes(f.root);
  assert.throws(() => appendOne(f.store, row()), /WRITER_BUSY/);
  assert.equal(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'), '{"token":"foreign"}');
  fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  assert.throws(() => f.store.append(records.slice(1)), /APPEND_FENCE/);
  assert.throws(() => f.store.append(Array(129).fill(records[0])), /BATCH_BUDGET/);
  assert.equal(currentBytes(f.root), pointer);
  fs.writeFileSync(path.join(f.root, 'latest.json'), '{partial'); assert.throws(() => f.open().read());
  fs.unlinkSync(path.join(f.root, 'latest.json'));
  assert.throws(() => f.open().read(), /POINTER_MISSING/);
  assert.throws(() => f.store.append(chain([row()])), /POINTER_MISSING/);
});
