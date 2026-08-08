import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOptionWalls, walkForward, calculateMetrics, enforceNonOverlappingTrades, foreignLedConfirmedSignal, institutionalAlignmentSignal, institutionalPairSignal, strategyDefinitions, evaluateHoldout } from '../src/backtest-engine.mjs';

function sampleRows(count = 130) {
  const dateAt = (index) => new Date(Date.UTC(2025, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: dateAt(index),
    nextTradeDate: dateAt(index + 1),
    txClose: 20_000 + index * 10,
    txContract: '202601',
    txOpen: 19_995 + index * 10,
    nextTxOpen: 20_005 + index * 10,
    nextTxClose: 20_010 + index * 10,
    nextTxContract: '202601',
    futureTradeDate2: dateAt(index + 2), futureTxClose2: 20_020 + index * 10,
    futureTradeDate3: dateAt(index + 3), futureTxClose3: 20_030 + index * 10,
    futureTradeDate5: dateAt(index + 5), futureTxClose5: 20_050 + index * 10,
    futureTxContract2: '202601', futureTxContract3: '202601', futureTxContract5: '202601',
    futureBars: Array.from({ length: 5 }, (_, offset) => ({ tradeDate: dateAt(index + offset + 1), txContract: '202601', open: 20_005 + index * 10, high: 20_030 + index * 10 + offset * 10, low: 19_990 + index * 10, close: 20_010 + index * 10 + offset * 10 })),
    foreignSpot5d: index,
    foreignShortDelta1d: index,
    foreignShortDelta3d: index,
    foreignFuturesDelta5d: index * 2,
    optionPc: 0.5 + index / 100,
    maxPainDistanceChange: -10,
    maxPainDistance: 50,
    maxPainSignedDistance: 100,
    atr20: 100,
    txReturn1d: 0.01,
    marketOiDelta1d: 100,
    marketOiDelta3d: 300,
    txReturn3d: 0.02,
    daysToExpiry: 3,
    regime: 'range',
  }));
}

test('Walk-forward thresholds are calibrated only on past training rows', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_spot_5d');
  const original = sampleRows();
  const altered = sampleRows();
  altered.slice(100).forEach((row) => { row.foreignSpot5d = 1_000_000; });
  const first = walkForward(original, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 8 });
  const second = walkForward(altered, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 8 });
  assert.deepEqual(first.folds[0].thresholds, second.folds[0].thresholds);
  assert.equal(first.folds[0].trainEnd, original[99].tradeDate);
  assert.equal(first.folds[0].testStart, original[100].tradeDate);
});

test('Trading cost is deducted only when a position is opened', () => {
  const metrics = calculateMetrics([
    { signal: 1, netPoints: 12, netReturnPct: 0.1 },
    { signal: 0, netPoints: 0, netReturnPct: 0 },
    { signal: -1, netPoints: -4, netReturnPct: -0.03 },
  ]);
  assert.equal(metrics.trades, 2);
  assert.equal(metrics.totalNetPoints, 8);
  assert.equal(metrics.winRatePct, 50);
});

test('Contract-aware cost model converts tax, commission and slippage into index points', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_spot_5d');
  const rows = sampleRows(105);
  const result = walkForward(rows, strategy, {
    minTrainDays: 100,
    testWindowDays: 20,
    costModel: { instrument: 'TMF', commissionPerSide: 12, slippagePointsRoundTrip: 2 },
  });
  const trade = result.daily.find((row) => row.signal !== 0);
  assert.equal(trade.costBreakdown.instrument, 'TMF');
  assert.ok(trade.costPoints > 5 && trade.costPoints < 7);
  assert.equal(result.assumptions.costModel.instrument, 'TMF');
});

test('Overlapping multi-day signals are suppressed until the prior position exits', () => {
  const trades = enforceNonOverlappingTrades([
    { tradeDate: '2026-01-01', entryTradeDate: '2026-01-02', targetTradeDate: '2026-01-06', signal: 1, grossPoints: 40, costPoints: 8, netPoints: 32, netReturnPct: 0.1 },
    { tradeDate: '2026-01-02', entryTradeDate: '2026-01-05', targetTradeDate: '2026-01-09', signal: 1, grossPoints: 70, costPoints: 8, netPoints: 62, netReturnPct: 0.2 },
    { tradeDate: '2026-01-06', entryTradeDate: '2026-01-07', targetTradeDate: '2026-01-13', signal: -1, grossPoints: 50, costPoints: 8, netPoints: 42, netReturnPct: 0.15 },
  ]);
  assert.equal(trades[0].signal, 1);
  assert.equal(trades[1].signal, 0);
  assert.equal(trades[1].overlapSuppressed, true);
  assert.equal(trades[2].signal, -1);
});

