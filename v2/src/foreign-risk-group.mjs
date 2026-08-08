function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function quantile(values, probability) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function foreignRiskThresholds(history = []) {
  return {
    futuresWeak: quantile(history.map((row) => row.foreignFuturesDelta5d).filter(finite), 0.30),
    shortAdd: quantile(history.map((row) => row.foreignShortDelta3d).filter(finite), 0.70),
    spotSell: quantile(history.map((row) => row.foreignSpot5d).filter(finite), 0.30),
  };
}

export function buildForeignRiskGroup(history, current) {
  const thresholds = foreignRiskThresholds(history);
  const components = [
    { key: 'futuresWeak', label: '外資期貨5日淨部位轉差', value: current?.foreignFuturesDelta5d, threshold: thresholds.futuresWeak, active: finite(current?.foreignFuturesDelta5d) && finite(thresholds.futuresWeak) && Number(current.foreignFuturesDelta5d) <= thresholds.futuresWeak },
    { key: 'shortAdd', label: '外資3日累積加空', value: current?.foreignShortDelta3d, threshold: thresholds.shortAdd, active: finite(current?.foreignShortDelta3d) && finite(thresholds.shortAdd) && Number(current.foreignShortDelta3d) >= thresholds.shortAdd },
    { key: 'spotSell', label: '外資現貨5日賣超', value: current?.foreignSpot5d, threshold: thresholds.spotSell, active: finite(current?.foreignSpot5d) && finite(thresholds.spotSell) && Number(current.foreignSpot5d) <= thresholds.spotSell },
  ];
  const available = components.filter((item) => finite(item.value) && finite(item.threshold));
  const activeCount = available.filter((item) => item.active).length;
  return {
    available: available.length === components.length,
    active: available.length === components.length && activeCount >= 2,
    activeCount, totalComponents: components.length,
    score: Math.round(activeCount / components.length * 100),
    level: activeCount === 3 ? '高' : activeCount === 2 ? '中高' : activeCount === 1 ? '留意' : '低',
    thresholds, components,
  };
}
