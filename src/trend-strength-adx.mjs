// Pure, bounded ADX(14) calculation over existing chart OHLC; no I/O or clock reads.
const PERIOD = 14;
const REQUIRED_BARS = 2 * PERIOD;
const MAX_BARS = 10000;
const ZERO_EPSILON = 1e-8;
const WIDTH_MS = Object.freeze({ '1m': 60000, '5m': 300000, '15m': 900000,
  '30m': 1800000, '1h': 3600000, '4h': 14400000 });
const SEED = 'TA_LIB_WILDER_14_UNSTABLE_0';
const SAFETY = Object.freeze({ formalWeight: 0, researchOnly: true,
  executionAuthorized: false, orderRoutesEnabled: false });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value > 0;
const text = value => typeof value === 'string' && value.trim() ? value : null;
const time = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const iso = value => finite(value) ? new Date(value).toISOString() : null;
const unique = values => Object.freeze([...new Set(values)].slice(0, 32));
const sourceCodes = value => Array.isArray(value)
  ? value.slice(0, 32).filter(code => typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code)) : [];
const addCodes = (set, values) => { for (const code of sourceCodes(values)) if (set.size < 32) set.add(code); };
const direction = (plus, minus) => plus > minus ? 'PLUS_DI_DOMINANT' : plus < minus ? 'MINUS_DI_DOMINANT' : 'EQUAL_DI';
const validHlc = bar => bar && [bar.high, bar.low, bar.close].every(positive)
  && bar.high >= bar.low && bar.close >= bar.low && bar.close <= bar.high;
const emptyNumbers = () => ({ value: null, plusDI: null, minusDI: null, deltaADX: null, direction: null });
function calculationResult(state, count, reasonCodes, values = {}) {
  return Object.freeze({ state, ...emptyNumbers(), ...values, barCount: count,
    requiredBars: REQUIRED_BARS, firstOutputIndex: REQUIRED_BARS - 1,
    seedMethod: SEED, reasonCodes: unique(reasonCodes) });
}

/** TA-Lib-style Wilder seed, with the additional unstable period explicitly zero.
 * Minimum 28 valid observations yields a first value, not a convergence claim.
 * DM ties contribute neither side. Known zero movement is distinct from missing HLC.
 */
export function calculateAdx14(bars) {
  if (!Array.isArray(bars)) return calculationResult('UNAVAILABLE', 0, ['ADX_INPUT_INVALID']);
  if (bars.length > MAX_BARS) return calculationResult('UNAVAILABLE', bars.length, ['ADX_INPUT_LIMIT_EXCEEDED']);
  if (!bars.every(validHlc)) return calculationResult('UNAVAILABLE', bars.length, ['ADX_OHLC_INVALID']);
  if (bars.length < REQUIRED_BARS) return calculationResult('WARMING_UP', bars.length, ['INSUFFICIENT_BARS']);
  let plus = 0, minus = 0, range = 0, sumDx = 0, adx = null, previousAdx = null;
  let plusDI = 0, minusDI = 0;
  for (let index = 1; index < bars.length; index++) {
    const before = bars[index - 1], current = bars[index];
    const up = current.high - before.high, down = before.low - current.low;
    const plusDM = up > 0 && up > down ? up : 0;
    const minusDM = down > 0 && down > up ? down : 0;
    const trueRange = Math.max(current.high - current.low,
      Math.abs(current.high - before.close), Math.abs(current.low - before.close));
    if (index < PERIOD) { plus += plusDM; minus += minusDM; range += trueRange; }
    else {
      plus = plus - plus / PERIOD + plusDM;
      minus = minus - minus / PERIOD + minusDM;
      range = range - range / PERIOD + trueRange;
      plusDI = range > 0 ? plus / range * 100 : 0;
      minusDI = range > 0 ? minus / range * 100 : 0;
      const denominator = plusDI + minusDI;
      const dx = denominator >= ZERO_EPSILON ? Math.abs(plusDI - minusDI) / denominator * 100 : 0;
      if (index < REQUIRED_BARS) {
        sumDx += dx;
        if (index === REQUIRED_BARS - 1) adx = sumDx / PERIOD;
      } else {
        previousAdx = adx;
        // Matches the selected TA-Lib convention: a zero denominator carries
        // an already-seeded ADX; the initial all-flat sequence legitimately seeds 0.
        if (range > 0 && denominator >= ZERO_EPSILON) adx = (adx * (PERIOD - 1) + dx) / PERIOD;
      }
    }
    if (![plus, minus, range, plusDI, minusDI, sumDx].every(finite)
        || (adx !== null && !finite(adx))) return calculationResult('UNAVAILABLE', bars.length, ['ADX_NUMERIC_RANGE_UNSUPPORTED']);
  }
  if (![adx, plusDI, minusDI].every(value => finite(value) && value >= -ZERO_EPSILON && value <= 100 + ZERO_EPSILON))
    return calculationResult('UNAVAILABLE', bars.length, ['ADX_NUMERIC_RANGE_UNSUPPORTED']);
  const bounded = value => Math.min(100, Math.max(0, value));
  return calculationResult('READY', bars.length, [], {
    value: bounded(adx), plusDI: bounded(plusDI), minusDI: bounded(minusDI),
    deltaADX: previousAdx === null ? null : adx - previousAdx, direction: direction(plusDI, minusDI),
  });
}