test('Institutional alignment separates net inventory, daily action and price-OI confirmation', () => {
  const row = {
    foreignFutures: -1000, trustFutures: -100, dealerFutures: -50,
    foreignFuturesDelta1d: 200, trustFuturesDelta1d: 20, dealerFuturesDelta1d: 10,
    txReturn1d: 0.01, marketOiDelta1d: 500,
  };
  assert.equal(institutionalAlignmentSignal(row, 'net'), -1);
  assert.equal(institutionalAlignmentSignal(row, 'delta'), 1);
  assert.equal(institutionalAlignmentSignal(row, 'confirmed'), 1);
  assert.equal(institutionalAlignmentSignal({ ...row, marketOiDelta1d: -1 }, 'confirmed'), 0);
  assert.equal(institutionalAlignmentSignal({ ...row, dealerFuturesDelta1d: -10 }, 'delta'), 0);
});

test('Institutional pair and foreign-led confirmation keep their preregistered roles', () => {
  const row = { foreignFuturesDelta1d: 500, trustFuturesDelta1d: 20, dealerFuturesDelta1d: -30, txReturn1d: 0.01, marketOiDelta1d: 100 };
  const threshold = { low: -100, high: 100 };
  assert.equal(institutionalPairSignal(row, 'foreign_trust'), 1);
  assert.equal(institutionalPairSignal(row, 'foreign_dealer'), 0);
  assert.equal(foreignLedConfirmedSignal(row, threshold), 1);
  assert.equal(foreignLedConfirmedSignal({ ...row, trustFuturesDelta1d: -1 }, threshold), 0);
  assert.equal(foreignLedConfirmedSignal({ ...row, txReturn1d: -0.01 }, threshold), 0);
});

test('Post-close research enters at the next tradable open instead of the signal-day close', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_spot_5d');
  const rows = sampleRows(105);
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].entryClose, rows[100].nextTxOpen);
  assert.equal(result.daily[0].exitClose, rows[100].nextTxClose);
  assert.equal(result.daily[0].grossPoints, 5);
  assert.equal(result.assumptions.holdingPeriod, 'next_taiwan_open_to_1_day_close');
});

test('Delayed holding periods share the next open but exit on their registered future close', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi_h3');
  const rows = sampleRows(106);
  Object.assign(rows[100], { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: 100 });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].entryClose, rows[100].nextTxOpen);
  assert.equal(result.daily[0].exitClose, rows[100].futureTxClose3);
  assert.equal(result.daily[0].targetTradeDate, rows[100].futureTradeDate3);
});

test('Multi-day outcomes never cross an active-contract rollover', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi_h3');
  const rows = sampleRows(106);
  Object.assign(rows[100], { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: 100 });
  rows[100].futureBars[2] = { ...rows[100].futureBars[2], txContract: '202602' };
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 0);
  assert.equal(result.daily[0].entryClose, undefined);
});

test('MAE and MFE follow the signal direction and future high-low path', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi_h2');
  const rows = sampleRows(105);
  Object.assign(rows[100], { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: 100, nextTxOpen: 21_005 });
  rows[100].futureBars = [
    { tradeDate: rows[100].nextTradeDate, txContract: '202601', open: 21_005, high: 21_080, low: 20_980, close: 21_030 },
    { tradeDate: rows[100].futureTradeDate2, txContract: '202601', open: 21_030, high: 21_120, low: 20_950, close: 21_040 },
  ];
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 1);
  assert.equal(result.daily[0].pathLow, 20_950);
  assert.equal(result.daily[0].pathHigh, 21_120);
  assert.equal(result.daily[0].maePoints, result.daily[0].pathLow - result.daily[0].entryClose);
  assert.equal(result.daily[0].mfePoints, result.daily[0].pathHigh - result.daily[0].entryClose);
  const activeTrades = result.daily.filter((row) => row.signal !== 0);
  const expectedAverageMae = activeTrades.reduce((sum, row) => sum + row.maePoints, 0) / activeTrades.length;
  assert.equal(result.metrics.averageMaePoints, expectedAverageMae);
});

