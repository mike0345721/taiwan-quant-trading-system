function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function mean(values) {
  const usable = values.map(Number).filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function stddev(values) {
  const usable = values.map(Number).filter(Number.isFinite);
  if (usable.length < 2) return null;
  const average = mean(usable);
  return Math.sqrt(usable.reduce((sum, value) => sum + (value - average) ** 2, 0) / (usable.length - 1));
}

function standardizedDifference(eventValues, controlValues) {
  const eventMean = mean(eventValues); const controlMean = mean(controlValues);
  const pooled = stddev([...eventValues, ...controlValues]);
  return finite(eventMean) && finite(controlMean) && finite(pooled) && pooled > 0
    ? (eventMean - controlMean) / pooled : null;
}

function priorVolatility(rows, index, size = 60) {
  if (index < size) return null;
  const values = rows.slice(index - size, index).map((row) => Number(row.sameDayReturnPct)).filter(Number.isFinite);
  return values.length >= Math.floor(size * 0.8) ? stddev(values) : null;
}

function eventType(rows, index) {
  const row = rows[index]; const volatility = priorVolatility(rows, index);
  if (!finite(volatility) || !finite(row.sameDayReturnPct) || !finite(row.txHigh) || !finite(row.txLow) || !finite(row.txOpen)) return null;
  const directionThreshold = Math.max(0.75, Number(volatility) * 1.5);
  const rangePct = (Number(row.txHigh) - Number(row.txLow)) / Number(row.txOpen) * 100;
  const priorRanges = rows.slice(index - 60, index)
    .filter((item) => finite(item.txHigh) && finite(item.txLow) && finite(item.txOpen))
    .map((item) => (Number(item.txHigh) - Number(item.txLow)) / Number(item.txOpen) * 100)
    .sort((a, b) => a - b);
  const rangeThreshold = priorRanges[Math.floor((priorRanges.length - 1) * 0.8)];
  if (Number(row.sameDayReturnPct) >= directionThreshold) return 'large_rise';
  if (Number(row.sameDayReturnPct) <= -directionThreshold) return 'large_fall';
  if (finite(rangeThreshold) && rangePct >= rangeThreshold) return 'large_range';
  return null;
}

export function classifyLargeMoveEvents(rows, options = {}) {
  const usable = rows.filter((row) => row.tradeDate >= (options.startDate || '2023-07-14'));
  return usable.map((row, index) => ({ row, index, type: eventType(usable, index) }));
}

const FEATURES = Object.freeze([
  'foreignSpot', 'foreignSpot3d', 'foreignSpot5d',
  'foreignFuturesDelta1d', 'foreignFuturesDelta5d', 'foreignShortDelta1d', 'foreignShortDelta3d',
  'marketOiDelta1d', 'marketOiDelta3d', 'marginBalanceDelta1dE', 'marginBalanceDelta5dE',
  'optionPc', 'maxPainDistanceChange', 'soxReturnPct', 'ndxReturnPct', 'usdtwdReturnPct', 'fredVix',
]);

export function analyzeReverseEvents(rows, options = {}) {
  const windows = options.windows || [1, 3, 5, 10];
  const classified = classifyLargeMoveEvents(rows, options);
  const usable = classified.map((item) => item.row);
  const eventCounts = Object.fromEntries(['large_rise', 'large_fall', 'large_range'].map((type) => [type, classified.filter((item) => item.type === type).length]));
  const studies = [];

  for (const type of Object.keys(eventCounts)) {
    const events = classified.filter((item) => item.type === type);
    for (const window of windows) {
      for (const feature of FEATURES) {
        const eventValues = []; const controlValues = []; const matchedPairs = [];
        for (const event of events) {
          const precursor = usable[event.index - window];
          if (!precursor || !finite(precursor[feature])) continue;
          eventValues.push(Number(precursor[feature]));
          const controls = classified.filter((candidate) => !candidate.type
            && candidate.index >= window
            && candidate.row.regime === event.row.regime
            && Math.abs(candidate.index - event.index) >= 10
            && finite(usable[candidate.index - window]?.[feature]));
          if (controls.length) {
            const nearest = controls.reduce((best, candidate) => Math.abs(candidate.index - event.index) < Math.abs(best.index - event.index) ? candidate : best);
            const controlValue = Number(usable[nearest.index - window][feature]);
            controlValues.push(controlValue);
            matchedPairs.push({ date: event.row.tradeDate, event: Number(precursor[feature]), control: controlValue });
          }
        }
        const effect = standardizedDifference(eventValues, controlValues);
        const midpoint = Math.floor(matchedPairs.length / 2);
        const early = matchedPairs.slice(0, midpoint); const late = matchedPairs.slice(midpoint);
        const earlyEffect = standardizedDifference(early.map((item) => item.event), early.map((item) => item.control));
        const lateEffect = standardizedDifference(late.map((item) => item.event), late.map((item) => item.control));
        const stable = finite(earlyEffect) && finite(lateEffect)
          && Math.sign(earlyEffect) === Math.sign(lateEffect)
          && Math.abs(earlyEffect) >= 0.2 && Math.abs(lateEffect) >= 0.2;
        const enough = eventValues.length >= 30 && controlValues.length >= 30 && finite(effect);
        studies.push({
          eventType: type, precursorDays: window, feature,
          eventSamples: eventValues.length, controlSamples: controlValues.length,
          eventMean: mean(eventValues), controlMean: mean(controlValues), standardizedDifference: effect,
          earlyEffect, lateEffect, stableAcrossHalves: stable,
          status: !enough ? 'insufficient_sample'
            : Math.abs(effect) < 0.35 ? 'weak'
              : stable ? 'candidate' : 'unstable_candidate',
        });
      }
    }
  }

  const candidates = studies.filter((item) => item.status === 'candidate')
    .sort((a, b) => Math.abs(b.standardizedDifference) - Math.abs(a.standardizedDifference));
  return {
    version: '3.0.0-research', generatedAt: new Date().toISOString(),
    methodology: {
      eventThreshold: 'Same-day open-to-close move exceeds max(0.75%, 1.5x prior 60-day volatility); otherwise top prior-60-day range quintile.',
      controls: 'Nearest non-event observation in the same past-only market regime, separated by at least 10 trading days.',
      promotionGate: 'At least 30 matched samples, |standardized difference| >= 0.35, same direction with |effect| >= 0.20 in both chronological halves, then walk-forward and untouched holdout validation.',
    },
    sourceRows: usable.length, firstDate: usable[0]?.tradeDate || null, lastDate: usable.at(-1)?.tradeDate || null,
    eventCounts, candidates: candidates.slice(0, 30), studies,
  };
}
