import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamCheckpoint, appendStreamRecord } from '../src/cru55-stream-core.mjs';
import { createProjectionJob, consumeProjectionPage, beginProjectionBatch, finishProjectionJob, projectionPrimitives } from '../src/cru55-stream-projection.mjs';
import { startIndexedProjection, advanceIndexedProjectionQueries } from '../src/cru55-indexed-projection.mjs';
import { beginRangeAppend, createRangeReader } from '../src/cru55-projection-range-index.mjs';
import { evaluateBestQuoteEligibility } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { digest, stableJson, SAFETY } from '../src/cvd-observation-core.mjs';
import { sessionFixture, calendar } from './cvd-session-context-fixture.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const source = 'sha256:' + digest('indexed-state-transition-fixture');
const resolverIdentity = 'governed-fixture';
const resolveSessionTradeDate = time => {
  const session = classifyTxChartSession(time, calendar);
  return { session: session.session, tradeDate: session.tradeDate };
};
function chain(rows) {
  let previous = 'GENESIS';
  return rows.map(({ recordHash, previousHash, ...data }) => {
    const body = { ...data, previousHash: previous };
    const row = { ...body, recordHash: digest(`${previous}\n${stableJson(body)}`) };
    previous = row.recordHash;
    return row;
  });
}

// Page boundaries are permanent across cutoffs. No filesystem, pipeline,
// process, timer, raw-prefix lease or benchmark is started by these fixtures.
function snapshots(rows, cutoffs) {
  rows = chain(rows);
  let checkpoint = createStreamCheckpoint(source, resolverIdentity), head = null, offset = 0;
  const pages = [], quotes = [], result = [];
  for (const cutoff of cutoffs) {
    while (offset < cutoff) {
      const records = rows.slice(offset, Math.min(offset + 4, cutoff));
      const previousTerminalHash = checkpoint.state.terminalHash, facts = [];
      for (const record of records) {
        const x = appendStreamRecord(checkpoint, record, {
          resolveSessionTradeDate,
          lookupQuote: (event, { afterOrdinal }) => quotes.findLast(quote => quote.ledgerOrdinal > afterOrdinal && evaluateBestQuoteEligibility(quote, event).eligible) ?? null,
        });
        checkpoint = x.checkpoint;
        if (x.event?.kind === 'futures_bidask') quotes.push(x.event);
        facts.push({ ordinal: checkpoint.state.ordinal, recordHash: record.recordHash,
          event: x.event, point: x.point, pressure: x.pressure, segmentStarted: x.segmentStarted,
          segment: x.point ? checkpoint.state.activeSegment : null });
      }
      const page = { schemaVersion: 'cru55-stream-page-v1', sourceLedgerIdentity: source, resolverIdentity,
        previousPageHash: head, previousQuotePageHash: null, previousTerminalHash,
        startOrdinal: offset + 1, endOrdinal: offset + records.length, quoteCount: 0,
        records, facts, checkpoint, ...SAFETY };
      pages.push(page); head = digest(stableJson(page)); offset += records.length;
    }
    result.push({ checkpoint, pages: [...pages] });
  }
  return result;
}

function compareCutoff(snapshot, previous = null, expectedReason = 'INITIAL_BUILD', extra = {}) {
  const options = { checkpoint: snapshot.checkpoint, sourceKind: 'SYNTHETIC_FIXTURE',
    generationHash: digest('cutoff:' + snapshot.checkpoint.state.terminalHash), calendar, ...extra };
  let oracle = createProjectionJob(options);
  for (const page of snapshot.pages) oracle = consumeProjectionPage(clone(oracle), clone(page));
  const started = startIndexedProjection(options, previous ? clone(previous.saved) : null);
  assert.equal(started.reason, expectedReason);
  assert.equal(started.resumed, expectedReason === null);
  const files = new Map(previous?.files ?? []);
  let projection = started.projection, index = started.index, recordsProcessed = 0;
  for (const page of snapshot.pages.filter(page => page.startOrdinal >= projection.nextOrdinal)) {
    const append = beginRangeAppend(index.roots, (hash, value) => files.set(hash, clone(value)));
    let futurePriceExcluded = index.futurePriceExcluded, maxPointAvailable = index.maxPointAvailable;
    const batch = beginProjectionBatch(clone(projection), {
      onPrice: price => { futurePriceExcluded ||= price.futureExcluded > 0; },
      onPoint: (event, point, prior, pressure) => {
        append.append(event, point, prior, pressure);
        maxPointAvailable = Math.max(maxPointAvailable ?? -Infinity, event.availableMs);
      },
    });
    batch.consume(clone(page));
    projection = batch.finish();
    index = clone({ roots: append.finish(), futurePriceExcluded, maxPointAvailable });
    recordsProcessed += page.records.length;
  }
  // Match the durable PROJECT -> QUERY boundary, including clearing stale bins.
  projection.display = {};
  projection = projectionPrimitives.seal(projection);
  const cursor = { cursor: null, historicalOrdinal: previous?.saved.projection.checkpoint.state.ordinal ?? 0 };
  projection = advanceIndexedProjectionQueries(clone(projection), clone(index), cursor, createRangeReader(hash => clone(files.get(hash))), {});
  assert.deepEqual(projection, oracle, 'entire sealed job/hash, not selected output fields');
  const prior = previous?.product ?? null;
  const product = finishProjectionJob(clone(projection), { prior, previousPublication: prior });
  assert.deepEqual(product, finishProjectionJob(clone(oracle), { prior, previousPublication: prior }), 'every chart/window/VWAP/context/handoff and publication endpoint');
  return { saved: clone({ schemaVersion: 'cru55-indexed-projection-v1', projection, index }), files, product, recordsProcessed };
}

