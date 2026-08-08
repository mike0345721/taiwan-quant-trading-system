import { fitRidge, predictRidge } from './intraday-factor-impact.mjs';

export const PRICE_BASELINE_KEYS = Object.freeze([
  'gapReturn',
  'prior5dMomentum',
  'openingReturn',
  'priorRv20',
  'openingRangeLocation',
  'previousSessionRange',
  'openingLocationPrevRange',
  'openingPathEfficiency',
]);

export const EVENT_TARGETS = Object.freeze({
  largeMove60: { severityKey: 'largeMove60Severity', quantile: 0.80 },
  downsideTail60: { severityKey: 'downsideTail60Severity', quantile: 0.90 },
  extremeExcursion60: { severityKey: 'extremeExcursion60Severity', quantile: 0.90 },
  volatilityExpansion60: { severityKey: 'volatilityExpansion60Severity', quantile: 0.80 },
});

export const HYPOTHESES = Object.freeze([
  {
    id: 'H1',
    factorKey: 'termSpreadBpsPastRank',
    interactionKey: 'h1PriceTermInteraction',
    primaryTarget: 'largeMove60',
    expectedInteractionSign: 1,
  },
  {
    id: 'H2',
    factorKey: 'skew25dPastRank',
    interactionKey: 'h2VolSkewInteraction',
    primaryTarget: 'downsideTail60',
    expectedInteractionSign: 1,
  },
  {
    id: 'H3',
    factorKey: 'marketOiDeltaPctPastRank',
    interactionKey: 'h3TrendOiInteraction',
    primaryTarget: 'extremeExcursion60',
    expectedInteractionSign: 1,
  },
]);

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function safeReturn(end, start) {
  if (!finite(end) || !finite(start) || Number(start) === 0) return null;
  return Number(end) / Number(start) - 1;
}

export function quantile(values, probability) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] == null
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function sampleStandardDeviation(values) {
  const clean = values.filter(finite).map(Number);
  if (clean.length < 2) return null;
  const average = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / (clean.length - 1));
}

function openingPathEfficiency(bars) {
  const first = bars[0];
  const second = bars[1];
  const third = bars[2];
  const path = Math.abs(Number(first.close) - Number(first.open))
    + Math.abs(Number(second.close) - Number(first.close))
    + Math.abs(Number(third.close) - Number(second.close));
  return path === 0 ? 0 : Math.abs(Number(third.close) - Number(first.open)) / path;
}

function futurePathVolatility(bars, anchorIndex = 2, horizonBars = 12) {
  const end = anchorIndex + horizonBars;
  if (end >= bars.length) return null;
  let prior = Number(bars[anchorIndex].close);
  let sumSquares = 0;
  for (let index = anchorIndex + 1; index <= end; index += 1) {
    const close = Number(bars[index].close);
    if (!(prior > 0) || !(close > 0)) return null;
    const value = Math.log(close / prior);
    sumSquares += value ** 2;
    prior = close;
  }
  return Math.sqrt(sumSquares);
}

function validDay(day) {
  return day && day.session === 'day' && day.timeframe === '5m'
    && Array.isArray(day.bars) && day.bars.length === 60;
}

