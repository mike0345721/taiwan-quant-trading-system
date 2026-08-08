import { calculateMetrics } from './backtest-engine.mjs';

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function active(rows) { return rows.filter((row) => Number(row.signal) !== 0); }

function suppressed(row) {
  return { ...row, signal: 0, grossPoints: 0, costPoints: 0, netPoints: 0, netReturnPct: 0, vetoSuppressed: true };
}

function summary(rows) {
  const metrics = calculateMetrics(rows);
  return {
    trades: metrics.trades,
    winRatePct: metrics.winRatePct,
    profitFactor: metrics.profitFactor,
    totalNetPoints: metrics.totalNetPoints,
    maxDrawdownPoints: metrics.maxDrawdownPoints,
    averageMaePoints: metrics.averageMaePoints,
    mae10PctPoints: metrics.mae10PctPoints,
    worstMaePoints: metrics.worstMaePoints,
    averageMfePoints: metrics.averageMfePoints,
  };
}

function applyRule(rows, predicate) {
  const kept = rows.map((row) => Number(row.signal) && predicate(row) ? suppressed(row) : row);
  const vetoed = rows.filter((row) => Number(row.signal) && predicate(row));
  return { all: summary(rows), kept: summary(kept), vetoed: summary(vetoed) };
}

function signConflict(row, spotMagnitudeCutoff) {
  return finite(row.foreignSpot5d) && Math.abs(Number(row.foreignSpot5d)) >= spotMagnitudeCutoff
    && Math.sign(Number(row.foreignSpot5d)) !== Math.sign(Number(row.signal));
}

function evidence(development, holdout) {
  const enough = holdout.vetoed.trades >= 10 && holdout.kept.trades >= 10;
  const pfBetter = finite(holdout.kept.profitFactor) && finite(holdout.all.profitFactor)
    && Number(holdout.kept.profitFactor) > Number(holdout.all.profitFactor);
  const tailBetter = finite(holdout.kept.mae10PctPoints) && finite(holdout.all.mae10PctPoints)
    && Number(holdout.kept.mae10PctPoints) > Number(holdout.all.mae10PctPoints);
  const developmentNotOpposite = (!finite(development.kept.profitFactor) || !finite(development.all.profitFactor)
    || Number(development.kept.profitFactor) >= Number(development.all.profitFactor) * 0.9)
    && (!finite(development.kept.mae10PctPoints) || !finite(development.all.mae10PctPoints)
      || Number(development.kept.mae10PctPoints) >= Number(development.all.mae10PctPoints));
  return {
    sampleEnough: enough, holdoutProfitFactorImproved: pfBetter, holdoutTailMaeImproved: tailBetter,
    developmentNotOpposite,
    verdict: enough && developmentNotOpposite && (pfBetter || tailBetter) ? 'candidate_only' : enough ? 'not_supported' : 'insufficient_holdout',
  };
}

export function analyzeNoTradeVeto(developmentRows, holdoutRows) {
  const developmentActive = active(developmentRows); const holdoutActive = active(holdoutRows);
  const atrCutoff = quantile(developmentActive.map((row) => row.atr20), 0.75);
  const vixCutoff = quantile(developmentActive.map((row) => row.fredVix), 0.75);
  const spotMagnitudeCutoff = quantile(developmentActive.filter((row) => finite(row.foreignSpot5d) && Math.abs(Number(row.foreignSpot5d)) > 0).map((row) => Math.abs(Number(row.foreignSpot5d))), 0.50);
  const predicates = {
    high_vol_regime: (row) => row.regime === 'high_vol',
    high_atr: (row) => finite(atrCutoff) && finite(row.atr20) && Number(row.atr20) >= atrCutoff,
    high_us_vix: (row) => finite(vixCutoff) && finite(row.fredVix) && Number(row.fredVix) >= vixCutoff,
    spot_futures_conflict: (row) => finite(spotMagnitudeCutoff) && signConflict(row, spotMagnitudeCutoff),
    near_option_expiry: (row) => finite(row.daysToExpiry) && Number(row.daysToExpiry) <= 1,
  };
  predicates.combined_risk = (row) => predicates.high_vol_regime(row) || predicates.high_atr(row) || predicates.spot_futures_conflict(row);
  const labels = {
    high_vol_regime: '20日實現波動率達高波動狀態', high_atr: 'ATR20 位於開發期前25%高檔',
    high_us_vix: '前一可得美國VIX位於開發期前25%高檔', spot_futures_conflict: '外資現貨5日與策略方向衝突',
    near_option_expiry: '主力選擇權距到期小於等於1日', combined_risk: '高波動／高ATR／現貨衝突任一成立',
  };
  const studies = Object.entries(predicates).map(([key, predicate]) => {
    const development = applyRule(developmentRows, predicate); const holdout = applyRule(holdoutRows, predicate);
    return { key, label: labels[key], development, holdout, evidence: evidence(development, holdout) };
  });
  return {
    thresholds: { atr20DevelopmentQ75: atrCutoff, previousUsVixDevelopmentQ75: vixCutoff, foreignSpot5dAbsoluteMedian: spotMagnitudeCutoff },
    sample: { developmentTrades: developmentActive.length, holdoutTrades: holdoutActive.length },
    studies,
    limitation: '本研究只從原策略已執行交易中移除風險日，不會因前一筆被否決而重新啟用原本重疊遭抑制的後續訊號。',
  };
}