test('Development results never consume an outcome beyond the development boundary', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi_h5');
  const rows = sampleRows(106);
  rows.forEach((row) => Object.assign(row, { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: 100 }));
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily.at(-1).signal, 0);
  assert.ok(result.daily.filter((row) => row.signal !== 0).every((row) => row.targetTradeDate <= rows.at(-1).tradeDate));
});

test('Large foreign short additions are short-only and no-drop variant requires OI growth without a prior decline', () => {
  const shortAdd = strategyDefinitions().find((item) => item.key === 'foreign_short_add_1d_h1');
  const noDrop = strategyDefinitions().find((item) => item.key === 'foreign_short_no_drop_h3');
  const rows = sampleRows(106);
  Object.assign(rows[100], { foreignShortDelta1d: 1_000, foreignShortDelta3d: 1_000, marketOiDelta3d: 500, txReturn3d: 0.01 });
  Object.assign(rows[101], { foreignShortDelta1d: -1_000, foreignShortDelta3d: 1_000, marketOiDelta3d: 500, txReturn3d: -0.01 });
  const shortResult = walkForward(rows, shortAdd, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  const noDropResult = walkForward(rows, noDrop, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(shortResult.daily[0].signal, -1);
  assert.equal(shortResult.daily[1].signal, 0);
  assert.equal(noDropResult.daily[0].signal, -1);
  assert.equal(noDropResult.daily[1].signal, 0);
});

test('Missing research values remain missing and never become zero signals', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_spot_5d');
  const rows = sampleRows(105);
  rows.slice(0, 101).forEach((row) => { row.foreignSpot5d = null; });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 0);
  assert.equal(result.folds[0].thresholds.foreignSpot5d.samples, 0);
});

test('Max Pain strategy only acts while distance shrinks near expiry', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'max_pain_convergence');
  const rows = sampleRows(105);
  rows[100].daysToExpiry = 8;
  rows[101].maxPainDistanceChange = 5;
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 0);
  assert.equal(result.daily[1].signal, 0);
  assert.equal(result.daily[2].signal, -1);
});

test('Final holdout thresholds never use holdout values', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_spot_5d');
  const original = sampleRows(150);
  const altered = sampleRows(150);
  altered.slice(120).forEach((row) => { row.foreignSpot5d = -9_999_999; });
  const first = evaluateHoldout(original, strategy, { holdoutPct: 0.20, minTrainDays: 100 });
  const second = evaluateHoldout(altered, strategy, { holdoutPct: 0.20, minTrainDays: 100 });
  assert.deepEqual(first.thresholds, second.thresholds);
  assert.equal(first.testStart, original[120].tradeDate);
  assert.equal(first.holdoutDays, 30);
});

test('Bull-regime alignment strategy stays flat outside bull regime', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'composite_bull_filter');
  const rows = sampleRows(105);
  rows.forEach((row) => { row.regime = 'range'; });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.metrics.trades, 0);
});

test('Bull-regime directional variants keep only their registered side', () => {
  const longOnly = strategyDefinitions().find((item) => item.key === 'composite_bull_long_only');
  const shortOnly = strategyDefinitions().find((item) => item.key === 'composite_bull_short_only');
  const rows = sampleRows(106);
  rows.forEach((row) => { row.regime = 'bull'; });
  Object.assign(rows[100], { foreignSpot5d: 1_000, foreignFuturesDelta5d: 1_000, optionPc: 10 });
  Object.assign(rows[101], { foreignSpot5d: -1_000, foreignFuturesDelta5d: -1_000, optionPc: -10 });
  const longResult = walkForward(rows, longOnly, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  const shortResult = walkForward(rows, shortOnly, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(longResult.daily[0].signal, 1);
  assert.equal(longResult.daily[1].signal, 0);
  assert.equal(shortResult.daily[0].signal, 0);
  assert.equal(shortResult.daily[1].signal, -1);
});

test('Foreign futures confirmation requires matching price direction and rising market OI', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi');
  const rows = sampleRows(105);
  Object.assign(rows[100], { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: 100 });
  Object.assign(rows[101], { foreignFuturesDelta5d: 1_000, txReturn1d: -0.01, marketOiDelta1d: 100 });
  Object.assign(rows[102], { foreignFuturesDelta5d: -1_000, txReturn1d: -0.01, marketOiDelta1d: 100 });
  Object.assign(rows[103], { foreignFuturesDelta5d: 1_000, txReturn1d: 0.01, marketOiDelta1d: -100 });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.deepEqual(result.daily.slice(0, 4).map((row) => row.signal), [1, 0, -1, 0]);
});

test('Chip incremental family preregisters price, OI, foreign and high-volatility filter layers', () => {
  const definitions = strategyDefinitions();
  const keys = definitions.filter((item) => item.researchFamily === 'chip_incremental_h2').map((item) => item.key).sort();
  assert.deepEqual(keys, [
    'foreign_futures_price_oi_h2', 'foreign_price_ablation_h2', 'foreign_price_oi_no_highvol_h2',
    'price_oi_benchmark_h2', 'price_only_benchmark_h2',
  ]);
  const filtered = definitions.find((item) => item.key === 'foreign_price_oi_no_highvol_h2');
  assert.deepEqual(filtered.allowedRegimes, ['bull', 'bear', 'range']);
});

test('Strict Max Pain convergence also requires one ATR proximity and one to three days to expiry', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'max_pain_atr_convergence');
  const rows = sampleRows(104);
  Object.assign(rows[100], { maxPainDistance: 80, atr20: 100, daysToExpiry: 2, maxPainDistanceChange: -10 });
  Object.assign(rows[101], { maxPainDistance: 120, atr20: 100, daysToExpiry: 2, maxPainDistanceChange: -10 });
  Object.assign(rows[102], { maxPainDistance: 80, atr20: 100, daysToExpiry: 4, maxPainDistanceChange: -10 });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.deepEqual(result.daily.slice(0, 3).map((row) => row.signal), [-1, 0, 0]);
});

