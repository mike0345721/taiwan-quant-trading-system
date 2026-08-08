import crypto from 'node:crypto';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values) {
  if (!values.length) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

export function quantile(values, probability) {
  const sorted = values.filter(finite).map(Number).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function pearson(leftValues, rightValues) {
  if (leftValues.length !== rightValues.length || leftValues.length < 3) return null;
  const leftMean = mean(leftValues);
  const rightMean = mean(rightValues);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftValues.length; index += 1) {
    const left = leftValues[index] - leftMean;
    const right = rightValues[index] - rightMean;
    covariance += left * right;
    leftVariance += left ** 2;
    rightVariance += right ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function ranks(values) {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const result = Array(values.length);
  let cursor = 0;
  while (cursor < ordered.length) {
    let end = cursor;
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[cursor].value) end += 1;
    const averageRank = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) result[ordered[index].index] = averageRank;
    cursor = end + 1;
  }
  return result;
}

export function spearman(leftValues, rightValues) {
  if (leftValues.length !== rightValues.length || leftValues.length < 3) return null;
  return pearson(ranks(leftValues), ranks(rightValues));
}

function correlationSummary(rows) {
  if (rows.length < 3) {
    return { n: rows.length, pearson: null, spearman: null, targetMean: null, targetSd: null };
  }
  const factors = rows.map((row) => row.factorValue);
  const targets = rows.map((row) => row.targetValue);
  return {
    n: rows.length,
    pearson: pearson(factors, targets),
    spearman: spearman(factors, targets),
    targetMean: mean(targets),
    targetSd: standardDeviation(targets),
  };
}

function bucketIndex(value, cuts) {
  let index = 0;
  while (index < cuts.length && value > cuts[index]) index += 1;
  return index + 1;
}

function quintileSummary(developmentRows, evaluationRows) {
  if (developmentRows.length < 20 || evaluationRows.length < 20) {
    return {
      developmentCuts: [],
      buckets: [],
      monotonicitySpearman: null,
      topMinusBottom: null,
      standardizedTopMinusBottom: null,
    };
  }
  const values = developmentRows.map((row) => row.factorValue);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((probability) => quantile(values, probability));
  const buckets = [1, 2, 3, 4, 5].map((bucket) => {
    const selected = evaluationRows.filter(
      (row) => bucketIndex(row.factorValue, cuts) === bucket,
    );
    return {
      bucket,
      n: selected.length,
      factorMin: selected.length ? Math.min(...selected.map((row) => row.factorValue)) : null,
      factorMax: selected.length ? Math.max(...selected.map((row) => row.factorValue)) : null,
      targetMean: mean(selected.map((row) => row.targetValue)),
    };
  });
  const complete = buckets.filter((bucket) => finite(bucket.targetMean));
  const monotonicity = complete.length >= 3
    ? spearman(complete.map((bucket) => bucket.bucket), complete.map((bucket) => bucket.targetMean))
    : null;
  const bottom = buckets[0].targetMean;
  const top = buckets[4].targetMean;
  const difference = finite(top) && finite(bottom) ? top - bottom : null;
  const targetSd = standardDeviation(evaluationRows.map((row) => row.targetValue));
  return {
    developmentCuts: cuts,
    buckets,
    monotonicitySpearman: monotonicity,
    topMinusBottom: difference,
    standardizedTopMinusBottom: finite(difference) && targetSd > 0 ? difference / targetSd : null,
  };
}

function groupedCorrelations(rows, key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key] ?? 'UNKNOWN';
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([group, selected]) => ({ group, ...correlationSummary(selected) }));
}

function contributionConcentration(rows) {
  if (rows.length < 5) return null;
  const factorMean = mean(rows.map((row) => row.factorValue));
  const targetMean = mean(rows.map((row) => row.targetValue));
  const contributions = rows
    .map((row) => Math.abs((row.factorValue - factorMean) * (row.targetValue - targetMean)))
    .sort((left, right) => right - left);
  const total = contributions.reduce((sum, value) => sum + value, 0);
  return total > 0 ? contributions.slice(0, 5).reduce((sum, value) => sum + value, 0) / total : null;
}

