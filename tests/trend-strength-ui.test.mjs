import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const source = name => {
  const begin = app.indexOf(`function ${name}(`), end = app.indexOf('\n}', begin) + 2;
  assert.ok(begin >= 0 && end > begin); return app.slice(begin, end);
};
const now = Date.parse('2026-11-04T03:10:01Z');
function chartFixture() {
  const chart = { actualContract: 'TXFK6', tradeDate: '2026-11-04', session: 'DAY', sessionId: '2026-11-04-DAY',
    mode: 'LIVE', timeframe: '5m', asOf: new Date(now).toISOString(), availableAt: new Date(now - 1000).toISOString(),
    lastEventTime: new Date(now - 1000).toISOString(), status: 'READY' };
  chart.trendStrength = { schemaVersion: 'trend-strength-adx14-v1', indicator: 'ADX', period: 14,
    identity: Object.fromEntries(['actualContract', 'tradeDate', 'session', 'sessionId'].map(k => [k, chart[k]])),
    mode: chart.mode, timeframe: chart.timeframe, asOf: chart.asOf, sourceAvailableAt: chart.availableAt,
    value: 37.25, plusDI: 20, minusDI: 40, deltaADX: -1.5, state: 'QUALITY_INSUFFICIENT',
    closedBarCount: 29, requiredClosedBars: 28, firstUsedBarAt: '2026-11-04T00:45:00.000Z', lastClosedBarAt: new Date(now - 1000).toISOString(),
    reasonCodes: ['CAPTURE_COMPLETENESS_UNVERIFIED'] };
  return chart;
}
function harness() {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {textContent: '', className: ''}); return nodes.get(id); };
  let time = now;
  class Clock extends Date { static now() { return time; } }
  const state = { txChartTimeframe: '5m', decisionWorkspace: {marketOperating: {marketShouldBeActive: true}} };
  const context = vm.createContext({ state, Date: Clock, $: node,
    dwText: (id, value) => { node(id).textContent = value; }, fmt: (value, decimals) => value.toFixed(decimals),
    signed: (value, suffix, decimals) => `${value > 0 ? '+' : ''}${value.toFixed(decimals)}${suffix}`,
    timeLabel: value => value });
  vm.runInContext(source('renderTrendStrength'), context);
  return { node, state, render: context.renderTrendStrength, setTime: value => { time = value; } };
}
function cleared(h) {
  for (const id of ['tt-trend-strength', 'tt-trend-direction', 'tt-trend-change']) assert.equal(h.node(id).textContent, '—', id);
  assert.doesNotMatch(h.node('tt-trend-main').textContent, /37\.25/);
  assert.match(h.node('tt-trend-trust').className, /is-unavailable/);
}

test('published ADX and DI are shown with timeframe, sample, timestamps and the actual quality limitation', () => {
  const h = harness(), chart = chartFixture(), original = JSON.stringify(chart); h.render(chart);
  assert.equal(h.node('tt-trend-main').textContent, 'ADX(14) 37.25');
  assert.equal(h.node('tt-trend-direction').textContent, '＋DI 20.00 / −DI 40.00');
  assert.equal(h.node('tt-trend-change').textContent, '-1.50 ADX');
  assert.match(h.node('tt-trend-sample').textContent, /5m.*29 根.*28 根/);
  assert.match(h.node('tt-trend-source').textContent, /TXFK6.*2026-11-04.*DAY.*03:10:00/);
  assert.match(h.node('tt-trend-source').textContent, /計算起點 2026-11-04T00:45:00\.000Z.*最後已收K線/);
  assert.match(h.node('tt-trend-reasons').textContent, /CAPTURE_COMPLETENESS_UNVERIFIED/);
  assert.equal(h.node('tt-trend-trust').textContent, '資料受限');
  assert.equal(JSON.stringify(chart), original);
});

test('clock expiry, request failure, selected timeframe and market closure clear a previously shown value, then recover', () => {
  for (const modify of [h => h.setTime(now + 120000), h => { h.state.homeChartError = 'CHART_REQUEST_TIMEOUT'; },
    h => { h.state.txChartTimeframe = '1m'; }, h => { h.state.decisionWorkspace.marketOperating.marketShouldBeActive = false; }]) {
    const h = harness(), chart = chartFixture(); h.render(chart); modify(h); h.render(chart); cleared(h);
    h.setTime(now); h.state.homeChartError = null; h.state.txChartTimeframe = '5m';
    h.state.decisionWorkspace.marketOperating.marketShouldBeActive = true;
    h.render(chart); assert.equal(h.node('tt-trend-strength').textContent, '37.25');
  }
});

