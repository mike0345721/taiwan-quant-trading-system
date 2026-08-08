import { buildTargetPaths } from './target-feasibility.mjs';

const GROUPS = ['price', 'chip', 'oi', 'option', 'global'];

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function round(value, digits = 4) { return Number.isFinite(value) ? Number(value.toFixed(digits)) : null; }
function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function factorValues(path, informationSet = 'pre_open') {
  const globalValues = informationSet === 'post_close'
    ? [path.signalSoxReturnPct, path.signalNdxReturnPct, path.signalUsdtwdReturnPct].filter(finite).map((value) => Math.abs(Number(value)))
    : [path.entrySoxReturnPct, path.entryNdxReturnPct, path.entryUsdtwdReturnPct].filter(finite).map((value) => Math.abs(Number(value)));
  return {
    price: finite(path.atrPct) ? Number(path.atrPct) : finite(path.txReturn1d) ? Math.abs(Number(path.txReturn1d)) * 100 : null,
    chip: finite(path.foreignFuturesDelta5d) ? Math.abs(Number(path.foreignFuturesDelta5d)) : null,
    oi: finite(path.marketOiDelta1d) ? Math.abs(Number(path.marketOiDelta1d)) : null,
    option: finite(path.optionPc) ? Math.abs(Math.log(Number(path.optionPc))) : null,
    global: globalValues.length ? Math.max(...globalValues) : null,
  };
}

function calibrate(train, target) {
  const factors = train.map((path) => factorValues(path, target.informationSet));
  return {
    factorThresholds: Object.fromEntries(GROUPS.map((group) => [group, quantile(factors.map((row) => row[group]).filter(finite).map(Number), 0.7)])),
    targetHigh: quantile(train.map((row) => target.value(row)).filter(finite).map(Number), target.highQuantile),
    targetLow: target.lowQuantile == null ? null : quantile(train.map((row) => target.value(row)).filter(finite).map(Number), target.lowQuantile),
  };
}

function observation(path, target, calibration, excludedGroup = null) {
  const value = target.value(path); if (!finite(value) || !finite(calibration.targetHigh)) return null;
  let actual;
  if (target.lowQuantile != null) {
    if (Number(value) >= calibration.targetHigh) actual = 1;
    else if (finite(calibration.targetLow) && Number(value) <= calibration.targetLow) actual = 0;
    else return null;
  } else actual = Number(value) >= calibration.targetHigh ? 1 : 0;
  const factors = factorValues(path, target.informationSet); const groups = GROUPS.filter((group) => group !== excludedGroup && finite(factors[group]) && finite(calibration.factorThresholds[group]));
  if (groups.length < 3) return null;
  const votes = Object.fromEntries(groups.map((group) => [group, Number(factors[group]) > Number(calibration.factorThresholds[group]) ? 1 : 0]));
  return { signalDate: path.signalDate, actual, value: Number(value), score: 100 * Object.values(votes).reduce((sum, vote) => sum + vote, 0) / groups.length, votes };
}

function auc(rows) {
  const positive = rows.filter((row) => row.actual === 1); const negative = rows.filter((row) => row.actual === 0);
  if (!positive.length || !negative.length) return null;
  let wins = 0;
  for (const p of positive) for (const n of negative) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (positive.length * negative.length);
}

export function classificationMetrics(rows, scoreCutoff = 40) {
  const predicted = rows.filter((row) => row.score >= scoreCutoff); const positives = rows.filter((row) => row.actual === 1);
  const truePositive = predicted.filter((row) => row.actual === 1).length; const baseRate = rows.length ? positives.length / rows.length : null;
  const precision = predicted.length ? truePositive / predicted.length : null; const recall = positives.length ? truePositive / positives.length : null;
  return {
    samples: rows.length, positives: positives.length, predictedHighRisk: predicted.length,
    baseRate: round(baseRate), precision: round(precision), recall: round(recall),
    lift: finite(baseRate) && Number(baseRate) > 0 && finite(precision) ? round(Number(precision) / Number(baseRate)) : null,
    auc: round(auc(rows)),
    predictedMeanTarget: round(mean(predicted.map((row) => row.value))),
    otherMeanTarget: round(mean(rows.filter((row) => row.score < scoreCutoff).map((row) => row.value))),
  };
}

function seededRandom(seed = 2_026_713) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

function blockBootstrap(rows, iterations = 500, blockSize = 5) {
  if (rows.length < 30) return { iterations: 0, blockSize, auc95: [null, null], lift95: [null, null] };
  const random = seededRandom(rows.length * 97 + blockSize); const aucValues = []; const liftValues = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    while (sample.length < rows.length) {
      const start = Math.floor(random() * Math.max(1, rows.length - blockSize + 1));
      sample.push(...rows.slice(start, start + blockSize));
    }
    const metrics = classificationMetrics(sample.slice(0, rows.length));
    if (finite(metrics.auc)) aucValues.push(Number(metrics.auc));
    if (finite(metrics.lift)) liftValues.push(Number(metrics.lift));
  }
  return {
    iterations, blockSize,
    auc95: [round(quantile(aucValues, 0.025)), round(quantile(aucValues, 0.975))],
    lift95: [round(quantile(liftValues, 0.025)), round(quantile(liftValues, 0.975))],
  };
}