export function buildDailyTargets({
  marketRows,
  futuresContractRows,
  futuresOiRows,
}) {
  const market = [...marketRows].sort((left, right) => left.trade_date.localeCompare(right.trade_date));
  const contractByKey = new Map(
    futuresContractRows
      .filter((row) => row.product === 'TX' && row.session === '一般')
      .map((row) => [`${row.trade_date}:${row.contract}`, row]),
  );
  const oiByDate = new Map(futuresOiRows.map((row) => [row.trade_date, row]));
  const returns = market.map((row) => Number(row.tx_change_pct) / 100);
  const result = [];
  for (let index = 1; index < market.length; index += 1) {
    const source = market[index - 1];
    const outcome = market[index];
    const sameContract = source.tx_contract === outcome.tx_contract;
    const contract = contractByKey.get(`${outcome.trade_date}:${source.tx_contract}`) || null;
    const priorReturns = returns.slice(Math.max(0, index - 20), index).filter(finite);
    const priorRv20 = priorReturns.length >= 20
      ? standardDeviation(priorReturns)
      : null;
    const priorTrend20 = index >= 20 && finite(market[index - 20].tx_close) && finite(source.tx_close)
      ? Number(source.tx_close) / Number(market[index - 20].tx_close) - 1
      : null;
    const next5 = market[index + 4] || null;
    result.push({
      decisionTradeDate: outcome.trade_date,
      sourceTradeDate: source.trade_date,
      sourceContract: source.tx_contract,
      outcomeContract: outcome.tx_contract,
      sameContract,
      rollTransition: !sameContract,
      nextDayReturn: sameContract && finite(source.tx_close) && finite(outcome.tx_close)
        ? Number(outcome.tx_close) / Number(source.tx_close) - 1
        : null,
      nextDayDirection: sameContract && finite(source.tx_close) && finite(outcome.tx_close)
        ? (Number(outcome.tx_close) / Number(source.tx_close) - 1 > 0 ? 1 : 0)
        : null,
      nextDayAbsoluteReturn: sameContract && finite(source.tx_close) && finite(outcome.tx_close)
        ? Math.abs(Number(outcome.tx_close) / Number(source.tx_close) - 1)
        : null,
      nextDayRange: sameContract && contract && finite(contract.high)
        && finite(contract.low) && finite(source.tx_close)
        ? (Number(contract.high) - Number(contract.low)) / Number(source.tx_close)
        : null,
      next5dReturn: next5 && next5.tx_contract === source.tx_contract
        && finite(next5.tx_close) && finite(source.tx_close)
        ? Number(next5.tx_close) / Number(source.tx_close) - 1
        : null,
      priorRv20,
      priorTrend20,
      daysToNearExpiry: oiByDate.get(source.trade_date)?.days_to_near_expiry ?? null,
      outcomeAvailableAt: `${outcome.trade_date}T23:59:59+08:00`,
    });
  }
  return result;
}

export function buildFixedSplit(targetRows) {
  const dates = targetRows.map((row) => row.decisionTradeDate).sort();
  const trainCount = Math.max(360, Math.floor(dates.length * 0.70));
  if (trainCount + 2 >= dates.length) {
    return {
      foldId: 'CHRONO_70_30_PURGE_1',
      trainEndDate: null,
      purgeDate: null,
      evaluationStartDate: null,
      eligible: false,
    };
  }
  return {
    foldId: 'CHRONO_70_30_PURGE_1',
    trainEndDate: dates[trainCount - 1],
    purgeDate: dates[trainCount],
    evaluationStartDate: dates[trainCount + 1],
    eligible: true,
  };
}

function targetThresholds(targetRows, split) {
  const development = targetRows.filter((row) => (
    split.eligible
    && row.decisionTradeDate <= split.trainEndDate
    && finite(row.nextDayReturn)
  ));
  const absolute = development.map((row) => row.nextDayAbsoluteReturn);
  const returns = development.map((row) => row.nextDayReturn);
  const rv = development.map((row) => row.priorRv20);
  const trend = development.map((row) => Math.abs(row.priorTrend20));
  return {
    largeMove80: quantile(absolute, 0.80),
    downsideTail10: quantile(returns, 0.10),
    highVolMedian: quantile(rv, 0.50),
    trendMagnitudeMedian: quantile(trend, 0.50),
  };
}

function targetValue(row, targetId, thresholds) {
  if (targetId === 'next_day_tx_return') return row.nextDayReturn;
  if (targetId === 'next_day_direction') return row.nextDayDirection;
  if (targetId === 'next_day_absolute_return') return row.nextDayAbsoluteReturn;
  if (targetId === 'next_day_range') return row.nextDayRange;
  if (targetId === 'next_5d_tx_return') return row.next5dReturn;
  if (targetId === 'next_day_large_move') {
    return finite(row.nextDayAbsoluteReturn) && finite(thresholds.largeMove80)
      ? (row.nextDayAbsoluteReturn >= thresholds.largeMove80 ? 1 : 0)
      : null;
  }
  if (targetId === 'next_day_downside_tail') {
    return finite(row.nextDayReturn) && finite(thresholds.downsideTail10)
      ? (row.nextDayReturn <= thresholds.downsideTail10 ? 1 : 0)
      : null;
  }
  return null;
}

