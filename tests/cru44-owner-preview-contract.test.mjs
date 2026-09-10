import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildCru44PreviewVersion,
  CRU44_APPROVED_BASE_MAIN,
  CRU44_PRODUCT_SURFACE_CONTRACT,
  validateCru44PreviewVersionTruth,
} from '../src/dashboard-integration-contract.mjs';
import {
  inspectObservedFlowPayload,
  normalizeBrowserRuntimeProof,
  validateBrowserRuntimeParity,
  validateBrowserRuntimeProof,
} from '../src/dashboard-runtime-readiness.mjs';

const HEAD = 'f'.repeat(40);

test('CRU-44 preview truth is bound to the approved base and promotes 1h plus 4h additively', () => {
  const version = buildCru44PreviewVersion({ enabled: true, branch: 'codex/cru-44-1h-4h-observed-flow-v1',
    dataMode: 'GOVERNED_LOCAL_DATA', runtimeVersion: { runtimeCommit: HEAD } });
  assert.equal(version.baseMainCommit, CRU44_APPROVED_BASE_MAIN);
  assert.equal(version.previewType, 'CRU44_OWNER_PREVIEW');
  assert.deepEqual(CRU44_PRODUCT_SURFACE_CONTRACT.observedFlow.governed, ['1m', '5m', '15m', '30m', '1h', '4h']);
  assert.deepEqual(CRU44_PRODUCT_SURFACE_CONTRACT.observedFlow.pending, ['tradingDay']);
  assert.deepEqual(validateCru44PreviewVersionTruth(version, HEAD), { ready: true, reasons: [] });
});

test('CRU-44 readiness accepts independent long-window lawful states and requires browser linkage for both', () => {
  const observedFlow = inspectObservedFlowPayload({ sourceState: 'LIVE', identity: {
    tradeDate: '2026-09-09', session: 'DAY', actualContract: 'TXFI6',
  }, windows: {
    primary60s: { status: 'READY' }, context300s: { status: 'QUALITY_INSUFFICIENT' },
    window900s: { status: 'READY', truthState: 'LIVE' },
    window1800s: { status: 'UNAVAILABLE', truthState: 'WARMING_UP' },
    window3600s: { status: 'READY', truthState: 'LIVE' },
    window14400s: { status: 'UNAVAILABLE', truthState: 'WARMING_UP' },
  } }, { requireLongWindows: true });
  assert.equal(observedFlow.ready, true);
  assert.equal(observedFlow.fifteenMinuteStatus, 'READY');
  assert.equal(observedFlow.thirtyMinuteTruthState, 'WARMING_UP');

  const proof = normalizeBrowserRuntimeProof({ lightweightChartsApiMajor: 5, canvasCount: 4,
    chartWidth: 900, chartHeight: 420, candleCount: 3, volumeCount: 3, chartStatusVisible: true,
    observedFlow1m: true, observedFlow5m: true, observedFlow15m: true, observedFlow30m: true,
    observedFlow1h: true, observedFlow4h: true,
  }, { exactHead: HEAD, runtimeStartedAt: '2026-09-09T00:00:00.000Z' });
  assert.deepEqual(validateBrowserRuntimeProof(proof, { exactHead: HEAD,
    runtimeStartedAt: '2026-09-09T00:00:00.000Z', requireLongWindows: true }),
  { ready: true, reasons: [], proof });
  assert.deepEqual(validateBrowserRuntimeParity(proof, { chart: { candleCount: 3, volumeCount: 3 },
    observedFlow, requireLongWindows: true }), { ready: true, reasons: [] });
});

test('CRU-44 long-window readiness fails closed when only one promoted window is present', () => {
  const result = inspectObservedFlowPayload({ sourceState: 'LIVE', windows: {
    primary60s: { status: 'READY' }, context300s: { status: 'READY' },
    window900s: { status: 'READY', truthState: 'LIVE' },
  } }, { requireLongWindows: true });
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ['OBSERVED_FLOW_1M_5M_15M_30M_1H_4H_UNAVAILABLE']);
});

test('CRU-44 launcher waits for identity catch-up and treats browser proof as a separate gate', () => {
  const launcher = fs.readFileSync(new URL('../scripts/start-cru44-owner-preview.ps1', import.meta.url), 'utf8');
  assert.match(launcher, /\[int\]\$Port = 8795/);
  assert.match(launcher, /runtimePreflightReady\.ready -eq \$true/);
  assert.match(launcher, /Gate = 'BROWSER_ACCEPTANCE_REQUIRED'/);
  assert.match(launcher, /\$attempt -lt 300/);
  assert.match(launcher, /CRU44_PREVIEW_START_FAILED:\$\{lastHealthReason\}/);
  assert.doesNotMatch(launcher, /Get-CimInstance/);
});
