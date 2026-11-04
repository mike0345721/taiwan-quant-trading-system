import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const home = fs.readFileSync(new URL('../public/home-workspace.js', import.meta.url), 'utf8');
function source(name) {
  const start = app.indexOf(`function ${name}(`), end = app.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start); return app.slice(start, end);
}
const current = { timeframe: '4h', mode: 'LIVE', status: 'READY', qualityStatus: 'PASS', availableAt: '2026-11-04T01:06:00Z',
  actualContract: 'TEST', tradeDate: '2026-11-04', session: 'DAY', lastPrice: 100, bars: [{ close: 100 }] };
function harness() {
  const nodes = new Map(), timers = new Map(), calls = [], renders = [];
  let timerId = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, attrs: {}, classList: { toggle() {}, add() {} },
      setAttribute(key, value) { this.attrs[key] = value; } });
    return nodes.get(id);
  };
  const state = { txChartPayload: current, txChartBarCount: 1, txChartTimeframe: '4h', txChartRequestId: 0, txChartLoading: false };
  const context = vm.createContext({ state, AbortController, URLSearchParams, Date, globalThis: null,
    $: node, terminalWrite: (id, value) => { node(id).textContent = value; }, dwText: (id, value) => { node(id).textContent = value; },
    timeLabel: value => value, terminalUnavailable: value => value, healthTone: () => 'is-ready',
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    api: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
    renderTxDecisionChart: value => { state.txChartPayload = value; renders.push(value); },
  });
  // The production loader and freshness renderer run unchanged; only transport and DOM are isolated.
  context.globalThis = context;
  vm.runInContext(source('renderTrendStrength') + '\n' + source('renderTxChartFreshness') + '\nasync ' + source('loadTxDecisionChart'), context);
  return { state, node, timers, calls, renders, context };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function guestHarness() {
  const h = harness(); let expired = 0; const requests = [], shown = [];
  Object.assign(h.state, { guestReadOnly: true, guestExpiresAt: new Date(Date.now() + 60000).toISOString(), guestExpiryMono: 60000, csrfToken: '' });
  h.context.performance = { now: () => 0 };
  h.context.expireGuestView = () => { expired++; };
  h.context.show = id => shown.push(id);
  h.context.fetch = (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
    options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  vm.runInContext('async ' + source('api'), h.context);
  return { ...h, requests, shown, expired: () => expired };
}

test('a stalled period request has a finite deadline, aborts transport, and keeps the labelled prior chart', async () => {
  const h = harness(); h.state.txChartTimeframe = '1D';
  const pending = h.context.loadTxDecisionChart({ fit: true });
  const result = pending.catch(error => error);
  assert.equal(h.calls[0].options?.signal?.aborted, false);
  assert.equal(h.timers.size, 1);
  const deadline = [...h.timers.values()][0]; assert.ok(deadline.ms > 0 && deadline.ms <= 10000);
  assert.match(h.node('dw-chart-mode').textContent, /1D.*載入|載入.*1D/);
  assert.match(h.node('dw-chart-mode').textContent, /4h/);
  deadline.fn(); await flush();
  const error = await result;
  assert.equal(error.message, 'CHART_REQUEST_TIMEOUT');
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(h.state.txChartLoading, false);
  assert.equal(h.state.txChartPayload, current);
  assert.match(h.node('dw-chart-status').textContent, /逾時|尚未更新/);
  assert.match(h.node('dw-chart-mode').textContent, /4h/);
  assert.equal(h.timers.size, 0);
  h.calls[0].resolve({ data: { ...current, timeframe: '1D' } }); await flush();
  assert.equal(h.renders.length, 0, 'late success after timeout cannot render');
});

test('switching periods aborts only the obsolete request; late results cannot replace the chosen period', async () => {
  const h = harness(); h.state.txChartTimeframe = '1D';
  const first = h.context.loadTxDecisionChart({ fit: true });
  h.state.txChartTimeframe = '5m'; await h.context.loadTxDecisionChart({ fit: true }); await flush();
  assert.equal(h.calls[0].options?.signal?.aborted, true);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ data: { ...current, timeframe: '5m' } }); await first;
  assert.equal(h.state.txChartPayload.timeframe, '5m');
  h.calls[0].resolve({ data: { ...current, timeframe: '1D' } }); await flush();
  assert.equal(h.state.txChartPayload.timeframe, '5m');
  assert.equal(h.state.homeChartError, null);
  assert.equal(h.state.txChartLoading, false);
  assert.equal(h.timers.size, 0);
});

