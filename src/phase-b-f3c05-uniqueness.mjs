import { rngFromSeedMaterial, sha256Hex, jcsNfc } from './phase-b-b0-v4-core.mjs';

export const MINIMUM_COMMON_PAIRED_SESSIONS = 100;
export const MINIMUM_INCREMENTAL_IMPROVEMENT = 0.05;

export function digest(value) {
  return sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function solve(matrix, vector) {
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < a.length; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-12) throw new Error('RIDGE_MATRIX_SINGULAR');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const scale = a[column][column];
    for (let j = column; j <= matrix.length; j += 1) a[column][j] /= scale;
    for (let row = 0; row < a.length; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= matrix.length; j += 1) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map((row) => row[matrix.length]);
}

export function fitRidgeRegression(rows, featureKeys, { lambda = 1 } = {}) {
  if (!rows.length) throw new Error('RIDGE_EMPTY_TRAINING_SET');
  const scaler = featureKeys.map((key) => {
    const values = rows.map((row) => row[key]);
    const center = mean(values);
    const variance = mean(values.map((value) => (value - center) ** 2));
    return { key, center, scale: Math.sqrt(variance) || 1 };
  });
  const x = rows.map((row) => [1, ...scaler.map(({ key, center, scale }) => (row[key] - center) / scale)]);
  const y = rows.map((row) => row.target);
  const width = x[0].length;
  const gram = Array.from({ length: width }, () => Array(width).fill(0));
  const rhs = Array(width).fill(0);
  for (let i = 0; i < x.length; i += 1) {
    for (let r = 0; r < width; r += 1) {
      rhs[r] += x[i][r] * y[i];
      for (let c = 0; c < width; c += 1) gram[r][c] += x[i][r] * x[i][c];
    }
  }
  for (let i = 1; i < width; i += 1) gram[i][i] += lambda;
  const coefficients = solve(gram, rhs);
  return {
    lambda, scaler, coefficients,
    predict(row) { return coefficients[0] + scaler.reduce((sum, item, index) => sum + coefficients[index + 1] * ((row[item.key] - item.center) / item.scale), 0); },
  };
}

export function evaluatePurgedWalkForward(rows, foldOrder) {
  const predictions = [];
  const foldResults = [];
  for (const foldId of foldOrder) {
    const test = rows.filter((row) => row.foldId === foldId);
    if (!test.length) continue;
    const testStart = test[0].tradeDate;
    const prior = rows.filter((row) => row.tradeDate < testStart);
    const purgeDate = prior.at(-1)?.tradeDate ?? null;
    const train = prior.filter((row) => row.tradeDate !== purgeDate);
    if (train.length < 20) {
      foldResults.push({ foldId, status: 'INSUFFICIENT_META_TRAINING_HISTORY', trainCount: train.length, testCount: test.length, purgeDate });
      continue;
    }
    const m0 = fitRidgeRegression(train, ['f3c01Score'], { lambda: 1 });
    const m1 = fitRidgeRegression(train, ['f3c01Score', 'f3c05Score'], { lambda: 1 });
    const foldRows = test.map((row) => ({ ...row, m0Prediction: m0.predict(row), m1Prediction: m1.predict(row) }));
    const metrics = lossMetrics(foldRows);
    predictions.push(...foldRows);
    foldResults.push({ foldId, status: 'EVALUATED', trainCount: train.length, testCount: test.length, purgeDate, ...metrics, m0ModelHash: digest({ scaler: m0.scaler, coefficients: m0.coefficients }), m1ModelHash: digest({ scaler: m1.scaler, coefficients: m1.coefficients }) });
  }
  return { predictions, foldResults, aggregate: lossMetrics(predictions) };
}

export function lossMetrics(rows) {
  if (!rows.length) return { count: 0, m0Rmse: null, m1Rmse: null, incrementalImprovement: null, m0Mae: null, m1Mae: null, m0RankCorrelation: null, m1RankCorrelation: null };
  const m0Squared = rows.map((row) => (row.target - row.m0Prediction) ** 2);
  const m1Squared = rows.map((row) => (row.target - row.m1Prediction) ** 2);
  const m0Rmse = Math.sqrt(mean(m0Squared));
  const m1Rmse = Math.sqrt(mean(m1Squared));
  return {
    count: rows.length, m0Rmse, m1Rmse,
    incrementalImprovement: (m0Rmse - m1Rmse) / m0Rmse,
    m0Mae: mean(rows.map((row) => Math.abs(row.target - row.m0Prediction))),
    m1Mae: mean(rows.map((row) => Math.abs(row.target - row.m1Prediction))),
    m0RankCorrelation: spearman(rows.map((row) => row.target), rows.map((row) => row.m0Prediction)),
    m1RankCorrelation: spearman(rows.map((row) => row.target), rows.map((row) => row.m1Prediction)),
  };
}

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) output[sorted[index].index] = rank;
    start = end;
  }
  return output;
}

