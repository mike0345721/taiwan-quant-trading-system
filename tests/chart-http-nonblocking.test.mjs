import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SessionStore, parseCookies, safeEqual } from '../src/security.mjs';
import { inspectChartPayload } from '../src/dashboard-runtime-readiness.mjs';
import { observationDecisionSnapshot } from '../src/market-observation-journal.mjs';

const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// Exercise the actual authenticated handler and readiness function while a chart
// calculation is held open. No socket, real settings, ledger or process is used.
function harness() {
  const sessions = new SessionStore(60_000), session = sessions.create('127.0.0.1');
  const queued = [], selections = [];
  let peekCount = 0;
  const stale = { status: 'UNAVAILABLE', reason: 'CHART_SNAPSHOT_STALE', bars: [], availableAt: null };
  const context = {
    URL, sessions, parseCookies, safeEqual, console, crypto: { randomUUID: () => 'synthetic-chart-request' },
    config: { candidateReadOnly: false, host: '127.0.0.1', port: 18723 },
    process: { env: {} }, cru55: null, formalEntry: null, marketCandidate: false,
    requestIsHttps: () => false, setSecurityHeaders() {}, clientIp: () => '127.0.0.1',
    inlineHandler: async () => false,
    sendJson(res, status, body) { res.status = status; res.body = JSON.parse(JSON.stringify(body)); },
    txChartService: {
      load(selection) { selections.push(selection); return new Promise(resolve => queued.push(resolve)); },
      peek() { peekCount += 1; return stale; },
    },
    // An accidental synchronous fallback must fail rather than silently pass.
    loadTxDecisionChart() { throw Error('HTTP_LEDGER_READ_FORBIDDEN'); },
    cru21PreviewEnabled: false, cru44PreviewEnabled: false, integrationPreviewEnabled: false,
    runtimeIdentity: { commit: 'a'.repeat(40), status: 'VERIFIED' },
    approvedMainIdentity: { commit: 'b'.repeat(40) },
    runtimeVersion: { runtimeStartedAt: '2026-11-04T00:00:00Z' },
    runtimeStartedAt: '2026-11-04T00:00:00Z', sourceCleanAtStartup: true,
    expectedDataMode: 'LIVE', lightweightChartsPath: 'synthetic-vendor', lightweightChartsPackagePath: 'synthetic-package',
    cru34LiveSnapshotPath: 'synthetic-snapshot', cru34LiveStatusPath: 'synthetic-status',
    cru34LiveDataRoot: 'synthetic-data', cru34LiveProjectionRoot: 'synthetic-projection',
    txChartDataRoot: 'synthetic-chart', txChartCacheRoot: 'synthetic-cache', chartCalendar: {},
    validateFormalRuntimeVersionTruth: () => ({ ready: true }),
    loadDashboardObservedFlow: () => ({}), inspectObservedFlowPayload: () => ({ ready: false }),
    inspectChartVendorRuntime: () => ({ ready: true }), inspectCru34LiveProducer: () => ({ ready: true }),
    inspectChartPayload, browserRuntimeProof: null,
    validateBrowserRuntimeProof: () => ({ ready: false, reasons: ['BROWSER_PROOF_MISSING'] }),
    buildCru46Readiness: input => ({ runtimeReady: { ready: input.chart.ready, reasons: input.chart.reasons } }),
    readDataOperationsReaderIdentity: () => null,
    inlineEnabled: false, localMarketOnly: false, productSurfaceContract: {}, operatingCalendar: {},
    assessTaifexMarketSession: () => ({ state: 'UNKNOWN' }),
    buildMarketChangeFeed: chart => ({ events: [], chartStatus: chart.status }),
    chartMarkersFromEvents: () => [],
    observationDecisionSnapshot,
  };
  const auth = source.slice(source.indexOf('function getSession(req)'), source.indexOf('const inlineEnabled ='));
  const readiness = source.slice(source.indexOf('function currentCru46RuntimeReadiness()'), source.indexOf('function readLocalJson('));
  const feedStart = source.indexOf('async function loadMarketChangeFeed(');
  const feed = source.slice(feedStart, source.indexOf('function preliveStatus('));
  const handler = source.slice(source.indexOf('const requestHandler ='), source.indexOf('const server = createDashboardServer'));
  assert.ok(feedStart >= 0, 'market-change requests must await the bounded chart service');
  vm.runInNewContext(`${auth}\n${readiness}\n${feed}\n${handler}\nglobalThis.handle=requestHandler;`, context);
  async function request(url, authenticated = true) {
    const res = { setHeader() {} };
    await context.handle({ method: 'GET', url, headers: authenticated ? { cookie: `twchip_session=${session.id}` } : {} }, res);
    return res;
  }
  return { request, queued, selections, get peekCount() { return peekCount; } };
}

