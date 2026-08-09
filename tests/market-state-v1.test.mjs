import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPastOnlyPercentile, evaluatePremarketMarketState } from '../src/market-state-v1.mjs';

const decisionAt = '2026-08-10T08:30:00+08:00';

function evidence(overrides = {}) {
  return {
    key: 'evidence',
    block: 'localPrice',
    availableAt: '2026-08-09T14:00:00+08:00',
    qualityStatus: 'VALID',
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    tradeDate: '2026-08-10',
    decisionAt,
    researchOnly: true,
    executionAuthorized: false,
    evidence: [],
    ...overrides,
  };
}

test('premarket evaluator fails closed when execution or research boundary is invalid', () => {
  assert.throws(() => evaluatePremarketMarketState(input({ executionAuthorized: true })), /EXECUTION_MUST_BE_FALSE/);
  assert.throws(() => evaluatePremarketMarketState(input({ researchOnly: false })), /RESEARCH_ONLY_REQUIRED/);
  assert.throws(() => evaluatePremarketMarketState(input({ decisionAt: 'invalid' })), /DECISION_AT_INVALID/);
});

test('future, stale and invalid-timestamp evidence is excluded instead of leaking into state', () => {
  const result = evaluatePremarketMarketState(input({
    evidence: [
      evidence({ key: 'future', direction: 'BEARISH', availableAt: '2026-08-10T09:00:00+08:00' }),
      evidence({ key: 'stale', direction: 'BEARISH', qualityStatus: 'STALE' }),
      evidence({ key: 'bad-time', direction: 'BEARISH', availableAt: null }),
      evidence({ key: 'valid-local', direction: 'BULLISH', trend: 'TREND_UP' }),
      evidence({ key: 'valid-breadth', block: 'breadth', direction: 'BULLISH' }),
    ],
  }));
  assert.equal(result.state.direction, 'BULLISH');
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.unavailable.map((row) => row.reason).sort(), ['AVAILABLE_AT_INVALID', 'FUTURE_EVIDENCE', 'QUALITY_STALE']);
});

test('direction and risk remain independent so bullish direction can coexist with elevated risk', () => {
  const result = evaluatePremarketMarketState(input({
    evidence: [
      evidence({ key: 'local', direction: 'BULLISH', trend: 'TREND_UP', volatility: 'NORMAL' }),
      evidence({ key: 'breadth', block: 'breadth', direction: 'BULLISH' }),
      evidence({ key: 'institutional', block: 'institutional', direction: 'NEUTRAL' }),
      evidence({ key: 'skew', block: 'options', risk: 'ELEVATED', volatility: 'HIGH', direction: 'BEARISH' }),
      evidence({ key: 'vix', block: 'globalFx', risk: 'ELEVATED', globalAlignment: 'HEADWIND', direction: 'BEARISH' }),
    ],
  }));
  assert.equal(result.state.direction, 'BULLISH');
  assert.equal(result.state.risk, 'ELEVATED');
  assert.equal(result.state.volatility, 'HIGH');
  assert.equal(result.state.globalAlignment, 'HEADWIND');
});

test('material bullish and bearish directional blocks produce CONFLICT rather than a weighted score', () => {
  const result = evaluatePremarketMarketState(input({
    evidence: [
      evidence({ key: 'local', direction: 'BULLISH', trend: 'TREND_UP' }),
      evidence({ key: 'breadth', block: 'breadth', direction: 'BEARISH' }),
      evidence({ key: 'futures', block: 'futuresPositioning', direction: 'BULLISH' }),
      evidence({ key: 'foreign', block: 'institutional', direction: 'BEARISH' }),
    ],
  }));
  assert.equal(result.state.direction, 'CONFLICT');
  assert.equal(result.conflicts.some((row) => row.type === 'DIRECTION_BLOCK_CONFLICT'), true);
});

test('global alignment keeps correlated global evidence inside one block and can report MIXED', () => {
  const result = evaluatePremarketMarketState(input({
    evidence: [
      evidence({ key: 'local', direction: 'NEUTRAL', trend: 'RANGE' }),
      evidence({ key: 'breadth', block: 'breadth', direction: 'NEUTRAL' }),
      evidence({ key: 'ndx-proxy', block: 'globalFx', globalAlignment: 'TAILWIND' }),
      evidence({ key: 'usd-twd', block: 'globalFx', globalAlignment: 'HEADWIND' }),
    ],
  }));
  assert.equal(result.state.globalAlignment, 'MIXED');
  assert.equal(result.conflicts.some((row) => row.type === 'GLOBAL_ALIGNMENT_MIXED'), true);
  assert.equal(result.state.direction, 'NEUTRAL');
});

test('hard event or data risk can set HIGH_RISK without fabricating bearish direction', () => {
  const result = evaluatePremarketMarketState(input({
    evidence: [
      evidence({ key: 'local', direction: 'BULLISH', trend: 'TREND_UP' }),
      evidence({ key: 'breadth', block: 'breadth', direction: 'BULLISH' }),
      evidence({ key: 'settlement-risk', block: 'eventRisk', hardRisk: true }),
    ],
  }));
  assert.equal(result.state.direction, 'BULLISH');
  assert.equal(result.state.risk, 'HIGH_RISK');
});

test('past-only percentile requires minimum history and never includes current value implicitly', () => {
  const insufficient = classifyPastOnlyPercentile(100, Array.from({ length: 59 }, (_, index) => index));
  assert.equal(insufficient.bucket, 'UNAVAILABLE');
  assert.equal(insufficient.sampleSize, 59);

  const prior = Array.from({ length: 100 }, (_, index) => index + 1);
  const high = classifyPastOnlyPercentile(95, prior);
  assert.equal(high.bucket, 'EXTREME_POSITIVE');
  assert.equal(high.sampleSize, 100);
  assert.equal(high.percentile, 0.95);

  const low = classifyPastOnlyPercentile(10, prior);
  assert.equal(low.bucket, 'EXTREME_NEGATIVE');
  assert.equal(low.percentile, 0.1);
});
