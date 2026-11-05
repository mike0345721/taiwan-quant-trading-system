import { classifyTxChartSession, compareTxChartTicks, txChartTickOrderKey } from './dashboard-tx-chart.mjs';
import { createKnownCaptureCollector, captureIntervalOverlaps, restrictKnownCaptureLoss } from './chart-capture-coverage.mjs';

const FIVE_MINUTES = 300_000;
const FRESH_MS = 120_000;
const TIME_REASON = 'TIMESTAMP_LINEAGE_INSUFFICIENT';
const SESSION_CACHE = new WeakMap();
const SESSION_MINUTE_CACHE = new WeakMap();
const CURRENT_LEVELS = ['currentDayHigh', 'currentDayLow', 'nightHigh', 'nightLow', 'vwap', 'openingRangeHigh', 'openingRangeLow'];
const finitePositive = value => typeof value !== 'boolean' && value !== '' && value != null
  && Number.isFinite(Number(value)) && Number(value) > 0;

// Preserve sub-millisecond source ordering for the audit. Aggregation retains
// its existing millisecond buckets; this does not assert clock accuracy.
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/i.test(value)) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + '+08:00';
  const ms = Date.parse(zoned);
  if (!Number.isFinite(ms)) return null;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/).slice(1).map(Number);
  const wall = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if ([wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds()]
    .some((part, index) => part !== parts[index])) return null;
  const fraction = zoned.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] || '';
  return { ms, order: BigInt(ms) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3) || '0') };
}
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
function sourceSession(record, calendar, eventMs) {
  // Reuse only date classification; every raw identity/quality/availability
  // guard below still runs. Avoid redoing Intl/calendar work on every live poll.
  const time = record.payload.datetime;
  const cached = SESSION_CACHE.get(record);
  if (cached?.time === time && cached.calendar === calendar) return cached.context;
  // Classification is constant within a Taipei minute except the first second
  // of 13:45 and 05:00. Keep those closing seconds separate from the remainder
  // of their minute. eventMs has already passed raw timestamp validation; this
  // cache does not replace the per-record nine-digit chronology/quality audit.
  // An epoch minute also separates dates and midnight. Retain one successful
  // context per calendar, never unresolved sessions or classification errors.
  const minute = Math.floor(eventMs / 60_000);
  const taipeiMinute = ((minute + 8 * 60) % 1440 + 1440) % 1440;
  const closingSecond = (taipeiMinute === 13 * 60 + 45 || taipeiMinute === 5 * 60)
    && eventMs - minute * 60_000 < 1000;
  const recent = SESSION_MINUTE_CACHE.get(calendar);
  if (recent?.minute === minute && recent.closingSecond === closingSecond) return recent.context;
  const context = classifyTxChartSession(time, calendar);
  if (calendar !== null && ['object', 'function'].includes(typeof calendar)) SESSION_MINUTE_CACHE.set(calendar, { minute, closingSecond, context });
  SESSION_CACHE.set(record, { time, calendar, context });
  return context;
}
const reasonsOf = value => Array.isArray(value?.qualityReasons) ? value.qualityReasons : [];
function permittedQuality(value) {
  if (value?.qualityReasons != null && !Array.isArray(value.qualityReasons)) return false;
  const reasons = reasonsOf(value);
  return ['PASS', 'QUALITY_INSUFFICIENT'].includes(value?.qualityStatus)
    && reasons.every(reason => reason === TIME_REASON)
    && (value.qualityStatus === 'PASS' || reasons.includes(TIME_REASON));
}
function eligibility(reasons, availableAt = null, extra = {}) {
  const reasonCodes = Object.freeze([...new Set(reasons)]);
  return Object.freeze({ schemaVersion: 'source-time-structure-v1', state: reasonCodes.length ? 'BLOCKED' : 'ELIGIBLE',
    basis: 'REPORTED_SOURCE_TIME_GEOMETRY', availableAt, reasonCodes,
    scope: 'LIVE_DESCRIPTIVE_ONLY', executionAuthorized: false, ...extra });
}

/** Add a narrow calculation capability without changing any quality or value.
 * Records are pre-normalization, physical-order TX inputs, consumed once. This is
 * neither a replay certificate nor permission for Tick/Quote chronology use.
 */
