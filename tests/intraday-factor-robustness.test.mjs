import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addPastOnlyPercentileRank,
  applyHolmToPermutation,
  blockPermutationTest,
  classifyRobustnessStudy,
  purgedWalkForward,
} from '../src/intraday-factor-robustness.mjs';

function datedRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    baseline: index % 5,
    factor: index,
    target: index * 0.01,
  })).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

test('past-only percentile rank never includes the current or future value', () => {
  const ranked = addPastOnlyPercentileRank(datedRows(25), 'factor', { minimumHistory: 20 });
  assert.equal(ranked[19].factorPastRank, null);
  assert.equal(ranked[20].factorPastRankHistoryCount, 20);
  assert.equal(ranked[20].factorPastRank, 1);
  const changedFuture = datedRows(25);
  changedFuture[24].factor = -999;
  const reranked = addPastOnlyPercentileRank(changedFuture, 'factor', { minimumHistory: 20 });
  assert.equal(reranked[20].factorPastRank, ranked[20].factorPastRank);
});

test('purged walk-forward leaves one date between training and test', () => {
  const ranked = addPastOnlyPercentileRank(datedRows(100), 'factor', { minimumHistory: 5 });
  const result = purgedWalkForward(ranked, {
    baselineKeys: ['baseline'],
    candidateKey: 'factorPastRank',
    targetKey: 'target',
    minimumTrainingDays: 40,
    testWindowDays: 10,
    purgeDays: 1,
  });
  assert.ok(result.predictions.length > 0);
  assert.ok(result.folds.every((fold) => fold.trainLastDate < fold.purgedDate));
  assert.ok(result.folds.every((fold) => fold.purgedDate < fold.testFirstDate));
});

test('block permutation test is deterministic', () => {
  const ranked = addPastOnlyPercentileRank(datedRows(100), 'factor', { minimumHistory: 5 });
  const options = {
    baselineKeys: ['baseline'],
    candidateKey: 'factorPastRank',
    targetKey: 'target',
    observedImprovement: 0.1,
    iterations: 50,
    seed: 17,
    minimumTrainingDays: 40,
    testWindowDays: 10,
  };
  assert.deepEqual(blockPermutationTest(ranked, options), blockPermutationTest(ranked, options));
});

test('Holm and verdict require meaningful, stable and corrected evidence', () => {
  const studies = [
    { permutation: { empiricalPValueOneSided: 0.001 } },
    { permutation: { empiricalPValueOneSided: 0.06 } },
  ];
  applyHolmToPermutation(studies);
  assert.equal(studies[0].multipleTesting.passed, true);
  assert.equal(studies[1].multipleTesting.passed, false);
  assert.equal(classifyRobustnessStudy({
    walkForward: {
      predictions: Array(24).fill({}),
      metrics: { relativeMaeImprovement: 0.02 },
      positiveFoldShare: 2 / 3,
    },
    multipleTesting: { passed: true },
  }), 'historical_robustness_signal_requires_forward');
});

test('generated wave-two evidence remains time-safe, historical-only and non-promotable', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const outputDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-factor-robustness');
  const report = JSON.parse(fs.readFileSync(
    path.join(outputDir, 'factor-robustness-report.json'),
    'utf8',
  ));
  const rows = fs.readFileSync(path.join(outputDir, 'ranked-daily.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(report.researchOnly, true);
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.formalWeightsChanged, false);
  assert.equal(report.freshHoldout, false);
  assert.equal(report.dataQuality.timeViolations, 0);
  assert.deepEqual(report.promotableFactors, []);
  assert.deepEqual(report.forwardObservationCandidates, []);
  assert.equal(rows.length, 135);
  assert.equal(new Set(rows.map((row) => row.tradeDate)).size, 135);
  assert.ok(rows.every((row) => row.factorSourceDate < row.tradeDate));
  const rankKeys = report.factorResults.map((factor) => `${factor.key}PastRank`);
  assert.ok(rows.every((row) => rankKeys.every((key) =>
    row[key] == null || Number(row[`${key}HistoryCount`]) >= 20)));
});