export function analyzeUnivariate({
  factorId,
  targetId,
  featureRows,
  targetRows,
  minimumEvaluationRows = 60,
}) {
  const pairs = buildUnivariatePairs({
    factorId,
    targetId,
    featureRows,
    targetRows,
  });
  const {
    split,
    thresholds,
    joined,
    development,
    evaluation,
  } = pairs;
  const status = evaluation.length >= minimumEvaluationRows
    ? 'DESCRIPTIVE_COMPLETE'
    : 'INSUFFICIENT_DATA';
  return {
    schemaVersion: 'phase-a-a12-univariate-v1',
    factorId,
    targetId,
    fold: split,
    thresholdsFromDevelopmentOnly: thresholds,
    counts: {
      full: joined.length,
      development: development.length,
      purge: joined.filter((row) => row.decisionTradeDate === split.purgeDate).length,
      evaluation: evaluation.length,
    },
    full: correlationSummary(joined),
    development: correlationSummary(development),
    evaluation: correlationSummary(evaluation),
    evaluationQuintiles: quintileSummary(development, evaluation),
    evaluationStability: {
      byYear: groupedCorrelations(evaluation, 'year'),
      byVolatilityRegime: groupedCorrelations(evaluation, 'volatilityRegime'),
      byTrendRegime: groupedCorrelations(evaluation, 'trendRegime'),
      bySettlementRegime: groupedCorrelations(evaluation, 'settlementRegime'),
      top5ContributionShare: contributionConcentration(evaluation),
    },
    evaluationStatus: status,
    historicalEvidence: status === 'DESCRIPTIVE_COMPLETE' ? 'UNASSESSED_UNTIL_A13' : 'INSUFFICIENT',
    promotionEligible: false,
    promotionStage: 'F1_OR_F2_PENDING_A13',
    nextAllowedStep: status === 'DESCRIPTIVE_COMPLETE'
      ? 'A13_LOW_COST_NEGATIVE_CONTROLS'
      : 'PAUSE_OR_WAIT_FOR_DATA',
    researchOnly: true,
    formalWeight: 0,
    executionAuthorized: false,
  };
}

export function buildUnivariatePairs({
  factorId,
  targetId,
  featureRows,
  targetRows,
}) {
  const split = buildFixedSplit(targetRows);
  const thresholds = targetThresholds(targetRows, split);
  const targetsByDate = new Map(targetRows.map((row) => [row.decisionTradeDate, row]));
  const joined = featureRows
    .filter((row) => row.factorId === factorId && row.qualityState === 'PASS' && finite(row.value))
    .map((feature) => {
      const target = targetsByDate.get(feature.decisionTradeDate);
      if (!target) return null;
      const value = targetValue(target, targetId, thresholds);
      if (!finite(value)) return null;
      return {
        decisionTradeDate: feature.decisionTradeDate,
        factorValue: Number(feature.value),
        targetValue: Number(value),
        year: feature.decisionTradeDate.slice(0, 4),
        volatilityRegime: finite(target.priorRv20) && finite(thresholds.highVolMedian)
          ? (target.priorRv20 >= thresholds.highVolMedian ? 'HIGH_VOL' : 'LOW_VOL')
          : 'UNKNOWN',
        trendRegime: finite(target.priorTrend20) && finite(thresholds.trendMagnitudeMedian)
          ? (Math.abs(target.priorTrend20) >= thresholds.trendMagnitudeMedian ? 'TREND' : 'RANGE')
          : 'UNKNOWN',
        settlementRegime: finite(target.daysToNearExpiry)
          ? (Number(target.daysToNearExpiry) <= 5 ? 'SETTLEMENT_WINDOW' : 'NON_SETTLEMENT')
          : 'UNKNOWN',
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.decisionTradeDate.localeCompare(right.decisionTradeDate));
  const development = split.eligible
    ? joined.filter((row) => row.decisionTradeDate <= split.trainEndDate)
    : [];
  const evaluation = split.eligible
    ? joined.filter((row) => row.decisionTradeDate >= split.evaluationStartDate)
    : [];
  return {
    factorId,
    targetId,
    split,
    thresholds,
    joined,
    development,
    evaluation,
  };
}

export function univariateDigest(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
