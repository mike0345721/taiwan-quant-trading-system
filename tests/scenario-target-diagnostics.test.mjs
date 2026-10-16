import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';
import { explainScenarioTarget } from '../src/scenario-target-diagnostics.mjs';

// All numbers/times below are synthetic fixtures, not market observations.
const at = '2026-10-12T10:30:00.000Z';
const unavailable = () => ({ availability: 'UNAVAILABLE' });
const level = (value, qualityStatus = 'PASS') => ({ availability: 'AVAILABLE', value,
  source: 'SYNTHETIC_TEST_REFERENCE', availableAt: at, qualityStatus });
function makeChart(overrides = {}) {
  const keys = ['vwap','openingRangeHigh','openingRangeLow','currentDayHigh','currentDayLow',
    'nightHigh','nightLow','previousDayHigh','previousDayLow','previousClose'];
  const levels = Object.fromEntries(keys.map(key => [key, unavailable()]));
  levels.vwap = level(100);
  return { timeframe: '5m', tradeDate: '2026-10-12', actualContract: 'TEST_FUTURE', session: 'DAY',
    availableAt: at, lastPrice: 102, qualityStatus: 'PASS', levels, openingRange: { status: 'FORMING' },
    bars: Array.from({ length: 6 }, (_, index) => ({ time: new Date(Date.parse(at) - (6-index)*300000).toISOString(),
      availableAt: new Date(Date.parse(at) - (5-index)*300000 - 1000).toISOString(),
      open: 94+index, high: 100+index, low: 90+index, close: 95+index, volume: 100, qualityStatus: 'PASS' })),
    ...overrides };
}
const build = chart => buildDecisionLevelWatch({ chart, snapshotTime: at });
const codes = result => result.scenarioWatch.long.targetDiagnostics.reasonCodes;

test('both absent targets retain the real observation node and explain what can still be observed', () => {
  const value = build(makeChart());
  assert.equal(value.state, 'READY');
  assert.equal(value.nextWatch.price, 100);
  assert.equal(value.nextWatch.id, 'VWAP');
  for (const side of [value.scenarioWatch.long, value.scenarioWatch.short]) {
    assert.equal(side.target, null);
    assert.equal(side.rr.state, 'UNAVAILABLE');
    assert.equal(side.rr.ratio, null);
    assert.deepEqual(side.targetDiagnostics.reasonCodes, ['NO_OTHER_VALIDATED_LEVEL']);
  }
  assert.match(value.nextWatch.why, /多方：.*空方：/);
  assert.match(value.nextWatch.watchFor, /目前僅能觀察.*風報比.*VWAP/);
  assert.match(value.nextWatch.basisReasons[0], /沒有觀察節點以外/);
});

test('quality-rejected references are distinguished from no reference beyond the boundary', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(130, 'QUALITY_INSUFFICIENT');
  const value = build(c);
  assert.deepEqual(codes(value), ['DIRECTIONAL_LEVEL_QUALITY_INSUFFICIENT']);
  assert.equal(value.scenarioWatch.long.targetDiagnostics.counts.rejectedQuality, 1);
  assert.equal(value.scenarioWatch.long.target, null);
  assert.match(value.nextWatch.why, /品質檢查/);
});

test('chart quality failure blocks focus before publishing price thresholds', () => {
  const value = build(makeChart({ qualityStatus: 'QUALITY_INSUFFICIENT' }));
  assert.equal(value.state,'READY');
  assert.equal(value.decisionFocus.state,'NO_ACTIVE_REFERENCE');
  assert.equal(value.nextWatch,null);assert.equal(value.scenarioWatch,null);
  assert.equal(value.evidenceGate.priceRelationAllowed,false);
  assert.ok(value.evidenceGate.reasonCodes.includes('PRICE_SOURCE_QUALITY_NOT_VERIFIED'));
  assert.equal(value.executionAuthorized,false);
});

