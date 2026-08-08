function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }

function mean(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower + 1] == null ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

export function trainPositionThresholds(rows) {
  const threshold = (key) => {
    const values = rows.map((row) => row[key]).filter(finite);
    return { low: quantile(values, 0.30), median: quantile(values, 0.50), high: quantile(values, 0.70), samples: values.length };
  };
  return {
    foreignSpot3d: threshold('foreignSpot3d'),
    foreignShortDelta3d: threshold('foreignShortDelta3d'),
    marketOiDelta3d: threshold('marketOiDelta3d'),
    marginBalanceDelta3dE: threshold('marginBalanceDelta3dE'),
  };
}

function high(value, threshold) { return finite(value) && finite(threshold?.high) && Number(value) >= Number(threshold.high); }
function low(value, threshold) { return finite(value) && finite(threshold?.low) && Number(value) <= Number(threshold.low); }

export function classifyPositionStates(row, thresholds) {
  const states = [];
  const spotHigh = high(row.foreignSpot3d, thresholds.foreignSpot3d);
  const spotLow = low(row.foreignSpot3d, thresholds.foreignSpot3d);
  const shortsAdded = high(row.foreignShortDelta3d, thresholds.foreignShortDelta3d);
  const shortsCovered = low(row.foreignShortDelta3d, thresholds.foreignShortDelta3d);
  const oiExpanded = finite(row.marketOiDelta3d) && Number(row.marketOiDelta3d) > 0;
  const oiContracted = finite(row.marketOiDelta3d) && Number(row.marketOiDelta3d) < 0;
  const marginAdded = high(row.marginBalanceDelta3dE, thresholds.marginBalanceDelta3dE);
  const marginReduced = low(row.marginBalanceDelta3dE, thresholds.marginBalanceDelta3dE);
  const priceUp = finite(row.txReturn3d) && Number(row.txReturn3d) > 0;
  const priceDown = finite(row.txReturn3d) && Number(row.txReturn3d) < 0;

  // These are observable position states, not claims that an institution manipulated prices.
  if (spotHigh && shortsAdded && oiExpanded && !priceUp) states.push('hedged_accumulation_candidate');
  if (spotHigh && shortsCovered && priceUp) states.push('risk_on_confirmation');
  if (spotLow && shortsAdded && oiExpanded) states.push('distribution_short_build');
  if (spotLow && shortsCovered && oiContracted) states.push('cash_exit_derivative_cover');
  if (priceDown && marginAdded && finite(row.foreignSpot3d) && Number(row.foreignSpot3d) < 0) states.push('retail_catch_falling_knife');
  if (priceDown && marginReduced && shortsCovered) states.push('deleveraging_with_short_cover');
  if (priceUp && finite(row.foreignSpot3d) && Number(row.foreignSpot3d) > 0 && marginReduced) states.push('institutional_led_rally');
  if (priceUp && marginAdded && finite(row.foreignSpot3d) && Number(row.foreignSpot3d) <= 0) states.push('retail_chase_without_foreign_confirmation');
  return states;
}

function outcome(row, holdingDays) {
  const bars = row.futureBars?.slice(0, holdingDays) || [];
  if (bars.length !== holdingDays || !finite(row.nextTxOpen) || !finite(bars.at(-1)?.close)) return null;
  const entryContract = bars[0]?.txContract;
  if (entryContract && bars.some((bar) => bar.txContract && bar.txContract !== entryContract)) return null;
  const highs = bars.map((bar) => Number(bar.high)).filter(Number.isFinite);
  const lows = bars.map((bar) => Number(bar.low)).filter(Number.isFinite);
  if (highs.length !== holdingDays || lows.length !== holdingDays) return null;
  const entry = Number(row.nextTxOpen); const exit = Number(bars.at(-1).close);
  return { points: exit - entry, returnPct: (exit / entry - 1) * 100, up: exit > entry, high: Math.max(...highs), low: Math.min(...lows), entry };
}

function summarize(rows, holdingDays) {
  const outcomes = rows.map((row) => outcome(row, holdingDays)).filter(Boolean);
  return {
    samples: outcomes.length,
    averagePoints: mean(outcomes.map((item) => item.points)),
    averageReturnPct: mean(outcomes.map((item) => item.returnPct)),
    upRatePct: outcomes.length ? outcomes.filter((item) => item.up).length / outcomes.length * 100 : null,
    averageAbsolutePoints: mean(outcomes.map((item) => Math.abs(item.points))),
    averageLongMaePoints: mean(outcomes.map((item) => Math.min(0, item.low - item.entry))),
    averageLongMfePoints: mean(outcomes.map((item) => Math.max(0, item.high - item.entry))),
  };
}

