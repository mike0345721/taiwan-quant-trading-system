import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const epoch = Date.parse('2026-10-08T01:14:57Z');
function source(name) {
  const begin = app.indexOf(`function ${name}(`);
  const end = app.indexOf('\n}', begin) + 2;
  assert.ok(begin >= 0 && end > begin);
  return app.slice(begin, end);
}
function payload(change = {}) {
  return { mode: 'LIVE', timeframe: '5m', status: 'READY', qualityStatus: 'PASS', lastPrice: 49524,
    actualContract: 'TXFJ6', tradeDate: '2026-10-08', session: 'DAY', sessionId: '2026-10-08-DAY',
    availableAt: new Date(epoch).toISOString(), levels: {},
    bars: [{ time: epoch / 1000, open: 49510, high: 49524, low: 49505, close: 49524, volume: 7 }], ...change };
}
function ui() {
  let now = epoch;
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, classList: { toggle() {}, add() {} },
      setAttribute() {}, closest() { return null; }, querySelector() { return null; } });
    return nodes.get(id);
  };
  const write = (id, value, options = {}) => { node(id).textContent = value ?? `UNAVAILABLE · ${options.reason}`; };
  const writes = { candle: [], volume: [], vwap: [] };
  const series = Object.fromEntries(Object.keys(writes).map((key) => [key, {
    setData: (data) => { writes[key] = [...data]; }, update: (last) => { writes[key][writes[key].length - 1] = last; },
  }]));
  const state = { decisionWorkspace: {}, txChartTimeframe: '5m', txChartRequestId: 0, txChartLoading: false,
    txChartSeries: series, txChartBarCount: 0, txChartPayload: null };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ state, $: node, Date: Clock, Intl, URLSearchParams, AbortController, setTimeout, clearTimeout, document: { querySelector: () => null },
    terminalWrite: write, dwText: write, terminalUnavailable: (reason) => `UNAVAILABLE · ${reason}`,
    finiteNumber: (v) => v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null,
    fmt: (v, n = 0) => Number(v).toFixed(n), signed: (v, suffix = '', n = 0) => `${Number(v).toFixed(n)}${suffix}`,
    tone() {}, levelValue: () => null, terminalTxLiveContractMonth: () => null,
    terminalHealthItem: () => null, terminalEodHealthUsable: () => false, terminalHealthUsable: () => false,
    terminalSourceMode: () => 'EOD', terminalSourceContext: () => '', dw4FamilyEvidence: () => null,
    updateTerminalSummaryDisclosure() {}, renderTerminalEvidenceCard() {}, renderGlobalTiles() {},
    terminalBreadthCounts: () => null, terminalHealthSummary: () => ({ value: null }), renderLiveMarketPulse() {},
    renderDecisionLevelWatch() {}, renderObservedFlow() {}, flowChannel: { view: () => null }, renderTxChartLevels() {},
    renderMarketPulse() {}, ensureTxChart: () => ({ timeScale: () => ({ fitContent() {} }) }),
    chartSeriesData: (value) => ({ candles: value.bars || [], volumes: (value.bars || []).map((bar) => ({ time: bar.time, value: bar.volume })), vwap: [] }),
    marketChangeMarkerData: () => [], dwHumanize: (value) => value, api: async () => { throw Error('OFFLINE_TEST'); },
  });
  vm.runInContext(['timeLabel', 'healthTone', 'renderTrendStrength', 'renderTxChartFreshness', 'renderTerminalShell', 'renderTxDecisionChart']
    .map(source).join('\n') + '\nasync ' + source('loadTxDecisionChart'), context);
  return { state, node, context, writes, setNow: (value) => { now = value; } };
}
function assertStale(h) {
  assert.match(h.node('tt-top-trust').textContent, /^資料過期 · 品質 PASS$/);
  assert.match(h.node('tt-top-trust').className, /is-unavailable/);
  assert.match(h.node('dw-chart-mode').textContent, /資料過期 · 來源 .*09:14:57 · LIVE · 5m · READ ONLY$/);
}

