import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { analyzeGlobalContext, analyzeOptionWalls, calculateMetrics, loadResearchRows, runAllStrategies, walkForward, evaluateHoldout } from '../src/backtest-engine.mjs';
import { tradingCostDefaults } from '../src/trading-costs.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const assumptions = { minTrainDays: 100, testWindowDays: 20, costPoints: 8, holdoutPct: 0.20, quantileLow: 0.30, quantileHigh: 0.70, minWalkForwardTrades: 30, minHoldoutTrades: 15, executionModelVersion: '2.0.0-fixed-contract-mae-mfe' };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function foldStability(folds) {
  const totals = folds.map((fold) => Number(fold.metrics.totalNetPoints) || 0).sort((a, b) => a - b);
  const middle = Math.floor(totals.length / 2);
  const medianNetPoints = totals.length % 2 ? totals[middle] : ((totals[middle - 1] || 0) + (totals[middle] || 0)) / 2;
  return {
    totalFolds: totals.length,
    positiveFolds: totals.filter((value) => value > 0).length,
    negativeFolds: totals.filter((value) => value < 0).length,
    flatFolds: totals.filter((value) => value === 0).length,
    medianNetPoints,
  };
}

function stressDiagnostics(result, holdout) {
  const developmentLong = result.daily.filter((row) => row.signal > 0);
  const developmentShort = result.daily.filter((row) => row.signal < 0);
  const holdoutLong = (holdout?.daily || []).filter((row) => row.signal > 0);
  const holdoutShort = (holdout?.daily || []).filter((row) => row.signal < 0);
  const combined = [...result.daily, ...(holdout?.daily || [])].filter((row) => row.signal !== 0);
  const bestWinners = combined.filter((row) => row.netPoints > 0).sort((a, b) => b.netPoints - a.netPoints);
  const withoutBest = (count) => calculateMetrics(combined.filter((row) => !bestWinners.slice(0, count).includes(row)));
  return {
    disclaimer: '事後診斷只用來辨認獲利來源，不是新的獨立樣本外驗證。',
    direction: {
      developmentLong: calculateMetrics(developmentLong), developmentShort: calculateMetrics(developmentShort),
      holdoutLong: calculateMetrics(holdoutLong), holdoutShort: calculateMetrics(holdoutShort),
    },
    profitConcentration: {
      combined: calculateMetrics(combined),
      withoutBest1: withoutBest(1), withoutBest3: withoutBest(3), withoutBest5: withoutBest(5),
    },
  };
}
function registerStrategy(strategy) {
  const definition = { key: strategy.key, label: strategy.label, mode: strategy.mode, feature: strategy.feature || null, quantiles: [0.30, 0.70] };
  if (strategy.allowedRegimes?.length) definition.allowedRegimes = strategy.allowedRegimes;
  if (strategy.target) definition.target = strategy.target;
  if (strategy.direction) definition.direction = strategy.direction;
  if (strategy.signalSide) definition.signalSide = strategy.signalSide;
  if (strategy.holdingDays) definition.holdingDays = strategy.holdingDays;
  if (strategy.pair) definition.pair = strategy.pair;
  const parameters = canonical(definition);
  db.prepare('INSERT OR IGNORE INTO strategy_versions(strategy_key, version, parameters_json, created_at) VALUES (?, ?, ?, ?)').run(strategy.key, strategy.version, parameters, new Date().toISOString());
  const saved = db.prepare('SELECT parameters_json FROM strategy_versions WHERE strategy_key=? AND version=?').get(strategy.key, strategy.version);
  if (saved.parameters_json !== parameters) throw new Error(`Immutable strategy version conflict: ${strategy.key}@${strategy.version}`);
}