function pearson(a, b) {
  const ma = mean(a); const mb = mean(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : null;
}

export function spearman(a, b) { return pearson(ranks(a), ranks(b)); }

function blockSample(rows, blockLength, rng) {
  const output = [];
  const starts = Math.max(1, rows.length - blockLength + 1);
  while (output.length < rows.length) {
    const start = rng.drawIndex(starts);
    for (let index = 0; index < blockLength && output.length < rows.length; index += 1) output.push(rows[start + index]);
  }
  return output;
}

function percentile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function movingBlockBootstrap(rows, freezeHash, iterations = 2000) {
  return [5, 10].map((blockLength) => {
    const values = [];
    for (let replicateIndex = 0; replicateIndex < iterations; replicateIndex += 1) {
      const { rng } = rngFromSeedMaterial({ schemaVersion: 'F3C05_RNG_SEED_V1', candidateId: 'F3C05', freezeHash, purpose: 'MOVING_BLOCK_BOOTSTRAP', blockLength, replicateIndex, streamId: 'PAIRED_LOSS_ROWS' });
      values.push(lossMetrics(blockSample(rows, blockLength, rng)).incrementalImprovement);
    }
    return { blockLength, iterations, lower95: percentile(values, 0.025), median: percentile(values, 0.5), upper95: percentile(values, 0.975), replicateHash: digest(values) };
  });
}

export function withinFoldScorePermutation(rows, foldOrder, freezeHash, iterations = 2000) {
  const observed = evaluatePurgedWalkForward(rows, foldOrder).aggregate.incrementalImprovement;
  let asGoodOrBetter = 0;
  const values = [];
  for (let replicateIndex = 0; replicateIndex < iterations; replicateIndex += 1) {
    const copy = rows.map((row) => ({ ...row }));
    for (const foldId of foldOrder) {
      const indices = copy.map((row, index) => row.foldId === foldId ? index : -1).filter((index) => index >= 0);
      const scores = indices.map((index) => copy[index].f3c05Score);
      const { rng } = rngFromSeedMaterial({ schemaVersion: 'F3C05_RNG_SEED_V1', candidateId: 'F3C05', freezeHash, purpose: 'WITHIN_FOLD_SCORE_PERMUTATION', foldId, replicateIndex, streamId: 'F3C05_SCORE' });
      for (let index = scores.length - 1; index > 0; index -= 1) { const selected = rng.drawIndex(index + 1); [scores[index], scores[selected]] = [scores[selected], scores[index]]; }
      indices.forEach((rowIndex, index) => { copy[rowIndex].f3c05Score = scores[index]; });
    }
    const value = evaluatePurgedWalkForward(copy, foldOrder).aggregate.incrementalImprovement;
    values.push(value);
    if (value >= observed) asGoodOrBetter += 1;
  }
  return { iterations, observed, pValue: (1 + asGoodOrBetter) / (iterations + 1), replicateHash: digest(values) };
}

export function concentrationCheck(rows) {
  const ranked = [...rows].map((row) => ({ tradeDate: row.tradeDate, incrementalSquaredError: (row.target - row.m0Prediction) ** 2 - (row.target - row.m1Prediction) ** 2 })).sort((a, b) => b.incrementalSquaredError - a.incrementalSquaredError);
  const removals = [1, 3, 5].map((count) => ({ count, removedDates: ranked.slice(0, count).map((row) => row.tradeDate), metrics: lossMetrics(rows.filter((row) => !new Set(ranked.slice(0, count).map((item) => item.tradeDate)).has(row.tradeDate))) }));
  return { rankedTop5: ranked.slice(0, 5), removals, conclusionDoesNotReverse: removals.every((row) => row.metrics.incrementalImprovement > 0) };
}
