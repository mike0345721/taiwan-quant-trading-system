import test from 'node:test';
import assert from 'node:assert/strict';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, digest, stableJson, SAFETY } from '../src/cvd-observation-core.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { buildCvdChartProjection, withFreshness, FRAMES, CHART_LIMITS } from '../src/cvd-chart-projection.mjs';

function fixture({ count = 8, unknown = false, trailingBreak = false } = {}) {
  const sourceLedgerIdentity = `sha256:${'a'.repeat(64)}`, resolverIdentity = 'test', rows = [];
  let previousHash = 'GENESIS';
  for (let i = 0; i < count; i++) {
    const stamp = new Date(Date.UTC(2026, 8, 14, 1, 0, i)).toISOString();
    const r = buildLiveEventRecord({ kind: 'futures_tick', code: 'TXFI6', receivedAt: stamp, payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-14', session: 'DAY', eventTime: stamp, close: 100 + i, volume: 1, tick_type: unknown ? 0 : i % 2 ? 2 : 1 }, ...SAFETY }, previousHash);
    rows.push(r); previousHash = r.recordHash;
  }
  if (trailingBreak) rows.push(buildLiveEventRecord({ kind: 'quote_type_resubscribe', code: 'TXFI6', receivedAt: '2026-09-14T03:00:00Z', payload: { product: 'TX' }, ...SAFETY }, previousHash));
  const checkpoint = appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity, resolverIdentity), rows, { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  const g = { generationHash: 'b'.repeat(64), prefixSha256: 'c'.repeat(64), result: cvdSemanticResult(checkpoint) };
  const price = { generationHash: g.generationHash, cutoffRecordHash: g.result.semantic.cutoffRecordHash, bars: [], timeLineageViolationCount: 0, reason: 'NO_LAWFUL_PRICE_BARS' };
  return { g, price };
}
test('six timeframes preserve accepted semantic endpoint, UNKNOWN, observed origin and cutoff; no checkpoint exposed', () => {
  const { g, price } = fixture();
  for (const frame of FRAMES) {
    const p = buildCvdChartProjection(g, price, frame);
    assert.equal(p.currentCvd, g.result.semantic.value); assert.equal(p.currentCvd, p.segments.at(-1).points.at(-1).value);
    assert.equal(p.sessionStartProven, false); assert.equal(p.scope, 'OBSERVED_FRAGMENT'); assert.equal(p.captureCompleteness, 'UNPROVEN');
    assert.equal(p.origin.ledgerOrdinal, g.result.semantic.segments[0].startOrdinal);
    assert.equal(p.cutoff.recordHash, g.result.semantic.cutoffRecordHash);
    assert.ok(!('checkpoint' in p)); assert.ok(!JSON.stringify(p).includes('sourceBinding'));
  }
});
test('all unknown/empty/boundary remain null and explain unavailability', () => {
  for (const options of [{ unknown: true }, { count: 0 }, { trailingBreak: true }]) {
    const { g, price } = fixture(options), p = buildCvdChartProjection(g, price);
    assert.equal(p.currentCvd, null); assert.ok(p.reason);
    if (options.unknown) assert.equal(p.summary.unknownVolume, 8);
    if (options.trailingBreak) { assert.equal(p.display.boundaryAtCutoff, true); assert.equal(p.segments.at(-1).terminalInvalid, true); }
  }
});
test('bounded selection retains physical first/last/extrema; gaps do not disappear', () => {
  const { g, price } = fixture({ count: 6000 });
  const p = buildCvdChartProjection(g, price);
  assert.ok(p.display.outputPoints <= CHART_LIMITS.points);
  assert.equal(p.segments[0].points[0].ledgerOrdinal, g.result.semantic.series[0].ledgerOrdinal);
  assert.equal(p.segments[0].points.at(-1).ledgerOrdinal, g.result.semantic.series.at(-1).ledgerOrdinal);
  assert.equal(p.segments[0].points.at(-1).value, g.result.semantic.value);
});
test('corrupt semantic/price binding/unsupported frame refused; poisoned plot time never sorted', () => {
  const { g, price } = fixture();
  assert.throws(() => buildCvdChartProjection(g, { ...price, generationHash: 'other' }), /IDENTITY_MISMATCH/);
  assert.throws(() => buildCvdChartProjection(g, price, '1d'), /TIMEFRAME_INVALID/);
  const bad = structuredClone(g); bad.result.semantic.series[1].availableAt = '2020-01-01T00:00:00Z';
  assert.throws(() => buildCvdChartProjection(bad, price), /SEMANTIC_INVALID/);
  bad.result.semanticHash = digest(stableJson(bad.result.semantic));
  const p = buildCvdChartProjection(bad, price); assert.equal(p.segments[0].clockInvalid, true); assert.deepEqual(p.segments[0].points, []);
});
test('freshness never promotes a pinned sample to LIVE and uses trade time, not request time', () => {
  const { g, price } = fixture(), p = buildCvdChartProjection(g, price);
  assert.equal(withFreshness(p, Date.parse(p.lastTradeAvailableAt) + 1000).freshness.state, 'HISTORICAL');
  assert.equal(withFreshness(p, Date.parse(p.lastTradeAvailableAt) + 61000).freshness.state, 'STALE');
  assert.equal(withFreshness({ ...p, lastTradeAvailableAt: null }).freshness.state, 'UNAVAILABLE');
  assert.equal(withFreshness(p, Date.parse(p.lastTradeAvailableAt) - 1).freshness.state, 'UNAVAILABLE');
});

test('timezone-less origin uses canonical Taipei epoch, independent of browser timezone', () => {
  const { g, price } = fixture(); g.result.semantic.segments[0].observedStart = '2026-09-07T08:45:00.061000';
  g.result.semanticHash = digest(stableJson(g.result.semantic));
  const p = buildCvdChartProjection(g, price);
  assert.equal(p.origin.eventTimeMs, Date.parse('2026-09-07T00:45:00.061Z'));
});

test('different session/contract segments stay separate with independent origins and gaps', () => {
  const { g, price } = fixture();
  const semantic = g.result.semantic, original = structuredClone(semantic.segments[0]);
  original.identity = ['TXFJ6', '2026-09-15', 'NIGHT', 'TX:2']; original.startOrdinal = 5;
  semantic.segments.push(original); semantic.activeIdentity = original.identity;
  for (const point of semantic.series.slice(4)) point.segment = 1;
  semantic.series[5].value = null;
  g.result.semanticHash = digest(stableJson(semantic));
  const p = buildCvdChartProjection(g, price);
  assert.equal(p.segments.length, 2); assert.equal(p.segmentIndex, 1); assert.equal(p.origin.ledgerOrdinal, 5);
  assert.equal(p.segments[0].session, 'DAY'); assert.equal(p.segments[1].session, 'NIGHT');
  assert.ok(p.segments[1].points.some(point => point.value === null));
  assert.equal(p.currentCvd, semantic.value);
  semantic.segments = Array.from({ length: 17 }, () => original); g.result.semanticHash = digest(stableJson(semantic));
  assert.throws(() => buildCvdChartProjection(g, price), /SEGMENT_BUDGET/);
});
