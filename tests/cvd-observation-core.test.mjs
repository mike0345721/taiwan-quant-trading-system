// Selectively reused CRU50 pure-core regressions; new schema and suffix budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations, buildExecutedPressureWindow } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, SAFETY } from '../src/cvd-observation-core.mjs';

const source = 'sha256:' + 'a'.repeat(64);
const resolverIdentity = 'engineering-explicit-v1';
function record(kind = 'futures_tick', payload = {}, more = {}) {
  return { kind, code: 'TXFI6', receivedAt: '2026-09-11T09:00:01+08:00', ...SAFETY,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-11', session: 'DAY',
      eventTime: '2026-09-11T09:00:01+08:00', close: 100, volume: 2, tick_type: 1, ...payload }, ...more };
}
function chain(rows) { let prev = 'GENESIS'; return rows.map(r => { const v = buildLiveEventRecord(r, prev); prev = v.recordHash; return v; }); }
function run(rows, chunk = rows.length || 1) {
  const records = chain(rows); let c = createCvdCheckpoint(source, resolverIdentity);
  for (let i = 0; i < records.length; i += chunk) c = appendCvdRecords(c, records.slice(i, i + chunk), { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: i });
  return { c, result: cvdSemanticResult(c), records };
}

test('C1 exact Pressure classification parity, conservation and UNKNOWN', () => {
  const { result, records } = run([record('futures_bidask', { bid_price: [99], ask_price: [100] }),
    record(), record('futures_tick', { tick_type: 2, volume: 3 }), record('futures_tick', { tick_type: 0, volume: 4 }),
    record('futures_tick', { simtrade: true, volume: 999 }), record('futures_tick', {}, { duplicate: true })]);
  const events = materializeTxCanonicalObservations(records, { resolverIdentity, sourceLedgerIdentity: source }).events;
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
  const resumed = appendCvdRecords(JSON.parse(old), [full.records[2]], { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 2 });
  assert.deepEqual(cvdSemanticResult(resumed), full.result); assert.equal(JSON.stringify(prefix.c), old);
});
test('C3 same timestamp and same content different ordinals both count; replay offset refused', () => {
  const { c, records } = run([record(), record()]);
  assert.equal(c.state.segments[0].value, 4);
  assert.throws(() => appendCvdRecords(c, records, { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /ORDINAL/);
  assert.throws(() => appendCvdRecords(c, [], { resolverIdentity, sourceLedgerIdentity: 'other', ledgerOrdinalOffset: 2 }), /SOURCE/);
  const corrupt = structuredClone(c); corrupt.state.ordinal = 0;
  assert.throws(() => cvdSemanticResult(corrupt), /CHECKPOINT/);
  const altered = structuredClone(records); altered[0].payload.volume = 999;
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), altered, { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /HASH/);
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
  assert.deepEqual(appendCvdRecords(c, [], { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 1 }), c);
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
  assert.deepEqual(prefix, future); assert.equal(r.status, 'OBSERVATION_CANDIDATE');
});
test('C8 research safety checked on every physical record; record/duration budgets', () => {
  const unsafe = chain([record('stock_tick', {}, { formalWeight: 1 })]);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), unsafe, { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 }), /SAFETY/);
  const { records } = run([record()]);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), records, { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0, maxRecords: 0 }), /BUDGET/);
  assert.throws(() => appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), records, { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0, deadline: 0 }), /BUDGET/);
});

test('C1 finite-positive overflow refuses output rather than serializing fake null', () => {
  assert.throws(() => run([record('futures_tick', { volume: 1e308 }), record('futures_tick', { volume: 1e308 })]), /NUMERIC_OVERFLOW/);
});