function pearson(pairs) {
  const valid = pairs.filter(([x, y]) => finite(x) && finite(y)).map(([x, y]) => [Number(x), Number(y)]);
  if (valid.length < 3) return { samples: valid.length, pearson: null };
  const mx = mean(valid.map(([x]) => x)); const my = mean(valid.map(([, y]) => y));
  const numerator = valid.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const denominator = Math.sqrt(valid.reduce((sum, [x]) => sum + (x - mx) ** 2, 0) * valid.reduce((sum, [, y]) => sum + (y - my) ** 2, 0));
  return { samples: valid.length, pearson: denominator ? numerator / denominator : null };
}

function featureOutcomeCorrelation(rows, feature, holdingDays) {
  return pearson(rows.map((row) => [row[feature], outcome(row, holdingDays)?.returnPct]));
}

export function analyzePositionStates(rows, { trainPct = 0.70 } = {}) {
  const eligible = rows.filter((row) => finite(row.foreignSpot3d) && finite(row.foreignShortDelta3d)
    && finite(row.marketOiDelta3d) && finite(row.marginBalanceDelta3dE) && finite(row.txReturn3d));
  const split = Math.max(30, Math.floor(eligible.length * trainPct));
  const training = eligible.slice(0, split); const holdout = eligible.slice(split);
  const thresholds = trainPositionThresholds(training);
  const names = [
    'hedged_accumulation_candidate', 'risk_on_confirmation', 'distribution_short_build', 'cash_exit_derivative_cover',
    'retail_catch_falling_knife', 'deleveraging_with_short_cover', 'institutional_led_rally', 'retail_chase_without_foreign_confirmation',
  ];
  const evaluate = (sample) => Object.fromEntries(names.map((name) => {
    const selected = sample.filter((row) => classifyPositionStates(row, thresholds).includes(name));
    return [name, { dates: selected.map((row) => row.tradeDate), h1: summarize(selected, 1), h2: summarize(selected, 2), h3: summarize(selected, 3), h5: summarize(selected, 5) }];
  }));
  return {
    methodology: {
      version: '1.0.0', thresholdRule: '30/70 percentiles fitted on the first 70% only',
      timing: 'Signals use after-close public data; outcomes enter at the next Taiwan futures day-session open.',
      warning: 'State labels describe observable position combinations. They do not prove deliberate price suppression or accumulation by one institution.',
    },
    coverage: {
      totalRows: rows.length, eligibleRows: eligible.length, trainingRows: training.length, holdoutRows: holdout.length,
      firstEligibleDate: eligible[0]?.tradeDate || null, lastEligibleDate: eligible.at(-1)?.tradeDate || null,
      holdoutStart: holdout[0]?.tradeDate || null,
    },
    thresholds,
    associations: {
      note: 'Pearson correlations are descriptive only and are not trading rules.',
      withTxH1: Object.fromEntries(['foreignSpot3d', 'foreignShortDelta3d', 'marketOiDelta3d', 'marginBalanceDelta3dE', 'shortBalanceDelta3dLots']
        .map((feature) => [feature, featureOutcomeCorrelation(eligible, feature, 1)])),
      withTxH3: Object.fromEntries(['foreignSpot3d', 'foreignShortDelta3d', 'marketOiDelta3d', 'marginBalanceDelta3dE', 'shortBalanceDelta3dLots']
        .map((feature) => [feature, featureOutcomeCorrelation(eligible, feature, 3)])),
      positionRelationships: {
        spotVsForeignShortChange: pearson(eligible.map((row) => [row.foreignSpot3d, row.foreignShortDelta3d])),
        spotVsMarginChange: pearson(eligible.map((row) => [row.foreignSpot3d, row.marginBalanceDelta3dE])),
        foreignShortVsMarginChange: pearson(eligible.map((row) => [row.foreignShortDelta3d, row.marginBalanceDelta3dE])),
      },
    },
    holdout: evaluate(holdout),
    fullSampleDiagnostics: evaluate(eligible),
  };
}
