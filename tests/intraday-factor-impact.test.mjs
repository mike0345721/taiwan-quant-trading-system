import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeIncrementalFactor,
  applyHolmCorrection,
  fitRidge,
  movingBlockBootstrapImprovement,
  predictRidge,
} from '../src/intraday-factor-impact.mjs';

test('ridge model learns a deterministic linear relationship without future state', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    x: index,
    y: 2 + 3 * index,
  }));
  const model = fitRidge(rows, ['x'], 'y', { lambda: 0 });
  assert.ok(model);
  assert.ok(Math.abs(predictRidge(model, { x: 31 }) - 95) < 1e-8);
});

test('incremental factor analysis uses chronological development and holdout dates', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    tradeDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
    baseline: index % 7,
    factor: index,
    target: index * 0.01,
  })).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const holdoutStartDate = rows[80].tradeDate;
  const result = analyzeIncrementalFactor(rows, {
    baselineKeys: ['baseline'],
    candidateKey: 'factor',
    targetKey: 'target',
    holdoutStartDate,
    minTrainDays: 40,
    testWindowDays: 10,
    bootstrapIterations: 200,
  });
  assert.equal(result.sample.development, 80);
  assert.equal(result.sample.holdout, 20);
  assert.ok(result.holdout.candidate.mae < result.holdout.baseline.mae);
});

test('moving block bootstrap is deterministic and reports paired improvement', () => {
  const rows = Array.from({ length: 30 }, () => ({
    baselineAbsoluteError: 2,
    candidateAbsoluteError: 1,
  }));
  const first = movingBlockBootstrapImprovement(rows, { iterations: 200, seed: 7 });
  const second = movingBlockBootstrapImprovement(rows, { iterations: 200, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.supported, true);
  assert.equal(first.observedAverageImprovement, 1);
});

test('Holm correction prevents later tests passing after the first rejection', () => {
  const studies = [
    { bootstrap: { pValueOneSided: 0.01 } },
    { bootstrap: { pValueOneSided: 0.03 } },
    { bootstrap: { pValueOneSided: 0.04 } },
  ];
  applyHolmCorrection(studies);
  assert.equal(studies[0].multipleTesting.passed, true);
  assert.equal(studies[1].multipleTesting.passed, false);
  assert.equal(studies[2].multipleTesting.passed, false);
});

test('generated factor dataset preserves time safety and research-only boundary', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const outputDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-factor-impact');
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'factor-impact-report.json'), 'utf8'));
  const rows = fs.readFileSync(path.join(outputDir, 'aligned-daily.ndjson'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(report.researchOnly, true);
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.formalWeightsChanged, false);
  assert.equal(report.dataQuality.timeViolations, 0);
  assert.equal(rows.length, 135);
  assert.equal(new Set(rows.map((row) => row.tradeDate)).size, 135);
  assert.ok(rows.every((row) => row.researchOnly === true));
  assert.ok(rows.every((row) => row.executionAuthorized === false));
  assert.ok(rows.every((row) =>
    Object.values(row.factorSourceDates ?? {})
      .filter(Boolean)
      .every((sourceDate) => sourceDate < row.tradeDate)));
});
