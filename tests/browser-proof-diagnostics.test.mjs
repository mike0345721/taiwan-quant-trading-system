import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserRuntimeProof, validateBrowserRuntimeProof } from '../src/dashboard-runtime-readiness.mjs';

const identity = { exactHead: 'a'.repeat(40), runtimeStartedAt: '2026-11-03T00:47:01.700Z' };
const proof = { schemaVersion: 'cru46-owner-browser-runtime-proof-v1', ...identity,
  lightweightChartsApiMajor: 5, canvasCount: 4, chartWidth: 900, chartHeight: 420,
  candleCount: 10, volumeCount: 10, chartStatusVisible: true,
  observedFlow1m: true, observedFlow5m: true };

test('missing proof remains unready without inventing chart or Flow failures', () => {
  assert.deepEqual(validateBrowserRuntimeProof(null, identity),
    { ready: false, reasons: ['BROWSER_PROOF_MISSING'], proof: null });
});

test('invalid schema and previous runtime proof cannot diagnose the current browser', () => {
  assert.deepEqual(validateBrowserRuntimeProof({ ...proof, schemaVersion: 'unknown' }, identity).reasons,
    ['BROWSER_PROOF_SCHEMA_INVALID']);
  const previous = { ...proof, runtimeStartedAt: '2026-11-02T00:00:00.000Z', lightweightChartsApiMajor: null };
  const result = validateBrowserRuntimeProof(previous, identity);
  assert.equal(result.ready, false);
  assert.deepEqual(result.reasons, ['BROWSER_PROOF_IDENTITY_MISMATCH']);
});

test('matching proof reports real failures and never accepts missing/nonfinite dimensions or counts', () => {
  assert.equal(validateBrowserRuntimeProof(proof, identity).ready, true);
  for (const field of ['canvasCount', 'chartWidth', 'chartHeight', 'candleCount', 'volumeCount']) {
    for (const value of [undefined, null, NaN, Infinity, -1, 0, '10', true, [10]]) {
      assert.equal(validateBrowserRuntimeProof({ ...proof, [field]: value }, identity).ready, false, `${field}=${value}`);
      const normalized = normalizeBrowserRuntimeProof({ ...proof, [field]: value }, identity);
      assert.equal(validateBrowserRuntimeProof(normalized, identity).ready, false, `normalized ${field}=${value}`);
    }
  }
  const failed = validateBrowserRuntimeProof({ ...proof, lightweightChartsApiMajor: null, observedFlow1m: false }, identity);
  assert.deepEqual(failed.reasons, ['CHART_BROWSER_V5_API_UNAVAILABLE', 'BROWSER_OBSERVED_FLOW_MISSING']);
});
