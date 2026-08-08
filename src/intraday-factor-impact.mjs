function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function quantile(values, probability) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] == null
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = Number(left[index]) - leftMean;
    const rightDelta = Number(right[index]) - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    if (Math.abs(augmented[pivot][pivot]) < 1e-12) return null;
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= multiplier * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function fitRidge(rows, featureKeys, targetKey, { lambda = 1 } = {}) {
  const usable = rows.filter((row) => finite(row[targetKey])
    && featureKeys.every((key) => finite(row[key])));
  if (usable.length <= featureKeys.length + 2) return null;
  const means = Object.fromEntries(featureKeys.map((key) => [key, mean(usable.map((row) => row[key]))]));
  const scales = Object.fromEntries(featureKeys.map((key) => {
    const variance = mean(usable.map((row) => (Number(row[key]) - means[key]) ** 2));
    return [key, Math.sqrt(variance) || 1];
  }));
  const design = usable.map((row) => [
    1,
    ...featureKeys.map((key) => (Number(row[key]) - means[key]) / scales[key]),
  ]);
  const targets = usable.map((row) => Number(row[targetKey]));
  const width = featureKeys.length + 1;
  const gram = Array.from({ length: width }, () => Array(width).fill(0));
  const rhs = Array(width).fill(0);
  for (let index = 0; index < design.length; index += 1) {
    for (let left = 0; left < width; left += 1) {
      rhs[left] += design[index][left] * targets[index];
      for (let right = 0; right < width; right += 1) {
        gram[left][right] += design[index][left] * design[index][right];
      }
    }
  }
  for (let index = 1; index < width; index += 1) gram[index][index] += lambda;
  const coefficients = solveLinearSystem(gram, rhs);
  if (!coefficients) return null;
  return { featureKeys, means, scales, coefficients, lambda, trainingRows: usable.length };
}

export function predictRidge(model, row) {
  if (!model || !model.featureKeys.every((key) => finite(row[key]))) return null;
  return model.coefficients[0] + model.featureKeys.reduce(
    (sum, key, index) => sum
      + model.coefficients[index + 1] * ((Number(row[key]) - model.means[key]) / model.scales[key]),
    0,
  );
}

export function predictionMetrics(predictions) {
  const usable = predictions.filter((row) => finite(row.actual) && finite(row.predicted));
  if (!usable.length) {
    return { samples: 0, mae: null, rmse: null, correlation: null, signAccuracy: null };
  }
  const errors = usable.map((row) => Number(row.predicted) - Number(row.actual));
  return {
    samples: usable.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((value) => value ** 2))),
    correlation: correlation(
      usable.map((row) => row.actual),
      usable.map((row) => row.predicted),
    ),
    signAccuracy: usable.filter((row) => Math.sign(Number(row.actual)) === Math.sign(Number(row.predicted))).length
      / usable.length,
  };
}

function randomGenerator(seed = 20260729) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function movingBlockBootstrapImprovement(errorRows, {
  iterations = 2_000,
  blockSize = 5,
  seed = 20260729,
} = {}) {
  const differences = errorRows
    .filter((row) => finite(row.baselineAbsoluteError) && finite(row.candidateAbsoluteError))
    .map((row) => Number(row.baselineAbsoluteError) - Number(row.candidateAbsoluteError));
  if (!differences.length) {
    return {
      days: 0,
      observedAverageImprovement: null,
      ci95: [null, null],
      probabilityPositive: null,
      pValueOneSided: null,
      supported: false,
    };
  }
  const random = randomGenerator(seed);
  const averages = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let count = 0;
    while (count < differences.length) {
      const start = Math.floor(random() * differences.length);
      for (let offset = 0; offset < blockSize && count < differences.length; offset += 1, count += 1) {
        sum += differences[(start + offset) % differences.length];
      }
    }
    averages.push(sum / differences.length);
  }
  const lower = quantile(averages, 0.025);
  const upper = quantile(averages, 0.975);
  const probabilityPositive = averages.filter((value) => value > 0).length / averages.length;
  return {
    days: differences.length,
    observedAverageImprovement: mean(differences),
    ci95: [lower, upper],
    probabilityPositive,
    pValueOneSided: 1 - probabilityPositive,
    blockSize,
    iterations,
    supported: finite(lower) && lower > 0,
  };
}

function pairedPredictions(train, test, baselineKeys, candidateKey, targetKey, lambda) {
  const baselineModel = fitRidge(train, baselineKeys, targetKey, { lambda });
  const candidateModel = fitRidge(train, [...baselineKeys, candidateKey], targetKey, { lambda });
  if (!baselineModel || !candidateModel) return [];
  return test.map((row) => ({
    tradeDate: row.tradeDate,
    actual: row[targetKey],
    baseline: predictRidge(baselineModel, row),
    candidate: predictRidge(candidateModel, row),
  })).filter((row) => finite(row.actual) && finite(row.baseline) && finite(row.candidate));
}