test('the visible main-price badge expires at 120 seconds without hiding historical bars or changing quality', () => {
  const h = ui();
  const value = payload();
  const before = JSON.stringify(value);
  h.setNow(epoch + 120_000); h.context.renderTxDecisionChart(value);
  assert.equal(h.node('tt-top-trust').textContent, 'PASS');
  assert.equal(h.node('dw-chart-mode').textContent, 'LIVE · 5m · READ ONLY');
  h.setNow(epoch + 120_001); h.context.renderTxDecisionChart(value);
  assertStale(h);
  assert.equal(h.node('tt-top-price').textContent, '49524');
  assert.equal(h.node('dw-reference-price').textContent, '49524');
  assert.equal(h.node('dw-chart-status').textContent, 'READY');
  assert.equal(h.state.txChartBarCount, 1); assert.equal(h.state.txChartVolumeCount, 1);
  assert.deepEqual(h.writes.candle, value.bars);
  assert.equal(h.state.txChartPayload, value); assert.equal(JSON.stringify(value), before);
  h.context.renderTerminalShell({ globalStatus: { dataHealth: 'PASS' } }, value);
  assertStale(h);
});

test('a first load of a source stopped twenty minutes ago immediately warns beside its price', () => {
  const h = ui(); h.setNow(epoch + 20 * 60_000);
  h.context.renderTxDecisionChart(payload()); assertStale(h);
  assert.match(h.node('tt-top-updated').textContent, /^來源 .*09:14:57$/);
});

test('missing, invalid and excessively future source times cannot display a plain PASS badge', () => {
  for (const availableAt of [null, undefined, '', 'not-a-time', new Date(epoch + 5_001).toISOString()]) {
    const h = ui();
    assert.doesNotThrow(() => h.context.renderTxDecisionChart(payload({ availableAt })));
    assert.match(h.node('tt-top-trust').textContent, /^資料時間不可驗證 · 品質 PASS$/);
    assert.match(h.node('dw-chart-mode').textContent, /^資料時間不可驗證 · 來源/);
    assert.match(h.node('tt-top-trust').className, /is-unavailable/);
    assert.equal(h.node('dw-chart-status').textContent, 'READY');
    assert.equal(h.state.txChartBarCount, 1);
  }
  const h = ui(); h.context.renderTxDecisionChart(payload({ availableAt: new Date(epoch + 5_000).toISOString() }));
  assert.equal(h.node('tt-top-trust').textContent, 'PASS');
});

test('replay keeps its historical mode and a fresh source retains its actual quality', () => {
  const h = ui(); h.setNow(epoch + 20 * 60_000);
  h.context.renderTxDecisionChart(payload({ mode: 'REPLAY' }));
  assert.equal(h.node('dw-chart-mode').textContent, 'REPLAY · 5m · READ ONLY');
  assert.equal(h.node('tt-top-trust').textContent, 'PASS');
  h.setNow(epoch); h.context.renderTxDecisionChart(payload({ qualityStatus: 'QUALITY_INSUFFICIENT' }));
  assert.equal(h.node('tt-top-trust').textContent, 'QUALITY_INSUFFICIENT');
  assert.equal(h.node('dw-chart-mode').textContent, 'LIVE · 5m · READ ONLY');
});

test('a pending or failed refresh still ages the displayed price; a fresh response restores it', async () => {
  const h = ui(); h.context.renderTxDecisionChart(payload());
  h.state.txChartLoading = true; h.setNow(epoch + 120_001);
  let calls = 0; h.context.api = async () => { calls += 1; throw Error('TEST_REFRESH_FAILED'); };
  await h.context.loadTxDecisionChart(); assertStale(h); assert.equal(calls, 0);
  h.state.txChartLoading = false;
  await assert.rejects(h.context.loadTxDecisionChart(), /TEST_REFRESH_FAILED/);
  assertStale(h); assert.equal(calls, 1);
  assert.equal(h.node('tt-top-price').textContent, '49524');
  h.context.api = async () => ({ data: payload({ availableAt: new Date(epoch + 120_001).toISOString(), lastPrice: 49530 }) });
  await h.context.loadTxDecisionChart();
  assert.equal(h.node('tt-top-trust').textContent, 'PASS');
  assert.equal(h.node('dw-chart-mode').textContent, 'LIVE · 5m · READ ONLY');
  assert.equal(h.node('tt-top-price').textContent, '49530');
});

test('an unavailable dashboard shell cannot suppress chart freshness warnings', () => {
  const h = ui(); h.node('decision-workspace').dataset.dashboardLoadState = 'UNAVAILABLE';
  h.setNow(epoch + 120_001); h.context.renderTxDecisionChart(payload()); assertStale(h);
});
