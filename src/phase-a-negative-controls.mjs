import crypto from 'node:crypto';

import { quantile, spearman } from './phase-a-univariate.mjs';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function deterministicSeed(globalSeed, factorId, targetId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${globalSeed}:${factorId}:${targetId}`)
    .digest();
  return digest.readUInt32LE(0);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndexes(length, random) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [indexes[index], indexes[selected]] = [indexes[selected], indexes[index]];
  }
  return indexes;
}

function movingBlockPermutation(values, blockSize, random) {
  const blocks = [];
  for (let start = 0; start < values.length; start += blockSize) {
    blocks.push(values.slice(start, Math.min(start + blockSize, values.length)));
  }
  return shuffledIndexes(blocks.length, random)
    .flatMap((index) => blocks[index])
    .slice(0, values.length);
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function correlationAtOffset(rows, factorOffset) {
  const factors = [];
  const targets = [];
  for (let index = 0; index < rows.length; index += 1) {
    const factorIndex = index + factorOffset;
    if (factorIndex < 0 || factorIndex >= rows.length) continue;
    factors.push(rows[factorIndex].factorValue);
    targets.push(rows[index].targetValue);
  }
  return spearman(factors, targets);
}

function countAtLeast(values, threshold) {
  return values.filter((value) => finite(value) && value >= threshold).length;
}

export function runLowCostNegativeControls({
  factorId,
  targetId,
  evaluationRows,
  a12Result,
  globalSeed,
  permutationIterations = 200,
  randomFeatureIterations = 50,
  blockSize = 5,
  minimumEvaluationRows = 60,
}) {
  const rows = [...evaluationRows]
    .filter((row) => finite(row.factorValue) && finite(row.targetValue))
    .sort((left, right) => left.decisionTradeDate.localeCompare(right.decisionTradeDate));
  const seed = deterministicSeed(globalSeed, factorId, targetId);
  const configuration = {
    permutationIterations,
    randomFeatureIterations,
    blockSize,
    minimumEvaluationRows,
    randomSeed: seed,
    observedStatistic: 'ABS_SPEARMAN',
    permutationMethod: 'MOVING_BLOCK_FACTOR_PERMUTATION',
    randomFeatureMethod: 'SEEDED_STANDARD_GAUSSIAN',
  };
  if (rows.length < minimumEvaluationRows || a12Result.evaluationStatus !== 'DESCRIPTIVE_COMPLETE') {
    return {
      schemaVersion: 'phase-a-a13-negative-controls-v1',
      factorId,
      targetId,
      evaluationRows: rows.length,
      configuration,
      observed: null,
      movingBlockPlacebo: null,
      randomFeatureCompetition: null,
      leadLagDiagnostic: null,
      concentrationDiagnostic: null,
      screeningChecks: [],
      evaluationStatus: 'INSUFFICIENT_DATA',
      historicalEvidence: 'INSUFFICIENT',
      computeAllocationEligible: false,
      promotionEligible: false,
      promotionStage: 'F1_OR_F2_INSUFFICIENT',
      nextAllowedStep: 'PAUSE_OR_WAIT_FOR_DATA',
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
    };
  }

  const random = mulberry32(seed);
  const factors = rows.map((row) => row.factorValue);
  const targets = rows.map((row) => row.targetValue);
  const observedSpearman = spearman(factors, targets);
  const observedAbsoluteSpearman = Math.abs(observedSpearman ?? 0);

  const placeboStatistics = Array.from({ length: permutationIterations }, () => {
    const permuted = movingBlockPermutation(factors, blockSize, random);
    return Math.abs(spearman(permuted, targets) ?? 0);
  });
  const empiricalP = (
    1 + countAtLeast(placeboStatistics, observedAbsoluteSpearman)
  ) / (permutationIterations + 1);

  const randomFeatureStatistics = Array.from({ length: randomFeatureIterations }, () => {
    const feature = Array.from({ length: rows.length }, () => gaussian(random));
    return Math.abs(spearman(feature, targets) ?? 0);
  });
  const randomFeatureP95 = quantile(randomFeatureStatistics, 0.95);
  const standardizedSpread = Math.abs(
    Number(a12Result.evaluationQuintiles?.standardizedTopMinusBottom ?? 0),
  );
  const top5ContributionShare = a12Result.evaluationStability?.top5ContributionShare ?? null;
  const lagSpearman = correlationAtOffset(rows, -1);
  const leadSpearman = correlationAtOffset(rows, 1);
  const leadDominanceLimit = Math.max(0.10, 2 * observedAbsoluteSpearman);

  const screeningChecks = [
    {
      checkId: 'MINIMUM_EFFECT_SIZE',
      passed: observedAbsoluteSpearman >= 0.05,
      observed: observedAbsoluteSpearman,
      threshold: 0.05,
    },
    {
      checkId: 'MOVING_BLOCK_PLACEBO',
      passed: empiricalP <= 0.10,
      observed: empiricalP,
      threshold: 0.10,
    },
    {
      checkId: 'RANDOM_FEATURE_COMPETITION',
      passed: finite(randomFeatureP95) && observedAbsoluteSpearman > randomFeatureP95,
      observed: observedAbsoluteSpearman,
      threshold: randomFeatureP95,
    },
    {
      checkId: 'QUINTILE_EFFECT_SIZE',
      passed: standardizedSpread >= 0.10,
      observed: standardizedSpread,
      threshold: 0.10,
    },
    {
      checkId: 'EXTREME_DAY_CONCENTRATION',
      passed: finite(top5ContributionShare) && top5ContributionShare <= 0.40,
      observed: top5ContributionShare,
      threshold: 0.40,
    },
    {
      checkId: 'FUTURE_LEAD_DOMINANCE',
      passed: !finite(leadSpearman) || Math.abs(leadSpearman) < leadDominanceLimit,
      observed: finite(leadSpearman) ? Math.abs(leadSpearman) : null,
      threshold: leadDominanceLimit,
    },
  ];
  const computeAllocationEligible = screeningChecks.every((check) => check.passed);
  return {
    schemaVersion: 'phase-a-a13-negative-controls-v1',
    factorId,
    targetId,
    evaluationRows: rows.length,
    configuration,
    observed: {
      spearman: observedSpearman,
      absoluteSpearman: observedAbsoluteSpearman,
      standardizedQuintileSpread: standardizedSpread,
    },
    movingBlockPlacebo: {
      empiricalP,
      statisticP50: quantile(placeboStatistics, 0.50),
      statisticP95: quantile(placeboStatistics, 0.95),
      exceedanceCount: countAtLeast(placeboStatistics, observedAbsoluteSpearman),
    },
    randomFeatureCompetition: {
      statisticP50: quantile(randomFeatureStatistics, 0.50),
      statisticP95: randomFeatureP95,
      observedExceedsP95: observedAbsoluteSpearman > randomFeatureP95,
    },
    leadLagDiagnostic: {
      lag1Spearman: lagSpearman,
      lead1Spearman: leadSpearman,
      leadDominanceLimit,
    },
    concentrationDiagnostic: {
      top5ContributionShare,
    },
    screeningChecks,
    evaluationStatus: computeAllocationEligible
      ? 'PROVISIONAL_ROUND2_PASS'
      : 'ROUND1_NEGATIVE_CONTROL_FAIL',
    historicalEvidence: computeAllocationEligible
      ? 'PROVISIONAL_POSITIVE_REQUIRES_STRONG_CONTROLS'
      : 'NEGATIVE_OR_UNSTABLE',
    computeAllocationEligible,
    promotionEligible: false,
    promotionStage: 'F1_OR_F2_PENDING_STRONG_CONTROLS',
    nextAllowedStep: computeAllocationEligible
      ? 'A20_REQUIRES_PRODUCT_OWNER_APPROVAL'
      : 'PAUSE_ROUND1_SCREENING',
    researchOnly: true,
    formalWeight: 0,
    executionAuthorized: false,
  };
}

export function negativeControlDigest(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
