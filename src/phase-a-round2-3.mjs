import crypto from 'node:crypto';

import { quantile, spearman } from './phase-a-univariate.mjs';

export const PHASE_A_METHODS = Object.freeze({
  schemaVersion: 'phase-a-round2-3-methods-v1',
  redundancyAbsoluteSpearman: 0.85,
  redundancyMinimumCommonRows: 120,
  ridgeLambda: 1,
  logisticIterations: 40,
  huberIterations: 30,
  huberDelta: 1.345,
  expandingMinimumTrainDays: 360,
  expandingPurgeDays: 1,
  expandingTestDays: 60,
  rollingTrainDays: 252,
  rollingPurgeDays: 1,
  rollingTestDays: 63,
  round2PlaceboIterations: 1000,
  round2RandomFeatures: 200,
  round2BlockSize: 5,
  round3Iterations: 2000,
  round3BlockSizes: [5, 10],
  alpha: 0.05,
  minimumPositiveFoldShare: 0.60,
  maximumExtremeContributionShare: 0.40,
  gamKnots: [0.25, 0.50, 0.75],
  optimizedOnTradingTarget: false,
});

const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const average = (values) => values.length
  ? values.reduce((sum, value) => sum + Number(value), 0) / values.length
  : null;

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function seededRandom(seedText) {
  let state = crypto.createHash('sha256').update(seedText).digest().readUInt32LE(0);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * random());
}

function shuffled(values, random) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [output[index], output[selected]] = [output[selected], output[index]];
  }
  return output;
}

function blockPermutation(values, blockSize, random) {
  const blocks = [];
  for (let start = 0; start < values.length; start += blockSize) {
    blocks.push(values.slice(start, Math.min(start + blockSize, values.length)));
  }
  return shuffled(blocks, random).flat().slice(0, values.length);
}

function blockBootstrapIndexes(length, blockSize, random) {
  const indexes = [];
  while (indexes.length < length) {
    const start = Math.floor(random() * Math.max(1, length - blockSize + 1));
    for (let offset = 0; offset < blockSize && indexes.length < length; offset += 1) {
      indexes.push(start + offset);
    }
  }
  return indexes;
}

function solveLinear(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) augmented[pivot][column] = 1e-12;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let cell = column; cell <= size; cell += 1) augmented[column][cell] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= size; cell += 1) {
        augmented[row][cell] -= factor * augmented[column][cell];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function normalEquations(matrix, target, weights, lambda) {
  const width = matrix[0].length;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (let row = 0; row < matrix.length; row += 1) {
    const weight = weights?.[row] ?? 1;
    for (let left = 0; left < width; left += 1) {
      xty[left] += weight * matrix[row][left] * target[row];
      for (let right = 0; right < width; right += 1) {
        xtx[left][right] += weight * matrix[row][left] * matrix[row][right];
      }
    }
  }
  for (let index = 1; index < width; index += 1) xtx[index][index] += lambda;
  xtx[0][0] += 1e-9;
  return solveLinear(xtx, xty);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function standardizer(rows) {
  const width = rows[0].length;
  const means = Array.from({ length: width }, (_, column) => average(rows.map((row) => row[column])));
  const sds = means.map((mean, column) => {
    const variance = average(rows.map((row) => (row[column] - mean) ** 2));
    return Math.sqrt(variance) || 1;
  });
  return {
    means,
    sds,
    transform: (row) => row.map((value, index) => (value - means[index]) / sds[index]),
  };
}

function fitRidge(trainX, trainY, lambda = PHASE_A_METHODS.ridgeLambda) {
  const scaler = standardizer(trainX);
  const design = trainX.map((row) => [1, ...scaler.transform(row)]);
  const coefficients = normalEquations(design, trainY, null, lambda);
  return { predict: (row) => dot([1, ...scaler.transform(row)], coefficients), coefficients, scaler };
}

function fitHuber(trainX, trainY) {
  const scaler = standardizer(trainX);
  const design = trainX.map((row) => [1, ...scaler.transform(row)]);
  let coefficients = normalEquations(design, trainY, null, PHASE_A_METHODS.ridgeLambda);
  for (let iteration = 0; iteration < PHASE_A_METHODS.huberIterations; iteration += 1) {
    const residuals = trainY.map((value, index) => value - dot(design[index], coefficients));
    const scale = (quantile(residuals.map(Math.abs), 0.5) || 1e-9) / 0.6745;
    const limit = PHASE_A_METHODS.huberDelta * scale;
    const weights = residuals.map((value) => Math.abs(value) <= limit ? 1 : limit / Math.abs(value));
    coefficients = normalEquations(design, trainY, weights, PHASE_A_METHODS.ridgeLambda);
  }
  return { predict: (row) => dot([1, ...scaler.transform(row)], coefficients), coefficients, scaler };
}

function logistic(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-Math.min(value, 40)));
  const exp = Math.exp(Math.max(value, -40));
  return exp / (1 + exp);
}

