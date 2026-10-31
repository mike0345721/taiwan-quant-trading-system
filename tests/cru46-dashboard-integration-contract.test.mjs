import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildIntegrationPreviewVersion,
  CRU46_INCLUDED_SOURCES,
  CRU46_INTEGRATION_BASE_MAIN,
  CRU46_PRODUCT_SURFACE_CONTRACT,
  validateIntegrationPreviewVersionTruth,
} from '../src/dashboard-integration-contract.mjs';
import {
  buildCru46Readiness,
  inspectChartPayload,
  inspectObservedFlowPayload,
  normalizeBrowserRuntimeProof,
  validateBrowserRuntimeParity,
  validateProducerHeartbeat,
  validateBrowserRuntimeProof,
} from '../src/dashboard-runtime-readiness.mjs';

const RUNTIME_HEAD = 'f'.repeat(40);

test('CRU-46 product surface freezes chart flow fail-closed and safety contracts', () => {
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.chart.requiredVisible,
    ['candlestick', 'volume', 'currentPrice', 'vwap', 'sessionHigh', 'sessionLow']);
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.windows,
    ['1m', '5m', '15m', '30m', '1h', '4h', 'tradingDay']);
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.governed, ['1m', '5m']);
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.pending, ['15m', '30m', '1h', '4h', 'tradingDay']);
  assert.equal(CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.synchronizedWithChart, true);
  assert.equal(CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.formalDirectionGate, 'classifiedCoverage === 1');
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.failClosed, {
    missingIsZero: false, staleIsLive: false, marketPulse: true, volume: true, basis: true, rvol: 'RESEARCH_PENDING',
  });
  assert.deepEqual(CRU46_PRODUCT_SURFACE_CONTRACT.safety, {
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
  });
});

test('integration Owner Preview version truth is exact explicit and incomplete', () => {
  const version = buildIntegrationPreviewVersion({
    enabled: true,
    branch: 'codex/cru-46-dashboard-integration-mainline-v1',
    dataMode: 'GOVERNED_LOCAL_DATA',
    runtimeVersion: {
      runtimeCommit: RUNTIME_HEAD,
      approvedMainCommit: CRU46_INTEGRATION_BASE_MAIN,
      runtimeStartedAt: '2026-09-08T00:00:00.000Z',
      syncState: 'MISMATCH',
    },
  });
  assert.equal(version.previewLabel, 'INTEGRATION OWNER PREVIEW');
  assert.equal(version.previewType, 'INTEGRATION_OWNER_PREVIEW');
  assert.equal(version.exactHead, RUNTIME_HEAD);
  assert.equal(version.buildCommit, RUNTIME_HEAD);
  assert.equal(version.runtimeCommit, RUNTIME_HEAD);
  assert.equal(version.baseMainCommit, CRU46_INTEGRATION_BASE_MAIN);
  assert.equal(version.approvedMainCommit, CRU46_INTEGRATION_BASE_MAIN);
  assert.equal(version.syncState, 'MISMATCH');
  assert.deepEqual(version.includedSources, CRU46_INCLUDED_SOURCES);
  assert.deepEqual(version.pendingCapabilities, ['CRU-44', 'CVD', 'RVOL', '15m+ observed-flow backend']);
  assert.equal(version.dataMode, 'GOVERNED_LOCAL_DATA');
  assert.equal(version.complete, false);
  assert.deepEqual(validateIntegrationPreviewVersionTruth(version, RUNTIME_HEAD), { ready: true, reasons: [] });
  const unavailable = buildIntegrationPreviewVersion({ enabled: true, runtimeVersion: { runtimeCommit: null } });
  assert.equal(validateIntegrationPreviewVersionTruth(unavailable, RUNTIME_HEAD).ready, false);
  assert.match(validateIntegrationPreviewVersionTruth(unavailable, RUNTIME_HEAD).reasons.join(','), /EXACTHEAD_UNVERIFIED/);
  assert.match(validateIntegrationPreviewVersionTruth({ ...version, runtimeCommit: 'e'.repeat(40) }, RUNTIME_HEAD).reasons.join(','), /RUNTIMECOMMIT_MISMATCH/);
});

