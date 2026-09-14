import test from 'node:test';
import assert from 'node:assert/strict';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, SAFETY, digest, stableJson } from '../src/cvd-observation-core.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildCvdChartProjection, FRAMES } from '../src/cvd-chart-projection.mjs';
import { buildCvdRelationshipProjection, classifyRelationship, compareEqualWindow, collapseRelationshipTimeline, mapRelationshipMarkers } from '../src/cvd-relationship-projection.mjs';

function fixture(specs = Array.from({ length: 19 }, (_, i) => ({ t: i * 10 }))) {
  const sourceLedgerIdentity = 'sha256:' + 'a'.repeat(64), resolverIdentity = 'fixture'; let hash = 'GENESIS';
  const stamp = t => new Date(Date.UTC(2026, 8, 14, 1) + t * 1000).toISOString();
  const rows = specs.map((s, i) => {
    const r = buildLiveEventRecord({ kind: s.kind || 'futures_tick', code: s.contract || 'TXFI6', receivedAt: stamp(s.received ?? s.t ?? i * 10), ...SAFETY,
      payload: { product: 'TX', productFamily: 'TX', actualContract: s.contract || 'TXFI6', tradeDate: s.date || '2026-09-14', session: s.session || 'DAY', eventTime: stamp(s.t ?? i * 10), close: s.price ?? 100 + i, volume: s.volume ?? 2, tick_type: s.side ?? 1 } }, hash);
    hash = r.recordHash; return r;
  });
  const checkpoint = appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity, resolverIdentity), rows, { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  const g = { generationHash: 'b'.repeat(64), result: cvdSemanticResult(checkpoint), prefixSha256: 'c'.repeat(64) };
  const canonical = materializeTxCanonicalObservations(rows, { sourceLedgerIdentity }).events;
  const price = { generationHash: g.generationHash, cutoffRecordHash: g.result.semantic.cutoffRecordHash, bars: [], reason: 'NO_LAWFUL_PRICE_BARS', timeLineageViolationCount: 0 };
  const build = (frame = '1m') => buildCvdRelationshipProjection(g, canonical, buildCvdChartProjection(g, price, frame), frame);
  return { g, canonical, price, build };
}
test('same cutoff/window/as-of identity and exact accepted CVD vs CRU34/44 net-flow parity in six windows', () => {
  const f = fixture();
  for (const frame of FRAMES) {
    const p = f.build(frame), c = p.current;
    assert.deepEqual(c.current.lineage, c.previous.lineage); assert.equal(c.lineage.cutoffRecordHash, f.canonical.at(-1).recordHash);
    assert.equal(c.lineage.availableAt, f.canonical.at(-1).availableAt); assert.equal(c.current.deltaCvd, c.current.pressure.netAggressiveFlowProxy);
    assert.equal(c.current.parity, 'EXACT'); assert.equal(c.cumulativeCvd, f.g.result.semantic.value);
    assert.equal(p.method.pressureIndependentVote, false); assert.equal(p.method.formalDirectionPromoted, false);
  }
});
test('delayed earlier-event changes only its later physical as-of snapshot, never history', () => {
  const specs = Array.from({ length: 14 }, (_, i) => ({ t: i * 10 }));
  const before = fixture(specs).build();
  const after = fixture([...specs, { t: 115, received: 145, side: 2, volume: 20 }]).build();
  assert.deepEqual(after.observations.slice(0, -1), before.observations);
  assert.equal(after.current.anchorEventMs, Date.parse('2026-09-14T01:01:55Z'));
  assert.equal(after.current.lineage.availableAt, '2026-09-14T01:02:25.000Z');
  assert.equal(after.current.current.deltaCvd, -8); // six eligible earlier BUY increments minus delayed SELL20
  assert.equal(after.current.current.parity, 'EXACT');
  assert.equal(after.timeline.at(-1).time, Date.parse('2026-09-14T01:02:25Z') / 1000);
  assert.equal(after.current.current.pathEfficiency.value, 1); // events120/130 are outside anchor115, so this selected path does not regress
  const next = fixture([...specs, { t: 115, received: 145, side: 2, volume: 20 }, { t: 150, received: 150 }]).build();
  assert.equal(next.current.current.pathEfficiency.value, null); // now the physical120/130->115 regression is inside the window
  assert.equal(next.current.relationship.code, 'MIXED_OR_QUALITY_LIMITED');
});
test('43 seconds is an observed fragment, never a complete 15m delta or prior comparison', () => {
  const p = fixture([{ t: 0 }, { t: 20 }, { t: 43 }]).build('15m');
  assert.equal(p.current.current.observedSpanMs, 43000); assert.equal(p.current.current.requiredSpanMs, 900000);
  assert.equal(p.current.current.complete, false); assert.equal(p.current.current.deltaCvd, 6);
  assert.equal(p.current.relationship.code, 'MIXED_OR_QUALITY_LIMITED'); assert.equal(p.current.comparisons.deltaCvd, '前窗不可比較');
  assert.equal(p.current.current.captureCompleteness, 'UNPROVEN');
});
test('lawful prior equal windows share actual current cutoff and compare exact magnitudes', () => {
  const p = fixture(Array.from({ length: 19 }, (_, i) => ({ t: i * 10, volume: i > 12 ? 1 : 4 }))).build();
  assert.equal(p.current.current.complete, true); assert.equal(p.current.previous.complete, true);
  assert.equal(p.current.current.deltaCvd, 6); assert.equal(p.current.previous.deltaCvd, 24);
  assert.equal(p.current.relationship.code, 'ALIGNED_BUT_WEAKENING'); assert.equal(p.current.comparisons.deltaCvd, '較前窗縮小');
  assert.equal(p.current.previous.upperInclusiveMs, p.current.anchorEventMs - 60000);
  assert.equal(p.current.previous.lineage.availableAt, p.current.lineage.availableAt);
});
for (const [name, change] of [['session', { session: 'NIGHT' }], ['contract', { contract: 'TXFJ6' }], ['tradeDate', { date: '2026-09-15' }]]) {
  test('cross-' + name + ' refusal: new segment has its own delta/origin and no prior comparison', () => {
    const p = fixture([{ t: 0 }, { t: 60 }, { t: 120, ...change }]).build();
    assert.equal(p.current.segment, 1); assert.equal(p.current.current.deltaCvd, 2);
    assert.equal(p.current.current.complete, false); assert.equal(p.current.comparisons.deltaCvd, '前窗不可比較');
    assert.equal(p.timeline.length, 0);
  });
}
test('continuity break and A-B-A within one epoch never pool old A data', () => {
  for (const middle of [{ t: 61, kind: 'quote_type_resubscribe' }, { t: 61, contract: 'TXFJ6' }]) {
    const p = fixture([{ t: 0 }, { t: 60 }, middle, { t: 120 }]).build();
    assert.equal(p.current.current.deltaCvd, 2); assert.equal(p.current.current.complete, false);
  }
});
test('UNKNOWN remains independent; all unknown is not zero/neutral; invalid accepted null cannot be repaired from counters', () => {
  let p = fixture([{ t: 0, side: 0 }, { t: 30, side: 0 }, { t: 60, side: 0 }]).build();
  assert.equal(p.current.current.deltaCvd, null); assert.equal(p.current.current.unknownVolume, 4);
  assert.equal(p.current.relationship.code, 'MIXED_OR_QUALITY_LIMITED');
  p = fixture([{ t: 0 }, { t: 30, side: 0 }, { t: 60 }]).build();
  assert.equal(p.current.current.deltaCvd, 2); assert.equal(p.current.current.unknownVolume, 2);
  assert.equal(p.current.current.pressure.direction, 'UNAVAILABLE'); assert.equal(p.current.relationship.code, 'MIXED_OR_QUALITY_LIMITED');
  const f = fixture([{ t: 0 }, { t: 30, volume: 0 }, { t: 60 }]); p = f.build();
  assert.equal(p.current.relationship.code, 'UNAVAILABLE'); assert.equal(p.current.current, null);
});
test('unaligned source/hash/cutoff identity is rejected instead of a relationship', () => {
  const f = fixture(); const canonical = structuredClone(f.canonical); canonical[1].recordHash = 'wrong';
  assert.throws(() => buildCvdRelationshipProjection(f.g, canonical, buildCvdChartProjection(f.g, f.price)), /CUTOFF_IDENTITY/);
  canonical[1].sourceLedgerIdentity = 'other';
  assert.throws(() => buildCvdRelationshipProjection(f.g, canonical, buildCvdChartProjection(f.g, f.price)), /CANONICAL_PREFIX/);
});
test('ALIGNED / MISMATCH / OPPOSITE / QUALITY_LIMITED / UNAVAILABLE fixtures use frozen evidence', () => {
  assert.equal(fixture().build().current.relationship.code, 'ALIGNED');
  assert.equal(fixture(Array.from({ length: 19 }, (_, i) => ({ t: i * 10, price: 200 - i }))).build().current.relationship.code, 'OPPOSITE_DIVERGENCE');
  // Nonzero path but equal first/last price gives clean flat-response mismatch.
  const flat = Array.from({ length: 19 }, (_, i) => ({ t: i * 10, price: i === 18 ? 113 : 100 + i }));
  assert.equal(fixture(flat).build().current.relationship.code, 'PRESSURE_RESPONSE_MISMATCH');
  assert.equal(classifyRelationship(null, null).code, 'UNAVAILABLE');
  assert.equal(fixture([{ t: 0 }, { t: 60 }, { t: 120 }]).build().current.relationship.code, 'MIXED_OR_QUALITY_LIMITED');
});
test('timeline identical-state collapse and segment reset; only actual state transitions at availableAt', () => {
  const o = (segment, code, n) => ({ segment, identity: ['TXFI6','2026-09-14','DAY','TX:1'], relationship: { code }, lineage: { availableAtMs: n * 1000, availableAt: String(n), cutoffLedgerOrdinal: n, availabilityLineageStatus:'USABLE' }, anchorEventTime: 'earlier' });
  const events = collapseRelationshipTimeline([o(0,'ALIGNED',1),o(0,'ALIGNED',2),o(0,'PRESSURE_RESPONSE_MISMATCH',3),o(1,'OPPOSITE_DIVERGENCE',4),o(1,'ALIGNED',5)]);
  assert.equal(events.length, 2); assert.equal(events[0].time, 3); assert.equal(events[1].segment, 1);
  const invalid = o(0,'UNAVAILABLE',3); invalid.lineage.availableAtMs=null; invalid.lineage.availabilityLineageStatus='INVALID_RECEIVED_AT';
  assert.deepEqual(collapseRelationshipTimeline([o(0,'ALIGNED',1),invalid,o(0,'OPPOSITE_DIVERGENCE',4)]),[]);
  invalid.lineage.availableAtMs=100; invalid.lineage.availabilityLineageStatus='INVALID_NON_MONOTONIC_RECEIVED_AT';
  assert.deepEqual(collapseRelationshipTimeline([o(0,'ALIGNED',1),invalid]),[]);
});
test('markers never backpaint, cross segment, use initial state, or fabricate bar location', () => {
  const id = ['TXFI6','2026-09-14','DAY','TX:1'];
  const segments = [{ startAvailableAt: '2026-09-14T01:00:00Z', availableAt: '2026-09-14T01:05:00Z' }];
  const t = Date.parse('2026-09-14T01:01:30Z') / 1000;
  const event = { segment: 0, identity: id, time: t, from: 'ALIGNED', to: 'OPPOSITE_DIVERGENCE' };
  const bars = [-30,30,90].map(n => ({ time: t+n, actualContract: id[0], tradeDate: id[1], session: id[2] }));
  assert.equal(mapRelationshipMarkers([event], bars, segments, 60000)[0].time, t+30);
  assert.equal(mapRelationshipMarkers([event], bars.slice(0,1), segments, 60000).length,0);
  assert.equal(mapRelationshipMarkers([event], bars.map(b=>({...b,session:'NIGHT'})), segments,60000).length,0);
  assert.equal(mapRelationshipMarkers([{...event,from:'MIXED_OR_QUALITY_LIMITED'}],bars,segments,60000).length,0);
});
test('equal-window wording is deterministic without relative-strength scores', () => {
  assert.equal(compareEqualWindow(2,-1),'方向翻轉'); assert.equal(compareEqualWindow(2,1),'較前窗放大');
  assert.equal(compareEqualWindow(1,2),'較前窗縮小'); assert.equal(compareEqualWindow(2,2),'持平'); assert.equal(compareEqualWindow(2,null),'前窗不可比較');
});
test('terminal non-tick boundary invalidates current comparisons without rewriting historical observations', () => {
  const specs = Array.from({length:19},(_,i)=>({t:i*10,volume:i>12?1:4}));
  const before=fixture(specs).build(), after=fixture([...specs,{t:190,kind:'quote_type_resubscribe'}]).build();
  assert.equal(before.current.comparisons.deltaCvd,'較前窗縮小');
  assert.equal(after.current.relationship.code,'UNAVAILABLE'); assert.equal(after.current.cumulativeCvd,null);
  assert.equal(after.current.comparisons.deltaCvd,'前窗不可比較'); assert.equal(after.current.current,null);
  assert.deepEqual(after.observations,before.observations);
});
test('bounded history fails closed instead of losing unseen state transitions', () => {
  const f = fixture(); f.g.result.semantic.series = Array(1025).fill(f.g.result.semantic.series[0]);
  f.g.result.semanticHash = digest(stableJson(f.g.result.semantic));
  assert.throws(() => buildCvdRelationshipProjection(f.g, f.canonical, { generationHash: f.g.generationHash, semanticHash: f.g.result.semanticHash, timeframe:'1m' }), /PREPARATION_BUDGET/);
});