test('same-period polling remains single-flight, and a response for the wrong period is rejected', async () => {
  const h = harness();
  const first = h.context.loadTxDecisionChart(); const result = first.catch(error => error);
  await h.context.loadTxDecisionChart();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options?.signal?.aborted, false);
  h.calls[0].resolve({ data: { ...current, timeframe: '1D' } });
  const error = await result; assert.equal(error.message, 'CHART_RESPONSE_TIMEFRAME_MISMATCH');
  assert.equal(h.state.txChartPayload, current); assert.equal(h.renders.length, 0);
});

test('rapidly returning to the original period still replaces an already aborted request', async () => {
  const h = harness();
  const first = h.context.loadTxDecisionChart();
  h.state.txChartTimeframe = '1D'; h.context.loadTxDecisionChart({ fit: true });
  h.state.txChartTimeframe = '4h'; h.context.loadTxDecisionChart({ fit: true });
  await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(h.state.homeChartError ?? null, null);
  const refreshed = { ...current, lastPrice: 101 };
  h.calls[1].resolve({ data: refreshed }); await first;
  assert.equal(h.state.txChartPayload, refreshed); assert.equal(h.state.txChartLoading, false);
});

test('a current response after failure restores the selected period and clears only its transport error', async () => {
  const h = harness(); h.state.homeChartError = 'CHART_REQUEST_TIMEOUT'; h.state.txChartTimeframe = '1D';
  const pending = h.context.loadTxDecisionChart();
  const restored = { ...current, timeframe: '1D', qualityStatus: 'QUALITY_INSUFFICIENT' };
  h.calls[0].resolve({ data: restored }); await pending;
  assert.equal(h.state.txChartPayload, restored); assert.equal(h.state.homeChartError, null);
  assert.equal(h.state.txChartPayload.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.equal(h.state.txChartLoading, false);
});

test('home does not present the retained period as a successfully loaded requested period', () => {
  const sandbox = { window: {} }; vm.runInNewContext(home, sandbox);
  const value = sandbox.window.HomeWorkspace.derive({ chart: current, requestedTimeframe: '1D', chartLoading: true,
    rendered: true, now: Date.parse(current.availableAt) + 1000 });
  assert.equal(value.chartCurrent, false); assert.equal(value.chartQualified, false);
  assert.match(value.status, /切換|載入/); assert.match(value.message, /1D/); assert.match(value.message, /4h/);
  assert.equal(value.price, '100'); assert.equal(value.focus, 'blocked');
});

test('the actual home renderer labels the retained period through pending, timeout, and recovery', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, hidden: false,
      classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(id);
  };
  const sandbox = { window: {}, document: { getElementById: node } }; vm.runInNewContext(home, sandbox);
  const start = home.indexOf('  function render(root, input) {'), end = home.indexOf('\n  global.HomeWorkspace', start);
  const context = vm.createContext({ document: sandbox.document, derive: sandbox.window.HomeWorkspace.derive,
    text: (id, value) => { node(id).textContent = value; }, number: value => value,
    renderEvidence() {}, renderResearchDrawer() {}, aiSummary() {} });
  vm.runInContext(home.slice(start, end), context);
  const root = { dataset: { homeVersion: '1' }, querySelector: () => null };
  const input = { chart: current, requestedTimeframe: '1D', chartLoading: true, rendered: true,
    now: Date.parse(current.availableAt) + 1000 };
  context.render(root, input);
  assert.match(node('dw-chart-mode').textContent, /1D.*載入.*4h.*快照/);
  assert.doesNotMatch(node('dw-chart-status').textContent, /觀察資料合格/);
  assert.equal(node('home-chart-notice').hidden, false); assert.equal(root.dataset.homeChart, 'snapshot');
  context.render(root, { ...input, chartLoading: false, chartError: 'CHART_REQUEST_TIMEOUT' });
  assert.match(node('home-impact').textContent, /逾時/);
  assert.match(node('dw-chart-mode').textContent, /1D.*尚未更新.*4h.*快照/);
  context.render(root, { ...input, chart: { ...current, timeframe: '1D' }, chartLoading: false });
  assert.equal(node('dw-chart-mode').textContent, '觀察模式 · 1D · 只讀');
  assert.equal(node('home-chart-notice').hidden, true); assert.equal(root.dataset.homeChart, 'current');
});