test('production surface exposes first-layer preview badge and machine-readable health truth', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const launcher = fs.readFileSync(new URL('../scripts/start-cru46-integration-owner-preview.ps1', import.meta.url), 'utf8');
  assert.match(html, /id="cru46-preview-badge">INTEGRATION OWNER PREVIEW/);
  assert.equal((html.match(/role="tab" aria-controls="dw-flow-selected-detail"/g) || []).length, 7);
  assert.match(html, /id="dw-flow-selected-detail"[^>]*role="tabpanel"[^>]*aria-labelledby="dw-flow-tab-5m"/);
  assert.match(html, /class="is-selected" aria-pressed="true" data-chart-timeframe="5m"/);
  for (const id of ['product', 'type', 'branch', 'head', 'base', 'build', 'runtime', 'cru43', 'cru45', 'pending', 'data-mode', 'complete']) {
    assert.match(html, new RegExp(`id="cru46-version-${id}"`));
  }
  assert.match(app, /version\.previewType === 'INTEGRATION_OWNER_PREVIEW'/);
  assert.match(app, /version\.complete === false \? 'NOT COMPLETE'/);
  assert.match(server, /versionTruth: runtimeVersion/);
  assert.match(server, /identityReady: readiness\.identityReady/);
  assert.match(server, /runtimeReady: readiness\.runtimeReady/);
  assert.match(server, /ownerPreviewReady: readiness\.ownerPreviewReady/);
  assert.match(server, /cru46-browser-runtime-proof/);
  assert.doesNotMatch(server, /candleCount:\s*chart\.candleCount|volumeCount:\s*chart\.volumeCount/);
  assert.match(app, /txChartVolumeCount/);
  assert.match(server, /productSurface: CRU46_PRODUCT_SURFACE_CONTRACT/);
  assert.match(launcher, /DASHBOARD_PREVIEW_TYPE = 'INTEGRATION_OWNER_PREVIEW'/);
  assert.match(launcher, /CRU46_EXPECTED_HEAD_UNVERIFIED/);
  assert.match(launcher, /identityReady\.ready -eq \$true/);
  assert.match(launcher, /runtimePreflightReady\.ready -eq \$true/);
  assert.match(launcher, /BROWSER_ACCEPTANCE_REQUIRED/);
  assert.match(launcher, /READY_FOR_INTEGRATION_OWNER_PREVIEW_REV_B/);
  assert.match(launcher, /ownerPreviewReady\.ready -eq \$true/);
  assert.match(launcher, /CRU46_EXISTING_PREVIEW_NOT_READY/);
  assert.match(launcher, /\$exactHead -eq \$expectedHead/);
  assert.match(launcher, /\$buildCommit -eq \$expectedHead/);
  assert.match(launcher, /\$runtimeCommit -eq \$expectedHead/);
  assert.match(launcher, /MOCK_DATA = 'false'/);
  assert.doesNotMatch(launcher, /executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/i);
});

test('Rev-B readiness separates identity, runtime, and Owner Preview gates', () => {
  const identity = { ready: true, reasons: [] };
  const vendor = { ready: true, reasons: [] };
  const producer = { ready: true, reasons: [] };
  const chart = inspectChartPayload({ status: 'READY', tradeDate: '2026-09-09', session: 'NIGHT', actualContract: 'TXFI6', bars: [
    { time: '2026-09-09T00:00:00.000Z', open: 1, high: 2, low: 1, close: 2, volume: 3 },
  ] });
  const observedFlow = inspectObservedFlowPayload({ sourceState: 'STALE', identity: {
    tradeDate: '2026-09-09', session: 'NIGHT', actualContract: 'TXFI6',
  }, windows: {
    primary60s: { status: 'READY' }, context300s: { status: 'QUALITY_INSUFFICIENT' },
  } });
  const pendingBrowser = validateBrowserRuntimeProof(null,
    { exactHead: RUNTIME_HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  const pending = buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser: pendingBrowser });
  assert.equal(pending.identityReady.ready, true);
  assert.equal(pending.runtimePreflightReady.ready, true);
  assert.equal(pending.runtimeReady.ready, false);
  assert.equal(pending.ownerPreviewReady.ready, false);
  assert.match(pending.runtimeReady.reasons.join(','), /BROWSER_PROOF_MISSING/);

  const browser = validateBrowserRuntimeProof({
    schemaVersion: 'cru46-owner-browser-runtime-proof-v1', exactHead: RUNTIME_HEAD,
    runtimeStartedAt: '2026-09-09T00:00:00.000Z', lightweightChartsApiMajor: 5,
    canvasCount: 4, chartWidth: 900, chartHeight: 420, candleCount: 1, volumeCount: 1, chartStatusVisible: true,
    observedFlow1m: true, observedFlow5m: true,
  }, { exactHead: RUNTIME_HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  const accepted = buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser });
  assert.equal(accepted.runtimeReady.ready, true);
  assert.equal(accepted.ownerPreviewReady.ready, true);
});

