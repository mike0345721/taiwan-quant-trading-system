import test from 'node:test';
import assert from 'node:assert/strict';
import { runLevelReactionStudy, prepareSession, extractLevels, findEvents, simulateTrade, holm, loadCostPolicy, STUDY_SPEC, STUDY_SPEC_HASH, stableJson } from '../src/level-reaction-study.mjs';
import { syntheticSessions } from '../research/level-reaction-v1/synthetic.mjs';
import crypto from 'node:crypto';

const policy = loadCostPolicy();

test('spec hash is frozen and matches spec content', () => {
  assert.equal(STUDY_SPEC_HASH, crypto.createHash('sha256').update(stableJson(STUDY_SPEC)).digest('hex'));
  assert.equal(STUDY_SPEC.executionAuthorized, false);
  assert.equal(STUDY_SPEC.orderRoutesEnabled, false);
});

test('triple barrier: stop first on same bar, target, time exit, gap stop at open', () => {
  const spec = { ...STUDY_SPEC, maxHoldBars: 3 };
  const bar = (o, h, l, c) => ({ open: o, high: h, low: l, close: c });
  // long, risk = 1.5 * 10 = 15, stop 85, target 130
  assert.equal(simulateTrade([bar(100, 131, 84, 100)], 0, 1, 10, spec, policy).reason, 'STOP');
  assert.equal(simulateTrade([bar(100, 131, 90, 100)], 0, 1, 10, spec, policy).reason, 'TARGET');
  const gap = simulateTrade([bar(100, 101, 99, 100), bar(70, 72, 60, 65)], 0, 1, 10, spec, policy);
  assert.equal(gap.reason, 'STOP_GAP'); assert.equal(gap.exit, 70);
  const time = simulateTrade([bar(100, 101, 99, 100), bar(100, 101, 99, 100), bar(100, 101, 99, 100), bar(104, 105, 103, 104)], 0, 1, 10, spec, policy);
  assert.equal(time.reason, 'TIME'); assert.equal(time.exit, 104);
  assert.ok(time.rNet.BASE_2_TICKS_PER_SIDE < time.rGross);
});

test('holm adjustment is monotone and bounded', () => {
  assert.deepEqual(holm([0.01, 0.04, 0.03]).map(x => +x.toFixed(4)), [0.03, 0.06, 0.06]);
});

test('null random walk produces no Holm-significant positive cell', () => {
  for (const seed of [1, 2, 3]) {
    const r = runLevelReactionStudy(syntheticSessions({ seed, days: 120 }), { seed });
    assert.ok(r.cells.every(c => !(c.pHolm !== null && c.pHolm < 0.05 && c.meanRNet > 0)), `seed ${seed}`);
  }
});

test('planted prior-day rejection edge is detected', () => {
  const r = runLevelReactionStudy(syntheticSessions({ seed: 101, days: 120, plantedEdge: 1.2 }), { seed: 101 });
  const c = r.cells.find(c => c.family === 'PD' && c.reaction === 'REJECT');
  assert.ok(c.meanRNet > 0.3 && c.pHolm < 0.05);
});

test('events do not change when future bars are removed or altered', () => {
  const s = syntheticSessions({ seed: 9, days: 12 }).map(prepareSession);
  let checked = 0;
  for (let k = 1; k < s.length; k++) {
    for (const ev of findEvents(s[k], extractLevels(s[k], s[k - 1])).events) {
      const rows = s[k].rows.slice(0, ev.entryIndex + 1).concat(s[k].rows.slice(ev.entryIndex + 1).map(r => ({ t: r.t, open: r.open + 500, high: r.open + 505, low: r.open - 300, close: r.open })));
      const t = prepareSession({ contract: s[k].contract, tradeDate: s[k].tradeDate, session: 'DAY', bars: rows.map(r => ({ timestamp: new Date(r.t).toISOString(), open: r.open, high: r.high, low: r.low, close: r.close })) });
      const same = findEvents(t, extractLevels(t, s[k - 1])).events.find(e => e.kind === ev.kind && e.price === ev.price && e.touchIndex === ev.touchIndex);
      assert.ok(same && same.reaction === ev.reaction && same.entryIndex === ev.entryIndex);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

test('V2: rolling ATR lets early-session events trade; ROUND levels bracket the open', async () => {
  const { STUDY_SPEC_V2 } = await import('../src/level-reaction-study.mjs');
  const raw = syntheticSessions({ seed: 5, days: 30 });
  const r1 = runLevelReactionStudy(raw, { seed: 5 });
  const r2 = runLevelReactionStudy(raw, { seed: 5, baseSpec: STUDY_SPEC_V2 });
  assert.ok(r2.skipped.NO_ATR < r1.skipped.NO_ATR);
  assert.equal(r2.cells.length, 12);
  const s = prepareSession(raw[3]);
  const round = extractLevels(s, prepareSession(raw[2]), STUDY_SPEC_V2).filter(l => l.family === 'ROUND');
  assert.ok(round.length >= 9 && round.every(l => l.price % 100 === 0 && Math.abs(l.price - s.rows[0].open) <= 500));
  assert.ok(round.every(l => (l.price > s.rows[0].open) === (l.approach === 1)));
  assert.equal(extractLevels(s, null).some(l => l.family === 'ROUND'), false);
});
