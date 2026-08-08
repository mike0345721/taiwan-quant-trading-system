function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function quantile(values, probability) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function v34CandidateSignals(history, current) {
  const shortThreshold = quantile(history.map((row) => row.foreignShortDelta3d).filter(finite), 0.70);
  return [
    { strategyKey: 'price_oi_reversal_h2', horizonDays: 2,
      signal: finite(current.txReturn1d) && finite(current.marketOiDelta1d) && Number(current.marketOiDelta1d) > 0 ? -Math.sign(Number(current.txReturn1d)) : 0,
      threshold: null, featureValue: current.marketOiDelta1d },
    { strategyKey: 'foreign_short_build_reversal_h3', horizonDays: 3,
      signal: finite(current.foreignShortDelta3d) && finite(shortThreshold) && Number(current.foreignShortDelta3d) >= shortThreshold ? 1 : 0,
      threshold: shortThreshold, featureValue: current.foreignShortDelta3d },
  ];
}

export function resolveCandidateOutcome(signalRecord, row, costPoints = 8) {
  if (!signalRecord?.signal) return null;
  const bars = row?.futureBars?.slice(0, signalRecord.horizonDays) || [];
  if (bars.length !== signalRecord.horizonDays || bars.some((bar) => bar.txContract !== row.txContract)) return null;
  const entry = bars[0]; const exit = bars.at(-1);
  if (!finite(entry.open) || !finite(exit.close)) return null;
  const grossPoints = Number(signalRecord.signal) * (Number(exit.close) - Number(entry.open));
  return { strategyKey: signalRecord.strategyKey, signalDate: signalRecord.signalDate, signal: signalRecord.signal,
    entryDate: entry.tradeDate, exitDate: exit.tradeDate, entryPrice: Number(entry.open), exitPrice: Number(exit.close),
    grossPoints, costPoints, netPoints: grossPoints - costPoints, resolvedAt: new Date().toISOString(), researchOnly: true };
}
