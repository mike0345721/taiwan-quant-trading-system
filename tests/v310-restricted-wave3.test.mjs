import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICE_BASELINE_KEYS,
  HYPOTHESES,
  buildRestrictedBaselineRows,
  addHypothesisFeatures,
  eventWalkForward,
  blockPermutationEventTest,
  applyHolmFamily,
} from '../src/v310-restricted-wave3.mjs';

function isoDate(index) {
  return new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
}

function day(index, contract = 'TXFA5') {
  const tradeDate = isoDate(index);
  const start = Date.parse(`${tradeDate}T00:45:00Z`);
  const base = 20_000 + index * 10;
  return {
    tradeDate,
    contract,
    session: 'day',
    timeframe: '5m',
    bars: Array.from({ length: 60 }, (_, barIndex) => {
      const open = base + barIndex;
      return {
        timestamp: new Date(start + barIndex * 300_000).toISOString(),
        open,
        high: open + 3,
        low: open - 2,
        close: open + (barIndex % 2 ? -1 : 2),
        volume: 100 + barIndex,
      };
    }),
  };
}

test('restricted price baseline uses only information available by 09:00', () => {
  const days = Array.from({ length: 30 }, (_, index) =>
    day(index, index === 15 ? 'TXFB5' : index > 15 ? 'TXFB5' : 'TXFA5'));
  const aligned = days.map((item, index) => ({
    tradeDate: item.tradeDate,
    decisionAvailableAt: `${item.tradeDate}T01:00:00.000Z`,
    factorSourceDate: isoDate(index - 1),
    termSpreadBps: index,
    skew25d: index / 100,
    marketOiDeltaPct: index / 1_000,
  }));
  const rows = buildRestrictedBaselineRows(days, aligned);
  assert.equal(rows.length, 30);
  assert.equal(rows[15].gapReturn, null);
  assert.equal(rows[15].openingLocationPrevRange, null);
  assert.ok(Number.isFinite(rows[20].priorRv20) && rows[20].priorRv20 >= 0);
  assert.ok(rows[20].openingPathEfficiency >= 0 && rows[20].openingPathEfficiency <= 1);
  assert.ok(rows[20].volatilityExpansion60Severity > 0);
  assert.equal(rows[20].decisionAvailableAt, `${rows[20].tradeDate}T01:00:00.000Z`);
  assert.equal(rows[20].researchOnly, true);
  assert.equal(rows[20].executionAuthorized, false);
  assert.deepEqual(PRICE_BASELINE_KEYS.includes('logOpeningVolume'), false);
  assert.deepEqual(PRICE_BASELINE_KEYS.includes('closeVsVwapReturn'), false);
});

test('restricted event study keeps three nested models and a one-day purge', () => {
  const hypothesis = HYPOTHESES[0];
  let rows = Array.from({ length: 110 }, (_, index) => {
    const base = Object.fromEntries(
      PRICE_BASELINE_KEYS.map((key, keyIndex) => [key, (index + keyIndex) / 100]),
    );
    const rank = (index % 20) / 19;
    return {
      tradeDate: isoDate(index),
      ...base,
      termSpreadBps: index,
      skew25d: index / 100,
      marketOiDeltaPct: index / 1_000,
      priorRv20: 0.01 + index / 100_000,
      largeMove60Severity: rank > 0.7 ? 0.03 : 0.002,
      downsideTail60Severity: rank > 0.8 ? 0.02 : 0.001,
      extremeExcursion60Severity: rank > 0.8 ? 0.04 : 0.003,
      volatilityExpansion60Severity: rank > 0.7 ? 0.025 : 0.002,
    };
  });
  rows = addHypothesisFeatures(rows);
  const result = eventWalkForward(rows, hypothesis, 'largeMove60');
  assert.ok(result.folds.length >= 2);
  assert.equal(result.folds[0].trainDays, 60);
  assert.equal(
    result.folds[0].purgedDate < result.folds[0].testFirstDate,
    true,
  );
  assert.equal(result.metrics.price.samples, result.metrics.interaction.samples);
  assert.ok(result.metrics.interaction.brier >= 0);
  const permutation = blockPermutationEventTest(
    rows, hypothesis, 'largeMove60', result.relativeBrierImprovement,
    { iterations: 10, blockSize: 5, seed: 7 },
  );
  assert.equal(permutation.iterations, 10);
  assert.ok(permutation.pValueOneSided > 0 && permutation.pValueOneSided <= 1);
  const family = [
    { permutation: { pValueOneSided: 0.01 } },
    { permutation: { pValueOneSided: 0.03 } },
    { permutation: { pValueOneSided: 0.20 } },
  ];
  applyHolmFamily(family);
  assert.equal(family[0].multipleTesting.familySize, 3);
  assert.equal(family.filter((item) => item.multipleTesting.passed).length, 1);
});
