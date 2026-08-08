import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPositionStates, trainPositionThresholds, analyzePositionStates } from '../src/position-state-research.mjs';

function row(index) {
  return {
    tradeDate: `2026-01-${String(index + 1).padStart(2, '0')}`,
    foreignSpot3d: index, foreignShortDelta3d: index, marketOiDelta3d: index,
    marginBalanceDelta3dE: index, txReturn3d: -0.01,
    nextTxOpen: 20000, futureBars: Array.from({ length: 5 }, (_, day) => ({ txContract: '202601', high: 20020 + day, low: 19990, close: 20010 + day })),
  };
}

test('classifies a hedged accumulation candidate from observable components', () => {
  const training = Array.from({ length: 10 }, (_, index) => row(index));
  const thresholds = trainPositionThresholds(training);
  const states = classifyPositionStates({ ...row(9), txReturn3d: -0.01 }, thresholds);
  assert.ok(states.includes('hedged_accumulation_candidate'));
});

test('analysis keeps threshold fitting separate from holdout evaluation', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ ...row(index), tradeDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}` }));
  const report = analyzePositionStates(rows);
  assert.equal(report.coverage.trainingRows, 42);
  assert.equal(report.coverage.holdoutRows, 18);
  assert.equal(report.methodology.thresholdRule.includes('first 70%'), true);
});