test('Option wall migration only signals when both walls move in the same direction', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'option_wall_migration');
  const rows = sampleRows(104);
  rows[100].callWallMove1d = 100; rows[100].putWallMove1d = 100;
  rows[101].callWallMove1d = -100; rows[101].putWallMove1d = -100;
  rows[102].callWallMove1d = 100; rows[102].putWallMove1d = -100;
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 1);
  assert.equal(result.daily[1].signal, -1);
  assert.equal(result.daily[2].signal, 0);
});

test('Option wall breakout requires weakening OI or a wall moving with price', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'option_wall_breakout_oi');
  const rows = sampleRows(104);
  rows[100].callBreakout = true; rows[100].callWallOiDelta1d = -500; rows[100].callWallMove1d = 0;
  rows[101].putBreakdown = true; rows[101].putWallOiDelta1d = 200; rows[101].putWallMove1d = 0;
  rows[102].putBreakdown = true; rows[102].putWallOiDelta1d = 200; rows[102].putWallMove1d = -100;
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 1);
  assert.equal(result.daily[1].signal, 0);
  assert.equal(result.daily[2].signal, -1);
});

test('Option wall diagnostics separate movement, stability and breakout samples', () => {
  const rows = sampleRows(3);
  Object.assign(rows[0], { callWallMove1d: 100, putWallMove1d: 100, callWallStableDays: 1, putWallStableDays: 1, nextTxClose: rows[0].txClose + 20 });
  Object.assign(rows[1], { callWallMove1d: 0, putWallMove1d: 0, callWallStableDays: 3, putWallStableDays: 4, callBreakout: true, callWallOiDelta1d: -100, nextTxClose: rows[1].txClose + 10 });
  Object.assign(rows[2], { callWallMove1d: -100, putWallMove1d: -100, callWallStableDays: 1, putWallStableDays: 1, putBreakdown: true, putWallOiDelta1d: -100, nextTxClose: rows[2].txClose - 10 });
  const report = analyzeOptionWalls(rows);
  assert.equal(report.migration.bothUp.samples, 1);
  assert.equal(report.stability.bothStable3Days.samples, 1);
  assert.equal(report.breakout.aboveCallWithOiWeakening.directionHitPct, 100);
  assert.equal(report.breakout.belowPutWithOiWeakening.directionHitPct, 100);
});

test('Overseas context strategy measures Taiwan open-to-close instead of capturing the overnight gap', () => {
  const strategy = strategyDefinitions().find((item) => item.key === 'sox_overnight');
  const rows = sampleRows(105);
  rows.forEach((row, index) => { row.soxReturnPct = index; });
  const result = walkForward(rows, strategy, { minTrainDays: 100, testWindowDays: 20, costPoints: 0 });
  assert.equal(result.daily[0].signal, 1);
  assert.equal(result.daily[0].grossPoints, 5);
  assert.equal(result.daily[0].targetTradeDate, result.daily[0].tradeDate);
  assert.equal(result.assumptions.holdingPeriod, 'current_taiwan_open_to_current_taiwan_close');
});