test('a pending daily chart cannot block health or cause health to read a ledger', async () => {
  const h = harness();
  let chartSettled = false;
  const pending = h.request('/api/v1/tx-chart?timeframe=1D&mode=LIVE').then(result => { chartSettled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queued.length, 1);
  assert.equal(chartSettled, false);
  const health = await h.request('/healthz', false);
  assert.equal(health.status, 200);
  assert.equal(health.body.runtimeReady.ready, false);
  assert.equal(health.body.runtimeEvidence.chart.reason, 'CHART_SNAPSHOT_STALE');
  assert.equal(h.peekCount, 1);
  assert.equal(h.selections.length, 1, 'health must not queue a chart calculation');
  assert.equal(chartSettled, false);
  h.queued.shift()({ status: 'QUALITY_INSUFFICIENT', reason: 'SOURCE_CATCHUP_PENDING', timeframe: '1D', bars: [] });
  const chart = await pending;
  assert.equal(chart.status, 200);
  assert.equal(chart.body.data.reason, 'SOURCE_CATCHUP_PENDING');
});

test('chart service deadline remains an explicit response and health stays independently callable', async () => {
  const h = harness();
  const pending = h.request('/api/v1/tx-chart?timeframe=1D&mode=LIVE');
  await new Promise(resolve => setImmediate(resolve));
  h.queued.shift()({ status: 'UNAVAILABLE', reason: 'CHART_WORKER_TIMEOUT', timeframe: '1D', bars: [] });
  assert.equal((await pending).body.data.reason, 'CHART_WORKER_TIMEOUT');
  assert.equal((await h.request('/healthz', false)).status, 200);
});

test('market changes wait for a resolved chart and chart calculations remain authenticated', async () => {
  const h = harness();
  assert.equal((await h.request('/api/v1/tx-chart?timeframe=1D', false)).status, 401);
  assert.equal(h.selections.length, 0);
  const pending = h.request('/api/v1/market-changes?mode=LIVE');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.selections.length, 1);
  h.queued.shift()({ status: 'QUALITY_INSUFFICIENT', bars: [] });
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.data.chartStatus, 'QUALITY_INSUFFICIENT');
});
test('observation API shares the bounded worker, authentication and exact returned snapshot without health rescans', async () => {
  const h=harness();
  assert.equal((await h.request('/api/v1/market-observation',false)).status,401);
  const pending=h.request('/api/v1/market-observation?timeframe=1m&mode=REPLAY&asOf=2026-11-04T01:05:00Z');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.selections[0].observation,true);assert.equal(h.selections[0].timeframe,'1m');
  assert.equal((await h.request('/healthz',false)).status,200);assert.equal(h.selections.length,1);
  const snapshot={schemaVersion:'cru61-market-observation-v1',status:'UNAVAILABLE',snapshotId:null,cutoff:'2026-11-04T01:05:00Z',reasonCodes:['NO_LAWFUL_TRADE'],cvd:{value:null},profile:{poc:null},events:[]};
  h.queued.shift()(snapshot);const response=await pending;
  assert.equal(response.status,200);assert.deepEqual(response.body.data,{...snapshot,journalSnapshot:null,journalCopy:null});
});