function evaluate(train, test, target, excludedGroup = null) {
  const calibration = calibrate(train, target);
  return test.map((path) => observation(path, target, calibration, excludedGroup)).filter(Boolean);
}

function targetDefinition(key) {
  if (key === 'large_move') return { key, label: '未來大行情', informationSet: 'pre_open', value: (row) => row.absoluteMovePct, highQuantile: 0.75, lowQuantile: null };
  if (key === 'gap_risk_postclose') return { key, label: '盤後預測隔夜跳空', informationSet: 'post_close', value: (row) => finite(row.gapPct) ? Math.abs(Number(row.gapPct)) : null, highQuantile: 0.75, lowQuantile: null };
  if (key === 'gap_risk_preopen') return { key, label: '開盤前即時跳空風險', informationSet: 'pre_open', value: (row) => finite(row.gapPct) ? Math.abs(Number(row.gapPct)) : null, highQuantile: 0.75, lowQuantile: null };
  return { key: 'trend_environment', label: '趨勢／震盪環境', informationSet: 'pre_open', value: (row) => row.efficiency, highQuantile: 0.7, lowQuantile: 0.3 };
}

function verdict(development, holdout) {
  if (holdout.samples < 40) return 'insufficient_holdout';
  if (development.auc >= 0.52 && development.lift >= 1.05 && holdout.auc >= 0.55 && holdout.lift >= 1.1) {
    if (holdout.confidence?.auc95?.[0] > 0.5 && holdout.confidence?.lift95?.[0] > 1) return 'supported_first_stage';
    return 'preliminary_signal';
  }
  if (development.auc < 0.5 && holdout.auc < 0.5) return 'inverse_or_failed';
  return 'not_stable';
}

export function runTargetStudy(paths, targetKey, assumptions = {}) {
  const target = targetDefinition(targetKey); const holdoutPct = assumptions.holdoutPct ?? 0.2; const minTrain = assumptions.minTrain ?? 250; const testWindow = assumptions.testWindow ?? 20;
  const split = Math.floor(paths.length * (1 - holdoutPct)); const developmentPaths = paths.slice(0, split); const holdoutPaths = paths.slice(split);
  const developmentRows = []; const foldMetrics = [];
  for (let start = minTrain; start < developmentPaths.length; start += testWindow) {
    const rows = evaluate(developmentPaths.slice(0, start), developmentPaths.slice(start, Math.min(start + testWindow, developmentPaths.length)), target);
    developmentRows.push(...rows); foldMetrics.push(classificationMetrics(rows));
  }
  const holdoutRows = evaluate(developmentPaths, holdoutPaths, target);
  const development = { ...classificationMetrics(developmentRows), confidence: blockBootstrap(developmentRows) };
  const holdout = { ...classificationMetrics(holdoutRows), confidence: blockBootstrap(holdoutRows) };
  const ablations = GROUPS.map((group) => {
    const rows = evaluate(developmentPaths, holdoutPaths, target, group); const metrics = classificationMetrics(rows);
    return { excludedGroup: group, ...metrics, aucChangeVsFull: finite(metrics.auc) && finite(holdout.auc) ? round(metrics.auc - holdout.auc) : null, liftChangeVsFull: finite(metrics.lift) && finite(holdout.lift) ? round(metrics.lift - holdout.lift) : null };
  });
  return {
    key: `${target.key}_h${assumptions.horizon}`,
    label: `${target.label}｜${assumptions.horizon}日`,
    horizon: assumptions.horizon,
    target: target.key,
    timing: target.informationSet === 'post_close' ? '訊號日盤後當時已知資料，不使用其後海外行情' : '訊號日盤後籌碼＋下一交易日開盤前已知海外資料',
    score: '五群等權；每群最多一票；分數40以上列高風險／趨勢候選',
    development, holdout, positiveFolds: foldMetrics.filter((row) => row.auc > 0.5).length, totalFolds: foldMetrics.filter((row) => finite(row.auc)).length,
    verdict: verdict(development, holdout), ablations,
  };
}

export function runMultiTargetResearch(rows, assumptions = {}) {
  const studies = [];
  for (const horizon of [1, 2, 3]) {
    const paths = buildTargetPaths(rows, horizon);
    studies.push(runTargetStudy(paths, 'large_move', { ...assumptions, horizon }));
    if (horizon === 1) {
      studies.push(runTargetStudy(paths, 'gap_risk_postclose', { ...assumptions, horizon }));
      studies.push(runTargetStudy(paths, 'gap_risk_preopen', { ...assumptions, horizon }));
    }
    if (horizon >= 2) studies.push(runTargetStudy(paths, 'trend_environment', { ...assumptions, horizon }));
  }
  return { generatedAt: new Date().toISOString(), assumptions: { holdoutPct: assumptions.holdoutPct ?? 0.2, minTrain: assumptions.minTrain ?? 250, testWindow: assumptions.testWindow ?? 20, factorQuantile: 0.7, targetLargeMoveQuantile: 0.75, scoreCutoff: 40, optimizedWeights: false }, studies };
}