test('successive normal cutoffs expire windows, re-bin displays and resume only appended records', () => {
  const points = snapshots(sessionFixture({ count: 22 }).rows, [9, 15, 22]);
  let previous = null, oldOrdinal = 0;
  for (const point of points) {
    previous = compareCutoff(point, previous, previous ? null : 'INITIAL_BUILD');
    assert.equal(previous.recordsProcessed, point.checkpoint.state.ordinal - oldOrdinal);
    oldOrdinal = point.checkpoint.state.ordinal;
  }
});

test('a late event inside an advancing suffix retains exact physical predecessor and price ordering', () => {
  const rows = sessionFixture({ count: 12 }).rows;
  rows[9] = { ...rows[9], payload: { ...rows[9].payload, eventTime: rows[2].payload.eventTime, datetime: rows[2].payload.datetime, close: 115, volume: 3 } };
  const [first, next] = snapshots(rows, [9, 12]);
  const result = compareCutoff(next, compareCutoff(first), null);
  assert.equal(result.recordsProcessed, 3);
  assert.equal(result.saved.projection.contextInvalid, true);
});

test('regressing final event or available clock rebuilds with exact refusal semantics', () => {
  for (const clock of ['event', 'available']) {
    const rows = sessionFixture({ count: 10 }).rows;
    rows[9] = clock === 'event'
      ? { ...rows[9], payload: { ...rows[9].payload, eventTime: rows[2].payload.eventTime, datetime: rows[2].payload.datetime } }
      : { ...rows[9], receivedAt: rows[2].receivedAt };
    const [first, next] = snapshots(rows, [9, 10]);
    const result = compareCutoff(next, compareCutoff(first), 'CUTOFF_CLOCK_REGRESSION');
    assert.equal(result.recordsProcessed, 10, clock + ' regression must rebuild the entire prefix');
  }
});

test('quote-only cutoff reuses historical trade state and advances the physical publication', () => {
  const rows = sessionFixture({ count: 10 }).rows;
  rows[9] = { ...rows[9], kind: 'futures_bidask', payload: { ...rows[9].payload, bid_price: [119], ask_price: [120] } };
  const [first, next] = snapshots(rows, [9, 10]), before = compareCutoff(first);
  const after = compareCutoff(next, before, null);
  assert.equal(after.recordsProcessed, 1);
  assert.equal(after.saved.projection.pointCount, before.saved.projection.pointCount);
  assert.equal(after.product.charts['1m'].cutoff.ledgerOrdinal, 10);
  assert.deepEqual(after.product.sessionContext.cutoff, before.product.sessionContext.cutoff);
});

test('continuity and contract changes rebuild instead of carrying a previous active segment', () => {
  for (const change of ['continuity', 'contract']) {
    const rows = sessionFixture({ count: 11 }).rows;
    if (change === 'continuity') rows[9] = { ...rows[9], kind: 'quote_type_resubscribe', payload: { product: 'TX' } };
    else for (const i of [9, 10]) rows[i] = { ...rows[i], code: 'TXFJ6', payload: { ...rows[i].payload, _target_code: 'TXFJ6', actualContract: 'TXFJ6' } };
    const [first, next] = snapshots(rows, [9, 11]);
    const result = compareCutoff(next, compareCutoff(first), 'ACTIVE_SEGMENT_CHANGED');
    assert.equal(result.recordsProcessed, 11, change);
    assert.equal(result.product.sessionContext.scope, 'UNAVAILABLE');
  }
});

test('historical future availability is re-evaluated when the next cutoff makes its price eligible', () => {
  const rows = sessionFixture({ count: 10 }).rows, origin = Date.parse(rows[0].receivedAt);
  rows[3] = { ...rows[3], receivedAt: new Date(origin + 200000).toISOString() };
  rows[9] = { ...rows[9], receivedAt: new Date(origin + 210000).toISOString() };
  const [first, next] = snapshots(rows, [9, 10]), before = compareCutoff(first);
  assert.equal(before.saved.index.futurePriceExcluded, true);
  const after = compareCutoff(next, before, 'HISTORICAL_AVAILABILITY_REEVALUATION');
  assert.equal(after.recordsProcessed, 10);
  const volume = result => result.product.charts['1m'].bars.reduce((sum, bar) => sum + bar.volume, 0);
  assert.equal(volume(after) - volume(before), 2, 'one new tick plus the previously future historical tick');
});

test('schema, source-kind and ordinal guards select a complete rebuild with exact output', () => {
  const [first, next] = snapshots(sessionFixture({ count: 12 }).rows, [9, 12]);
  const before = compareCutoff(first), after = compareCutoff(next, before, null);
  const wrongSchema = { ...before, saved: { ...before.saved, schemaVersion: 'unknown-index' } };
  compareCutoff(next, wrongSchema, 'INDEX_SCHEMA_CHANGED');
  compareCutoff(next, before, 'SOURCE_OR_RESOLVER_CHANGED', { sourceKind: 'GOVERNED_FRAGMENT' });
  compareCutoff(first, after, 'CUTOFF_REGRESSION');
});