test('a context-only reference is not promoted to a legal target to fill an empty card', () => {
  const c = makeChart(); c.levels.previousClose = level(130);
  const value = build(c);
  assert.deepEqual(codes(value), ['DIRECTIONAL_LEVEL_CONTEXT_ONLY']);
  assert.equal(value.scenarioWatch.long.target, null);
  assert.match(value.nextWatch.why, /低優先級背景結構/);
});

test('an existing price inside the confirmation boundary is explained rather than extended', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(105);
  const value = build(c);
  assert.equal(value.scenarioWatch.long.confirmationThreshold, 106);
  assert.deepEqual(codes(value), ['NO_LEVEL_BEYOND_CONFIRMATION']);
  assert.equal(value.scenarioWatch.long.target, null);
  assert.equal(value.scenarioWatch.long.rr.ratio, null);
});

test('lawful long and short targets and structural R:R remain unchanged', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(130); c.levels.currentDayLow = level(70);
  const value = build(c);
  assert.equal(value.scenarioWatch.long.target.price, 130);
  assert.equal(value.scenarioWatch.short.target.price, 70);
  assert.equal(value.scenarioWatch.long.rr.ratio, 2);
  assert.equal(value.scenarioWatch.short.rr.ratio, 2);
  assert.equal(value.observationGuidance, null);
  assert.equal(value.scenarioWatch.long.targetDiagnostics.state, 'TARGET_PRESENT');
  assert.deepEqual(codes(value), []);
});

test('one-sided absence does not claim both directions lack targets', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(130);
  const value = build(c);
  assert.ok(value.scenarioWatch.long.target);
  assert.equal(value.scenarioWatch.short.target, null);
  assert.match(value.nextWatch.why, /目前有一側缺少/);
  assert.doesNotMatch(value.nextWatch.why, /多空兩側都缺少/);
  assert.equal(value.scenarioWatch.long.rr.ratio, 2);
});

test('target discovery is not reduced to the visible one-to-three lines', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(130); c.levels.currentDayLow = level(70);
  const value = buildDecisionLevelWatch({ chart: c, snapshotTime: at, maxVisible: 1 });
  assert.equal(value.levels.length, 1);
  assert.equal(value.scenarioWatch.long.target.price, 130);
  assert.equal(value.scenarioWatch.short.target.price, 70);
});

test('stale, missing-price and missing completed-bar input keep original fail-closed results', () => {
  for (const [c, reason] of [
    [makeChart({ availableAt: '2026-10-12T10:20:00.000Z' }), 'CHART_SOURCE_STALE'],
    [makeChart({ lastPrice: null }), 'CURRENT_PRICE_UNAVAILABLE'],
    [makeChart({ bars: [] }), 'OBSERVATION_ZONE_UNAVAILABLE'],
  ]) {
    const value = build(c);
    assert.equal(value.state, 'UNAVAILABLE');
    assert.equal(value.reason, reason);
    assert.equal(value.nextWatch, null);
    assert.equal(value.scenarioWatch, null);
  }
});

test('future and identity-mismatched references never become target candidates', () => {
  const c = makeChart();
  c.levels.currentDayHigh = { ...level(130), availableAt: '2026-10-12T11:00:00.000Z' };
  c.levels.currentDayLow = { ...level(70), actualContract: 'OTHER_FUTURE' };
  const value = build(c);
  assert.equal(value.scenarioWatch.long.target, null);
  assert.equal(value.scenarioWatch.short.target, null);
  assert.deepEqual(codes(value), ['NO_OTHER_VALIDATED_LEVEL']);
});

test('diagnostics distinguish mixed quality and context exclusions without counting one level twice', () => {
  const node = { id: 'n', qualityStatus: 'PASS' };
  const diagnostic = explainScenarioTarget({ side: 'LONG', node, chartQuality: 'PASS', threshold: 106, target: null,
    levels: [{ id: 'bad', price: 130, qualityStatus: 'UNKNOWN', importanceBand: 'CONTEXT' },
      { id: 'background', price: 140, qualityStatus: 'PASS', importanceBand: 'CONTEXT' }] });
  assert.deepEqual(diagnostic.reasonCodes, ['DIRECTIONAL_LEVEL_QUALITY_INSUFFICIENT', 'DIRECTIONAL_LEVEL_CONTEXT_ONLY']);
  assert.deepEqual(diagnostic.counts, { otherLevels: 2, beyondConfirmation: 2, rejectedQuality: 1, rejectedContextOnly: 1, eligible: 0 });
});