export function buildRestrictedBaselineRows(days, alignedRows) {
  const sortedDays = [...days].filter(validDay)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const aligned = new Map(alignedRows.map((row) => [row.tradeDate, row]));
  const sessionReturns = sortedDays.map((day) => safeReturn(day.bars.at(-1).close, day.bars[0].open));

  return sortedDays.map((day, index) => {
    const factor = aligned.get(day.tradeDate);
    if (!factor) return null;
    const bars = day.bars;
    const previous = sortedDays[index - 1] || null;
    const priorFiveStart = sortedDays[index - 6] || null;
    const priorFive = sortedDays.slice(Math.max(0, index - 6), index);
    const samePriorContract = previous?.contract === day.contract;
    const fiveDaySameContract = priorFive.length === 6
      && priorFive.every((candidate) => candidate.contract === previous?.contract);
    const priorRvWindow = sessionReturns.slice(Math.max(0, index - 20), index);
    const openingHigh = Math.max(...bars.slice(0, 3).map((bar) => Number(bar.high)));
    const openingLow = Math.min(...bars.slice(0, 3).map((bar) => Number(bar.low)));
    const openingRange = openingHigh - openingLow;
    const previousRange = previous
      ? Number(previous.bars.reduce((value, bar) => Math.max(value, Number(bar.high)), -Infinity))
        - Number(previous.bars.reduce((value, bar) => Math.min(value, Number(bar.low)), Infinity))
      : null;
    const previousHigh = previous
      ? Math.max(...previous.bars.map((bar) => Number(bar.high))) : null;
    const previousLow = previous
      ? Math.min(...previous.bars.map((bar) => Number(bar.low))) : null;
    const anchorClose = Number(bars[2].close);
    const future = bars.slice(3, 15);
    const futureClose = future.at(-1)?.close;
    const mfe = future.length
      ? safeReturn(Math.max(...future.map((bar) => Number(bar.high))), anchorClose) : null;
    const mae = future.length
      ? safeReturn(Math.min(...future.map((bar) => Number(bar.low))), anchorClose) : null;

    return {
      schemaVersion: 'v3.10-restricted-wave3-row-v1',
      tradeDate: day.tradeDate,
      contract: day.contract,
      decisionAvailableAt: factor.decisionAvailableAt,
      factorSourceDate: factor.factorSourceDate,
      gapReturn: samePriorContract ? safeReturn(bars[0].open, previous.bars.at(-1).close) : null,
      prior5dMomentum: fiveDaySameContract
        ? safeReturn(previous.bars.at(-1).close, priorFiveStart.bars.at(-1).close) : null,
      openingReturn: safeReturn(anchorClose, bars[0].open),
      priorRv20: priorRvWindow.length === 20 ? sampleStandardDeviation(priorRvWindow) : null,
      openingRangeLocation: openingRange === 0 ? 0.5 : (anchorClose - openingLow) / openingRange,
      previousSessionRange: previous && Number(previous.bars.at(-1).close) !== 0
        ? previousRange / Number(previous.bars.at(-1).close) : null,
      openingLocationPrevRange: samePriorContract && previousHigh !== previousLow
        ? (Number(bars[0].open) - previousLow) / (previousHigh - previousLow) : null,
      openingPathEfficiency: openingPathEfficiency(bars),
      termSpreadBps: factor.termSpreadBps,
      skew25d: factor.skew25d,
      marketOiDeltaPct: factor.marketOiDeltaPct,
      largeMove60Severity: finite(futureClose)
        ? Math.abs(safeReturn(futureClose, anchorClose)) : null,
      downsideTail60Severity: finite(mae) ? Math.abs(Math.min(0, mae)) : null,
      extremeExcursion60Severity: finite(mfe) && finite(mae)
        ? Math.max(Math.max(0, mfe), Math.abs(Math.min(0, mae))) : null,
      volatilityExpansion60Severity: futurePathVolatility(bars),
      researchOnly: true,
      executionAuthorized: false,
    };
  }).filter(Boolean);
}

export function addPastOnlyRank(rows, sourceKey, outputKey, minimumHistory = 20) {
  const history = [];
  return rows.map((row) => {
    const value = row[sourceKey];
    let rank = null;
    if (finite(value) && history.length >= minimumHistory) {
      const below = history.filter((item) => item < Number(value)).length;
      const equal = history.filter((item) => item === Number(value)).length;
      rank = (below + 0.5 * equal) / history.length;
    }
    const result = { ...row, [outputKey]: rank };
    if (finite(value)) history.push(Number(value));
    return result;
  });
}

export function addHypothesisFeatures(rows) {
  let ranked = addPastOnlyRank(rows, 'termSpreadBps', 'termSpreadBpsPastRank');
  ranked = addPastOnlyRank(ranked, 'skew25d', 'skew25dPastRank');
  ranked = addPastOnlyRank(ranked, 'marketOiDeltaPct', 'marketOiDeltaPctPastRank');
  ranked = addPastOnlyRank(ranked, 'priorRv20', 'priorRv20PastRank');
  return ranked.map((row) => ({
    ...row,
    h1PriceTermInteraction: finite(row.prior5dMomentum) && finite(row.termSpreadBpsPastRank)
      ? Number(row.prior5dMomentum) * (Number(row.termSpreadBpsPastRank) - 0.5) : null,
    h2VolSkewInteraction: finite(row.priorRv20PastRank) && finite(row.skew25dPastRank)
      ? Number(row.priorRv20PastRank) * Number(row.skew25dPastRank) : null,
    h3TrendOiInteraction: finite(row.openingReturn) && finite(row.marketOiDeltaPctPastRank)
      ? Math.abs(Number(row.openingReturn)) * Number(row.marketOiDeltaPctPastRank) : null,
  }));
}

