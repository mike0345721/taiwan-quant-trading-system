import test from 'node:test';
import assert from 'node:assert/strict';
import { runTargetStudy, classificationMetrics } from '../src/multi-target-research.mjs';

function paths(count = 360) {
  return Array.from({ length: count }, (_, index) => ({
    signalDate: `d${index}`, absoluteMovePct: index % 4 === 0 ? 3 : 0.5, gapPct: index % 5 === 0 ? 2 : 0.2,
    efficiency: index % 3 === 0 ? 0.95 : 0.2, atrPct: index % 4 === 0 ? 2 : 0.5,
    foreignFuturesDelta5d: index % 4 === 0 ? 10_000 : 100, marketOiDelta1d: index % 4 === 0 ? 5_000 : 50,
    optionPc: index % 4 === 0 ? 2 : 1, entrySoxReturnPct: index % 4 === 0 ? 3 : 0.1,
    entryNdxReturnPct: 0.1, entryUsdtwdReturnPct: 0.05,
    signalSoxReturnPct: index % 4 === 0 ? 2 : 0.1, signalNdxReturnPct: 0.1, signalUsdtwdReturnPct: 0.05,
  }));
}

test('Multi-target study keeps final holdout separate and returns group ablations', () => {
  const result = runTargetStudy(paths(), 'large_move', { horizon: 1, minTrain: 120, testWindow: 20, holdoutPct: 0.2 });
  assert.ok(result.development.samples > 0);
  assert.equal(result.ablations.length, 5);
  assert.ok(result.holdout.auc > 0.5);
  assert.equal(result.holdout.confidence.iterations, 500);
});

test('Classification lift compares high-score precision with target base rate', () => {
  const metrics = classificationMetrics([
    { actual: 1, score: 80, value: 3 }, { actual: 0, score: 20, value: 1 },
    { actual: 1, score: 60, value: 2 }, { actual: 0, score: 10, value: 0.5 },
  ]);
  assert.equal(metrics.baseRate, 0.5);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.lift, 2);
});
