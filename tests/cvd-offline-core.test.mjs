import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations, buildExecutedPressureWindow } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, SAFETY } from '../src/cvd-offline-core.mjs';

const source = 'engineering-fixture';
function record(kind = 'futures_tick', payload = {}, more = {}) {
  return { kind, code: 'TXFI6', receivedAt: '2026-09-11T09:00:01+08:00', ...SAFETY,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-11', session: 'DAY',
      eventTime: '2026-09-11T09:00:01+08:00', close: 100, volume: 2, tick_type: 1, ...payload }, ...more };
}
function chain(rows) { let prev = 'GENESIS'; return rows.map(r => { const v = buildLiveEventRecord(r, prev); prev = v.recordHash; return v; }); }
function run(rows, chunk = rows.length || 1) {
  const records = chain(rows); let c = createCvdCheckpoint(source);
  for (let i = 0; i < records.length; i += chunk) c = appendCvdRecords(c, records.slice(i, i + chunk), { sourceLedgerIdentity: source, ledgerOrdinalOffset: i });
  return { c, result: cvdSemanticResult(c), records };
}

test('C1 exact Pressure classification parity, conservation and UNKNOWN', () => {
  const { result, records } = run([record('futures_bidask', { bid_price: [99], ask_price: [100] }),
    record(), record('futures_tick', { tick_type: 2, volume: 3 }), record('futures_tick', { tick_type: 0, volume: 4 }),
    record('futures_tick', { simtrade: true, volume: 999 }), record('futures_tick', {}, { duplicate: true })]);
  const events = materializeTxCanonicalObservations(records, { sourceLedgerIdentity: source }).events;
  const p = buildExecutedPressureWindow(events, events.at(-1));
  const s = result.semantic.segments[0];
  for (const key of ['buyProxyVolume', 'sellProxyVolume', 'unknownVolume', 'totalExecutedVolume', 'classifiedCoverage']) assert.equal(s[key], p[key]);
  assert.equal(s.value, -1); assert.equal(s.tickCount, 3);
  assert.equal(s.classificationConflictCount, p.conflict.count);
  assert.equal(s.totalExecutedVolume, s.buyProxyVolume + s.sellProxyVolume + s.unknownVolume);
});
test('C1 empty, all UNKNOWN, invalid price/volume never neutral or complete', () => {
  assert.equal(run([]).result.semantic.value, null);
  assert.equal(run([record('futures_tick', { tick_type: 0 })]).result.semantic.value, null);
  for (const invalid of [0, -1, '', 'bad']) {
    const r = run([record(), record('futures_tick', { volume: invalid }), record()]).result.semantic;
    assert.equal(r.value, null); assert.equal(r.segments[0].invalidTickCount, 1);
  }
  assert.equal(run([record('futures_tick', { close: 0 })]).result.semantic.value, null);
});
test('C2 full/chunk/JSON checkpoint resume and immutable earlier output', () => {
  const rows = [record('futures_bidask', { bid_price: [99], ask_price: [100] }), record(), record('futures_tick', { tick_type: 2 })];
  const full = run(rows);
  for (const size of [1, 2, 3]) assert.deepEqual(run(rows, size).result, full.result);
  const prefix = run(rows.slice(0, 2)); const old = JSON.stringify(prefix.c);
  const resumed = appendCvdRecords(JSON.parse(old), [full.records[2]], { sourceLedgerIdentity: source, ledgerOrdinalOffset: 2 });
  assert.deepEqual(cvdSemanticResult(resumed), full.result); assert.equal(JSON.stringify(prefix.c), old);
});
test('C3 same timestamp and same content different ordinals both count; replay offset refused', () => {
  const { c, records } = run([record(), record()]);
  assert.equal(c.state.segments[0].value, 4);
  assert.throws(() => appendCvdRecords(c, records, { sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /ORDINAL/);
  assert.throws(() => appendCvdRecords(c, [], { sourceLedgerIdentity: 'other', ledgerOrdinalOffset: 2 }), /SOURCE/);
  const corrupt = structuredClone(c); corrupt.state.ordinal = 0;
  assert.throws(() => cvdSemanticResult(corrupt), /CHECKPOINT/);
  const altered = structuredClone(records); altered[0].payload.volume = 999;
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source), altered, { sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /HASH/);
});
test('C4 contract/date/session/epoch create segments; idle and long gaps do not', () => {
  for (const change of [{ actualContract: 'TXFJ6' }, { tradeDate: '2026-09-14' }, { session: 'NIGHT' }]) {
    assert.equal(run([record(), record('futures_tick', change)]).result.semantic.segments.length, 2);
  }
  const rows = [record(), record('quote_type_resubscribe', { product: 'TX' }), record(), record('futures_bidask'), record()];
  const r = run(rows, 1).result.semantic;
  assert.equal(r.segments.length, 2); assert.equal(r.series[1].joinedContinuityStatus, 'WARMING');
  assert.equal(r.series[2].joinedContinuityStatus, 'USABLE');
  const late = record('futures_tick', { eventTime: '2026-09-11T09:05:01+08:00' }, { receivedAt: '2026-09-11T09:05:01+08:00' });
  assert.equal(run([record(), late]).result.semantic.segments.length, 1);
  const c = run([record()]).c;
  assert.deepEqual(appendCvdRecords(c, [], { sourceLedgerIdentity: source, ledgerOrdinalOffset: 1 }), c);
});
test('C4 non-TX physical receivedAt contamination survives chunk and reset recovers', () => {
  const rows = [record(), record('stock_tick', {}, { receivedAt: '2026-09-11T09:00:00+08:00' }), record(),
    record('quote_type_resubscribe', { product: 'TX' }), record()];
  const full = run(rows); assert.deepEqual(run(rows, 1).result, full.result);
  assert.equal(full.result.semantic.series[1].value, null);
  assert.equal(full.result.semantic.series[2].value, 2);
  assert.equal(full.result.semantic.series[1].ledgerOrdinal, 3);
  assert.equal(run([record('futures_tick', { session: null })]).result.semantic.value, null);
});
test('C5 physically later quote cannot change prior points; late tick finds older lawful quote', () => {
  const quote = (time, ask) => record('futures_bidask', { eventTime: time, bid_price: [ask - 1], ask_price: [ask] });
  const rows = [quote('2026-09-11T09:00:00+08:00', 100), quote('2026-09-11T09:00:02+08:00', 200), record()];
  const r = run(rows, 1).result.semantic;
  assert.equal(r.segments[0].bestQuoteMatchedVolume, 2);
  const prefix = run([record()]).result.semantic.series;
  const future = run([record(), quote('2026-09-11T09:00:00+08:00', 100)]).result.semantic.series;
  assert.deepEqual(prefix, future); assert.equal(r.status, 'HISTORICAL_OFFLINE');
});
test('C8 research safety checked on every physical record; record/duration budgets', () => {
  const unsafe = chain([record('stock_tick', {}, { formalWeight: 1 })]);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source), unsafe, { sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /SAFETY/);
  const { records } = run([record()]);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source), records, { sourceLedgerIdentity: source, ledgerOrdinalOffset: 0, maxRecords: 0 }), /BUDGET/);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source), records, { sourceLedgerIdentity: source, ledgerOrdinalOffset: 0, deadline: 0 }), /BUDGET/);
});

test('C1 finite-positive overflow refuses output rather than serializing fake null', () => {
  assert.throws(() => run([record('futures_tick', { volume: 1e308 }), record('futures_tick', { volume: 1e308 })]), /NUMERIC_OVERFLOW/);
});