function clipProbability(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function auc(predictions) {
  const positives = predictions.filter((row) => row.actual === 1);
  const negatives = predictions.filter((row) => row.actual === 0);
  if (!positives.length || !negatives.length) return null;
  let score = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive.predicted > negative.predicted) score += 1;
      else if (positive.predicted === negative.predicted) score += 0.5;
    }
  }
  return score / (positives.length * negatives.length);
}

function eventMetrics(predictions) {
  if (!predictions.length) {
    return { samples: 0, eventRate: null, brier: null, auc: null };
  }
  return {
    samples: predictions.length,
    eventRate: predictions.reduce((sum, row) => sum + row.actual, 0) / predictions.length,
    brier: predictions.reduce((sum, row) => sum + (row.predicted - row.actual) ** 2, 0)
      / predictions.length,
    auc: auc(predictions),
  };
}

function relativeBrierImprovement(baseline, candidate) {
  if (!finite(baseline) || Number(baseline) <= 0 || !finite(candidate)) return null;
  return (Number(baseline) - Number(candidate)) / Number(baseline);
}

export function eventWalkForward(rows, hypothesis, targetName, {
  minimumTrainingDays = 60,
  testWindowDays = 12,
  purgeDays = 1,
  lambda = 1,
} = {}) {
  const target = EVENT_TARGETS[targetName];
  if (!target) throw new Error(`unknown_event_target:${targetName}`);
  const required = [
    ...PRICE_BASELINE_KEYS,
    hypothesis.factorKey,
    hypothesis.interactionKey,
    target.severityKey,
  ];
  const usable = rows.filter((row) => required.every((key) => finite(row[key])))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const allPredictions = { price: [], factor: [], interaction: [] };
  const folds = [];

  for (let testStart = minimumTrainingDays + purgeDays;
    testStart < usable.length;
    testStart += testWindowDays) {
    const trainEnd = testStart - purgeDays;
    const trainRaw = usable.slice(0, trainEnd);
    const testRaw = usable.slice(testStart, Math.min(testStart + testWindowDays, usable.length));
    const threshold = quantile(trainRaw.map((row) => row[target.severityKey]), target.quantile);
    if (!finite(threshold) || !testRaw.length) continue;
    const train = trainRaw.map((row) => ({
      ...row,
      __event: Number(row[target.severityKey]) >= Number(threshold) ? 1 : 0,
    }));
    const test = testRaw.map((row) => ({
      ...row,
      __event: Number(row[target.severityKey]) >= Number(threshold) ? 1 : 0,
    }));
    const priceModel = fitRidge(train, PRICE_BASELINE_KEYS, '__event', { lambda });
    const factorModel = fitRidge(
      train, [...PRICE_BASELINE_KEYS, hypothesis.factorKey], '__event', { lambda },
    );
    const interactionModel = fitRidge(
      train,
      [...PRICE_BASELINE_KEYS, hypothesis.factorKey, hypothesis.interactionKey],
      '__event',
      { lambda },
    );
    if (!priceModel || !factorModel || !interactionModel) continue;

    const foldSets = { price: [], factor: [], interaction: [] };
    for (const row of test) {
      const actual = row.__event;
      for (const [name, model] of [
        ['price', priceModel],
        ['factor', factorModel],
        ['interaction', interactionModel],
      ]) {
        const predicted = predictRidge(model, row);
        if (!finite(predicted)) continue;
        const record = { tradeDate: row.tradeDate, actual, predicted: clipProbability(predicted) };
        foldSets[name].push(record);
        allPredictions[name].push(record);
      }
    }
    const priceMetrics = eventMetrics(foldSets.price);
    const factorMetrics = eventMetrics(foldSets.factor);
    const interactionMetrics = eventMetrics(foldSets.interaction);
    const coefficient = interactionModel.coefficients.at(-1);
    folds.push({
      trainFirstDate: train[0]?.tradeDate ?? null,
      trainLastDate: train.at(-1)?.tradeDate ?? null,
      trainDays: train.length,
      purgedDate: usable[testStart - 1]?.tradeDate ?? null,
      testFirstDate: test[0]?.tradeDate ?? null,
      testLastDate: test.at(-1)?.tradeDate ?? null,
      testDays: test.length,
      threshold,
      priceBrier: priceMetrics.brier,
      factorBrier: factorMetrics.brier,
      interactionBrier: interactionMetrics.brier,
      interactionRelativeBrierImprovement: relativeBrierImprovement(
        priceMetrics.brier, interactionMetrics.brier,
      ),
      interactionCoefficient: coefficient,
    });
  }

  const metrics = {
    price: eventMetrics(allPredictions.price),
    factor: eventMetrics(allPredictions.factor),
    interaction: eventMetrics(allPredictions.interaction),
  };
  const positiveFolds = folds.filter(
    (fold) => Number(fold.interactionRelativeBrierImprovement) > 0,
  ).length;
  const expectedSignFolds = folds.filter(
    (fold) => Math.sign(Number(fold.interactionCoefficient))
      === hypothesis.expectedInteractionSign,
  ).length;
  return {
    usableDays: usable.length,
    predictions: allPredictions,
    folds,
    metrics,
    relativeBrierImprovement: relativeBrierImprovement(
      metrics.price.brier, metrics.interaction.brier,
    ),
    factorRelativeBrierImprovement: relativeBrierImprovement(
      metrics.price.brier, metrics.factor.brier,
    ),
    positiveFoldShare: folds.length ? positiveFolds / folds.length : null,
    expectedSignFoldShare: folds.length ? expectedSignFolds / folds.length : null,
  };
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function shuffleBlocks(values, blockSize, random) {
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

function rebuildInteraction(row, hypothesis) {
  if (hypothesis.id === 'H1') {
    return Number(row.prior5dMomentum) * (Number(row[hypothesis.factorKey]) - 0.5);
  }
  if (hypothesis.id === 'H2') {
    return Number(row.priorRv20PastRank) * Number(row[hypothesis.factorKey]);
  }
  return Math.abs(Number(row.openingReturn)) * Number(row[hypothesis.factorKey]);
}

export function blockPermutationEventTest(rows, hypothesis, targetName, observedImprovement, {
  iterations = 1_000,
  blockSize = 5,
  seed = 20260730,
} = {}) {
  const usableIndexes = rows.map((row, index) => finite(row[hypothesis.factorKey]) ? index : null)
    .filter((index) => index !== null);
  const original = usableIndexes.map((index) => Number(rows[index][hypothesis.factorKey]));
  const random = randomGenerator(seed);
  const nullImprovements = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shuffled = shuffleBlocks(original, blockSize, random);
    const permuted = rows.map((row) => ({ ...row }));
    usableIndexes.forEach((rowIndex, valueIndex) => {
      permuted[rowIndex][hypothesis.factorKey] = shuffled[valueIndex];
      permuted[rowIndex][hypothesis.interactionKey] = rebuildInteraction(
        permuted[rowIndex], hypothesis,
      );
    });
    const result = eventWalkForward(permuted, hypothesis, targetName);
    if (finite(result.relativeBrierImprovement)) {
      nullImprovements.push(result.relativeBrierImprovement);
    }
  }
  const greaterOrEqual = nullImprovements.filter(
    (value) => value >= Number(observedImprovement),
  ).length;
  return {
    iterations: nullImprovements.length,
    blockSize,
    pValueOneSided: (1 + greaterOrEqual) / (nullImprovements.length + 1),
    nullMedian: quantile(nullImprovements, 0.5),
    nullP95: quantile(nullImprovements, 0.95),
  };
}

export function applyHolmFamily(studies, alpha = 0.05) {
  const ordered = [...studies].sort(
    (left, right) => left.permutation.pValueOneSided - right.permutation.pValueOneSided,
  );
  let priorPassed = true;
  ordered.forEach((study, index) => {
    const threshold = alpha / (ordered.length - index);
    const passed = priorPassed && study.permutation.pValueOneSided <= threshold;
    study.multipleTesting = {
      method: 'Holm',
      familySize: ordered.length,
      rank: index + 1,
      alpha,
      threshold,
      passed,
    };
    if (!passed) priorPassed = false;
  });
  return studies;
}

export function classifyRestrictedStudy(study, hypothesis) {
  const result = study.walkForward;
  const primary = study.targetName === hypothesis.primaryTarget;
  const gates = {
    primaryTarget: primary,
    oosDays: result.metrics.interaction.samples >= 24,
    relativeBrierImprovement: Number(result.relativeBrierImprovement) >= 0.01,
    positiveFoldShare: Number(result.positiveFoldShare) >= 0.60,
    holm: study.multipleTesting?.passed === true,
    expectedSignFoldShare: !primary || Number(result.expectedSignFoldShare) >= 0.60,
  };
  const passed = Object.values(gates).every(Boolean);
  return {
    gates,
    verdict: passed
      ? 'historical_discovery_requires_frozen_forward'
      : primary ? 'primary_hypothesis_not_supported' : 'secondary_discovery_not_promotable',
  };
}