function fitRidgeLogistic(trainX, trainY) {
  const scaler = standardizer(trainX);
  const design = trainX.map((row) => [1, ...scaler.transform(row)]);
  let coefficients = Array(design[0].length).fill(0);
  for (let iteration = 0; iteration < PHASE_A_METHODS.logisticIterations; iteration += 1) {
    const probabilities = design.map((row) => logistic(dot(row, coefficients)));
    const weights = probabilities.map((value) => Math.max(1e-5, value * (1 - value)));
    const working = probabilities.map((value, index) => (
      dot(design[index], coefficients) + (trainY[index] - value) / weights[index]
    ));
    coefficients = normalEquations(design, working, weights, PHASE_A_METHODS.ridgeLambda);
  }
  return { predict: (row) => logistic(dot([1, ...scaler.transform(row)], coefficients)), coefficients, scaler };
}

export function fitRidgeLogisticAudit(trainX, trainY) {
  return fitRidgeLogistic(trainX, trainY);
}

function metric(kind, outcomes, predictions, baselines) {
  if (!outcomes.length) return { n: 0, loss: null, baselineLoss: null, improvement: null };
  if (kind === 'binary') {
    const brier = average(outcomes.map((value, index) => (predictions[index] - value) ** 2));
    const baselineBrier = average(outcomes.map((value, index) => (baselines[index] - value) ** 2));
    return {
      n: outcomes.length,
      metric: 'BRIER',
      loss: brier,
      baselineLoss: baselineBrier,
      improvement: baselineBrier - brier,
      relativeImprovement: baselineBrier ? (baselineBrier - brier) / baselineBrier : null,
    };
  }
  const mae = average(outcomes.map((value, index) => Math.abs(predictions[index] - value)));
  const baselineMae = average(outcomes.map((value, index) => Math.abs(baselines[index] - value)));
  return {
    n: outcomes.length,
    metric: 'MAE',
    loss: mae,
    baselineLoss: baselineMae,
    improvement: baselineMae - mae,
    relativeImprovement: baselineMae ? (baselineMae - mae) / baselineMae : null,
  };
}

function holm(items, pKey = 'empiricalP') {
  const valid = items.filter((item) => finite(item[pKey])).sort((a, b) => a[pKey] - b[pKey]);
  let priorAdjusted = 0;
  for (let index = 0; index < valid.length; index += 1) {
    const threshold = PHASE_A_METHODS.alpha / (valid.length - index);
    const adjusted = Math.max(priorAdjusted, Math.min(1, valid[index][pKey] * (valid.length - index)));
    priorAdjusted = adjusted;
    valid[index].holm = { familySize: valid.length, rank: index + 1, threshold, adjustedP: adjusted, passed: adjusted <= PHASE_A_METHODS.alpha };
  }
  return items;
}

function groupsForFeatures(featureRows) {
  return new Map(featureRows.map((row) => [row.factorId, row.factorGroup]));
}

export function buildRedundancyClusters(featureRows) {
  const usable = featureRows.filter((row) => row.qualityState === 'PASS' && finite(row.value));
  const byFactor = new Map();
  for (const row of usable) {
    if (!byFactor.has(row.factorId)) byFactor.set(row.factorId, new Map());
    byFactor.get(row.factorId).set(row.decisionTradeDate, Number(row.value));
  }
  const factors = [...byFactor.keys()].sort();
  const parent = new Map(factors.map((factor) => [factor, factor]));
  const find = (value) => {
    let current = value;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (left, right) => {
    const a = find(left); const b = find(right);
    if (a !== b) parent.set(b, a < b ? a : b);
  };
  const relations = [];
  for (let leftIndex = 0; leftIndex < factors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < factors.length; rightIndex += 1) {
      const left = byFactor.get(factors[leftIndex]);
      const right = byFactor.get(factors[rightIndex]);
      const common = [...left.keys()].filter((date) => right.has(date));
      if (common.length < PHASE_A_METHODS.redundancyMinimumCommonRows) continue;
      const relation = spearman(common.map((date) => left.get(date)), common.map((date) => right.get(date)));
      if (finite(relation) && Math.abs(relation) >= PHASE_A_METHODS.redundancyAbsoluteSpearman) {
        relations.push({ left: factors[leftIndex], right: factors[rightIndex], n: common.length, spearman: relation });
        union(factors[leftIndex], factors[rightIndex]);
      }
    }
  }
  const clustered = new Map();
  for (const factor of factors) {
    const root = find(factor);
    if (!clustered.has(root)) clustered.set(root, []);
    clustered.get(root).push(factor);
  }
  const coverage = new Map([...byFactor].map(([factor, rows]) => [factor, rows.size]));
  const clusters = [...clustered.values()].map((members, index) => {
    const sorted = [...members].sort((left, right) => coverage.get(right) - coverage.get(left) || left.localeCompare(right));
    return { clusterId: `RC${String(index + 1).padStart(3, '0')}`, representative: sorted[0], members: [...members].sort(), representativeRule: 'MAX_COVERAGE_THEN_FACTOR_ID', targetPerformanceUsed: false };
  });
  return { methods: PHASE_A_METHODS, factorCount: factors.length, relations, clusters, digest: digest({ relations, clusters }) };
}

