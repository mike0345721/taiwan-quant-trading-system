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
  assert.match(server, /productSurface: CRU46_PRODUCT_SURFACE_CONTRACT/);
  assert.match(launcher, /DASHBOARD_PREVIEW_TYPE = 'INTEGRATION_OWNER_PREVIEW'/);
  assert.match(launcher, /CRU46_EXPECTED_HEAD_UNVERIFIED/);
  assert.match(launcher, /identityReady\.ready -eq \$true/);
  assert.match(launcher, /runtimePreflightReady\.ready -eq \$true/);
  assert.match(launcher, /BROWSER_ACCEPTANCE_REQUIRED/);
  assert.doesNotMatch(launcher, /Url\s*=\s*"http:\/\/127\.0\.0\.1/);
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
  const chart = inspectChartPayload({ status: 'READY', bars: [
    { time: '2026-09-09T00:00:00.000Z', open: 1, high: 2, low: 1, close: 2, volume: 3 },
  ] });
  const observedFlow = inspectObservedFlowPayload({ sourceState: 'STALE', windows: {
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
    canvasCount: 4, chartWidth: 900, chartHeight: 420, candleCount: 1, volumeCount: 1,
    observedFlow1m: true, observedFlow5m: true,
  }, { exactHead: RUNTIME_HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  const accepted = buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser });
  assert.equal(accepted.runtimeReady.ready, true);
  assert.equal(accepted.ownerPreviewReady.ready, true);
});
