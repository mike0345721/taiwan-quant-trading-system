import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, SAFETY, digest, stableJson } from '../src/cvd-observation-core.mjs';
import { evaluateBestQuoteEligibility } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { createStreamCheckpoint, appendStreamRecord, streamCurrent, validateStreamCheckpoint,
  STREAM_VERSION, STREAM_LIMITS } from '../src/cru55-stream-core.mjs';

const source = 'sha256:' + 'a'.repeat(64), resolverIdentity = 'stream-oracle-v1';
function record(kind = 'futures_tick', payload = {}, more = {}) {
  return { kind, code: 'TXFI6', receivedAt: '2026-09-11T09:00:01+08:00', ...SAFETY,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-11', session: 'DAY',
      eventTime: '2026-09-11T09:00:01+08:00', close: 100, volume: 2, tick_type: 1, ...payload }, ...more };
}
function chain(rows) {
  let previous = 'GENESIS';
  // Deliberately permit hash-valid invalid clocks/safety payloads so the kernel,
  // not the production ledger constructor, is the boundary under test.
  return rows.map(row => {
    const body = { ...row, previousHash: previous };
    const next = { ...body, recordHash: digest(`${previous}\n${stableJson(body)}`) };
    previous = next.recordHash; return next;
  });
}
// Test stand-in for the caller's durable, physical-order quote index.
function indexLookup(quotes) {
  return (event, { afterOrdinal }) => quotes.findLast(q => q.ledgerOrdinal > afterOrdinal
    && evaluateBestQuoteEligibility(q, event).eligible) ?? null;
}
function parity(rows, options = {}) {
  const quotes = [], points = [], segments = [];
  let frozen = createCvdCheckpoint(source, resolverIdentity), streamed = createStreamCheckpoint(source, resolverIdentity);
  for (const row of chain(rows)) {
    const oldBytes = JSON.stringify(streamed);
    frozen = appendCvdRecords(frozen, [row], { sourceLedgerIdentity: source, resolverIdentity,
      ledgerOrdinalOffset: frozen.state.ordinal, ...options });
    const result = appendStreamRecord(streamed, row, { ...options, lookupQuote: indexLookup(quotes) });
    assert.equal(JSON.stringify(streamed), oldBytes, 'prior checkpoint immutable');
    streamed = JSON.parse(JSON.stringify(result.checkpoint)); // real serialization boundary after every record
    if (result.event?.kind === 'futures_bidask') quotes.push(result.event);
    if (result.point) {
      points.push(result.point); segments[result.point.segment] = streamed.state.activeSegment;
      assert.ok(Object.isFrozen(result.point));
    }
    const actual = streamCurrent(streamed), expected = cvdSemanticResult(frozen).semantic;
    for (const key of ['sourceLedgerIdentity', 'resolverIdentity', 'cutoffLedgerOrdinal', 'cutoffRecordHash',
      'value', 'availableAt', 'lastTradeAvailableAt', 'cutoffReceivedAt', 'currentReason', 'activeIdentity']) {
      assert.deepEqual(actual[key], expected[key], key + ' at ordinal ' + actual.cutoffLedgerOrdinal);
    }
    assert.deepEqual(points, expected.series);
    assert.deepEqual(segments, expected.segments);
    assert.equal(streamed.state.segmentCount, expected.segments.length);
    assert.equal(streamed.state.schemaVersion, STREAM_VERSION);
    assert.ok(!('series' in streamed.state) && !('quotes' in streamed.state) && !('semanticHash' in actual));
  }
  return { streamed, points, segments };
}

test('stream matches frozen oracle at every cutoff: UNKNOWN, conflict, invalid, duplicate, continuity and restart', () => {
  const r = parity([
    record('futures_bidask', { bid_price: [99], ask_price: [100] }),
    record('futures_tick', { tick_type: 0, volume: 3 }), record(),
    record('futures_tick', { tick_type: 2, volume: 4 }),
    record('futures_tick', {}, { duplicate: true }), record('futures_tick', { simtrade: true }),
    record('futures_tick', { volume: '' }), record(),
    record('quote_type_resubscribe', { product: 'TX' }), record(),
    record('futures_bidask', { bid_price: [99], ask_price: [100] }), record(),
    record('stock_tick', {}, { receivedAt: '2026-09-11T09:00:00+08:00' }), record(),
    record('quote_type_resubscribe', { product: 'TX' }), record(),
    record('futures_bidask', { actualContract: 'TXFJ6' }), record(),
    record('futures_tick', { session: 'NIGHT', tradeDate: '2026-09-14' }),
    record('quote_type_resubscribe', { product: 'TX' }),
  ]);
  assert.equal(streamCurrent(r.streamed).value, null);
  assert.ok(r.points.some(p => p.value === null));
});

test('late cutoff looks up earlier lawful quote, never newest/future quote or a pre-fence A→B→A quote', () => {
  const quote = (eventTime, ask, extra = {}) => record('futures_bidask', { eventTime, bid_price: [ask - 1], ask_price: [ask], ...extra });
  const r = parity([
    quote('2026-09-11T09:00:00+08:00', 100),
    quote('2026-09-11T09:00:02+08:00', 200), record(),
    quote('2026-09-11T09:00:00+08:00', 100, { actualContract: 'TXFJ6' }), record(),
  ]);
  assert.equal(r.segments[0].bestQuoteMatchedVolume, 2);
  assert.equal(r.segments[1].bestQuoteMatchedVolume, 0);
});

