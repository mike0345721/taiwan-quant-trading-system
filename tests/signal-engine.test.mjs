import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSnapshot } from '../src/mock-data.mjs';
import { buildSignal } from '../src/signal-engine.mjs';

test('signal engine returns bounded values', () => {
  const snapshot = createMockSnapshot();
  snapshot.sources = {
    marketOverview: { ok: true }, marketBreadth: { ok: true }, spotInstitutional: { ok: true }, margin: { ok: true },
    futuresMarket: { ok: true }, futuresInstitutional: { ok: true }, options: { ok: true }, largeTraders: { ok: true },
  };
  const signal = buildSignal(snapshot);
  assert.ok(signal.totalScore >= -100 && signal.totalScore <= 100);
  assert.ok(signal.confidence >= 0 && signal.confidence <= 100);
  assert.ok(signal.gapRisk >= 0 && signal.gapRisk <= 100);
  assert.ok(signal.tradabilityScore >= 0 && signal.tradabilityScore <= 100);
  assert.ok(['long', 'neutral', 'short'].includes(signal.bias));
  assert.equal(signal.tradeState, 'wait');
  assert.equal(signal.validation.directionScore, 'research_only_unvalidated_weights');
  assert.equal(signal.validation.gapRisk, 'heuristic_not_probability');
  assert.equal(signal.validation.tradabilityScore, 'process_readiness_not_expected_return');
  assert.equal(signal.vetoReasons.includes('5分鐘價格、VWAP與成交量確認尚未接入'), true);
  assert.equal(signal.disclaimer.includes('不構成下單指令'), true);
});

test('missing component values are excluded instead of becoming neutral votes', () => {
  const snapshot = createMockSnapshot();
  snapshot.spotInstitutional = { ok: true, data: {} };
  snapshot.options = { ok: true, data: {} };
  snapshot.marketBreadth = { ok: true, data: { listed: {}, otc: {} } };
  snapshot.futuresInstitutional = { ok: true, data: {} };
  snapshot.derived = { ...(snapshot.derived || {}), futures: {} };
  snapshot.sources = {
    marketOverview: { ok: true }, marketBreadth: { ok: true }, spotInstitutional: { ok: true },
    futuresMarket: { ok: true }, futuresInstitutional: { ok: true }, options: { ok: true },
  };
  const signal = buildSignal(snapshot);
  assert.equal(signal.availableComponentCount, 0);
  assert.equal(signal.modelCoveragePct, 0);
  assert.deepEqual(signal.calculation.included, []);
});
