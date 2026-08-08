import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSixAxisShadow } from '../src/six-axis-shadow.mjs';

function snapshot() {
  return {
    asOfDate: '2026-07-24',
    signal: {
      totalScore: -24,
      availableComponentCount: 4,
      agreementPct: 70,
      modelCoveragePct: 100,
      volatilityRisk: 65,
      tradabilityScore: 42,
      tradeState: 'wait',
      vetoReasons: ['price'],
      completenessPct: 90,
    },
    taiwanVix: { data: { close: 24 } },
    marketOverview: { data: { vix: 20 } },
    options: { ok: true, data: { oiPcRatio: 1.3, contract: 'TXO202607W4' } },
    priceConfirmation: { ready: false, state: 'not_connected', reasons: ['等待盤中行情'] },
    researchDecision: {
      v362Risk: {
        dataDate: '2026-07-24',
        options: { level: 'medium', atmIv: 0.25, skew: 0.03, contract: 'TXO202607W4' },
        evidence: { level: 1, liveEligible: false, interpretation: '風險候選' },
      },
    },
  };
}

test('six-axis shadow records all components but never affects official decisions', () => {
  const result = buildSixAxisShadow(snapshot());
  assert.equal(result.axes.length, 6);
  assert.equal(result.formalWeight, 0);
  assert.equal(result.influencesOfficialDecision, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.axes.every((item) => item.formalWeight === 0), true);
  assert.equal(result.axes.every((item) => item.influencesOfficialDecision === false), true);
  assert.equal(result.axes.find((item) => item.key === 'direction').signedValue, -24);
  assert.equal(result.axes.find((item) => item.key === 'price').available, false);
  assert.match(result.note, /不是勝率/);
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
});

test('same six-axis inputs produce the same audit hash', () => {
  const first = buildSixAxisShadow(snapshot());
  const second = buildSixAxisShadow(snapshot());
  assert.equal(first.inputHash, second.inputHash);
  assert.notEqual(first.recordedAt, null);
});
