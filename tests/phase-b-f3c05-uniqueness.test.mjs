import test from 'node:test';
import assert from 'node:assert/strict';
import { concentrationCheck, evaluatePurgedWalkForward, fitRidgeRegression, lossMetrics, movingBlockBootstrap, withinFoldScorePermutation } from '../src/phase-b-f3c05-uniqueness.mjs';

function rows() {
  const output = [];
  for (let index = 0; index < 120; index += 1) {
    const f3c01Score = Math.sin(index / 7);
    const f3c05Score = Math.cos(index / 5);
    output.push({ tradeDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`, foldId: `WF${String(Math.floor(index / 30) + 1).padStart(2, '0')}`, f3c01Score, f3c05Score, target: 2 * f3c01Score + 3 * f3c05Score });
  }
  return output.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

test('ridge regression uses train-only scaling and deterministic lambda one fit', () => {
  const data = rows().slice(0, 60); const first = fitRidgeRegression(data, ['f3c01Score', 'f3c05Score'], { lambda: 1 }); const second = fitRidgeRegression(data, ['f3c01Score', 'f3c05Score'], { lambda: 1 });
  assert.deepEqual(first.scaler, second.scaler); assert.deepEqual(first.coefficients, second.coefficients); assert.equal(first.predict(data[0]), second.predict(data[0]));
});

test('purged meta walk-forward compares M0 with M1 without interactions', () => {
  const result = evaluatePurgedWalkForward(rows(), ['WF01', 'WF02', 'WF03', 'WF04']);
  assert.equal(result.foldResults[0].status, 'INSUFFICIENT_META_TRAINING_HISTORY');
  assert.equal(result.predictions.length, 90);
  assert.ok(result.aggregate.incrementalImprovement > 0.05);
});

test('loss metrics, concentration, bootstrap and permutation are deterministic', () => {
  const data = rows(); const first = evaluatePurgedWalkForward(data, ['WF01', 'WF02', 'WF03', 'WF04']); const second = evaluatePurgedWalkForward(data, ['WF01', 'WF02', 'WF03', 'WF04']);
  assert.deepEqual(first, second); assert.deepEqual(lossMetrics(first.predictions), first.aggregate);
  const concentration = concentrationCheck(first.predictions); assert.equal(concentration.removals.length, 3);
  const bootA = movingBlockBootstrap(first.predictions, 'test-freeze', 20); const bootB = movingBlockBootstrap(first.predictions, 'test-freeze', 20); assert.deepEqual(bootA, bootB);
  const permA = withinFoldScorePermutation(data, ['WF01', 'WF02', 'WF03', 'WF04'], 'test-freeze', 20); const permB = withinFoldScorePermutation(data, ['WF01', 'WF02', 'WF03', 'WF04'], 'test-freeze', 20); assert.deepEqual(permA, permB);
});
