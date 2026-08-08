import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})-day\.json$/;
const EXPECTED_DAY_BARS = 60;
const RVOL_LOOKBACK_DAYS = 20;
const HORIZONS = Object.freeze([
  { key: 'm30', bars: 6, minutes: 30 },
  { key: 'm60', bars: 12, minutes: 60 },
  { key: 'm120', bars: 24, minutes: 120 },
]);

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function asNumber(value) { return finite(value) ? Number(value) : null; }

function median(values) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator, denominator) {
  if (!finite(numerator) || !finite(denominator) || Number(denominator) === 0) return null;
  return Number(numerator) / Number(denominator);
}

function simpleReturn(end, start) {
  const value = ratio(end, start);
  return value === null ? null : value - 1;
}

function addMinutes(timestamp, minutes) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : new Date(value + minutes * 60_000).toISOString();
}

function taipeiTime(timestamp) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : new Date(value + 8 * 60 * 60_000).toISOString().slice(11, 16);
}

function phase(barIndex) {
  if (barIndex <= 2) return 'opening_15m';
  if (barIndex <= 20) return 'morning_followthrough';
  if (barIndex <= 47) return 'midday';
  return 'closing_hour';
}

function auditPassed(audit) {
  return typeof audit?.state === 'string' && audit.state.startsWith('passed');
}

function validateInput(day, audit, tradeDate) {
  const errors = [];
  if (!day || typeof day !== 'object') return ['day_file_invalid_json'];
  if (!audit || typeof audit !== 'object') return ['audit_file_missing_or_invalid'];
  if (!auditPassed(audit)) errors.push('audit_not_passed');
  if (audit.executionAuthorized !== false) errors.push('audit_execution_boundary_missing');
  if (day.source !== 'historical_replay') errors.push('source_not_historical_replay');
  if (day.product !== 'TX') errors.push('product_not_TX');
  if (day.session !== 'day') errors.push('session_not_day');
  if (day.timeframe !== '5m') errors.push('timeframe_not_5m');
  if (day.tradeDate !== tradeDate || audit.tradeDate !== tradeDate) errors.push('trade_date_mismatch');
  if (!day.contract || day.contract !== audit.contract) errors.push('contract_mismatch');
  if (!Array.isArray(day.bars) || day.bars.length !== EXPECTED_DAY_BARS) errors.push('day_bar_count_not_60');
  if (audit.checks?.daySessionCoverage?.pass !== true) errors.push('day_coverage_audit_not_passed');
  for (const key of ['open', 'high', 'low', 'close']) {
    if (audit.checks?.[key]?.pass !== true) errors.push(`${key}_audit_not_passed`);
  }
  if (audit.checks?.contractConsistency?.pass !== true) errors.push('day_night_contract_audit_not_passed');

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  (Array.isArray(day.bars) ? day.bars : []).forEach((bar, index) => {
    const timestamp = Date.parse(bar?.timestamp);
    if (Number.isNaN(timestamp)) errors.push(`bar_${index}_timestamp_invalid`);
    if (!Number.isNaN(timestamp) && timestamp <= previousTimestamp) errors.push(`bar_${index}_not_in_order`);
    if (!Number.isNaN(timestamp)) previousTimestamp = timestamp;
    if (bar?.complete === false) errors.push(`bar_${index}_incomplete`);
    for (const key of ['open', 'high', 'low', 'close', 'volume']) {
      if (!finite(bar?.[key])) errors.push(`bar_${index}_${key}_missing`);
    }
    if (finite(bar?.volume) && Number(bar.volume) < 0) errors.push(`bar_${index}_volume_negative`);
    if (finite(bar?.high) && finite(bar?.low) && Number(bar.high) < Number(bar.low)) errors.push(`bar_${index}_range_invalid`);
    if (['open', 'high', 'low', 'close'].every((key) => finite(bar?.[key]))) {
      if (Number(bar.open) > Number(bar.high) || Number(bar.open) < Number(bar.low)) errors.push(`bar_${index}_open_out_of_range`);
      if (Number(bar.close) > Number(bar.high) || Number(bar.close) < Number(bar.low)) errors.push(`bar_${index}_close_out_of_range`);
    }
  });
  return [...new Set(errors)];
}