export function buildEvidenceBlocks({ featureRows, a13Results, redundancy }) {
  const groupMap = groupsForFeatures(featureRows);
  const representative = new Map();
  for (const cluster of redundancy.clusters) for (const member of cluster.members) representative.set(member, cluster.representative);
  const eligible = a13Results.filter((result) => result.computeAllocationEligible);
  const blocks = [];
  for (const factorGroup of ['Cash', 'Futures', 'Options']) {
    const targetIds = [...new Set(eligible.map((result) => result.targetId))].sort();
    for (const targetId of targetIds) {
      const sourceFactors = eligible
        .filter((result) => result.targetId === targetId && groupMap.get(result.factorId) === factorGroup)
        .map((result) => result.factorId)
        .sort();
      const factors = [...new Set(sourceFactors.map((factor) => representative.get(factor) || factor))].sort();
      blocks.push({
        blockId: `${factorGroup.toUpperCase()}__${targetId}`,
        factorGroup,
        targetId,
        sourceFactors,
        factors,
        status: factors.length ? 'READY' : 'NO_ROUND1_SURVIVORS',
        createsGroupState: false,
        createsWeight: false,
        createsSignal: false,
      });
    }
  }
  return { methods: PHASE_A_METHODS, blocks, digest: digest(blocks) };
}

function targetDataset(targetRows, targetId, targetThresholds, targetKind) {
  const valueFor = (row) => {
    if (targetId === 'next_day_tx_return') return row.nextDayReturn;
    if (targetId === 'next_day_direction') return row.nextDayDirection;
    if (targetId === 'next_day_absolute_return') return row.nextDayAbsoluteReturn;
    if (targetId === 'next_day_range') return row.nextDayRange;
    if (targetId === 'next_5d_tx_return') return row.next5dReturn;
    if (targetId === 'next_day_large_move') return finite(row.nextDayAbsoluteReturn) && finite(targetThresholds.largeMove80) ? (row.nextDayAbsoluteReturn >= targetThresholds.largeMove80 ? 1 : 0) : null;
    if (targetId === 'next_day_downside_tail') return finite(row.nextDayReturn) && finite(targetThresholds.downsideTail10) ? (row.nextDayReturn <= targetThresholds.downsideTail10 ? 1 : 0) : null;
    return null;
  };
  return targetRows.map((row) => ({
    date: row.decisionTradeDate,
    y: valueFor(row),
    kind: targetKind,
    volatilityRegime: finite(row.priorRv20) && finite(targetThresholds.highVolMedian) ? (row.priorRv20 >= targetThresholds.highVolMedian ? 'HIGH_VOL' : 'LOW_VOL') : 'UNKNOWN',
    trendRegime: finite(row.priorTrend20) && finite(targetThresholds.trendMagnitudeMedian) ? (Math.abs(row.priorTrend20) >= targetThresholds.trendMagnitudeMedian ? 'TREND' : 'RANGE') : 'UNKNOWN',
    settlementRegime: finite(row.daysToNearExpiry) ? (Number(row.daysToNearExpiry) <= 5 ? 'SETTLEMENT_WINDOW' : 'NON_SETTLEMENT') : 'UNKNOWN',
  })).filter((row) => finite(row.y));
}