test('contradictory governed identity, invalid clocks and terminal physical contamination retain frozen refusal', () => {
  parity([record(), record('stock_tick', {}, { receivedAt: null }), record()]);
  parity([record('futures_tick', { eventTime: null }), record()]);
  parity([record(), record('quote_type_resubscribe', { product: 'TX' }, { receivedAt: '2026-09-11T09:00:05+08:00' }),
    record('stock_tick', {}, { receivedAt: '2026-09-11T09:00:04+08:00' }),
    record('futures_tick', {}, { receivedAt: '2026-09-11T09:00:06+08:00' })]);
  parity([record(), record()], { resolveSessionTradeDate: () => ({ session: 'NIGHT', tradeDate: '2026-09-11' }) });
});

test('more than 1024 points retain cumulative origin; immutable points reconstruct frozen semantics', () => {
  const records = chain(Array.from({ length: 1100 }, (_, i) => record('futures_tick', { tick_type: i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2, volume: i % 7 + 1 })));
  let streamed = createStreamCheckpoint(source, resolverIdentity);
  const pages = [];
  for (let start = 0; start < records.length; start += 100) {
    const points = [];
    for (const row of records.slice(start, start + 100)) {
      const next = appendStreamRecord(streamed, row); streamed = next.checkpoint; points.push(next.point);
    }
    pages.push(Object.freeze(points)); streamed = JSON.parse(JSON.stringify(streamed));
  }
  const frozen = appendCvdRecords(createCvdCheckpoint(source, resolverIdentity), records,
    { sourceLedgerIdentity: source, resolverIdentity, ledgerOrdinalOffset: 0 });
  assert.deepEqual(pages.flat(), frozen.state.series);
  assert.deepEqual(streamed.state.activeSegment, frozen.state.segments[0]);
  assert.equal(streamed.state.activeSegment.startOrdinal, 1);
  assert.equal(streamed.state.ordinal, 1100);
  assert.equal(streamCurrent(streamed).value, cvdSemanticResult(frozen).semantic.value);
});

test('actual >250000 physical ordinals and >25000 quotes cross restart without resets or resident history', { timeout: 120000 }, () => {
  let checkpoint = createStreamCheckpoint(source, resolverIdentity), latestQuote = null;
  const quote = record('futures_bidask', { bid_price: [99], ask_price: [100] }), tick = record(), ignored = record('stock_tick');
  let firstPoint = null, maxSize = 0;
  for (let i = 1; i <= 250002; i++) {
    const row = buildLiveEventRecord(i <= 25001 ? quote : i === 25002 || i > 250000 ? tick : ignored, checkpoint.state.terminalHash);
    const result = appendStreamRecord(checkpoint, row, { lookupQuote: () => latestQuote });
    checkpoint = result.checkpoint;
    if (result.event?.kind === 'futures_bidask') latestQuote = result.event;
    if (result.point && !firstPoint) firstPoint = result.point;
    if (i % 10000 === 0 || i === 250001) {
      maxSize = Math.max(maxSize, Buffer.byteLength(JSON.stringify(checkpoint)));
      checkpoint = JSON.parse(JSON.stringify(checkpoint));
    }
  }
  assert.equal(checkpoint.state.ordinal, 250002);
  assert.equal(checkpoint.state.segmentCount, 1);
  assert.equal(checkpoint.state.activeSegment.startOrdinal, 25002);
  assert.equal(checkpoint.state.activeSegment.bestQuoteMatchedVolume, 6);
  assert.equal(streamCurrent(checkpoint).value, 6);
  assert.equal(firstPoint.value, 2);
  assert.ok(maxSize < 5000 && maxSize < STREAM_LIMITS.checkpointBytes);
});

test('source chain, unsafe records, lookup failures, corrupt state and numeric overflow fail closed', () => {
  const rows = chain([record('futures_bidask', { bid_price: [99], ask_price: [100] }), record()]);
  const first = appendStreamRecord(createStreamCheckpoint(source, resolverIdentity), rows[0]);
  const old = JSON.stringify(first.checkpoint);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[1]), /LOOKUP_REQUIRED/);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[1], { lookupQuote: () => undefined }), /LOOKUP_INVALID/);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[1], { lookupQuote: () => Promise.resolve(null) }), /LOOKUP_INVALID/);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[1], { lookupQuote: () => ({ ...first.event, ledgerOrdinal: 2 }) }), /LOOKUP_INVALID/);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[1], { lookupQuote: () => { throw Error('INDEX_NOT_READY'); } }), /INDEX_NOT_READY/);
  assert.equal(JSON.stringify(first.checkpoint), old);
  assert.throws(() => appendStreamRecord(first.checkpoint, rows[0]), /HASH/);
  const bad = structuredClone(first.checkpoint); bad.state.ordinal = 0;
  assert.throws(() => validateStreamCheckpoint(bad), /CHECKPOINT/);
  assert.throws(() => appendStreamRecord(createStreamCheckpoint(source, resolverIdentity), chain([record('stock_tick', {}, { executionAuthorized: true })])[0]), /SAFETY/);
  const large = chain([record('futures_tick', { volume: 1e308 }), record('futures_tick', { volume: 1e308 })]);
  const start = appendStreamRecord(createStreamCheckpoint(source, resolverIdentity), large[0]);
  assert.throws(() => appendStreamRecord(start.checkpoint, large[1]), /NUMERIC_OVERFLOW/);
});