test('an eligible but unselected target is flagged for engineering investigation', () => {
  const diagnostic = explainScenarioTarget({ side: 'SHORT', node: { id: 'n', qualityStatus: 'PASS' },
    chartQuality: 'PASS', threshold: 94, target: null,
    levels: [{ id: 'low', price: 70, qualityStatus: 'PASS', importanceBand: 'SECONDARY' }] });
  assert.equal(diagnostic.state, 'SELECTION_REQUIRES_REVIEW');
  assert.deepEqual(diagnostic.reasonCodes, ['ELIGIBLE_TARGET_NOT_SELECTED']);
  assert.match(diagnostic.waitFor, /核對選取流程/);
});

test('diagnostics never mutate input, and missing threshold is not coerced to zero', () => {
  const levels = Object.freeze([Object.freeze({ id: 'high', price: 130, qualityStatus: 'PASS', importanceBand: 'PRIMARY' })]);
  const d = explainScenarioTarget({ side: 'LONG', node: { id: 'n', qualityStatus: 'PASS' },
    chartQuality: 'PASS', threshold: null, target: null, levels });
  assert.equal(d.state, 'EVIDENCE_INCOMPLETE');
  assert.equal(d.counts.beyondConfirmation, null);
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.counts) && Object.isFrozen(d.reasonCodes));
  assert.equal(d.changesSelection, false);
  assert.equal(d.recommendation, false);
});

test('invalid diagnostic side is rejected instead of guessing long or short', () => {
  assert.throws(() => explainScenarioTarget({ side: 'BUY' }), /SCENARIO_DIAGNOSTIC_SIDE_REQUIRED/);
});

test('the existing Next Watch renderer exposes the explanation without inventing targets', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderDecisionLevelWatch(');
  const end = source.indexOf('\nasync function loadDecisionLevelWatch(', start);
  assert.ok(start >= 0 && end > start, 'Exact existing renderer boundaries must be present');
  const rendered = {};
  const context = vm.createContext({ state: { decisionWorkspace: null, txChartPayload: null },
    $: () => ({ dataset: {} }),
    dwText: (id, value) => { rendered[id] = value; },
    levelWatchIsFresh: () => true, levelWatchMatchesChart: () => true,
    finiteNumber: value => typeof value === 'number' ? value : null,
    fmt: (value, digits) => value.toFixed(digits),
    scenarioDirectionLabel: () => '雙向觀察／方向未定',
    renderNextWatchBasis: values => { rendered.basis = values.slice(0, 7); },
    renderScenarioWatch: value => { rendered.scenario = value; } });
  vm.runInContext(source.slice(start, end), context);
  context.payload = build(makeChart());
  vm.runInContext('renderDecisionLevelWatch(payload)', context);
  assert.match(rendered['dw-next-watch-why'], /多方：.*空方：/);
  assert.match(rendered['dw-next-watch-response'], /目前僅能觀察.*VWAP/);
  assert.match(rendered.basis.join(' '), /沒有觀察節點以外/);
  assert.equal(rendered.scenario.long.target, null);
  assert.equal(rendered.scenario.short.target, null);
});

test('present target does not change lack of Flow confirmation or closed trading flags', () => {
  const c = makeChart(); c.levels.currentDayHigh = level(130);
  const value = build(c);
  assert.equal(value.scenarioWatch.long.flowConfirmationState, 'UNAVAILABLE');
  assert.equal(value.researchOnly, true);
  assert.equal(value.formalWeight, 0);
  assert.equal(value.systemDirectionalSignal, false);
  assert.equal(value.recommendation, false);
  assert.equal(value.executionAuthorized, false);
  assert.equal(value.orderRoutesEnabled, false);
});