function joinedBlockRows({ featureRows, targetRows, block, thresholds, targetKind }) {
  const featureByDate = new Map();
  for (const row of featureRows) {
    if (!block.factors.includes(row.factorId) || row.qualityState !== 'PASS' || !finite(row.value)) continue;
    if (!featureByDate.has(row.decisionTradeDate)) featureByDate.set(row.decisionTradeDate, new Map());
    featureByDate.get(row.decisionTradeDate).set(row.factorId, Number(row.value));
  }
  return targetDataset(targetRows, block.targetId, thresholds, targetKind)
    .map((target) => {
      const values = featureByDate.get(target.date);
      if (!values || block.factors.some((factor) => !values.has(factor))) return null;
      return { ...target, x: block.factors.map((factor) => values.get(factor)) };
    })
    .filter(Boolean)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function walkForwardFolds(length, { train = 360, purge = 1, test = 60 } = {}) {
  const folds = [];
  for (let trainEnd = train; trainEnd + purge < length; trainEnd += test) {
    const testStart = trainEnd + purge;
    const testEnd = Math.min(length, testStart + test);
    if (testEnd - testStart < 20) break;
    folds.push({ trainStart: 0, trainEnd, purgeStart: trainEnd, purgeEnd: testStart, testStart, testEnd });
  }
  return folds;
}

function runModelWalkForward(rows, kind, modelId, basisBuilder = null) {
  const folds = walkForwardFolds(rows.length, {
    train: PHASE_A_METHODS.expandingMinimumTrainDays,
    purge: PHASE_A_METHODS.expandingPurgeDays,
    test: PHASE_A_METHODS.expandingTestDays,
  });
  const predictions = [];
  const foldResults = [];
  for (let index = 0; index < folds.length; index += 1) {
    const fold = folds[index];
    const trainRows = rows.slice(fold.trainStart, fold.trainEnd);
    const testRows = rows.slice(fold.testStart, fold.testEnd);
    const basis = basisBuilder ? basisBuilder(trainRows.map((row) => row.x)) : null;
    const trainX = trainRows.map((row) => basis ? basis.transform(row.x) : row.x);
    const testX = testRows.map((row) => basis ? basis.transform(row.x) : row.x);
    const trainY = trainRows.map((row) => row.y);
    const baseline = average(trainY);
    let model;
    if (modelId === 'RIDGE_LOGISTIC' || modelId === 'EXPLAINABLE_GAM_LOGISTIC') model = fitRidgeLogistic(trainX, trainY);
    else if (modelId === 'HUBER_REGRESSION') model = fitHuber(trainX, trainY);
    else model = fitRidge(trainX, trainY);
    const foldPredictions = testRows.map((row, rowIndex) => ({
      date: row.date,
      outcome: row.y,
      prediction: model.predict(testX[rowIndex]),
      baseline,
      volatilityRegime: row.volatilityRegime,
      trendRegime: row.trendRegime,
      settlementRegime: row.settlementRegime,
      foldId: `WF${String(index + 1).padStart(2, '0')}`,
    }));
    predictions.push(...foldPredictions);
    foldResults.push({
      foldId: `WF${String(index + 1).padStart(2, '0')}`,
      trainStartDate: trainRows[0].date,
      trainEndDate: trainRows.at(-1).date,
      testStartDate: testRows[0].date,
      testEndDate: testRows.at(-1).date,
      ...metric(kind, foldPredictions.map((row) => row.outcome), foldPredictions.map((row) => row.prediction), foldPredictions.map((row) => row.baseline)),
    });
  }
  return {
    modelId,
    foldCount: folds.length,
    foldResults,
    predictions,
    aggregate: metric(kind, predictions.map((row) => row.outcome), predictions.map((row) => row.prediction), predictions.map((row) => row.baseline)),
    positiveFoldShare: folds.length ? foldResults.filter((fold) => fold.improvement > 0).length / folds.length : null,
  };
}

export function runTransparentWalkForward({ featureRows, targetRows, targetSpec, evidenceBlocks, thresholdsByTarget }) {
  const targetMap = new Map(targetSpec.targets.map((target) => [target.targetId, target]));
  const studies = [];
  for (const block of evidenceBlocks.blocks.filter((item) => item.status === 'READY')) {
    const target = targetMap.get(block.targetId);
    const rows = joinedBlockRows({ featureRows, targetRows, block, thresholds: thresholdsByTarget[block.targetId], targetKind: target.kind });
    const models = target.kind === 'binary' ? ['RIDGE_LOGISTIC'] : ['RIDGE_REGRESSION', 'HUBER_REGRESSION'];
    for (const modelId of models) {
      const result = runModelWalkForward(rows, target.kind, modelId);
      studies.push({ blockId: block.blockId, factorGroup: block.factorGroup, targetId: block.targetId, targetKind: target.kind, factors: block.factors, rowCount: rows.length, ...result });
    }
  }
  return { methods: PHASE_A_METHODS, studies, digest: digest(studies) };
}

// Exposes the exact frozen A22 mechanics for an explicitly selected study.
// It does not alter A22 outputs and is used only to audit/reproduce a frozen candidate.
export function reproduceTransparentCandidateDetails({ featureRows, targetRows, targetSpec, block, thresholds }) {
  const target = targetSpec.targets.find((item) => item.targetId === block.targetId);
  if (!target || target.kind !== 'binary') throw new Error('candidate_target_must_be_binary');
  const rows = joinedBlockRows({ featureRows, targetRows, block, thresholds, targetKind: target.kind });
  const folds = walkForwardFolds(rows.length, {
    train: PHASE_A_METHODS.expandingMinimumTrainDays,
    purge: PHASE_A_METHODS.expandingPurgeDays,
    test: PHASE_A_METHODS.expandingTestDays,
  });
  return {
    rows,
    folds: folds.map((fold, index) => {
      const trainRows = rows.slice(fold.trainStart, fold.trainEnd);
      const testRows = rows.slice(fold.testStart, fold.testEnd);
      const model = fitRidgeLogistic(trainRows.map((row) => row.x), trainRows.map((row) => row.y));
      return {
        foldId: `WF${String(index + 1).padStart(2, '0')}`,
        trainingRange: { start: trainRows[0].date, end: trainRows.at(-1).date },
        testRange: { start: testRows[0].date, end: testRows.at(-1).date },
        purgeRows: fold.purgeEnd - fold.purgeStart,
        scaler: { means: model.scaler.means, sds: model.scaler.sds },
        intercept: model.coefficients[0],
        coefficients: model.coefficients.slice(1),
        trainScores: trainRows.map((row) => ({ date: row.date, score: model.predict(row.x) })),
        oosScores: testRows.map((row) => ({ date: row.date, score: model.predict(row.x) })),
      };
    }),
  };
}

// Exposes the exact frozen A22 ridge-regression mechanics for a continuous
// candidate without modifying any Phase A artifact.
export function reproduceTransparentContinuousCandidateDetails({ featureRows, targetRows, targetSpec, block, thresholds }) {
  const target = targetSpec.targets.find((item) => item.targetId === block.targetId);
  if (!target || target.kind !== 'continuous') throw new Error('candidate_target_must_be_continuous');
  const rows = joinedBlockRows({ featureRows, targetRows, block, thresholds, targetKind: target.kind });
  const folds = walkForwardFolds(rows.length, {
    train: PHASE_A_METHODS.expandingMinimumTrainDays,
    purge: PHASE_A_METHODS.expandingPurgeDays,
    test: PHASE_A_METHODS.expandingTestDays,
  });
  return {
    rows,
    folds: folds.map((fold, index) => {
      const trainRows = rows.slice(fold.trainStart, fold.trainEnd);
      const testRows = rows.slice(fold.testStart, fold.testEnd);
      const model = fitRidge(trainRows.map((row) => row.x), trainRows.map((row) => row.y));
      return {
        foldId: `WF${String(index + 1).padStart(2, '0')}`,
        trainingRange: { start: trainRows[0].date, end: trainRows.at(-1).date },
        testRange: { start: testRows[0].date, end: testRows.at(-1).date },
        purgeRows: fold.purgeEnd - fold.purgeStart,
        scaler: { means: model.scaler.means, sds: model.scaler.sds },
        intercept: model.coefficients[0],
        coefficients: model.coefficients.slice(1),
        trainScores: trainRows.map((row) => ({ date: row.date, score: model.predict(row.x) })),
        oosScores: testRows.map((row) => ({ date: row.date, score: model.predict(row.x) })),
      };
    }),
  };
}

function contributionShare(rows) {
  if (rows.length < 5) return null;
  const contributions = rows.map((row) => Math.abs(row.prediction - row.baseline) * Math.abs(row.outcome - row.baseline)).sort((a, b) => b - a);
  const total = contributions.reduce((sum, value) => sum + value, 0);
  return total ? contributions.slice(0, 5).reduce((sum, value) => sum + value, 0) / total : null;
}

function regimeMetrics(predictions, key, kind) {
  const values = [...new Set(predictions.map((row) => row[key]))].sort();
  return values.map((value) => {
    const rows = predictions.filter((row) => row[key] === value);
    return { regime: value, ...metric(kind, rows.map((row) => row.outcome), rows.map((row) => row.prediction), rows.map((row) => row.baseline)) };
  });
}

export function runStrongControls(walkForward, globalSeed) {
  const studies = walkForward.studies.map((study) => {
    const predictions = study.predictions;
    const observed = Math.abs(spearman(predictions.map((row) => row.prediction), predictions.map((row) => row.outcome)) ?? 0);
    const random = seededRandom(`${globalSeed}:A23:${study.blockId}:${study.targetId}:${study.modelId}`);
    const placeboStats = Array.from({ length: PHASE_A_METHODS.round2PlaceboIterations }, () => Math.abs(spearman(blockPermutation(predictions.map((row) => row.prediction), PHASE_A_METHODS.round2BlockSize, random), predictions.map((row) => row.outcome)) ?? 0));
    const empiricalP = (1 + placeboStats.filter((value) => value >= observed).length) / (placeboStats.length + 1);
    const randomStats = Array.from({ length: PHASE_A_METHODS.round2RandomFeatures }, () => Math.abs(spearman(predictions.map(() => gaussian(random)), predictions.map((row) => row.outcome)) ?? 0));
    const lead = Math.abs(spearman(predictions.slice(1).map((row) => row.prediction), predictions.slice(0, -1).map((row) => row.outcome)) ?? 0);
    const lag = Math.abs(spearman(predictions.slice(0, -1).map((row) => row.prediction), predictions.slice(1).map((row) => row.outcome)) ?? 0);
    const extreme = contributionShare(predictions);
    return {
      studyId: `${study.blockId}__${study.modelId}`,
      blockId: study.blockId,
      factorGroup: study.factorGroup,
      targetId: study.targetId,
      targetKind: study.targetKind,
      modelId: study.modelId,
      factors: study.factors,
      oosRows: predictions.length,
      observedStatistic: observed,
      empiricalP,
      randomFeatureP95: quantile(randomStats, 0.95),
      positiveFoldShare: study.positiveFoldShare,
      aggregate: study.aggregate,
      leadLag: { leadAbsoluteSpearman: lead, lagAbsoluteSpearman: lag, futureLeadDominates: lead > Math.max(0.10, 2 * observed) },
      extremeContributionShare: extreme,
      regimes: {
        volatility: regimeMetrics(predictions, 'volatilityRegime', study.targetKind),
        trend: regimeMetrics(predictions, 'trendRegime', study.targetKind),
        settlement: regimeMetrics(predictions, 'settlementRegime', study.targetKind),
      },
      checks: {
        positiveIncrementalLoss: study.aggregate.improvement > 0,
        foldStability: study.positiveFoldShare >= PHASE_A_METHODS.minimumPositiveFoldShare,
        randomFeature: observed > (quantile(randomStats, 0.95) ?? Infinity),
        extremeDays: finite(extreme) && extreme <= PHASE_A_METHODS.maximumExtremeContributionShare,
        leadLag: !(lead > Math.max(0.10, 2 * observed)),
      },
    };
  });
  for (const targetId of [...new Set(studies.map((study) => study.targetId))]) holm(studies.filter((study) => study.targetId === targetId));
  for (const study of studies) {
    study.strongControlPass = Object.values(study.checks).every(Boolean) && Boolean(study.holm?.passed);
    study.promotionEligible = false;
  }
  return { methods: PHASE_A_METHODS, studies, digest: digest(studies) };
}

export function freezeF3Candidates(strongControls, contractSensitiveFactors) {
  const sensitive = new Set(contractSensitiveFactors);
  const ranked = strongControls.studies
    .filter((study) => study.strongControlPass)
    .sort((left, right) => (left.holm.adjustedP - right.holm.adjustedP) || (right.aggregate.relativeImprovement - left.aggregate.relativeImprovement) || left.studyId.localeCompare(right.studyId));
  const candidates = [];
  const usedBlocks = new Set();
  for (const study of ranked) {
    if (usedBlocks.has(study.blockId)) continue;
    usedBlocks.add(study.blockId);
    const contractSensitive = study.factors.some((factor) => sensitive.has(factor));
    candidates.push({
      candidateId: `F3C${String(candidates.length + 1).padStart(2, '0')}`,
      studyId: study.studyId,
      blockId: study.blockId,
      factorGroup: study.factorGroup,
      targetId: study.targetId,
      modelId: study.modelId,
      factors: study.factors,
      promotionStage: 'F3_PREREGISTRATION_CANDIDATE',
      evaluationStatus: 'PENDING',
      promotionEligible: false,
      contractPolicyStatus: contractSensitive ? 'PROVISIONAL' : 'NOT_APPLICABLE',
      requiresPP1Reconciliation: contractSensitive,
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
    });
    if (candidates.length === 5) break;
  }
  return { maximumCandidates: 5, candidates, digest: digest(candidates) };
}

function gamBasisBuilder(trainX) {
  const columns = trainX[0]?.length || 0;
  const knots = Array.from({ length: columns }, (_, column) => PHASE_A_METHODS.gamKnots.map((p) => quantile(trainX.map((row) => row[column]), p)));
  return {
    knots,
    transform: (row) => row.flatMap((value, column) => [value, value ** 2, value ** 3, ...knots[column].map((knot) => Math.max(0, value - knot) ** 3)]),
  };
}

export function runGamChallenger({ candidates, evidenceBlocks, featureRows, targetRows, targetSpec, thresholdsByTarget }) {
  const blockMap = new Map(evidenceBlocks.blocks.map((block) => [block.blockId, block]));
  const targetMap = new Map(targetSpec.targets.map((target) => [target.targetId, target]));
  const studies = [];
  for (const candidate of candidates.candidates) {
    const block = blockMap.get(candidate.blockId);
    const target = targetMap.get(candidate.targetId);
    const rows = joinedBlockRows({ featureRows, targetRows, block, thresholds: thresholdsByTarget[candidate.targetId], targetKind: target.kind });
    const modelId = target.kind === 'binary' ? 'EXPLAINABLE_GAM_LOGISTIC' : 'EXPLAINABLE_GAM_RIDGE';
    const baseModel = target.kind === 'binary' ? 'RIDGE_LOGISTIC' : 'RIDGE_REGRESSION';
    const result = runModelWalkForward(rows, target.kind, modelId, gamBasisBuilder);
    const baseline = runModelWalkForward(rows, target.kind, baseModel);
    studies.push({
      candidateId: candidate.candidateId,
      blockId: candidate.blockId,
      targetId: candidate.targetId,
      targetKind: target.kind,
      factors: candidate.factors,
      modelId,
      basis: 'ADDITIVE_CUBIC_TRUNCATED_POWER_FIXED_QUARTILE_KNOTS',
      hyperparameterSearch: false,
      ...result,
      transparentComparator: baseline.aggregate,
      challengerIncrementalImprovement: finite(result.aggregate.loss) && finite(baseline.aggregate.loss) ? baseline.aggregate.loss - result.aggregate.loss : null,
    });
  }
  return { methods: PHASE_A_METHODS, studies, digest: digest(studies) };
}

export function runRound3Controls(gam, globalSeed) {
  const results = [];
  for (const study of gam.studies) {
    const rows = study.predictions;
    const observed = Math.abs(spearman(rows.map((row) => row.prediction), rows.map((row) => row.outcome)) ?? 0);
    const blocks = [];
    for (const blockSize of PHASE_A_METHODS.round3BlockSizes) {
      const random = seededRandom(`${globalSeed}:A32:${study.candidateId}:${blockSize}`);
      const placebo = [];
      const bootstrapImprovement = [];
      for (let iteration = 0; iteration < PHASE_A_METHODS.round3Iterations; iteration += 1) {
        placebo.push(Math.abs(spearman(blockPermutation(rows.map((row) => row.prediction), blockSize, random), rows.map((row) => row.outcome)) ?? 0));
        const indexes = blockBootstrapIndexes(rows.length, blockSize, random);
        const sampled = indexes.map((index) => rows[index]);
        bootstrapImprovement.push(metric(study.targetKind, sampled.map((row) => row.outcome), sampled.map((row) => row.prediction), sampled.map((row) => row.baseline)).improvement);
      }
      blocks.push({
        blockSize,
        placeboIterations: PHASE_A_METHODS.round3Iterations,
        bootstrapIterations: PHASE_A_METHODS.round3Iterations,
        empiricalP: (1 + placebo.filter((value) => value >= observed).length) / (placebo.length + 1),
        bootstrapImprovementP05: quantile(bootstrapImprovement, 0.05),
        bootstrapImprovementP50: quantile(bootstrapImprovement, 0.50),
        bootstrapImprovementP95: quantile(bootstrapImprovement, 0.95),
      });
    }
    results.push({ candidateId: study.candidateId, targetId: study.targetId, observedStatistic: observed, blocks, empiricalP: Math.max(...blocks.map((block) => block.empiricalP)), promotionEligible: false });
  }
  for (const targetId of [...new Set(results.map((result) => result.targetId))]) holm(results.filter((result) => result.targetId === targetId));
  return { methods: PHASE_A_METHODS, results, digest: digest(results) };
}

export function buildPromotionBoard({ featureRows, a10Results, a13Results, strongControls, candidates, round3, contractSensitiveFactors }) {
  const factors = [...new Set(featureRows.map((row) => row.factorId))].sort();
  const groupMap = groupsForFeatures(featureRows);
  const sensitive = new Set(contractSensitiveFactors);
  const qualityMap = new Map(a10Results.map((row) => [row.factorId, row]));
  const candidateFactors = new Map();
  for (const candidate of candidates.candidates) for (const factor of candidate.factors) candidateFactors.set(factor, candidate);
  const strongByFactor = new Map();
  for (const study of strongControls.studies) for (const factor of study.factors) {
    if (!strongByFactor.has(factor)) strongByFactor.set(factor, []);
    strongByFactor.get(factor).push(study);
  }
  const board = factors.map((factorId) => {
    const quality = qualityMap.get(factorId);
    const a13 = a13Results.filter((result) => result.factorId === factorId);
    const strong = strongByFactor.get(factorId) || [];
    const candidate = candidateFactors.get(factorId) || null;
    const contractSensitive = sensitive.has(factorId);
    let promotionStage = quality?.qualityState === 'PASS' ? 'F1' : 'F0';
    let evaluationStatus = quality?.qualityState === 'PASS' ? 'PASS' : 'FAIL';
    let historicalEvidence = quality?.qualityState === 'PASS' ? 'INSUFFICIENT' : 'NEGATIVE';
    let evidenceRole = 'Data Quality';
    if (a13.length) {
      promotionStage = 'F2';
      evaluationStatus = strong.some((study) => study.strongControlPass) ? 'PASS' : 'FAIL';
      historicalEvidence = evaluationStatus === 'PASS' ? 'POSITIVE' : 'NEGATIVE';
      evidenceRole = a13.some((result) => result.targetId.includes('direction') || result.targetId.includes('return')) ? 'Direction_or_Regime' : 'Risk_Veto_or_Descriptive';
    }
    if (candidate) {
      promotionStage = 'F3';
      evaluationStatus = 'PENDING';
      historicalEvidence = 'MIXED_REQUIRES_PREREGISTRATION';
      evidenceRole = 'Preregistration Candidate';
    }
    return {
      factorId,
      factorGroup: groupMap.get(factorId) || 'UNKNOWN',
      promotionStage,
      evaluationStatus,
      promotionEligible: false,
      historicalEvidence,
      evidenceRole,
      contractPolicyStatus: contractSensitive ? 'PROVISIONAL' : 'NOT_APPLICABLE',
      requiresPP1Reconciliation: contractSensitive,
      nextPromotionRequirement: contractSensitive ? 'PP1_CONTRACT_POLICY_RECONCILIATION' : candidate ? 'OWNER_APPROVED_PREREGISTRATION_AND_NEW_FROZEN_FORWARD' : evaluationStatus === 'PASS' ? 'EXPLICIT_F3_PREREGISTRATION' : 'PAUSE_OR_NEW_OWNER_HYPOTHESIS',
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
  });
  const phaseBQueue = [
    'T0_OPENING_RANGE_BASELINE',
    'ORB_VWAP_RVOL_PRICE_PATH',
    'MAE_MFE_FALSE_BREAKOUT',
    'DAILY_BIAS_X_INTRADAY_SETUP',
  ].map((item, index) => ({ queueOrder: index + 1, item, status: 'REQUIRES_SEPARATE_OWNER_AUTHORIZATION' }));
  return { methods: PHASE_A_METHODS, board, candidates: candidates.candidates, round3: round3.results, phaseBQueue, digest: digest({ board, phaseBQueue }) };
}

export function validateStagePayload(stage, payload) {
  if (!payload || typeof payload !== 'object') throw new Error(`output_schema_invalid:${stage}:not_object`);
  if (payload.stage !== stage) throw new Error(`output_schema_invalid:${stage}:stage`);
  for (const field of ['snapshotHash', 'specHash', 'targetSpecHash', 'featureSpecHash', 'blockerPatchHash']) {
    if (typeof payload[field] !== 'string' || payload[field].length !== 64) throw new Error(`output_schema_invalid:${stage}:${field}`);
  }
  if (payload.researchOnly !== true || payload.formalWeight !== 0 || payload.executionAuthorized !== false) {
    throw new Error(`output_schema_invalid:${stage}:safeguards`);
  }
  const required = {
    A20: 'redundancy', A21: 'evidenceBlocks', A22: 'walkForward', A23: 'strongControls',
    A30: 'f3Candidates', A31: 'gamChallenger', A32: 'round3Controls',
    A33: 'promotionBoard', A40: 'reports',
  }[stage];
  if (!required || !payload[required]) throw new Error(`output_schema_invalid:${stage}:${required || 'unknown_stage'}`);
  return true;
}

export function phaseARoundDigest(value) {
  return digest(value);
}