test('an initial timeout ends loading and exposes an unavailable state without making up bars', async () => {
  const h = harness(); h.state.txChartPayload = null; h.state.txChartBarCount = 0; h.state.txChartTimeframe = '1D';
  const pending = h.context.loadTxDecisionChart().catch(error => error);
  assert.equal(h.node('dw-chart-canvas').attrs['aria-busy'], 'true');
  [...h.timers.values()][0].fn(); await pending;
  assert.equal(h.node('dw-chart-canvas').attrs['aria-busy'], 'false');
  assert.equal(h.state.txChartLoading, false); assert.equal(h.state.txChartPayload.status, 'UNAVAILABLE');
  assert.equal(h.state.txChartPayload.reason, 'CHART_REQUEST_TIMEOUT'); assert.equal(h.state.txChartPayload.bars.length, 0);
});

test('the AI summary reports confirmed owner-disabled status without inferring it from missing accounts', () => {
  const nodes = new Map([
    ['home-ai-summary', { textContent: '' }], ['ai-inline', { getAttribute: () => 'false' }],
    ['ai-status', { dataset: { phase: 'DISABLED' } }], ['ai-account', { value: '' }], ['ai-model', { value: '' }],
  ]);
  const sandbox = { window: {}, document: { getElementById: id => nodes.get(id) } }; vm.runInNewContext(home, sandbox);
  sandbox.window.HomeWorkspace.aiSummary();
  assert.match(nodes.get('home-ai-summary').textContent, /DISABLED_BY_OWNER/);
  assert.doesNotMatch(nodes.get('home-ai-summary').textContent, /尚未選擇模型|帳號狀態待確認/);
  nodes.get('ai-status').dataset.phase = 'FAILED'; sandbox.window.HomeWorkspace.aiSummary();
  assert.doesNotMatch(nodes.get('home-ai-summary').textContent, /DISABLED_BY_OWNER/);
});

test('actual shared api preserves a valid guest session when a chart request is superseded or times out', async () => {
  for (const kind of ['superseded', 'timeout']) {
    const h = guestHarness(); h.state.txChartTimeframe = '1D';
    const first = h.context.loadTxDecisionChart().catch(error => error);
    if (kind === 'superseded') {
      h.state.txChartTimeframe = '5m'; await h.context.loadTxDecisionChart(); await flush();
      h.requests[1].resolve({ ok: true, status: 200, json: async () => ({ data: { ...current, timeframe: '5m' } }) });
    } else [...h.timers.values()][0].fn();
    await first; await flush();
    assert.equal(h.expired(), 0, `${kind} is local chart cancellation, not a guest session failure`);
    assert.equal(h.state.txChartLoading, false);
  }
});

test('actual shared api preserves real network failure, expired deadline, HTTP410 and HTTP401 protections', async () => {
  const network = guestHarness();
  const pending = network.context.loadTxDecisionChart().catch(error => error);
  network.requests[0].reject(new TypeError('Failed to fetch')); await pending;
  assert.equal(network.expired(), 1);
  const expired = guestHarness(); expired.state.guestExpiryMono = 0;
  await assert.rejects(expired.context.api('/api/v1/tx-chart?timeframe=5m'), /GUEST_EXPIRED/);
  assert.equal(expired.expired(), 1); assert.equal(expired.requests.length, 0);
  const gone = guestHarness(); const response = gone.context.api('/api/v1/tx-chart?timeframe=5m');
  gone.requests[0].resolve({ ok: false, status: 410, json: async () => ({ error: 'GUEST_EXPIRED' }) });
  await assert.rejects(response, /GUEST_EXPIRED/); assert.equal(gone.expired(), 1);
  const unauthorized = guestHarness(); const denied = unauthorized.context.api('/api/v1/tx-chart?timeframe=5m');
  unauthorized.requests[0].resolve({ ok: false, status: 401, json: async () => ({ error: 'AUTH_REQUIRED' }) });
  await assert.rejects(denied, /AUTH_REQUIRED/); assert.deepEqual(unauthorized.shown, ['login-view']);
});
