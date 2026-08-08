import {
  fitRidge,
  predictRidge,
  predictionMetrics,
} from './intraday-factor-impact.mjs';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function randomGenerator(seed = 20260729) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function addPastOnlyPercentileRank(rows, factorKey, {
  outputKey = `${factorKey}PastRank`,
  minimumHistory = 20,
} = {}) {
  const history = [];
  return [...rows]
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
    .map((row) => {
      let rank = null;
      if (finite(row[factorKey]) && history.length >= minimumHistory) {
        const current = Number(row[factorKey]);
        const below = history.filter((value) => value < current).length;
        const equal = history.filter((value) => value === current).length;
        rank = (below + 0.5 * equal) / history.length;
      }
      const ranked = {
        ...row,
        [outputKey]: rank,
        [`${outputKey}HistoryCount`]: history.length,
      };
      if (finite(row[factorKey])) history.push(Number(row[factorKey]));
      return ranked;
    });
}

function pairedMetrics(rows) {
  const baseline = predictionMetrics(rows.map((row) => ({
    actual: row.actual,
    predicted: row.baseline,
  })));
  const candidate = predictionMetrics(rows.map((row) => ({
    actual: row.actual,
    predicted: row.candidate,
  })));
  const relativeMaeImprovement = finite(baseline.mae) && Number(baseline.mae) > 0
    && finite(candidate.mae)
    ? (Number(baseline.mae) - Number(candidate.mae)) / Number(baseline.mae)
    : null;
  return { baseline, candidate, relativeMaeImprovement };
}

export function purgedWalkForward(rows, {
  baselineKeys,
  candidateKey,
  targetKey,
  minimumTrainingDays = 60,
  testWindowDays = 12,
  purgeDays = 1,
  lambda = 1,
} = {}) {
  const usable = rows
    .filter((row) => finite(row[targetKey])
      && finite(row[candidateKey])
      && baselineKeys.every((key) => finite(row[key])))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const predictions = [];
  const folds = [];
  for (let testStart = minimumTrainingDays; testStart < usable.length; testStart += testWindowDays) {
    const trainEnd = Math.max(0, testStart - purgeDays);
    const train = usable.slice(0, trainEnd);
    const test = usable.slice(testStart, Math.min(testStart + testWindowDays, usable.length));
    const baselineModel = fitRidge(train, baselineKeys, targetKey, { lambda });
    const candidateModel = fitRidge(train, [...baselineKeys, candidateKey], targetKey, { lambda });
    if (!baselineModel || !candidateModel || !test.length) continue;
    const foldPredictions = test.map((row) => ({
      tradeDate: row.tradeDate,
      actual: row[targetKey],
      baseline: predictRidge(baselineModel, row),
      candidate: predictRidge(candidateModel, row),
    })).filter((row) => finite(row.actual) && finite(row.baseline) && finite(row.candidate));
    const metrics = pairedMetrics(foldPredictions);
    predictions.push(...foldPredictions);
    folds.push({
      trainFirstDate: train[0]?.tradeDate ?? null,
      trainLastDate: train.at(-1)?.tradeDate ?? null,
      trainDays: train.length,
      purgedDate: purgeDays ? usable[testStart - 1]?.tradeDate ?? null : null,
      testFirstDate: test[0]?.tradeDate ?? null,
      testLastDate: test.at(-1)?.tradeDate ?? null,
      testDays: foldPredictions.length,
      relativeMaeImprovement: metrics.relativeMaeImprovement,
    });
  }
  const metrics = pairedMetrics(predictions);
  const positiveFolds = folds.filter((fold) => Number(fold.relativeMaeImprovement) > 0).length;
  return {
    usableDays: usable.length,
    predictions,
    folds,
    metrics,
    positiveFolds,
    positiveFoldShare: folds.length ? positiveFolds / folds.length : null,
  };
}

function shuffledBlocks(values, blockSize, random) {
  const blocks = [];
  for (let index = 0; index < values.length; index += blockSize) {
    blocks.push(values.slice(index, index + blockSize));
  }
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [blocks[index], blocks[swap]] = [blocks[swap], blocks[index]];
  }
  return blocks.flat();
}

export function blockPermutationTest(rows, {
  baselineKeys,
  candidateKey,
  targetKey,
  observedImprovement,
  iterations = 1_000,
  blockSize = 5,
  seed = 20260729,
  minimumTrainingDays = 60,
  testWindowDays = 12,
  purgeDays = 1,
  lambda = 1,
} = {}) {
  if (!finite(observedImprovement)) {
    return {
      iterations,
      blockSize,
      empiricalPValueOneSided: null,
      nullMeanImprovement: null,
      nullMaximumImprovement: null,
    };
  }
  const random = randomGenerator(seed);
  const values = rows.map((row) => row[candidateKey]);
  const nullImprovements = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const permuted = shuffledBlocks(values, blockSize, random);
    const placeboRows = rows.map((row, index) => ({ ...row, [candidateKey]: permuted[index] }));
    const result = purgedWalkForward(placeboRows, {
      baselineKeys,
      candidateKey,
      targetKey,
      minimumTrainingDays,
      testWindowDays,
      purgeDays,
      lambda,
    });
    if (finite(result.metrics.relativeMaeImprovement)) {
      nullImprovements.push(Number(result.metrics.relativeMaeImprovement));
    }
  }
  const exceedances = nullImprovements
    .filter((value) => value >= Number(observedImprovement)).length;
  return {
    iterations: nullImprovements.length,
    blockSize,
    empiricalPValueOneSided: (1 + exceedances) / (nullImprovements.length + 1),
    nullMeanImprovement: mean(nullImprovements),
    nullMaximumImprovement: nullImprovements.length ? Math.max(...nullImprovements) : null,
  };
}

export function applyHolmToPermutation(studies, { alpha = 0.05 } = {}) {
  const eligible = studies
    .map((study, index) => ({ index, p: study.permutation?.empiricalPValueOneSided }))
    .filter((row) => finite(row.p))
    .sort((left, right) => left.p - right.p);
  let previousPassed = true;
  for (let rank = 0; rank < eligible.length; rank += 1) {
    const row = eligible[rank];
    const threshold = alpha / (eligible.length - rank);
    const passed = previousPassed && row.p <= threshold;
    previousPassed = passed;
    studies[row.index].multipleTesting = {
      method: 'Holm',
      familySize: eligible.length,
      rank: rank + 1,
      alpha,
      threshold,
      passed,
    };
  }
  return studies;
}

export function classifyRobustnessStudy(study) {
  if (study.walkForward.predictions.length < 24) return 'insufficient_oos';
  const improvement = Number(study.walkForward.metrics.relativeMaeImprovement);
  const foldShare = Number(study.walkForward.positiveFoldShare);
  if (improvement >= 0.01 && foldShare >= 0.60 && study.multipleTesting?.passed) {
    return 'historical_robustness_signal_requires_forward';
  }
  if (improvement > 0 && foldShare >= 0.50) return 'descriptive_robustness_only';
  return 'not_supported_or_unstable';
}