export function attachSourceTimeStructureEligibility(chart, records, { calendar, cutoff, explicitAsOf = false } = {}) {
  if (!chart) return chart;
  const reasons = new Set();
  const at = timestamp(cutoff)?.ms;
  if (chart.mode !== 'LIVE' || explicitAsOf) reasons.add('LIVE_CURRENT_ONLY');
  if (chart.timeframe !== '5m') reasons.add('FIVE_MINUTE_STRUCTURE_ONLY');
  // Outside this new capability's scope retain legacy per-value behavior,
  // including conservative replay rendering. A top-level refusal is additive.
  if (reasons.size) return Object.freeze({ ...chart, structureEligibility: eligibility(reasons, chart.availableAt ?? null) });
  if (chart.source !== 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK') reasons.add('SOURCE_UNSUPPORTED');
  if (chart.executionAuthorized !== false || chart.orderRoutesEnabled !== false || chart.formalWeight !== 0 || chart.researchOnly !== true) reasons.add('CHART_SAFETY_BOUNDARY_INVALID');
  if (!calendar || !Number.isFinite(at)) reasons.add('SOURCE_CONTEXT_MISSING');
  if (!chart.actualContract || !chart.tradeDate || !['DAY', 'NIGHT'].includes(chart.session) || !chart.sessionId
    || chart.contractConsistencyState !== 'MATCH' || chart.contractRollover?.detected !== false
    || chart.availableContracts?.length !== 1 || chart.availableContracts[0] !== chart.actualContract) reasons.add('SOURCE_IDENTITY_UNVERIFIED');
  if (!permittedQuality(chart)) reasons.add('NON_TIMESTAMP_QUALITY_RESTRICTION');
  if (chart.sequenceGapEventCount !== 0 || chart.sequenceGapSize !== 0 || chart.futureDataViolations !== 0) reasons.add('CONTINUITY_OR_FUTURE_VIOLATION');

  // Retain only sufficient statistics for displayed bars, not raw tick history.
  // Completion is the first qualifying physical record, even if later records
  // regress in source time. Sorted thresholds let each completion commit once.
  const barInputs = (chart.bars || []).map(bar => ({ start: timestamp(bar.time)?.ms,
    sessionEnd: timestamp(bar.sessionEnd)?.ms, count: 0, maxAvailable: -Infinity, closedBy: null }));
  for (const state of barInputs) state.end = state.start + FIVE_MINUTES;
  const orderedBars = barInputs.filter(state => Number.isFinite(state.start)).sort((a, b) => a.start - b.start);
  const openingInputs = { start: timestamp(chart.tradeDate + 'T08:45:00+08:00')?.ms,
    end: timestamp(chart.tradeDate + 'T09:00:00+08:00')?.ms, count: 0, maxAvailable: -Infinity, closedBy: null };
  const completions = [...orderedBars, openingInputs].filter(state => Number.isFinite(state.end)).sort((a, b) => a.end - b.end);
  const closingBars = new Map();
  for (const state of orderedBars) if (state.end === state.sessionEnd) {
    const states = closingBars.get(state.end) || []; states.push(state); closingBars.set(state.end, states);
  }
  let completionIndex = 0, inputCount = 0, last = null, selected = null;
  let earliestEvent = Infinity, maxAvailable = -Infinity;
  const include = (state, input) => { state.count++; state.maxAvailable = Math.max(state.maxAvailable, input.effectiveMs); };
  const accumulate = input => {
    inputCount++; last = input;
    if (!selected || compareTxChartTicks(input.chartOrderKey, selected.chartOrderKey) >= 0) selected = input;
    earliestEvent = Math.min(earliestEvent, input.eventMs);
    maxAvailable = Math.max(maxAvailable, input.effectiveMs);
    while (completionIndex < completions.length && completions[completionIndex].end <= input.eventMs) {
      completions[completionIndex++].closedBy = input;
    }
    let low = 0, high = orderedBars.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (orderedBars[middle].start <= input.eventMs) low = middle + 1; else high = middle;
    }
    for (let index = low - 1; index >= 0 && orderedBars[index].end > input.eventMs; index--) include(orderedBars[index], input);
    for (const state of closingBars.get(input.eventMs) || []) include(state, input);
    if (input.eventMs >= openingInputs.start && input.eventMs < openingInputs.end) include(openingInputs, input);
  };
  let duplicateExcludedCount = 0, futureExcludedCount = 0, scopedRecordCount = 0;
  let previousSourceOrder = null;
  const capture = createKnownCaptureCollector({ actualContract: chart.actualContract, cutoff, calendar });
  for (const record of records || []) {
    // Capture evidence has its own guards. Feed every physical record before
    // the narrower source-time eligibility filters can exclude it.
    capture.append(record);
    if (record?.kind !== 'futures_tick') continue;
    if (record.duplicate === true || record.payload?.simtrade === true) { duplicateExcludedCount++; continue; }
    const payload = record.payload || {};
    const event = timestamp(payload.datetime);
    const envelope = record.exchangeTimestamp === payload.datetime ? event : timestamp(record.exchangeTimestamp);
    const received = record.receivedAt === payload.datetime ? event
      : record.receivedAt === record.exchangeTimestamp ? envelope : timestamp(record.receivedAt);
    if (!event || !envelope || !received) { reasons.add('RAW_TIMESTAMP_MISSING_OR_INVALID'); continue; }
    if (event.order !== envelope.order) { reasons.add('SOURCE_TIMESTAMP_CONFLICT'); continue; }
    let context;
    try { context = sourceSession(record, calendar, event.ms); }
    catch { reasons.add('SOURCE_SESSION_UNRESOLVED'); continue; }
    if (context.sessionTradeDate !== chart.tradeDate || context.session !== chart.session || context.sessionId !== chart.sessionId) continue;
    scopedRecordCount++;
    const effectiveMs = Math.max(event.ms, received.ms);
    if (Number.isFinite(at) && effectiveMs > at) { futureExcludedCount++; continue; }
    if (payload._product_family !== 'TX' || !/^TXF[A-L]\d$/.test(chart.actualContract || '')
      || [record.product, payload.code, payload._target_code].some(code => code !== chart.actualContract)) {
      reasons.add('RAW_IDENTITY_MISMATCH'); continue;
    }
    if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) reasons.add('RAW_SAFETY_BOUNDARY_INVALID');
    if (!finitePositive(payload.close) || !finitePositive(payload.volume)) { reasons.add('RAW_PRICE_OR_VOLUME_INVALID'); continue; }
    if (record.sequenceGap !== 0) reasons.add('RAW_SEQUENCE_GAP_OR_UNKNOWN');
    if (previousSourceOrder != null && event.order < previousSourceOrder) reasons.add('SOURCE_EVENT_TIME_REGRESSION');
    previousSourceOrder = event.order;
    // The chart loader changes availability text only for a negative delta.
    // Preserve that exact provenance for fallback event IDs, and preserve the
    // original physical input order separately for the chronology audit.
    const chartOrderKey = txChartTickOrderKey({ eventId: record.eventId, actualContract: chart.actualContract,
      exchangeTimestamp: payload.datetime, availableAt: received.ms < event.ms ? iso(event.ms) : record.receivedAt,
      price: Number(payload.close), volume: Number(payload.volume) });
    accumulate({ eventMs: event.ms, receivedMs: received.ms, effectiveMs, price: Number(payload.close), chartOrderKey });
  }
  if (!inputCount || inputCount !== chart.sourceEventCount) reasons.add('SOURCE_INPUT_COUNT_MISMATCH');
  if (!last || !Number.isFinite(at) || last.eventMs > at || last.receivedMs > at
    || at - last.eventMs > FRESH_MS || at - last.receivedMs > FRESH_MS) reasons.add('SOURCE_EVENT_OR_RECEIPT_STALE');
  // Chart ordering has a deterministic event-ID tie-break; it does not claim
  // that equal source times establish physical ordering. Compare to its exact
  // selected tick rather than accepting any price within the tied timestamp.
  if (!selected || !Number.isFinite(at) || selected.eventMs > at || selected.receivedMs > at
    || at - selected.eventMs > FRESH_MS || at - selected.receivedMs > FRESH_MS) reasons.add('SELECTED_SOURCE_EVENT_OR_RECEIPT_STALE');
  if (!selected || timestamp(chart.lastEventTime)?.ms !== selected.eventMs || Number(chart.lastPrice) !== selected.price) reasons.add('LATEST_SOURCE_MISMATCH');
  const captureIntervals = capture.finish();
  const sessionStart = timestamp(chart.bars?.[0]?.sessionStart)?.ms
    ?? earliestEvent;
  if (timestamp(chart.availableAt)?.ms !== maxAvailable) reasons.add('CHART_AVAILABILITY_MISMATCH');
  const audit = Object.freeze({ scopedRecordCount, includedInputCount: inputCount, duplicateExcludedCount, futureExcludedCount,
    sourceEventWatermark: iso(last?.eventMs), sourceReceiptAt: iso(last?.receivedMs), effectiveAvailableAt: iso(maxAvailable),
    selectedSourceEventTime: iso(selected?.eventMs), selectedSourceReceiptAt: iso(selected?.receivedMs),
    selectedSourceEventId: selected?.chartOrderKey.eventId ?? null,
    chronologyQualityPreserved: true,
    feedCompleteness: captureIntervalOverlaps(captureIntervals, sessionStart, at) ? 'KNOWN_CAPTURE_INTERRUPTION' : 'UNKNOWN_NO_NATIVE_SEQUENCE',
    ...(captureIntervals.length ? { captureIntervals } : {}), replayEligible: false,
    priceConfirmationEligible: false, flowConfirmationEligible: false });
  const top = eligibility(reasons, iso(maxAvailable), { audit });
  const baseReasons = [...top.reasonCodes];
  const bars = Object.freeze((chart.bars || []).map((bar, index) => {
    const bad = [...baseReasons];
    const start = timestamp(bar.time)?.ms, end = start + FIVE_MINUTES;
    const sourceRows = barInputs[index];
    const closedBy = sourceRows.closedBy;
    const captureAffected = captureIntervalOverlaps(captureIntervals, start, end);
    if (captureAffected) bad.push('KNOWN_CAPTURE_INTERRUPTION');
    if (!Number.isFinite(start) || end > at || !closedBy || closedBy.effectiveMs > at) bad.push('SOURCE_COMPLETION_NOT_OBSERVED');
    if (['actualContract', 'tradeDate', 'session', 'sessionId'].some(key => bar[key] !== chart[key])) bad.push('BAR_IDENTITY_MISMATCH');
    if (!permittedQuality(bar) || bar.sequenceGapCount !== 0) bad.push('BAR_NON_TIMESTAMP_QUALITY');
    if (!sourceRows.count || sourceRows.count !== bar.eventCount || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finitePositive)) bad.push('BAR_INPUTS_UNVERIFIED');
    const inputAvailable = sourceRows.maxAvailable;
    const available = Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity);
    return Object.freeze({ ...restrictKnownCaptureLoss(bar, captureAffected), structureEligibility: eligibility(bad, iso(available), {
      completionAvailableAt: iso(closedBy?.effectiveMs), completionSourceEventTime: iso(closedBy?.eventMs) }) });
  }));
  const levelEligibility = (value, name) => {
    const bad = [...baseReasons];
    const expectedSource = name.startsWith('openingRange') ? 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900'
      : name === 'vwap' ? 'SESSION_EXACT_TX_TICK_VWAP' : 'ACTUAL_TX_TICK_STREAM';
    if (!permittedQuality(value) || !finitePositive(value.value ?? value.high)
      || value.source !== expectedSource
      || ['actualContract', 'tradeDate', 'session'].some(key => value[key] !== chart[key])) bad.push('LEVEL_INPUTS_UNVERIFIED');
    if (timestamp(value.availableAt)?.ms == null || timestamp(value.availableAt).ms > at) bad.push('LEVEL_AVAILABILITY_INVALID');
    let inputAvailable = maxAvailable, closedBy = null;
    // A LIVE cumulative reference must account for an open outage after its
    // last tick, not stop checking at that tick's own availability.
    let windowStart = sessionStart, windowEnd = at;
    if (name.startsWith('openingRange')) {
      const start = timestamp(chart.tradeDate + 'T08:45:00+08:00')?.ms;
      const end = timestamp(chart.tradeDate + 'T09:00:00+08:00')?.ms;
      inputAvailable = openingInputs.maxAvailable;
      windowStart = start; windowEnd = end;
      closedBy = openingInputs.closedBy;
      if (chart.session !== 'DAY' || !openingInputs.count || !closedBy || closedBy.effectiveMs > at
        || !['READY', 'QUALITY_INSUFFICIENT'].includes(chart.openingRange?.status)) bad.push('OPENING_RANGE_COMPLETION_UNVERIFIED');
    }
    if (captureIntervalOverlaps(captureIntervals, windowStart, windowEnd)) bad.push('KNOWN_CAPTURE_INTERRUPTION');
    return eligibility(bad, iso(Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity)),
      closedBy ? { completionAvailableAt: iso(closedBy.effectiveMs) } : {});
  };
  const levels = { ...(chart.levels || {}) };
  for (const name of CURRENT_LEVELS) if (levels[name]?.availability === 'AVAILABLE') {
    const proof = levelEligibility(levels[name], name);
    levels[name] = Object.freeze({ ...restrictKnownCaptureLoss(levels[name], proof.reasonCodes.includes('KNOWN_CAPTURE_INTERRUPTION')), structureEligibility: proof });
  }
  let openingRange = chart.openingRange;
  if (openingRange && ['READY', 'QUALITY_INSUFFICIENT'].includes(openingRange.status)) {
    const proof = levelEligibility(openingRange, 'openingRange');
    openingRange = Object.freeze({ ...restrictKnownCaptureLoss(openingRange, proof.reasonCodes.includes('KNOWN_CAPTURE_INTERRUPTION')), structureEligibility: proof });
  }
  return Object.freeze({ ...chart, structureEligibility: top, bars, levels: Object.freeze(levels), openingRange });
}