function captureOverlap(intervals, start, end) {
  return intervals.some(interval => {
    const from = time(interval?.startSourceAt), until = time(interval?.endSourceAt);
    return (from === null || from < end) && (until === null || until <= (from ?? -Infinity) || until > start);
  });
}

/** Descriptive chart adapter. The cutoff and closure witnesses come from chart,
 * never Date.now(). This does not grant research, chronology, or execution eligibility.
 */
export function buildChartTrendStrength(chart) {
  const identity = Object.freeze(Object.fromEntries(['actualContract', 'tradeDate', 'session', 'sessionId']
    .map(key => [key, text(chart?.[key])])));
  const limitations = new Set(['DESCRIPTIVE_NOT_A_TRADE_SIGNAL', 'ADX_IS_NOT_DIRECTION_OR_PROBABILITY',
    'SESSION_SCOPED_SEED', 'MINIMUM_SAMPLE_NOT_CONVERGENCE_GUARANTEE', 'FEED_COMPLETENESS_NOT_CERTIFIED']);
  const base = { schemaVersion: 'trend-strength-adx14-v1', indicator: 'ADX', period: PERIOD,
    timeframe: text(chart?.timeframe), identity, mode: text(chart?.mode),
    asOf: text(chart?.asOf), sourceAvailableAt: text(chart?.availableAt),
    source: 'EXISTING_CHART_CLOSED_OHLC', seedMethod: SEED, requiredClosedBars: REQUIRED_BARS,
    firstUsedBarAt: null, lastClosedBarAt: null, calculationAvailableAt: null, maxSessionClosedBars: null,
    closedBarCount: 0, excludedFormingBarCount: 0, resetCount: 0,
    closureBasis: 'OBSERVED_CHART_SOURCE_EVENT_WITHIN_ASOF', ...SAFETY };
  const finish = (state, reasons, extra = {}) => Object.freeze({ ...base, state, ...emptyNumbers(), ...extra,
    reasonCodes: unique(reasons), limitations: unique(limitations) });
  if (!chart || chart.schemaVersion !== 'governed-tx-decision-chart-v2'
      || chart.barContract?.schemaVersion !== 'chart-bar-contract-v2') return finish('UNAVAILABLE', ['CHART_CONTRACT_UNVERIFIED']);
  if (!['LIVE', 'REPLAY'].includes(chart.mode)
      || (!Object.hasOwn(WIDTH_MS, chart.timeframe) && chart.timeframe !== '1D')) return finish('UNAVAILABLE', ['CHART_MODE_OR_TIMEFRAME_UNSUPPORTED']);
  if (!['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart.status)) return finish('UNAVAILABLE', ['CHART_STATUS_UNAVAILABLE']);
  if (chart.source !== 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK'
      || Object.entries(SAFETY).some(([key, value]) => chart[key] !== value)) return finish('UNAVAILABLE', ['CHART_SOURCE_OR_SAFETY_INVALID']);
  if (Object.values(identity).some(value => !value) || chart.contractConsistencyState !== 'MATCH'
      || chart.contractRollover?.detected !== false
      || (chart.timeframe === '1D' ? chart.session !== 'NIGHT_PLUS_DAY' : !['DAY', 'NIGHT'].includes(chart.session)))
    return finish('UNAVAILABLE', ['CHART_IDENTITY_UNVERIFIED']);
  const cutoff = time(chart.asOf), available = time(chart.availableAt), observed = time(chart.lastEventTime);
  if (cutoff === null || available === null || observed === null || available > cutoff || observed > cutoff || observed > available)
    return finish('UNAVAILABLE', ['CHART_SOURCE_TIME_UNVERIFIED']);
  if (!Array.isArray(chart.bars) || chart.bars.length > MAX_BARS)
    return finish('UNAVAILABLE', [Array.isArray(chart.bars) ? 'ADX_INPUT_LIMIT_EXCEEDED' : 'CHART_BARS_MISSING']);
  const sessionStart = time(chart.bars[0]?.sessionStart), sessionEnd = time(chart.bars[0]?.sessionEnd);
  if (sessionStart === null || sessionEnd === null || sessionEnd <= sessionStart)
    return finish('UNAVAILABLE', ['SESSION_CAPACITY_UNVERIFIED']);
  base.maxSessionClosedBars = chart.timeframe === '1D' ? 1 : Math.floor((sessionEnd - sessionStart) / WIDTH_MS[chart.timeframe]);
  if (chart.futureDataViolations !== 0) return finish('UNAVAILABLE', ['CHART_FUTURE_DATA_UNVERIFIED']);
  const restricted = new Set();
  if (chart.sourceComplete !== true) restricted.add(chart.sourceComplete === false ? 'SOURCE_CATCHUP_PENDING' : 'SOURCE_COMPLETENESS_UNVERIFIED');
  if (chart.qualityStatus !== 'PASS') restricted.add('CHART_QUALITY_RESTRICTED');
  if (chart.qualityStatus !== 'PASS') addCodes(restricted, chart.qualityReasons);
  if (chart.sequenceGapEventCount !== 0 || chart.sequenceGapSize !== 0) restricted.add('SOURCE_SEQUENCE_QUALITY_RESTRICTED');
  const audit = chart.structureEligibility?.audit;
  const intervals = Array.isArray(audit?.captureIntervals) ? audit.captureIntervals : [];
  if (chart.structureEligibility?.state !== 'ELIGIBLE') restricted.add('SOURCE_STRUCTURE_EVIDENCE_UNVERIFIED');
  if (!text(chart.continuityEpoch)) limitations.add('CONTINUITY_EPOCH_NOT_EXPOSED_BY_CHART');
  if (chart.mode === 'REPLAY') limitations.add('HISTORICAL_ASOF_NOT_LIVE');
  let segment = [], previousTime = null, excludedFormingBarCount = 0, resetCount = 0;
  const reset = reason => { segment = []; resetCount++; limitations.add(reason); };
  for (const bar of chart.bars) {
    const start = time(bar?.time);
    if (start === null || (previousTime !== null && start <= previousTime)) return finish('UNAVAILABLE', ['BAR_ORDER_OR_TIME_INVALID']);
    previousTime = start;
    // Future tail rows cannot change an earlier as-of calculation, even if their
    // OHLC fields are not yet populated. They do not count toward warmup.
    if (start > cutoff) { excludedFormingBarCount++; continue; }
    if (Object.entries(identity).some(([key, value]) => bar?.[key] !== value)) return finish('UNAVAILABLE', ['BAR_IDENTITY_MISMATCH']);
    const end = chart.timeframe === '1D' ? sessionEnd : start + WIDTH_MS[chart.timeframe];
    if (time(bar.sessionStart) !== sessionStart || time(bar.sessionEnd) !== sessionEnd
        || end === null || start < sessionStart || start >= sessionEnd || end <= start)
      return finish('UNAVAILABLE', ['BAR_SESSION_BOUNDARY_INVALID']);
    const first = time(bar.firstEventTime), last = time(bar.lastEventTime), inputAvailable = time(bar.availableAt);
    if ((inputAvailable !== null && inputAvailable > available) || (last !== null && last > observed))
      return finish('UNAVAILABLE', ['BAR_SOURCE_WATERMARK_CONFLICT']);
    if (end > sessionEnd || end > cutoff || observed < end || bar.windowState === 'FORMING') {
      excludedFormingBarCount++; continue;
    }
    const firstAllowed = chart.timeframe === '1D' ? sessionStart : start;
    if (!validHlc(bar) || !positive(bar.open) || bar.open < bar.low || bar.open > bar.high
        || first === null || last === null || inputAvailable === null || first < firstAllowed
        || last < first || last > end || last > inputAvailable)
      return finish('UNAVAILABLE', ['BAR_OHLC_OR_SOURCE_TIME_INVALID']);
    const proof = bar.structureEligibility;
    if (proof?.reasonCodes?.includes('SOURCE_COMPLETION_NOT_OBSERVED')) { excludedFormingBarCount++; continue; }
    if (bar.captureCoverage?.state === 'KNOWN_INTERRUPTION' || proof?.reasonCodes?.includes('KNOWN_CAPTURE_INTERRUPTION')
        || captureOverlap(intervals, firstAllowed, end) || (finite(bar.sequenceGapCount) && bar.sequenceGapCount > 0)) {
      reset('RESET_AFTER_CAPTURE_INTERRUPTION'); continue;
    }
    const previous = segment.at(-1);
    if (previous && start !== previous.end) reset('RESET_AFTER_BAR_GAP');
    const epoch = text(bar.continuityEpoch) || text(chart.continuityEpoch);
    if (segment.length && epoch !== segment.at(-1).epoch) reset('RESET_AFTER_CONTINUITY_EPOCH_CHANGE');
    const completionEvent = time(proof?.completionSourceEventTime), completionAvailable = time(proof?.completionAvailableAt);
    const hasProof = proof?.state === 'ELIGIBLE' && Array.isArray(proof.reasonCodes) && proof.reasonCodes.length === 0
      && completionEvent !== null && completionEvent >= end && completionEvent <= observed
      && completionAvailable !== null && completionAvailable >= completionEvent && completionAvailable <= available;
    const barReasons = [];
    if (!hasProof) barReasons.push('CLOSED_BAR_CAPTURE_EVIDENCE_UNVERIFIED');
    if (proof?.state === 'BLOCKED') barReasons.push(...sourceCodes(proof.reasonCodes));
    if (bar.qualityStatus !== 'PASS' || bar.sequenceGapCount !== 0) barReasons.push('BAR_QUALITY_RESTRICTED');
    if (bar.qualityStatus !== 'PASS') barReasons.push(...sourceCodes(bar.qualityReasons));
    if (bar.sourceComplete === false || bar.captureCoverage?.state === 'SOURCE_PARTIAL') barReasons.push('SOURCE_CATCHUP_PENDING');
    segment.push({ bar, start, end, epoch, reasons: barReasons });
  }
  const sample = { firstUsedBarAt: iso(segment[0]?.start), lastClosedBarAt: iso(segment.at(-1)?.end),
    calculationAvailableAt: iso(available), closedBarCount: segment.length, excludedFormingBarCount, resetCount };
  for (const row of segment) addCodes(restricted, row.reasons);
  if (base.maxSessionClosedBars < REQUIRED_BARS)
    return finish('UNAVAILABLE', ['SESSION_CAPACITY_BELOW_REQUIRED_BARS', ...restricted], sample);
  if (segment.length < REQUIRED_BARS) return finish('WARMING_UP', ['INSUFFICIENT_CLOSED_BARS', ...restricted], sample);
  const result = calculateAdx14(segment.map(row => row.bar));
  if (result.state !== 'READY') return finish('UNAVAILABLE', result.reasonCodes, sample);
  if (result.plusDI === 0 && result.minusDI === 0) limitations.add('ZERO_DIRECTIONAL_MOVEMENT_OBSERVED');
  return finish(restricted.size ? 'QUALITY_INSUFFICIENT' : 'READY', [...restricted], { ...sample,
    value: result.value, plusDI: result.plusDI, minusDI: result.minusDI,
    deltaADX: result.deltaADX, direction: result.direction });
}