function pairedMetrics(rows) {
  const baseline = predictionMetrics(rows.map((row) => ({ actual: row.actual, predicted: row.baseline })));
  const candidate = predictionMetrics(rows.map((row) => ({ actual: row.actual, predicted: row.candidate })));
  const maeImprovement = finite(baseline.mae) && baseline.mae > 0 && finite(candidate.mae)
    ? (baseline.mae - candidate.mae) / baseline.mae
    : null;
  return { baseline, candidate, maeImprovement };
}

export function analyzeIncrementalFactor(rows, {
  baselineKeys,
  candidateKey,
  targetKey,
  holdoutStartDate,
  minTrainDays = 60,
  testWindowDays = 12,
  lambda = 1,
  bootstrapIterations = 2_000,
  seed = 20260729,
} = {}) {
  const usable = rows.filter((row) => finite(row[targetKey])
    && finite(row[candidateKey])
    && baselineKeys.every((key) => finite(row[key])))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const development = usable.filter((row) => row.tradeDate < holdoutStartDate);
  const holdout = usable.filter((row) => row.tradeDate >= holdoutStartDate);
  const walkForwardPredictions = [];
  for (let start = minTrainDays; start < development.length; start += testWindowDays) {
    walkForwardPredictions.push(...pairedPredictions(
      development.slice(0, start),
      development.slice(start, Math.min(start + testWindowDays, development.length)),
      baselineKeys,
      candidateKey,
      targetKey,
      lambda,
    ));
  }
  const holdoutPredictions = pairedPredictions(
    development,
    holdout,
    baselineKeys,
    candidateKey,
    targetKey,
    lambda,
  );
  const developmentMetrics = pairedMetrics(walkForwardPredictions);
  const holdoutMetrics = pairedMetrics(holdoutPredictions);
  const bootstrap = movingBlockBootstrapImprovement(
    holdoutPredictions.map((row) => ({
      baselineAbsoluteError: Math.abs(Number(row.baseline) - Number(row.actual)),
      candidateAbsoluteError: Math.abs(Number(row.candidate) - Number(row.actual)),
    })),
    { iterations: bootstrapIterations, seed },
  );
  const developmentValues = development.map((row) => row[candidateKey]);
  const lowThreshold = quantile(developmentValues, 0.30);
  const highThreshold = quantile(developmentValues, 0.70);
  const low = holdout.filter((row) => Number(row[candidateKey]) <= lowThreshold);
  const high = holdout.filter((row) => Number(row[candidateKey]) >= highThreshold);
  const finalModel = fitRidge(development, [...baselineKeys, candidateKey], targetKey, { lambda });
  return {
    candidateKey,
    targetKey,
    sample: {
      total: usable.length,
      development: development.length,
      walkForwardPredictions: walkForwardPredictions.length,
      holdout: holdout.length,
      holdoutStartDate,
    },
    development: developmentMetrics,
    holdout: holdoutMetrics,
    bootstrap,
    descriptiveHoldoutContrast: {
      thresholdsFromDevelopment: { low: lowThreshold, high: highThreshold },
      lowSamples: low.length,
      highSamples: high.length,
      lowMeanTarget: mean(low.map((row) => row[targetKey])),
      highMeanTarget: mean(high.map((row) => row[targetKey])),
      highMinusLow: low.length && high.length
        ? mean(high.map((row) => row[targetKey])) - mean(low.map((row) => row[targetKey]))
        : null,
    },
    standardizedFactorCoefficient: finalModel?.coefficients?.at(-1) ?? null,
  };
}

export function applyHolmCorrection(studies, { alpha = 0.05 } = {}) {
  const eligible = studies
    .map((study, index) => ({ index, p: study.bootstrap?.pValueOneSided }))
    .filter((row) => finite(row.p))
    .sort((left, right) => left.p - right.p);
  let allPreviousPassed = true;
  for (let rank = 0; rank < eligible.length; rank += 1) {
    const row = eligible[rank];
    const threshold = alpha / (eligible.length - rank);
    const passed = allPreviousPassed && row.p <= threshold;
    allPreviousPassed = passed;
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

export function classifyFactor(studies) {
  const enough = studies.filter((study) => study.sample.holdout >= 20);
  if (!enough.length) return 'insufficient_holdout';
  const supported = enough.filter((study) => study.multipleTesting?.passed
    && Number(study.development.maeImprovement) > 0
    && Number(study.holdout.maeImprovement) > 0
    && study.bootstrap.supported);
  if (supported.some((study) => study.targetKey.startsWith('excursion'))) {
    return 'risk_filter_candidate_for_forward_validation';
  }
  if (supported.some((study) => study.targetKey.startsWith('return'))) {
    return 'direction_candidate_for_forward_validation';
  }
  if (enough.some((study) => Number(study.development.maeImprovement) > 0
    && Number(study.holdout.maeImprovement) > 0)) {
    return 'descriptive_observation_only';
  }
  return 'not_supported_or_unstable';
}