test('Rev-B browser proof preserves rendered evidence and rejects backend-only eligibility', () => {
  const proof = normalizeBrowserRuntimeProof({ lightweightChartsApiMajor: 5, canvasCount: 4,
    chartWidth: 900, chartHeight: 420, candleCount: 0, volumeCount: 0, chartStatusVisible: false,
    observedFlow1m: false, observedFlow5m: false },
  { exactHead: RUNTIME_HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  assert.equal(proof.candleCount, 0);
  assert.equal(proof.volumeCount, 0);
  const validated = validateBrowserRuntimeProof(proof,
    { exactHead: RUNTIME_HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  assert.equal(validated.ready, false);
  assert.match(validated.reasons.join(','), /CHART_BROWSER_SERIES_EMPTY/);
  const parity = validateBrowserRuntimeParity(proof, { chart: { candleCount: 10, volumeCount: 10 },
    observedFlow: { oneMinuteStatus: 'READY', fiveMinuteStatus: 'READY' } });
  assert.equal(parity.ready, false);
  assert.match(parity.reasons.join(','), /CHART_BROWSER_CANDLE_COUNT_MISMATCH/);
});

test('Rev-B runtime gates reject null chart bars, identity drift, and stale or recycled producer instances', () => {
  const nullChart = inspectChartPayload({ status: 'READY', tradeDate: '2026-09-09', session: 'NIGHT', actualContract: 'TXFI6',
    bars: [{ time: '2026-09-09T00:00:00.000Z', open: null, high: null, low: null, close: null, volume: null }] });
  assert.equal(nullChart.ready, false);
  assert.equal(nullChart.candleCount, 0);
  assert.equal(nullChart.volumeCount, 0);

  const base = { ready: true, reasons: [] };
  const browser = { ready: true, reasons: [] };
  const flow = inspectObservedFlowPayload({ sourceState: 'LIVE', identity: {
    tradeDate: '2026-09-09', session: 'NIGHT', actualContract: 'TXFI6',
  }, windows: { primary60s: { status: 'READY' }, context300s: { status: 'READY' } } });
  const mismatchedChart = inspectChartPayload({ status: 'READY', tradeDate: '2026-09-09', session: 'DAY', actualContract: 'TXFI6',
    bars: [{ time: '2026-09-09T00:00:00.000Z', open: 1, high: 2, low: 1, close: 2, volume: 3 }] });
  const drift = buildCru46Readiness({ identity: base, vendor: base, producer: base, chart: mismatchedChart,
    observedFlow: flow, browser });
  assert.equal(drift.ownerPreviewReady.ready, false);
  assert.match(drift.ownerPreviewReady.reasons.join(','), /CHART_OBSERVED_FLOW_IDENTITY_MISMATCH/);

  const paths = { snapshotPath: 'D:\\data\\latest.json', statusPath: 'D:\\data\\status.json',
    dataRoot: 'D:\\data', projectionRoot: 'D:\\data\\runtime', now: new Date('2026-09-09T00:01:00.000Z'),
    isProcessAlive: () => true };
  const status = { schemaVersion: 'cru34-live-worker-status-v1', status: 'AVAILABLE', pid: 42,
    workerInstanceId: '00000000-0000-4000-8000-000000000001', observedAt: '2026-09-09T00:00:00.000Z',
    snapshotPath: paths.snapshotPath, statusPath: paths.statusPath, dataRoot: paths.dataRoot, projectionRoot: paths.projectionRoot };
  const lock = { pid: 42, workerInstanceId: status.workerInstanceId, dataRoot: paths.dataRoot, projectionRoot: paths.projectionRoot };
  assert.match(validateProducerHeartbeat(status, lock, paths).reasons.join(','), /LIVE_PRODUCER_HEARTBEAT_STALE/);
  assert.match(validateProducerHeartbeat({ ...status, observedAt: '2026-09-09T00:00:59.000Z' },
    { ...lock, workerInstanceId: '00000000-0000-4000-8000-000000000002' }, paths).reasons.join(','),
  /LIVE_PRODUCER_INSTANCE_MISMATCH/);
});

test('render-ready stale Flow has an explicit separate freshness failure',()=>{
 const now=new Date('2026-10-27T05:00:00Z');
 const flow={sourceState:'STALE',source:{availableAt:'2026-10-27T04:59:00Z',validUntil:'2026-10-27T04:59:30Z'},windows:{primary60s:{status:'READY'},context300s:{status:'QUALITY_INSUFFICIENT'}}};
 const r=inspectObservedFlowPayload(flow,{now});assert.equal(r.ready,true);
 assert.equal(r.sourceFreshness.ready,false);assert.equal(r.sourceFreshness.ageMs,60000);
 assert.ok(r.sourceFreshness.reasons.includes('FLOW_SOURCE_EXPIRED'));
 const current=inspectObservedFlowPayload({...flow,sourceState:'LIVE',source:{availableAt:'2026-10-27T04:59:59Z',validUntil:'2026-10-27T05:00:29Z'}},{now});
 assert.equal(current.sourceFreshness.ready,true);assert.equal(current.sourceFreshness.ageMs,1000);
 assert.match(current.sourceFreshness.scope,/NOT_DIRECTION/);
 for(const source of [{},{availableAt:'2026-10-27T05:00:01Z',validUntil:'2026-10-27T05:00:31Z'},{availableAt:'invalid',validUntil:'invalid'}])
  assert.equal(inspectObservedFlowPayload({...flow,sourceState:'LIVE',source},{now}).sourceFreshness.ready,false);
});
