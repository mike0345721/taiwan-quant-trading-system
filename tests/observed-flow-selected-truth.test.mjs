import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the shipped render path with a small text/visual sink. No browser,
// provider, recorded market data, or model request is needed for these fixtures.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const names = ['fmt', 'finiteNumber', 'signed', 'timeLabel', 'dwHumanize',
  'observedFlowMetric', 'observedFlowCoverage', 'observedFlowRatio',
  'observedFlowStateLabel', 'observedFlowPressureSide', 'observedFlowRelation',
  'observedFlowSelectedSummary', 'renderObservedFlowSelected'];
const source = names.map(name => {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = app.indexOf('\n}', start);
  assert.ok(end > start, name);
  return app.slice(start, end + 2);
}).join('\n');

function fixture(sourceState = 'LIVE') {
  return { sourceState, source: { availableAt: '2026-10-09T00:06:30+08:00' },
    windows: { primary60s: { status: 'READY', truthState: null,
      pressure: { status: 'READY', pressureRatio: 0.636, classifiedCoverage: 1, direction: 'BUY_SIDE' },
      response: { displacementPoints: 1, directionRelation: 'SAME_DIRECTION' },
      pathEfficiency: { value: 0.111 } } } };
}

function render(value, available = true) {
  const before = JSON.stringify(value);
  const text = {};
  const visual = {};
  const sandbox = {
    DW_REASON_LABELS: {}, observedFlowSelectedWindow: '1m',
    $: id => ({ id, classList: { toggle() {} } }),
    dwText: (id, value) => { text[id] = value; },
    observedFlowWindowByKey: value => ({ definition: { key: '1m', label: '1分', data: 'GOVERNED' }, window: value.windows.primary60s }),
    renderObservedFlowSegments: (el, value, options) => { visual[el.id] = { value, ...options }; },
    renderObservedFlowEnergy() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  sandbox.renderObservedFlowSelected(value, available, 'SOURCE_UNAVAILABLE');
  assert.equal(JSON.stringify(value), before, 'render must preserve raw values and source timestamps');
  return { text, visual };
}

for (const state of ['LIVE', 'STALE', 'HISTORICAL']) {
  test(`complete-coverage ${state} snapshot has the correct restriction and relation`, () => {
    const { text, visual } = render(fixture(state));
    assert.equal(text['dw-flow-selected-coverage'], '100.0%');
    assert.equal(text['dw-flow-selected-ratio'], '+0.636');
    assert.equal(text['dw-flow-selected-response'], '+1 點');
    assert.equal(text['dw-flow-selected-path'], '0.111');
    assert.equal(text['dw-flow-selected-reason-code'], state === 'LIVE' ? 'READY' : state);
    assert.doesNotMatch(text['dw-flow-selected-reason'], /分類覆蓋/);
    assert.equal(visual['dw-flow-selected-bar'].inactive, state !== 'LIVE');
    const relation = state === 'LIVE' ? '同方向反應' : '快照：同方向反應（非目前盤勢）';
    assert.equal(text['dw-flow-selected-relation'], relation);
    assert.ok(text['dw-flow-selected-summary'].includes(relation));
  });
}

test('live incomplete coverage retains its real reason and unavailable relation', () => {
  const value = fixture();
  Object.assign(value.windows.primary60s.pressure, { status: 'QUALITY_INSUFFICIENT', classifiedCoverage: 0.971 });
  value.windows.primary60s.response.directionRelation = 'PRESSURE_UNAVAILABLE';
  const { text } = render(value);
  assert.equal(text['dw-flow-selected-coverage'], '97.1%');
  assert.equal(text['dw-flow-selected-reason-code'], 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  assert.equal(text['dw-flow-selected-relation'], '成交力道不可判定');
});

test('complete coverage with unavailable pressure preserves the provider reason', () => {
  const value = fixture();
  Object.assign(value.windows.primary60s.pressure, { status: 'QUALITY_INSUFFICIENT', unavailableReason: 'PROVIDER_QUALITY_LIMIT' });
  const { text } = render(value);
  assert.equal(text['dw-flow-selected-reason-code'], 'PROVIDER_QUALITY_LIMIT');
  assert.doesNotMatch(text['dw-flow-selected-reason'], /分類覆蓋/);
});

test('explicit unavailable window reason outranks generic missing pressure', () => {
  const value = fixture('STALE');
  value.windows.primary60s = { status: 'UNAVAILABLE', unavailableReason: 'WARMING_UP_WINDOW_INCOMPLETE' };
  const { text } = render(value);
  assert.equal(text['dw-flow-selected-reason-code'], 'WARMING_UP_WINDOW_INCOMPLETE');
  assert.match(text['dw-flow-selected-summary'], /WARMING_UP_WINDOW_INCOMPLETE/);
  assert.equal(text['dw-flow-selected-ratio'], '不可判定');
  assert.equal(text['dw-flow-selected-relation'], '成交力道不可判定');
});

test('missing response keeps its actual reason ahead of freshness restriction', () => {
  const value = fixture('STALE');
  value.windows.primary60s.response = { displacementPoints: null, unavailableReason: 'RESPONSE_MISSING' };
  const { text } = render(value);
  assert.equal(text['dw-flow-selected-reason-code'], 'RESPONSE_MISSING');
  assert.equal(text['dw-flow-selected-response'], '不可用');
});
