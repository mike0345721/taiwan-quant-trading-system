import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildIntegrationPreviewVersion,
  CRU46_INCLUDED_SOURCES,
  CRU46_INTEGRATION_BASE_MAIN,
  CRU46_PRODUCT_SURFACE_CONTRACT,
} from '../src/dashboard-integration-contract.mjs';

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
});

test('production surface exposes first-layer preview badge and machine-readable health truth', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const launcher = fs.readFileSync(new URL('../scripts/start-cru46-integration-owner-preview.ps1', import.meta.url), 'utf8');
  assert.match(html, /id="cru46-preview-badge">INTEGRATION OWNER PREVIEW/);
  for (const id of ['product', 'type', 'branch', 'head', 'base', 'build', 'runtime', 'cru43', 'cru45', 'pending', 'data-mode', 'complete']) {
    assert.match(html, new RegExp(`id="cru46-version-${id}"`));
  }
  assert.match(app, /version\.previewType === 'INTEGRATION_OWNER_PREVIEW'/);
  assert.match(app, /version\.complete === false \? 'NOT COMPLETE'/);
  assert.match(server, /versionTruth: runtimeVersion/);
  assert.match(server, /productSurface: CRU46_PRODUCT_SURFACE_CONTRACT/);
  assert.match(launcher, /DASHBOARD_PREVIEW_TYPE = 'INTEGRATION_OWNER_PREVIEW'/);
  assert.match(launcher, /MOCK_DATA = 'false'/);
  assert.doesNotMatch(launcher, /executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/i);
});