function saveResult(result, holdout) {
  registerStrategy(result.strategy);
  const startedAt = new Date().toISOString();
  const run = db.prepare(`INSERT INTO backtest_runs(strategy_key, strategy_version, started_at, first_trade_date, last_trade_date, sample_size, assumptions_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`).run(result.strategy.key, result.strategy.version, startedAt, result.daily[0]?.tradeDate, result.daily.at(-1)?.tradeDate, result.metrics.evaluatedDays, JSON.stringify(result.assumptions));
  const runId = Number(run.lastInsertRowid);
  const insertFold = db.prepare('INSERT INTO backtest_folds VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertDaily = db.prepare('INSERT INTO backtest_daily_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const fold of result.folds) insertFold.run(runId, fold.foldIndex, fold.trainStart, fold.trainEnd, fold.testStart, fold.testEnd, JSON.stringify(fold.thresholds), JSON.stringify(fold.metrics));
    for (const row of [...result.daily, ...(holdout?.daily || [])]) {
      const snapshot = {
        split: row.foldIndex === -1 ? 'final_holdout' : 'walk_forward', holdingPeriod: result.assumptions.holdingPeriod,
        executionModelVersion: result.assumptions.executionModelVersion, entryContract: row.entryContract, targetContract: row.targetContract,
        contractConsistent: row.contractConsistent, maePoints: row.maePoints, mfePoints: row.mfePoints, costBreakdown: row.costBreakdown || null,
        foreignSpot5d: row.foreignSpot5d, foreignFutures: row.foreignFutures, trustFutures: row.trustFutures, dealerFutures: row.dealerFutures,
        foreignFuturesDelta1d: row.foreignFuturesDelta1d, trustFuturesDelta1d: row.trustFuturesDelta1d, dealerFuturesDelta1d: row.dealerFuturesDelta1d,
        foreignLongDelta1d: row.foreignLongDelta1d, foreignShortDelta1d: row.foreignShortDelta1d, foreignShortDelta3d: row.foreignShortDelta3d,
        foreignShortDelta5d: row.foreignShortDelta5d, foreignFuturesDelta5d: row.foreignFuturesDelta5d, optionPc: row.optionPc,
        txReturn1d: row.txReturn1d, txReturn3d: row.txReturn3d, marketOiDelta1d: row.marketOiDelta1d, marketOiDelta3d: row.marketOiDelta3d,
        atr20: row.atr20, maxPainDistance: row.maxPainDistance, maxPainDistanceChange: row.maxPainDistanceChange, daysToExpiry: row.daysToExpiry,
        callWallMove1d: row.callWallMove1d, putWallMove1d: row.putWallMove1d, callWallOiDelta1d: row.callWallOiDelta1d,
        putWallOiDelta1d: row.putWallOiDelta1d, callWallStableDays: row.callWallStableDays, putWallStableDays: row.putWallStableDays,
        callBreakout: row.callBreakout, putBreakdown: row.putBreakdown, soxReturnPct: row.soxReturnPct, soxSourceDate: row.soxSourceDate,
        ndxReturnPct: row.ndxReturnPct, ndxSourceDate: row.ndxSourceDate, usdtwdReturnPct: row.usdtwdReturnPct, usdtwdSourceDate: row.usdtwdSourceDate,
      };
      insertDaily.run(runId, row.tradeDate, row.targetTradeDate || row.nextTradeDate, row.foldIndex, row.signal, row.regime,
        row.entryClose ?? row.txClose, row.exitClose ?? row.nextTxClose, row.grossPoints, row.costPoints, row.netPoints, row.netReturnPct, JSON.stringify(snapshot));
    }
    db.prepare(`UPDATE backtest_runs SET finished_at=?, results_json=?, status='completed' WHERE id=?`).run(new Date().toISOString(), JSON.stringify({ metrics: result.metrics, byRegime: result.byRegime, folds: result.folds.length, holdout: holdout ? { testStart: holdout.testStart, testEnd: holdout.testEnd, metrics: holdout.metrics } : null }), runId);
    db.exec('COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); db.prepare(`UPDATE backtest_runs SET finished_at=?, status='failed', error=? WHERE id=?`).run(new Date().toISOString(), error.message, runId); throw error; }
  return runId;
}

try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db);
  const splitIndex = Math.max(assumptions.minTrainDays, Math.floor(rows.length * (1 - assumptions.holdoutPct)));
  const developmentRows = rows.slice(0, splitIndex);
  const results = runAllStrategies(developmentRows, assumptions);
  const report = { generatedAt: new Date().toISOString(), researchRows: rows.length, developmentRows: developmentRows.length, finalHoldoutRows: rows.length - developmentRows.length, assumptions, disclaimer: 'Research only. The preserved baseline deducts 8 points for comparability. Contract scenarios use the confirmed broker commission schedule plus tax and slippage assumptions. No live orders.', optionWallDiagnostics: analyzeOptionWalls(rows), globalContextDiagnostics: analyzeGlobalContext(rows), strategies: [] };
  for (const result of results) {
    const holdout = evaluateHoldout(rows, result.strategy, assumptions);
    const costSensitivity = Object.fromEntries([4, 8, 12].map((costPoints) => [costPoints, walkForward(developmentRows, result.strategy, { ...assumptions, costPoints }).metrics]));
    const contractCostSensitivity = Object.fromEntries(Object.entries(tradingCostDefaults.contracts).map(([instrument, contract]) => [instrument, walkForward(developmentRows, result.strategy, {
      ...assumptions,
      costModel: { instrument, commissionPerSide: contract.commissionPerSide, slippagePointsRoundTrip: 2 },
      executionModelVersion: '3.0.0-contract-tax-commission-slippage',
    }).metrics]));
    const parameterSensitivity = Object.fromEntries([[0.20, 0.80], [0.30, 0.70], [0.40, 0.60]].map(([quantileLow, quantileHigh]) => [`${quantileLow}-${quantileHigh}`, walkForward(developmentRows, result.strategy, { ...assumptions, quantileLow, quantileHigh }).metrics]));
    const walkForwardPositive = result.metrics.totalNetPoints > 0 && result.metrics.profitFactor > 1;
    const holdoutPositive = holdout.metrics.totalNetPoints > 0 && holdout.metrics.profitFactor > 1;
    const positiveCostScenarios = Object.values(costSensitivity).filter((metrics) => metrics.totalNetPoints > 0 && metrics.profitFactor > 1).length;
    const positiveParameterScenarios = Object.values(parameterSensitivity).filter((metrics) => metrics.totalNetPoints > 0 && metrics.profitFactor > 1).length;
    const stability = foldStability(result.folds);
    const sampleEnough = result.metrics.trades >= assumptions.minWalkForwardTrades && holdout.metrics.trades >= assumptions.minHoldoutTrades;
    const foldStable = stability.positiveFolds > stability.negativeFolds && stability.medianNetPoints > 0;
    const robustEnough = positiveCostScenarios >= 2 && positiveParameterScenarios >= 2 && foldStable;
    const gate = !walkForwardPositive ? 'failed_walk_forward'
      : !holdoutPositive ? 'failed_holdout'
        : !sampleEnough ? 'insufficient_sample'
          : !foldStable ? 'failed_fold_stability'
          : !robustEnough ? 'failed_robustness'
            : 'passed_first_gate';
    report.strategies.push({ runId: saveResult(result, holdout), key: result.strategy.key, version: result.strategy.version, label: result.strategy.label, researchFamily: result.strategy.researchFamily || null, researchRole: result.strategy.researchRole || 'strategy', gate, robustness: { sampleEnough, foldStable, robustEnough, positiveCostScenarios, totalCostScenarios: Object.keys(costSensitivity).length, positiveParameterScenarios, totalParameterScenarios: Object.keys(parameterSensitivity).length }, metrics: result.metrics, holdout: { testStart: holdout.testStart, testEnd: holdout.testEnd, metrics: holdout.metrics, byRegime: holdout.byRegime }, byRegime: result.byRegime, costSensitivity, contractCostSensitivity, parameterSensitivity, foldStability: stability, stressDiagnostics: stressDiagnostics(result, holdout), folds: result.folds.length });
  }
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const output = path.join(config.reportsPath, 'latest-backtest.json'); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.V2_QUIET === '1') {
    console.log(JSON.stringify({ generatedAt: report.generatedAt, researchRows: report.researchRows, developmentRows: report.developmentRows, finalHoldoutRows: report.finalHoldoutRows, strategies: report.strategies.map(({ label, gate, metrics, holdout, foldStability }) => ({ label, gate, walkForward: metrics, holdout: holdout.metrics, foldStability })) }, null, 2));
  } else console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
