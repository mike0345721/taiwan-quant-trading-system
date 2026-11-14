import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
import { createMarketObservationState, appendMarketObservationRecords, marketObservationSnapshot } from '../src/market-observation-core.mjs';
import { observationDecisionSnapshot } from '../src/market-observation-journal.mjs';
import * as decision from '../src/dashboard-decision-workspace.mjs';
import * as changes from '../src/market-change-feed.mjs';
import { observedFlowAtChart } from '../src/dashboard-observed-flow.mjs';
import { assessCandidateMarketInputs } from '../src/candidate-market-inputs.mjs';
import { appendDecisionJournal, readDecisionJournal } from '../src/decision-journal.mjs';
import { normalizeObservation, observationCopyText, explainReasons } from '../public/market-observation.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const server = read('server.mjs'), app = read('public/app.js'), moduleSource = read('public/market-observation.js');
function between(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `missing source boundary ${start}`);
  return source.slice(first, last);
}
function fixture() {
  const sourceLedgerIdentity = 'sha256:' + 'b'.repeat(64), resolverIdentity = 'capture-integration-fixture';
  let previousHash = 'GENESIS';
  const prices = [100,102,105,103,101,104,107,106,103,99,97,100,103,108,109,104,99,96,98,101];
  const rows = prices.map((close, index) => {
    const at = new Date(Date.UTC(2026, 10, 4, 1, index)).toISOString();
    const row = buildLiveEventRecord({ kind: 'futures_tick', code: 'TXFK6', receivedAt: at, ...SAFETY,
      payload: { productFamily: 'TX', actualContract: 'TXFK6', tradeDate: '2026-11-04', session: 'DAY',
        eventTime: at, close, volume: 2, tick_type: index % 3 ? 1 : 2 } }, previousHash);
    previousHash = row.recordHash; return row;
  });
  const state = appendMarketObservationRecords(createMarketObservationState(sourceLedgerIdentity, resolverIdentity), rows,
    { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  const cutoff = rows.at(-1).receivedAt;
  const observation = marketObservationSnapshot(state, { cutoff, now: cutoff, mode: 'LIVE', timeframe: '5m' });
  const chart = { schemaVersion: 'governed-tx-decision-chart-v2', timeframe: '5m', mode: 'LIVE',
    status: 'QUALITY_INSUFFICIENT', qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons: ['FIXTURE_PARTIAL'],
    actualContract: 'TXFK6', tradeDate: '2026-11-04', session: 'DAY', sessionId: '2026-11-04-DAY',
    asOf: cutoff, availableAt: cutoff, lastPrice: prices.at(-1),
    bars: [{ time: rows[15].receivedAt, open: 104, high: 104, low: 96, close: 101, volume: 10, availableAt: cutoff }],
    vwap: [], levels: {}, marketObservation: observation };
  return { observation, chart, cutoff };
}
function serverContext(chart, extras = {}) {
  const loads = [];
  const context = vm.createContext({ Date, marketCandidate: true, candidateCacheModeRejected: false,
    process: { env: {} }, forwardShadowBaseRoot: 'fixture', txChartDataRoot: 'fixture', futuresAuditPath: 'fixture',
    txChartService: { load: async selection => { loads.push(selection); return chart; } },
    currentObservedFlow: () => null, observedFlowAtChart, observationDecisionSnapshot,
    currentMarketPulse: async () => null, loadIx0001BreadthForWorkspace: () => null,
    buildDataHealthContract: () => ({ overall: 'QUALITY_INSUFFICIENT', items: [], staleCount: 0, unavailableCount: 0 }),
    readLocalJson: () => null, runtimeVersion: {}, productSurfaceContract: {},
    assessTaifexMarketSession: () => ({ state: 'FIXTURE' }), operatingCalendar: {},
    ...decision, ...changes,
    buildDecisionWorkspace: options => decision.buildDecisionWorkspace({ ...options, now: new Date('2026-11-04T01:20:00Z') }),
    assessCandidateMarketInputs: options => assessCandidateMarketInputs({ ...options, now: new Date('2026-11-04T01:20:00Z') }),
    ...extras });
  vm.runInContext(between(server, 'async function decisionWorkspacePayload(', 'async function loadMarketChangeFeed('), context);
  return { context, loads };
}

test('paired worker dispatch carries the exact chart cutoff and identity into all three observation modules', () => {
  const { chart, observation } = fixture(); let handler, response, selected;
  const worker = read('src/dashboard-tx-chart-worker.mjs');
  vm.runInNewContext(worker.slice(worker.indexOf('parentPort.on(')), {
    performance,
    parentPort: { on: (_name, callback) => { handler = callback; }, postMessage: payload => { response = payload; } },
    workerData: { dataRoot: 'fixture', cacheRoot: 'private', producerRoot: 'producer', calendar: {} },
    createTxChartReadBudget: () => ({}), loadTxDecisionChart: () => chart,
    loadMarketObservation: options => { selected = options; return observation; },
  });
  handler({ id: 7, selection: { capture: true, timeframe: '5m', mode: 'LIVE' } });
  assert.equal(response?.error, undefined, 'captured worker must execute with its real timing dependency');
  assert.ok(selected, 'the actual worker must dispatch observation rather than only return an error');
  for (const key of ['actualContract', 'tradeDate', 'session', 'timeframe', 'mode']) assert.equal(selected[key], chart[key]);
  assert.equal(selected.asOf, chart.asOf); assert.equal(response.id, 7);
  assert.equal(response.chart.marketObservation.snapshotId, observation.snapshotId);
});

test('real core snapshot, Copy and event handoff retain one capture hash through disk journal readback', async t => {
  const { chart, observation } = fixture();
  const privatePath = 'D:\\private-fixture\\ledger.ndjson';
  chart.marketObservation.sourceProgress = { sourcePath: privatePath };
  const { context, loads } = serverContext(chart, {buildDataHealthContract: () => ({overall:'UNKNOWN',items:[],
    lineage:{sourcePath:privatePath},staleCount:0,unavailableCount:0})});
  const captured = await context.decisionWorkspacePayload({}, {}, null, { capture: true });
  const envelope = context.decisionCaptureEnvelope(captured, '5m');
  assert.equal(loads.length, 1); assert.equal(loads[0].capture, true);
  const snapshot = envelope.workspace.snapshot;
  assert.ok(decision.validateDecisionSnapshot(snapshot).valid);
  assert.equal(snapshot.marketObservation.snapshotId, observation.snapshotId);
  assert.equal(snapshot.marketObservation.cutoff, chart.asOf);
  assert.equal(envelope.chart.marketObservation.journalSnapshot.snapshotHash, snapshot.snapshotHash);
  assert.ok(envelope.workspace.chatGptCopy.includes(observation.snapshotId));
  assert.ok(envelope.workspace.chatGptCopy.includes(snapshot.snapshotHash));
  assert.equal(envelope.chart.marketObservation.journalCopy, envelope.workspace.chatGptCopy);
  assert.ok(!envelope.chart.marketObservation.journalCopy.includes('private-fixture'));
  assert.equal(envelope.chart.qualityStatus, 'QUALITY_INSUFFICIENT');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'journal.ndjson');
  appendDecisionJournal(file, { intent: 'NO_TRADE', snapshot, reason: 'SYNTHETIC integration only' });
  assert.equal(readDecisionJournal(file)[0].snapshotHash, snapshot.snapshotHash);
  assert.equal(readDecisionJournal(file)[0].snapshot.marketObservation.snapshotId, observation.snapshotId);
});

test('no-EOD partial capture still requests the paired chart and preserves its observation instead of dropping modules', async () => {
  const { chart } = fixture();
  const { context, loads } = serverContext(chart, {
    latestSnapshot: null, expectedDataMode: 'live', refreshSnapshot: async () => {}, offlineCandidate: true,
    isolatedBridge: { connected: false }, isolatedLeadership: null, config: { candidateReadOnly: true }, lastRefreshError: null,
    preliveStatus: () => { throw Error('UNUSED_ARCHIVE_SCAN'); },
  });
  const captured = await context.currentDiscussionWorkspace({ capture: true });
  assert.equal(loads.length, 1); assert.equal(loads[0].capture, true);
  assert.equal(captured.workspace.degraded.status, 'PARTIAL');
  assert.equal(captured.workspace.snapshot.marketObservation.snapshotId, chart.marketObservation.snapshotId);
});

test('Flow capture enforces cutoff, contract, date, session and observation continuity without replacing unknowns with zero', () => {
  const { chart } = fixture();
  const flow = { sourceState: 'STALE', source: { availableAt: chart.asOf },
    lineage: { sourceLedgerIdentity: chart.marketObservation.identity.sourceLedgerIdentity },
    identity: { ...chart.marketObservation.identity }, windows: { primary60s: { pressure: { pressureRatio: null } } },
    ...SAFETY, recommendation: false, systemDirectionalSignal: false };
  assert.equal(observedFlowAtChart(flow, chart), flow);
  for (const lineage of [null, {}, {sourceLedgerIdentity: 'OTHER'}]) {
    const result = observedFlowAtChart({...flow, lineage}, chart);
    assert.equal(result.unavailableReason, 'FLOW_CAPTURE_SOURCE_MISMATCH'); assert.equal(result.windows, null);
  }
  for (const key of ['actualContract', 'tradeDate', 'session', 'continuityEpoch']) {
    const changed = { ...flow, identity: { ...flow.identity, [key]: 'OTHER' } };
    const result = observedFlowAtChart(changed, chart);
    assert.equal(result.unavailableReason, 'FLOW_CAPTURE_IDENTITY_MISMATCH'); assert.equal(result.windows, null);
    assert.equal(result.excludedIdentity[key], 'OTHER');
  }
  for (const at of ['invalid', new Date(Date.parse(chart.asOf) + 1).toISOString()]) {
    const result = observedFlowAtChart({ ...flow, source: { availableAt: at } }, chart);
    assert.equal(result.unavailableReason, 'FLOW_OUTSIDE_CAPTURE_CUTOFF'); assert.equal(result.windows, null);
  }
});

test('captured observation ignores routine refresh and reset removes the prior login snapshot and cancels pending work', async () => {
  const { observation } = fixture(); const nodes = new Map(); let aborted = 0, requests = 0;
  const el = id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', value: '' }); return nodes.get(id); };
  const context = vm.createContext({ window: {}, snapshot: null, selectedEventId: null, captured: false,
    controller: { abort: () => { aborted++; } }, requestId: 1, catchupTimer: null, minimumRefreshMs: 4500,
    clearTimeout, setTimeout, Date, AbortController, root: { setAttribute() {} }, el,
    render() {}, handoff() {}, normalizeObservation, observationCopyText, explainReasons, stamp: String, list: value => String(value),
    failure: null, lastGoodCutoff: null, staleNote: () => '', QUOTE_UNAFFECTED: '',
    selectedEvent: () => null, visible: () => true, timeframe: () => '5m', lastRequestAt: 0,
    fetch: async () => { requests++; throw Error('FIXTURE_STOP'); } });
  vm.runInContext(between(moduleSource, '  async function refresh(', "  el('mo-timeframe').addEventListener"), context);
  vm.runInContext(between(moduleSource, '  window.MarketObservationWorkspace =', '  if (visible()) refresh();'), context);
  context.window.MarketObservationWorkspace.capture(observation);
  assert.equal(context.captured, true); assert.equal(aborted, 1);
  assert.equal(context.window.MarketObservationWorkspace.currentSnapshot().snapshotId, observation.snapshotId);
  await context.refresh(); assert.equal(requests, 0);
  context.window.MarketObservationWorkspace.reset();
  assert.equal(context.captured, false); assert.equal(context.window.MarketObservationWorkspace.currentSnapshot(), null);
  await context.refresh(); assert.equal(requests, 1);
});

test('slow capture fences chart polling until the request settles, then resumes without relaxing supersession checks', async () => {
  const { chart } = fixture(); const { context: builder } = serverContext(chart);
  const payload = { data: builder.decisionCaptureEnvelope(await builder.decisionWorkspacePayload({}, {}, null, { capture: true }), '5m') };
  let resolve, chartReads = 0, captureReads = 0, applied = 0;
  const pending = new Promise(done => { resolve = done; });
  const state = { csrfToken: 'fixture', guestReadOnly: false, txChartTimeframe: '5m', txChartPayload: chart,
    txChartRequestId: 0, dashboardRequestId: 0, txChartLoading: false };
  const context = vm.createContext({ state, AbortController, setTimeout, clearTimeout, URLSearchParams,
    flowChannel: { ticket: () => 'flow', isCurrentSession: token => token === 'flow' },
    api: async route => { if (route.startsWith('/api/v1/decision-capture')) { captureReads++; return pending; }
      chartReads++; return { data: chart }; },
    applyDecisionCapture: () => { applied++; }, copyToClipboard: async () => {},
    renderTxChartFreshness() {}, renderTxDecisionChart() {}, dwText() {}, $: () => ({ setAttribute() {} }),
  });
  vm.runInContext(between(app, 'function decisionCaptureIdentity(', 'function renderDecisionCaptureStatus(')
    + between(app, 'const decisionCaptureController =', 'function clearDecisionCapture(')
    + between(app, 'async function loadTxDecisionChart(', '// Returns only a candidate')
    + '\nglobalThis.control = decisionCaptureController;', context);
  const capture = context.control.capture(); await Promise.resolve();
  assert.equal(state.decisionCaptureBusy, true);
  await context.loadTxDecisionChart(); await context.loadTxDecisionChart();
  assert.equal(chartReads, 0); assert.equal(captureReads, 1);
  resolve(payload); await capture;
  assert.equal(state.decisionCaptureBusy, false); assert.equal(applied, 1);
  await context.loadTxDecisionChart(); assert.equal(chartReads, 1);
});
