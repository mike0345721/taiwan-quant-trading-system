import { calculateMetrics, enforceNonOverlappingTrades, evaluateHoldout } from './backtest-engine.mjs';

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }

export function riskAdjustedUtility(metrics, rules = {}) {
  const trades = Number(metrics?.trades || 0);
  if (!trades) return Number.NEGATIVE_INFINITY;
  const reliabilityTarget = rules.reliabilityTrades ?? 30;
  const reliability = Math.min(1, Math.sqrt(trades / reliabilityTarget));
  const expectancy = finite(metrics.averageNetPoints) ? Number(metrics.averageNetPoints) : Number(metrics.totalNetPoints || 0) / trades;
  const drawdownPerTrade = Math.max(0, Number(metrics.maxDrawdownPoints || 0)) / trades;
  const tailMae = finite(metrics.mae10PctPoints) ? Math.abs(Number(metrics.mae10PctPoints)) : 0;
  return expectancy * reliability
    - drawdownPerTrade * (rules.drawdownPenaltyWeight ?? 0.25)
    - tailMae * (rules.tailMaePenaltyWeight ?? 0.10);
}

export function chooseHoldingPeriod(evaluations, rules = {}) {
  const minimumTrades = rules.minimumTrades ?? 10;
  const minimumProfitFactor = rules.minimumProfitFactor ?? 1.05;
  const eligible = evaluations.filter((item) => item.metrics?.trades >= minimumTrades
    && finite(item.metrics?.profitFactor) && Number(item.metrics.profitFactor) >= minimumProfitFactor
    && Number(item.metrics?.totalNetPoints) > 0);
  if (!eligible.length) return { choice: 'no_trade', reason: 'inner_validation_failed', eligible: [] };
  const ranked = eligible.map((item) => ({ ...item, utility: riskAdjustedUtility(item.metrics, rules) }))
    .filter((item) => Number.isFinite(item.utility) && item.utility > (rules.minimumUtility ?? 0));
  if (!ranked.length) return { choice: 'no_trade', reason: 'risk_adjusted_utility_failed', eligible: [] };
  ranked.sort((a, b) => Number(b.utility) - Number(a.utility)
    || Number(b.metrics.profitFactor) - Number(a.metrics.profitFactor)
    || Number(b.metrics.totalNetPoints) - Number(a.metrics.totalNetPoints)
    || Number(a.strategy.holdingDays) - Number(b.strategy.holdingDays));
  return { choice: ranked[0].strategy.key, reason: 'best_risk_adjusted_inner_validation',
    eligible: ranked.map((item) => item.strategy.key), ranking: ranked.map((item) => ({ key: item.strategy.key, utility: item.utility })) };
}

function innerEvaluation(trainingRows, strategy, assumptions) {
  const minimum = assumptions.innerMinTrainDays ?? 100;
  if (trainingRows.length <= minimum + 10) return { strategy, available: false, metrics: calculateMetrics([]) };
  const result = evaluateHoldout(trainingRows, strategy, {
    ...assumptions,
    minTrainDays: minimum,
    holdoutPct: assumptions.innerHoldoutPct ?? 0.25,
  });
  return { strategy, available: result.available, metrics: result.metrics };
}

function exactTestWindow(trainingRows, testingRows, strategy, assumptions) {
  const combined = [...trainingRows, ...testingRows];
  return evaluateHoldout(combined, strategy, {
    ...assumptions,
    minTrainDays: trainingRows.length,
    holdoutPct: testingRows.length / combined.length,
  });
}

export function nestedHoldingStudy(rows, strategies, assumptions = {}) {
  const finalHoldoutPct = assumptions.finalHoldoutPct ?? 0.20;
  const developmentEnd = Math.floor(rows.length * (1 - finalHoldoutPct));
  const developmentRows = rows.slice(0, developmentEnd);
  const outerMinTrainDays = assumptions.outerMinTrainDays ?? 160;
  const outerTestWindowDays = assumptions.outerTestWindowDays ?? 20;
  const folds = []; const developmentDaily = [];
  for (let start = outerMinTrainDays, foldIndex = 0; start < developmentRows.length; start += outerTestWindowDays, foldIndex += 1) {
    const training = developmentRows.slice(0, start);
    const testing = developmentRows.slice(start, Math.min(developmentRows.length, start + outerTestWindowDays));
    if (!testing.length) break;
    const inner = strategies.map((strategy) => innerEvaluation(training, strategy, assumptions));
    const selection = chooseHoldingPeriod(inner, assumptions.selectionRules);
    let daily = testing.map((row) => ({ ...row, signal: 0, netPoints: 0, netReturnPct: 0, foldIndex, holdingChoice: 'no_trade' }));
    if (selection.choice !== 'no_trade') {
      const strategy = strategies.find((item) => item.key === selection.choice);
      daily = exactTestWindow(training, testing, strategy, assumptions).daily.map((row) => ({ ...row, foldIndex, holdingChoice: selection.choice }));
    }
    developmentDaily.push(...daily);
    folds.push({ foldIndex, trainEnd: training.at(-1)?.tradeDate, testStart: testing[0]?.tradeDate, testEnd: testing.at(-1)?.tradeDate,
      choice: selection.choice, reason: selection.reason, inner: inner.map((item) => ({ key: item.strategy.key, metrics: item.metrics })) });
  }
  const developmentExecuted = enforceNonOverlappingTrades(developmentDaily);
  const finalInner = strategies.map((strategy) => innerEvaluation(developmentRows, strategy, assumptions));
  const finalSelection = chooseHoldingPeriod(finalInner, assumptions.selectionRules);
  let finalDaily = rows.slice(developmentEnd).map((row) => ({ ...row, signal: 0, netPoints: 0, netReturnPct: 0, holdingChoice: 'no_trade' }));
  if (finalSelection.choice !== 'no_trade') {
    const strategy = strategies.find((item) => item.key === finalSelection.choice);
    finalDaily = exactTestWindow(developmentRows, rows.slice(developmentEnd), strategy, assumptions).daily.map((row) => ({ ...row, holdingChoice: finalSelection.choice }));
  }
  return {
    assumptions: {
      finalHoldoutPct, outerMinTrainDays, outerTestWindowDays,
      innerMinTrainDays: assumptions.innerMinTrainDays ?? 100,
      innerHoldoutPct: assumptions.innerHoldoutPct ?? 0.25,
      selectionRules: { minimumTrades: 10, minimumProfitFactor: 1.05, reliabilityTrades: 30,
        drawdownPenaltyWeight: 0.25, tailMaePenaltyWeight: 0.10, minimumUtility: 0, ...assumptions.selectionRules },
      selectionTiming: 'each choice uses only dates earlier than its test window',
    },
    development: { metrics: calculateMetrics(developmentExecuted), folds },
    finalHoldout: { choice: finalSelection.choice, reason: finalSelection.reason, inner: finalInner.map((item) => ({ key: item.strategy.key, metrics: item.metrics })), metrics: calculateMetrics(finalDaily), daily: finalDaily },
  };
}
