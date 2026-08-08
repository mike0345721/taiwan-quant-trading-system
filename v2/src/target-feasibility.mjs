function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function futurePath(rows, index, horizon) {
  const signalRow = rows[index]; const path = rows.slice(index + 1, index + horizon + 1);
  if (path.length !== horizon || !finite(signalRow?.txClose) || !finite(path[0]?.txOpen) || !finite(path.at(-1)?.txClose)) return null;
  if (!path.every((row) => finite(row.txHigh) && finite(row.txLow) && finite(row.txClose))) return null;
  const entryContract = path[0]?.txContract;
  if (entryContract && path.some((row) => row.txContract && row.txContract !== entryContract)) return null;
  const entry = Number(path[0].txOpen); const exit = Number(path.at(-1).txClose);
  if (entry <= 0) return null;
  const highs = path.map((row) => Number(row.txHigh)); const lows = path.map((row) => Number(row.txLow));
  const closePath = [entry, ...path.map((row) => Number(row.txClose))];
  const travelled = closePath.slice(1).reduce((sum, value, pathIndex) => sum + Math.abs(value - closePath[pathIndex]), 0);
  return {
    signalDate: signalRow.tradeDate,
    entryDate: path[0].tradeDate,
    exitDate: path.at(-1).tradeDate,
    returnPct: (exit / entry - 1) * 100,
    absoluteMovePct: Math.abs(exit / entry - 1) * 100,
    gapPct: signalRow.txContract && entryContract && signalRow.txContract !== entryContract
      ? null : (entry / Number(signalRow.txClose) - 1) * 100,
    realizedRangePct: (Math.max(...highs) - Math.min(...lows)) / entry * 100,
    efficiency: travelled > 0 ? Math.abs(exit - entry) / travelled : 0,
    longMaePct: Math.min(0, (Math.min(...lows) / entry - 1) * 100),
    longMfePct: Math.max(0, (Math.max(...highs) / entry - 1) * 100),
    shortMaePct: Math.min(0, (entry / Math.max(...highs) - 1) * 100),
    shortMfePct: Math.max(0, (entry / Math.min(...lows) - 1) * 100),
    regime: signalRow.regime || null,
    atrPct: finite(signalRow.atr20) && Number(signalRow.txClose) > 0 ? Number(signalRow.atr20) / Number(signalRow.txClose) * 100 : null,
    txReturn1d: finite(signalRow.txReturn1d) ? Number(signalRow.txReturn1d) : null,
    txReturn3d: finite(signalRow.txReturn3d) ? Number(signalRow.txReturn3d) : null,
    foreignFuturesDelta1d: finite(signalRow.foreignFuturesDelta1d) ? Number(signalRow.foreignFuturesDelta1d) : null,
    foreignFuturesDelta5d: finite(signalRow.foreignFuturesDelta5d) ? Number(signalRow.foreignFuturesDelta5d) : null,
    marketOiDelta1d: finite(signalRow.marketOiDelta1d) ? Number(signalRow.marketOiDelta1d) : null,
    optionPc: finite(signalRow.optionPc) && Number(signalRow.optionPc) > 0 ? Number(signalRow.optionPc) : null,
    entrySoxReturnPct: finite(path[0].soxReturnPct) ? Number(path[0].soxReturnPct) : null,
    entryNdxReturnPct: finite(path[0].ndxReturnPct) ? Number(path[0].ndxReturnPct) : null,
    entryUsdtwdReturnPct: finite(path[0].usdtwdReturnPct) ? Number(path[0].usdtwdReturnPct) : null,
    signalSoxReturnPct: finite(signalRow.soxReturnPct) ? Number(signalRow.soxReturnPct) : null,
    signalNdxReturnPct: finite(signalRow.ndxReturnPct) ? Number(signalRow.ndxReturnPct) : null,
    signalUsdtwdReturnPct: finite(signalRow.usdtwdReturnPct) ? Number(signalRow.usdtwdReturnPct) : null,
  };
}

export function buildTargetPaths(rows, horizon) {
  return rows.map((_, index) => futurePath(rows, index, horizon)).filter(Boolean);
}

function describe(paths) {
  const field = (key) => paths.map((row) => row[key]).filter(Number.isFinite);
  const moves = field('absoluteMovePct'); const gaps = field('gapPct').map(Math.abs); const ranges = field('realizedRangePct'); const efficiency = field('efficiency');
  return {
    samples: paths.length,
    absoluteMovePct: { median: round(quantile(moves, 0.5)), q75: round(quantile(moves, 0.75)), q90: round(quantile(moves, 0.9)) },
    absoluteGapPct: { samples: gaps.length, median: round(quantile(gaps, 0.5)), q75: round(quantile(gaps, 0.75)), q90: round(quantile(gaps, 0.9)) },
    realizedRangePct: { median: round(quantile(ranges, 0.5)), q75: round(quantile(ranges, 0.75)), q90: round(quantile(ranges, 0.9)) },
    pathEfficiency: { mean: round(mean(efficiency)), q30: round(quantile(efficiency, 0.3)), q70: round(quantile(efficiency, 0.7)) },
    longMaePct: { median: round(quantile(field('longMaePct'), 0.5)), q10: round(quantile(field('longMaePct'), 0.1)) },
    shortMaePct: { median: round(quantile(field('shortMaePct'), 0.5)), q10: round(quantile(field('shortMaePct'), 0.1)) },
  };
}

export function analyzeTargetFeasibility(rows) {
  const horizons = {};
  for (const horizon of [1, 2, 3]) {
    const paths = buildTargetPaths(rows, horizon);
    horizons[horizon] = describe(paths);
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceRows: rows.length,
    firstDate: rows[0]?.tradeDate || null,
    lastDate: rows.at(-1)?.tradeDate || null,
    horizons,
    targets: [
      { key: 'large_move', label: '未來是否出現大行情', status: 'ready_daily', definition: '下一日盤開盤至第1／2／3日收盤絕對報酬，門檻只用訓練區分位數校準' },
      { key: 'trend_range', label: '趨勢或震盪', status: 'daily_proxy_only', definition: '先用1／2／3日路徑效率近似；真正盤中趨勢盤需5分鐘資料' },
      { key: 'overnight_gap', label: '隔夜跳空風險', status: 'ready_daily', definition: '下一日盤開盤相對訊號日收盤的絕對缺口；換月跨合約日排除' },
      { key: 'mae_mfe', label: '訊號後最大逆向／順向波動', status: 'ready_for_fold_integration', definition: '以未來日高低計算；必須套入每折當時產生的訊號方向' },
      { key: 'holding_period', label: '持有1日、2日或不交易', status: 'ready_nested_validation', definition: '只可用訓練折選持有期，再到下一折驗證，禁止事後挑最好期間' },
      { key: 'no_trade', label: '何時不交易', status: 'first_candidate_available', definition: '高波動排除已降低留出回撤，但樣本不足；後續加入訊號衝突與資料品質' },
    ],
  };
}