test('quote-only identity boundary and a terminal reconnect do not expose prior segment as current', () => {
  const changed = run([record(), record('futures_bidask', { actualContract: 'TXFJ6' })]);
  assert.equal(changed.result.semantic.value, null);
  assert.equal(changed.result.semantic.series[0].value, 2);
  const returned = run([record(), record('futures_bidask', { actualContract: 'TXFJ6' }), record()]);
  assert.equal(returned.result.semantic.segments.length, 2);
  assert.equal(returned.result.semantic.value, 2);
  assert.equal(run([record(), record('quote_type_resubscribe', { product: 'TX' })]).result.semantic.value, null);
});
test('terminal non-TX lineage regression invalidates current snapshot without rewriting old history', () => {
  const r = run([record(), record('stock_tick', {}, { receivedAt: '2026-09-11T08:59:59+08:00' })]);
  assert.equal(r.result.semantic.value, null); assert.equal(r.result.semantic.series[0].value, 2);
  assert.equal(r.result.semantic.availableAt, null);
  assert.equal(r.result.semantic.cutoffReceivedAt, '2026-09-11T08:59:59+08:00');
});
test('snapshot availability follows the physical input that invalidated it; trade freshness stays separate', () => {
  const r = run([record(), record('quote_type_resubscribe', { product: 'TX' }, { receivedAt: '2026-09-11T09:00:05+08:00' })]);
  assert.equal(r.result.semantic.value, null);
  assert.equal(r.result.semantic.availableAt, '2026-09-11T09:00:05+08:00');
  assert.equal(r.result.semantic.lastTradeAvailableAt, '2026-09-11T09:00:01+08:00');
  assert.equal(r.result.semantic.series[0].availableAt, '2026-09-11T09:00:01+08:00');
});
test('snapshot physical availability includes reconnect timestamps until a new canonical epoch', () => {
  const rows = [record(), record('quote_type_resubscribe', { product: 'TX' }, { receivedAt: '2026-09-11T09:00:05+08:00' }),
    record('stock_tick', {}, { receivedAt: '2026-09-11T09:00:04+08:00' })];
  const invalid = run(rows).result.semantic;
  assert.equal(invalid.availableAt, null); assert.equal(invalid.value, null);
  assert.equal(invalid.cutoffReceivedAt, '2026-09-11T09:00:04+08:00');
  rows.push(record('futures_tick', {}, { receivedAt: '2026-09-11T09:00:06+08:00' }));
  const recovered = run(rows); assert.deepEqual(run(rows, 1).c, recovered.c);
  assert.equal(recovered.result.semantic.availableAt, '2026-09-11T09:00:06+08:00');
  assert.equal(recovered.result.semantic.value, 2);
});
test('session origin and same-cutoff CVD are independent of all six presentation timeframes', () => {
  const rows = [record(), record('futures_tick', { tick_type: 2, volume: 1 }),
    record('futures_tick', { session: 'NIGHT', volume: 4 }), record('futures_tick', { session: 'NIGHT', tick_type: 2 })];
  const r = run(rows), checkpointBytes = JSON.stringify(r.c);
  for (const timeframe of ['1m', '5m', '15m', '30m', '1h', '4h']) {
    const unchanged = appendCvdRecords(r.c, [], { resolverIdentity, sourceLedgerIdentity: source,
      ledgerOrdinalOffset: r.c.state.ordinal, timeframe });
    assert.deepEqual(unchanged, r.c);
  }
  assert.equal(JSON.stringify(r.c), checkpointBytes);
  assert.deepEqual(r.result.semantic.segments.map(s => s.value), [1, 2]);
  assert.ok(r.result.semantic.segments.every(s => s.captureCompleteness === 'UNPROVEN' && !s.sessionStartProven));
});
test('explicit illegal/contradictory governed session fails closed without editing canonical semantics', () => {
  const records = chain([record()]);
  const r = appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), records, {
    resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0,
    resolveSessionTradeDate: () => ({ session: 'NIGHT', tradeDate: '2026-09-11' }),
  });
  assert.equal(cvdSemanticResult(r).semantic.value, null);
  assert.equal(cvdSemanticResult(r).semantic.segments[0].reason, 'GOVERNED_SESSION_BOUNDARY_INVALID');
  assert.equal(run([record('futures_tick', { session: 'CLOSED' })]).result.semantic.value, null);
});
test('new bounded suffix processing exceeds the old 10000-record lifecycle cap', () => {
  const records = chain(Array.from({ length: 10001 }, () => record('stock_tick')));
  const first = appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), records.slice(0, 9000),
    { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 0 });
  const end = appendCvdRecords(first, records.slice(9000), { resolverIdentity, sourceLedgerIdentity: source, ledgerOrdinalOffset: 9000 });
  assert.equal(end.state.ordinal, 10001); assert.equal(cvdSemanticResult(end).semantic.value, null);
});
