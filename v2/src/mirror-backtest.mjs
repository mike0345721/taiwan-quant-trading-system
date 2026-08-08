function finite(value) { return Number.isFinite(Number(value)); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

export function metricsFromPoints(points = []) {
  const usable = points.map(Number).filter(Number.isFinite);
  let equity = 0; let peak = 0; let maxDrawdownPoints = 0;
  for (const value of usable) { equity += value; peak = Math.max(peak, equity); maxDrawdownPoints = Math.max(maxDrawdownPoints, peak - equity); }
  const gains = usable.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(usable.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    trades: usable.length,
    winRatePct: usable.length ? usable.filter((value) => value > 0).length / usable.length * 100 : null,
    averageNetPoints: mean(usable), totalNetPoints: usable.reduce((sum, value) => sum + value, 0),
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? null : 0,
    maxDrawdownPoints,
  };
}

export function mirrorTrade(trade) {
  if (!trade || !finite(trade.grossPoints) || !finite(trade.costPoints) || Number(trade.signal) === 0) return null;
  const grossPoints = -Number(trade.grossPoints);
  const costPoints = Number(trade.costPoints);
  return { ...trade, signal: -Number(trade.signal), grossPoints, netPoints: grossPoints - costPoints };
}

export function compareMirrorTrades(trades = []) {
  const active = trades.filter((trade) => Number(trade.signal) !== 0 && finite(trade.grossPoints) && finite(trade.costPoints));
  const mirrored = active.map(mirrorTrade).filter(Boolean);
  return {
    original: metricsFromPoints(active.map((trade) => Number(trade.grossPoints) - Number(trade.costPoints))),
    mirror: metricsFromPoints(mirrored.map((trade) => trade.netPoints)),
  };
}