test('all identity dimensions, source time, calculation cutoff and period must match the selected chart', () => {
  const mutations = ['actualContract','tradeDate','session','sessionId'].map(k => c => { c.trendStrength.identity[k] = 'OTHER'; });
  for (const k of ['timeframe','mode','asOf','sourceAvailableAt','indicator','schemaVersion']) mutations.push(c => { c.trendStrength[k] = 'OTHER'; });
  mutations.push(c => { c.trendStrength.period = 7; });
  for (const modify of mutations) {
    const h = harness(), chart = chartFixture(); h.render(chart); modify(chart); h.render(chart); cleared(h);
    assert.match(h.node('tt-trend-reasons').textContent, /TREND_IDENTITY_MISMATCH/);
  }
});

test('warmup, missing and unavailable values remain unknown and never reuse a previous value', () => {
  for (const state of ['WARMING_UP','UNAVAILABLE','UNEXPECTED']) {
    const h = harness(), chart = chartFixture(); h.render(chart); chart.trendStrength.state = state;
    chart.trendStrength.value = null; chart.trendStrength.closedBarCount = 12;
    chart.trendStrength.limitations = ['RESET_AFTER_CAPTURE_INTERRUPTION']; h.render(chart); cleared(h);
    assert.match(h.node('tt-trend-sample').textContent, /12 根/);
    assert.match(h.node('tt-trend-reasons').textContent, /RESET_AFTER_CAPTURE_INTERRUPTION/);
  }
  const h = harness(); h.render(chartFixture()); h.render({}); cleared(h);
});

test('a timeframe that cannot fit 28 bars in one session does not promise availability by waiting', () => {
  const h = harness(), chart = chartFixture();
  chart.timeframe = chart.trendStrength.timeframe = h.state.txChartTimeframe = '1h';
  chart.trendStrength.state = 'UNAVAILABLE'; chart.trendStrength.value = null;
  chart.trendStrength.closedBarCount = 3; chart.trendStrength.reasonCodes = ['SESSION_CAPACITY_BELOW_REQUIRED_BARS'];
  h.render(chart); cleared(h);
  assert.equal(h.node('tt-trend-main').textContent, '此週期單盤樣本不足');
  assert.match(h.node('tt-trend-sample').textContent, /無法累積足夠樣本.*1m／5m.*不跨盤拼接/);
});

test('null, numeric strings, infinity and out-of-range numbers cannot become an ADX zero', () => {
  for (const value of [null, undefined, '', '37.25', NaN, Infinity, -1, 101]) {
    const h = harness(), chart = chartFixture(); chart.trendStrength.value = value; h.render(chart); cleared(h);
  }
  const h = harness(), chart = chartFixture(); chart.trendStrength.value = 0; chart.trendStrength.deltaADX = 0;
  h.render(chart); assert.equal(h.node('tt-trend-strength').textContent, '0.00'); assert.equal(h.node('tt-trend-change').textContent, '0.00 ADX');
});

test('future or missing source time cannot look current; replay explicitly keeps its historical label', () => {
  for (const at of [null, '', 'invalid', new Date(now + 5001).toISOString()]) {
    const h = harness(), chart = chartFixture(); chart.availableAt = at; chart.trendStrength.sourceAvailableAt = at;
    h.render(chart); cleared(h);
  }
  const h = harness(), chart = chartFixture(); chart.mode = chart.trendStrength.mode = 'REPLAY';
  h.setTime(now + 86400000); h.render(chart);
  assert.equal(h.node('tt-trend-strength').textContent, '37.25');
  assert.match(h.node('tt-trend-trust').textContent, /^歷史回放/);
  assert.match(h.node('tt-summary-strength').textContent, /^歷史回放/);
});

test('freshness lifecycle owns trend expiry and the terminal shell cannot restore the old pending placeholder', () => {
  assert.match(source('renderTxChartFreshness'), /renderTrendStrength\(chart\)/);
  assert.doesNotMatch(source('renderTerminalShell'), /dwText\('tt-trend-(?:main|strength|direction|change)'/);
  assert.match(fs.readFileSync(new URL('../public/trader-terminal-shell.js', import.meta.url), 'utf8'), /ADX 衡量方向性移動的強度/);
});

test('a numeric payload cannot bypass the minimum closed sample or source-event cutoff', () => {
  for (const modify of [c => { c.trendStrength.closedBarCount = 27; }, c => { c.trendStrength.closedBarCount = null; },
    c => { c.trendStrength.lastClosedBarAt = null; }, c => { c.trendStrength.lastClosedBarAt = new Date(now + 1).toISOString(); },
    c => { c.lastEventTime = new Date(now - 2000).toISOString(); }, c => { c.asOf = c.trendStrength.asOf = 'invalid'; }]) {
    const h = harness(), chart = chartFixture(); modify(chart); h.render(chart); cleared(h);
    assert.match(h.node('tt-trend-reasons').textContent, /TREND_CLOSED_BARS_UNVERIFIED/);
  }
});