function typicalPrice(bar) {
  return (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
}

function inputFingerprint(inputs) {
  const hash = crypto.createHash('sha256');
  for (const input of inputs) {
    hash.update(input.tradeDate);
    hash.update('\0');
    hash.update(JSON.stringify(input.day));
    hash.update('\0');
    hash.update(JSON.stringify(input.audit));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function labelForHorizon(bars, index, horizon) {
  const current = bars[index];
  const endIndex = index + horizon.bars;
  if (endIndex >= bars.length) {
    return {
      minutes: horizon.minutes,
      complete: false,
      labelAvailableAt: null,
      closeReturn: null,
      mfeReturn: null,
      maeReturn: null,
      reason: 'session_boundary',
    };
  }
  const futureWindow = bars.slice(index + 1, endIndex + 1);
  const futureEnd = bars[endIndex];
  const mfeReturn = simpleReturn(Math.max(...futureWindow.map((bar) => Number(bar.high))), current.close);
  const maeReturn = simpleReturn(Math.min(...futureWindow.map((bar) => Number(bar.low))), current.close);
  return {
    minutes: horizon.minutes,
    complete: true,
    labelAvailableAt: addMinutes(futureEnd.timestamp, 5),
    closeReturn: simpleReturn(futureEnd.close, current.close),
    mfeReturn: mfeReturn === null ? null : Math.max(0, mfeReturn),
    maeReturn: maeReturn === null ? null : Math.min(0, maeReturn),
    reason: null,
  };
}

function buildDay(input, priorInputs) {
  const { day, audit, tradeDate } = input;
  const bars = day.bars;
  const previousInput = priorInputs.at(-1) || null;
  const priorSameSlot = Array.from({ length: EXPECTED_DAY_BARS }, (_, index) => priorInputs
    .slice(-RVOL_LOOKBACK_DAYS)
    .map((candidate) => asNumber(candidate.day.bars[index]?.volume))
    .filter(finite));
  const priorSessionVolumes = priorInputs.slice(-RVOL_LOOKBACK_DAYS)
    .map((candidate) => candidate.day.bars.reduce((sum, bar) => sum + Number(bar.volume), 0));

  let cumulativeVolume = 0;
  let cumulativeTypicalValue = 0;
  let runningHigh = Number.NEGATIVE_INFINITY;
  let runningLow = Number.POSITIVE_INFINITY;
  let previousVwap = null;
  const openingRangeHigh = Math.max(...bars.slice(0, 3).map((bar) => Number(bar.high)));
  const openingRangeLow = Math.min(...bars.slice(0, 3).map((bar) => Number(bar.low)));
  const previousContract = previousInput?.day?.contract || null;
  const isContractRollDay = previousContract === null ? null : previousContract !== day.contract;

  const features = bars.map((bar, barIndex) => {
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const volume = Number(bar.volume);
    const previousBar = bars[barIndex - 1] || null;
    cumulativeVolume += volume;
    cumulativeTypicalValue += typicalPrice(bar) * volume;
    runningHigh = Math.max(runningHigh, high);
    runningLow = Math.min(runningLow, low);
    const vwapProxy = cumulativeVolume > 0 ? cumulativeTypicalValue / cumulativeVolume : null;
    const rvolBaseline = median(priorSameSlot[barIndex]);
    const rvolReady = priorSameSlot[barIndex].length >= RVOL_LOOKBACK_DAYS;
    const openingRangeComplete = barIndex >= 2;
    const row = {
      schemaVersion: '1.0.0',
      datasetVersion: 'V3.8.1-price-volume-baseline',
      rowType: 'bar_feature',
      tradeDate,
      timestamp: bar.timestamp,
      featureAvailableAt: addMinutes(bar.timestamp, 5),
      retrievedAt: null,
      product: 'TX',
      contract: day.contract,
      previousTradingDayContract: previousContract,
      isContractRollDay,
      session: 'day',
      timeframe: '5m',
      barIndex,
      taipeiTime: taipeiTime(bar.timestamp),
      minutesFromOpen: barIndex * 5,
      sessionPhase: phase(barIndex),
      open,
      high,
      low,
      close,
      volume,
      barOpenToCloseReturn: simpleReturn(close, open),
      closeToPreviousBarReturn: previousBar ? simpleReturn(close, previousBar.close) : null,
      sessionOpenToCloseReturn: simpleReturn(close, bars[0].open),
      highLowRangeReturn: simpleReturn(high, low),
      runningSessionHigh: runningHigh,
      runningSessionLow: runningLow,
      closeFromRunningHighReturn: simpleReturn(close, runningHigh),
      closeFromRunningLowReturn: simpleReturn(close, runningLow),
      cumulativeVolume,
      volumeToPreviousBarRatio: previousBar ? ratio(volume, previousBar.volume) : null,
      vwapProxyHlc3: vwapProxy,
      closeVsVwapProxyReturn: simpleReturn(close, vwapProxy),
      vwapProxyChangeReturn: previousVwap === null ? null : simpleReturn(vwapProxy, previousVwap),
      openingRangeComplete,
      openingRangeHigh: openingRangeComplete ? openingRangeHigh : null,
      openingRangeLow: openingRangeComplete ? openingRangeLow : null,
      closeVsOpeningRangeHighReturn: openingRangeComplete ? simpleReturn(close, openingRangeHigh) : null,
      closeVsOpeningRangeLowReturn: openingRangeComplete ? simpleReturn(close, openingRangeLow) : null,
      aboveOpeningRange: openingRangeComplete ? close > openingRangeHigh : null,
      belowOpeningRange: openingRangeComplete ? close < openingRangeLow : null,
      rvol20SameSlot: rvolReady && rvolBaseline !== null && rvolBaseline !== 0 ? volume / rvolBaseline : null,
      rvol20BaselineMedian: rvolReady ? rvolBaseline : null,
      rvol20SampleDays: priorSameSlot[barIndex].length,
      rvol20Ready: rvolReady,
      source: day.provider || 'TAIFEX official 30-day tick file',
      sourceAuditState: audit.state,
      researchOnly: true,
      executionAuthorized: false,
    };
    previousVwap = vwapProxy;
    return row;
  });

  const sessionVolume = bars.reduce((sum, bar) => sum + Number(bar.volume), 0);
  const sessionVolumeBaseline = median(priorSessionVolumes);
  const sessionVolumeRvolReady = priorSessionVolumes.length >= RVOL_LOOKBACK_DAYS;
  const finalFeature = features.at(-1);
  const dailyFeature = {
    schemaVersion: '1.0.0',
    datasetVersion: 'V3.8.1-price-volume-baseline',
    rowType: 'daily_feature',
    tradeDate,
    featureAvailableAt: addMinutes(bars.at(-1).timestamp, 5),
    retrievedAt: null,
    product: 'TX',
    contract: day.contract,
    previousTradingDayContract: previousContract,
    isContractRollDay,
    session: 'day',
    timeframe: '5m',
    open: Number(bars[0].open),
    high: Math.max(...bars.map((bar) => Number(bar.high))),
    low: Math.min(...bars.map((bar) => Number(bar.low))),
    close: Number(bars.at(-1).close),
    openToCloseReturn: simpleReturn(bars.at(-1).close, bars[0].open),
    closeToPreviousTradingDayReturn: previousInput && previousInput.day.contract === day.contract
      ? simpleReturn(bars.at(-1).close, previousInput.day.bars.at(-1).close)
      : null,
    highLowRangeReturn: simpleReturn(
      Math.max(...bars.map((bar) => Number(bar.high))),
      Math.min(...bars.map((bar) => Number(bar.low))),
    ),
    sessionVolume,
    sessionVolumeRvol20: sessionVolumeRvolReady && sessionVolumeBaseline !== null && sessionVolumeBaseline !== 0
      ? sessionVolume / sessionVolumeBaseline : null,
    sessionVolumeRvol20BaselineMedian: sessionVolumeRvolReady ? sessionVolumeBaseline : null,
    sessionVolumeRvol20SampleDays: priorSessionVolumes.length,
    sessionVolumeRvol20Ready: sessionVolumeRvolReady,
    vwapProxyHlc3: finalFeature.vwapProxyHlc3,
    closeVsVwapProxyReturn: finalFeature.closeVsVwapProxyReturn,
    openingRangeHigh,
    openingRangeLow,
    closeVsOpeningRangeHighReturn: simpleReturn(bars.at(-1).close, openingRangeHigh),
    closeVsOpeningRangeLowReturn: simpleReturn(bars.at(-1).close, openingRangeLow),
    auditState: audit.state,
    researchOnly: true,
    executionAuthorized: false,
  };

  const labels = bars.map((bar, barIndex) => ({
    schemaVersion: '1.0.0',
    datasetVersion: 'V3.8.1-price-volume-baseline-labels',
    rowType: 'future_label',
    tradeDate,
    timestamp: bar.timestamp,
    featureAvailableAt: addMinutes(bar.timestamp, 5),
    product: 'TX',
    contract: day.contract,
    session: 'day',
    timeframe: '5m',
    barIndex,
    horizons: Object.fromEntries(HORIZONS.map((horizon) => [horizon.key, labelForHorizon(bars, barIndex, horizon)])),
    researchOnly: true,
    executionAuthorized: false,
  }));

  return { features, dailyFeature, labels };
}

export function buildIntradayResearchDataset(archiveDir) {
  const discovered = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((name) => DAY_FILE.test(name)).sort()
    : [];
  const included = [];
  const excluded = [];
  for (const name of discovered) {
    const tradeDate = name.match(DAY_FILE)[1];
    const day = readJson(path.join(archiveDir, name));
    const audit = readJson(path.join(archiveDir, `${tradeDate}-audit.json`));
    const errors = validateInput(day, audit, tradeDate);
    if (errors.length) excluded.push({ tradeDate, errors });
    else included.push({ tradeDate, day, audit });
  }

  const barFeatures = [];
  const dailyFeatures = [];
  const futureLabels = [];
  included.forEach((input, index) => {
    const built = buildDay(input, included.slice(0, index));
    barFeatures.push(...built.features);
    dailyFeatures.push(built.dailyFeature);
    futureLabels.push(...built.labels);
  });

  const featureFutureKeys = barFeatures.reduce((count, row) => count + Object.keys(row).filter((key) => /future|horizon|label/i.test(key)).length, 0);
  const rvolReadyRows = barFeatures.filter((row) => row.rvol20Ready).length;
  const inputAsOf = included.map((item) => item.audit.generatedAt).filter(Boolean).sort().at(-1) || null;
  const quality = {
    schemaVersion: '1.0.0',
    datasetVersion: 'V3.8.1-price-volume-baseline',
    inputAsOf,
    inputFingerprintSha256: inputFingerprint(included),
    source: 'audited TAIFEX official 5-minute day-session archives',
    researchOnly: true,
    executionAuthorized: false,
    counts: {
      discoveredDays: discovered.length,
      includedDays: included.length,
      excludedDays: excluded.length,
      barFeatureRows: barFeatures.length,
      dailyFeatureRows: dailyFeatures.length,
      futureLabelRows: futureLabels.length,
      rvolReadyRows,
    },
    dateRange: {
      first: included[0]?.tradeDate || null,
      last: included.at(-1)?.tradeDate || null,
    },
    excluded,
    gates: {
      engineeringTargetDays: 30,
      formalResearchTargetDays: 120,
      engineeringReady: included.length >= 30,
      formalResearchReady: included.length >= 120,
      status: included.length >= 120 ? 'formal_research_data_gate_met' : included.length >= 30 ? 'engineering_only_sample_insufficient_for_formal_research' : 'engineering_sample_incomplete',
    },
    lookaheadAudit: {
      featureFutureKeyCount: featureFutureKeys,
      featuresUseOnlyCurrentAndPriorBars: featureFutureKeys === 0,
      rvolUsesStrictlyEarlierTradingDays: true,
      openingRangeHiddenUntilThirdBarCompletes: true,
      futureLabelsStoredSeparately: true,
      labelAvailabilityRecordedAtHorizonEnd: true,
    },
    missingness: {
      ohlcvMissingRows: barFeatures.filter((row) => ['open', 'high', 'low', 'close', 'volume'].some((key) => !finite(row[key]))).length,
      retrievedAtMissingRows: barFeatures.filter((row) => row.retrievedAt === null).length,
      rvolMissingRows: barFeatures.filter((row) => row.rvol20SameSlot === null).length,
      expectedOpeningRangeNullRows: barFeatures.filter((row) => !row.openingRangeComplete && row.openingRangeHigh === null && row.openingRangeLow === null).length,
    },
    definitions: {
      vwapProxyHlc3: 'cumulative sum(((high+low+close)/3)*volume) / cumulative volume; this is an OHLCV proxy, not exact tick VWAP',
      rvol20SameSlot: 'current 5-minute volume divided by the median volume of the same bar index from exactly 20 strictly earlier audited trading days; null during warmup',
      featureAvailableAt: '5-minute bar end in UTC; no value from a later bar is used',
      retrievedAt: 'null because the legacy archive did not preserve source retrieval timestamps; null is retained rather than fabricated or filled with zero',
    },
    warnings: [
      ...(included.length < 120 ? ['Fewer than 120 complete trading days: descriptive engineering dataset only; no strategy or performance claim is authorized.'] : []),
      ...(barFeatures.some((row) => row.retrievedAt === null) ? ['Legacy archives lack retrievedAt metadata.'] : []),
      'VWAP is an HLC3-by-volume proxy derived from 5-minute bars, not exact tick VWAP.',
      'No broker credentials, order endpoint, strategy optimization or live execution is included.',
    ],
  };
  return { barFeatures, dailyFeatures, futureLabels, quality };
}

function ndjson(rows) { return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''); }

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function writeIntradayResearchDataset(outputDir, dataset) {
  const files = {
    barFeatures: path.join(outputDir, 'bar-features.ndjson'),
    dailyFeatures: path.join(outputDir, 'daily-features.ndjson'),
    futureLabels: path.join(outputDir, 'future-labels.ndjson'),
    quality: path.join(outputDir, 'quality-summary.json'),
  };
  atomicWrite(files.barFeatures, ndjson(dataset.barFeatures));
  atomicWrite(files.dailyFeatures, ndjson(dataset.dailyFeatures));
  atomicWrite(files.futureLabels, ndjson(dataset.futureLabels));
  atomicWrite(files.quality, `${JSON.stringify(dataset.quality, null, 2)}\n`);
  return files;
}

export const intradayResearchConstants = Object.freeze({
  expectedDayBars: EXPECTED_DAY_BARS,
  rvolLookbackDays: RVOL_LOOKBACK_DAYS,
  horizons: HORIZONS,
});
