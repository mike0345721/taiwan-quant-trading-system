function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function randomGenerator(seed = 20260714) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2 ** 32; };
}

export function alignDailySeries(seriesByKey) {
  const entries = Object.entries(seriesByKey);
  if (!entries.length) return [];
  const maps = entries.map(([key, rows]) => [key, new Map(rows.map((row) => [row.tradeDate, row]))]);
  const dates = [...maps[0][1].keys()].filter((date) => maps.every(([, map]) => map.has(date))).sort();
  return dates.map((tradeDate) => ({ tradeDate, values: Object.fromEntries(maps.map(([key, map]) => [key, Number(map.get(tradeDate)?.netPoints || 0)])) }));
}

export function movingBlockBootstrapDifference(aligned, candidateKey, comparatorKey, options = {}) {
  const differences = aligned.map((row) => Number(row.values[candidateKey] || 0) - Number(row.values[comparatorKey] || 0));
  const iterations = options.iterations ?? 2_000; const blockSize = Math.max(1, options.blockSize ?? 5);
  if (!differences.length) return { days: 0, observedTotalDifference: null, ci95: [null, null], probabilityPositive: null };
  const random = randomGenerator(options.seed ?? 20260714); const totals = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0; let count = 0;
    while (count < differences.length) {
      const start = Math.floor(random() * differences.length);
      for (let offset = 0; offset < blockSize && count < differences.length; offset += 1, count += 1) {
        total += differences[(start + offset) % differences.length];
      }
    }
    totals.push(total);
  }
  const observed = differences.reduce((sum, value) => sum + value, 0);
  return {
    days: differences.length,
    observedTotalDifference: observed,
    observedAverageDifference: observed / differences.length,
    ci95: [quantile(totals, 0.025), quantile(totals, 0.975)],
    probabilityPositive: totals.filter((value) => value > 0).length / totals.length,
    blockSize, iterations,
    supported: finite(quantile(totals, 0.025)) && quantile(totals, 0.025) > 0,
  };
}

export function matchedLongDrift(candidateDaily, costPoints = 8) {
  return candidateDaily.map((row) => {
    if (!Number(row.signal) || !finite(row.entryClose) || !finite(row.exitClose)) return { ...row, netPoints: 0, signal: 0 };
    return { ...row, signal: 1, netPoints: Number(row.exitClose) - Number(row.entryClose) - costPoints };
  });
}
