import { classifyTxChartSession, compareTxChartTicks, txChartTickOrderKey } from './dashboard-tx-chart.mjs';

const FIVE_MINUTES = 300_000;
const FRESH_MS = 120_000;
const TIME_REASON = 'TIMESTAMP_LINEAGE_INSUFFICIENT';
const SESSION_CACHE = new WeakMap();
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
function sourceSession(record, calendar) {
  // Reuse only date classification; every raw identity/quality/availability
  // guard below still runs. Avoid redoing Intl/calendar work on every live poll.
  const time = record.payload.datetime;
  const cached = SESSION_CACHE.get(record);
  if (cached?.time === time && cached.calendar === calendar) return cached.context;
  const context = classifyTxChartSession(time, calendar);
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
 * Records are the pre-normalization, physical-order TX cache inputs. This is
 * neither a replay certificate nor permission for Tick/Quote chronology use.
 */
export function attachSourceTimeStructureEligibility(chart, records, { calendar, cutoff, explicitAsOf = false } = {}) {
  if (!chart) return chart;
  const reasons = [];
  const at = timestamp(cutoff)?.ms;
  if (chart.mode !== 'LIVE' || explicitAsOf) reasons.push('LIVE_CURRENT_ONLY');
  if (chart.timeframe !== '5m') reasons.push('FIVE_MINUTE_STRUCTURE_ONLY');
  // Outside this new capability's scope retain legacy per-value behavior,
  // including conservative replay rendering. A top-level refusal is additive.
  if (reasons.length) return Object.freeze({ ...chart, structureEligibility: eligibility(reasons, chart.availableAt ?? null) });
  if (chart.source !== 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK') reasons.push('SOURCE_UNSUPPORTED');
  if (chart.executionAuthorized !== false || chart.orderRoutesEnabled !== false || chart.formalWeight !== 0 || chart.researchOnly !== true) reasons.push('CHART_SAFETY_BOUNDARY_INVALID');
  if (!calendar || !Number.isFinite(at)) reasons.push('SOURCE_CONTEXT_MISSING');
  if (!chart.actualContract || !chart.tradeDate || !['DAY', 'NIGHT'].includes(chart.session) || !chart.sessionId
    || chart.contractConsistencyState !== 'MATCH' || chart.contractRollover?.detected !== false
    || chart.availableContracts?.length !== 1 || chart.availableContracts[0] !== chart.actualContract) reasons.push('SOURCE_IDENTITY_UNVERIFIED');
  if (!permittedQuality(chart)) reasons.push('NON_TIMESTAMP_QUALITY_RESTRICTION');
  if (chart.sequenceGapEventCount !== 0 || chart.sequenceGapSize !== 0 || chart.futureDataViolations !== 0) reasons.push('CONTINUITY_OR_FUTURE_VIOLATION');

  const inputs = [];
  let duplicateExcludedCount = 0, futureExcludedCount = 0, scopedRecordCount = 0;
  let previousSourceOrder = null;
  for (const record of records || []) {
    if (record?.kind !== 'futures_tick') continue;
    if (record.duplicate === true || record.payload?.simtrade === true) { duplicateExcludedCount++; continue; }
    const payload = record.payload || {};
    const event = timestamp(payload.datetime), envelope = timestamp(record.exchangeTimestamp), received = timestamp(record.receivedAt);
    if (!event || !envelope || !received) { reasons.push('RAW_TIMESTAMP_MISSING_OR_INVALID'); continue; }
    if (event.order !== envelope.order) { reasons.push('SOURCE_TIMESTAMP_CONFLICT'); continue; }
    let context;
    try { context = sourceSession(record, calendar); }
    catch { reasons.push('SOURCE_SESSION_UNRESOLVED'); continue; }
    if (context.sessionTradeDate !== chart.tradeDate || context.session !== chart.session || context.sessionId !== chart.sessionId) continue;
    scopedRecordCount++;
    const effectiveMs = Math.max(event.ms, received.ms);
    if (Number.isFinite(at) && effectiveMs > at) { futureExcludedCount++; continue; }
    if (payload._product_family !== 'TX' || !/^TXF[A-L]\d$/.test(chart.actualContract || '')
      || [record.product, payload.code, payload._target_code].some(code => code !== chart.actualContract)) {
      reasons.push('RAW_IDENTITY_MISMATCH'); continue;
    }
    if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) reasons.push('RAW_SAFETY_BOUNDARY_INVALID');
    if (!finitePositive(payload.close) || !finitePositive(payload.volume)) { reasons.push('RAW_PRICE_OR_VOLUME_INVALID'); continue; }
    if (record.sequenceGap !== 0) reasons.push('RAW_SEQUENCE_GAP_OR_UNKNOWN');
    if (previousSourceOrder != null && event.order < previousSourceOrder) reasons.push('SOURCE_EVENT_TIME_REGRESSION');
    previousSourceOrder = event.order;
    // The chart loader changes availability text only for a negative delta.
    // Preserve that exact provenance for fallback event IDs, and preserve the
    // original physical input order separately for the chronology audit.
    const chartOrderKey = txChartTickOrderKey({ eventId: record.eventId, actualContract: chart.actualContract,
      exchangeTimestamp: payload.datetime, availableAt: received.ms < event.ms ? iso(event.ms) : record.receivedAt,
      price: Number(payload.close), volume: Number(payload.volume) });
    inputs.push({ eventMs: event.ms, receivedMs: received.ms, effectiveMs, price: Number(payload.close), volume: Number(payload.volume), chartOrderKey });
  }
  if (!inputs.length || inputs.length !== chart.sourceEventCount) reasons.push('SOURCE_INPUT_COUNT_MISMATCH');
  const last = inputs.at(-1);
  if (!last || !Number.isFinite(at) || last.eventMs > at || last.receivedMs > at
    || at - last.eventMs > FRESH_MS || at - last.receivedMs > FRESH_MS) reasons.push('SOURCE_EVENT_OR_RECEIPT_STALE');
  // Chart ordering has a deterministic event-ID tie-break; it does not claim
  // that equal source times establish physical ordering. Compare to its exact
  // selected tick rather than accepting any price within the tied timestamp.
  const selected = inputs.reduce((latest, input) => !latest || compareTxChartTicks(input.chartOrderKey, latest.chartOrderKey) >= 0 ? input : latest, null);
  if (!selected || timestamp(chart.lastEventTime)?.ms !== selected.eventMs || Number(chart.lastPrice) !== selected.price) reasons.push('LATEST_SOURCE_MISMATCH');
  const maxAvailable = inputs.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);
  if (timestamp(chart.availableAt)?.ms !== maxAvailable) reasons.push('CHART_AVAILABILITY_MISMATCH');
  const audit = Object.freeze({ scopedRecordCount, includedInputCount: inputs.length, duplicateExcludedCount, futureExcludedCount,
    sourceEventWatermark: iso(last?.eventMs), sourceReceiptAt: iso(last?.receivedMs), effectiveAvailableAt: iso(maxAvailable),
    chronologyQualityPreserved: true, feedCompleteness: 'UNKNOWN_NO_NATIVE_SEQUENCE', replayEligible: false,
    priceConfirmationEligible: false, flowConfirmationEligible: false });
  const top = eligibility(reasons, iso(maxAvailable), { audit });
  const baseReasons = [...top.reasonCodes];
  const completion = end => inputs.find(input => input.eventMs >= end);
  const bars = Object.freeze((chart.bars || []).map(bar => {
    const bad = [...baseReasons];
    const start = timestamp(bar.time)?.ms, end = start + FIVE_MINUTES;
    const sourceRows = inputs.filter(input => input.eventMs >= start && input.eventMs < end);
    // Existing exact-session-close semantics place the closing tick in the preceding bucket.
    if (end === timestamp(bar.sessionEnd)?.ms) sourceRows.push(...inputs.filter(input => input.eventMs === end));
    const closedBy = completion(end);
    if (!Number.isFinite(start) || end > at || !closedBy || closedBy.effectiveMs > at) bad.push('SOURCE_COMPLETION_NOT_OBSERVED');
    if (['actualContract', 'tradeDate', 'session', 'sessionId'].some(key => bar[key] !== chart[key])) bad.push('BAR_IDENTITY_MISMATCH');
    if (!permittedQuality(bar) || bar.sequenceGapCount !== 0) bad.push('BAR_NON_TIMESTAMP_QUALITY');
    if (!sourceRows.length || sourceRows.length !== bar.eventCount || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finitePositive)) bad.push('BAR_INPUTS_UNVERIFIED');
    const inputAvailable = sourceRows.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);
    const available = Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity);
    return Object.freeze({ ...bar, structureEligibility: eligibility(bad, iso(available), {
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
    let inputRows = inputs, closedBy = null;
    if (name.startsWith('openingRange')) {
      const start = timestamp(chart.tradeDate + 'T08:45:00+08:00')?.ms;
      const end = timestamp(chart.tradeDate + 'T09:00:00+08:00')?.ms;
      inputRows = inputs.filter(input => input.eventMs >= start && input.eventMs < end);
      closedBy = completion(end);
      if (chart.session !== 'DAY' || !inputRows.length || !closedBy || closedBy.effectiveMs > at
        || !['READY', 'QUALITY_INSUFFICIENT'].includes(chart.openingRange?.status)) bad.push('OPENING_RANGE_COMPLETION_UNVERIFIED');
    }
    const inputAvailable = inputRows.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);
    return eligibility(bad, iso(Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity)),
      closedBy ? { completionAvailableAt: iso(closedBy.effectiveMs) } : {});
  };
  const levels = { ...(chart.levels || {}) };
  for (const name of CURRENT_LEVELS) if (levels[name]?.availability === 'AVAILABLE') {
    levels[name] = Object.freeze({ ...levels[name], structureEligibility: levelEligibility(levels[name], name) });
  }
  const openingRange = chart.openingRange && ['READY', 'QUALITY_INSUFFICIENT'].includes(chart.openingRange.status)
    ? Object.freeze({ ...chart.openingRange, structureEligibility: levelEligibility(chart.openingRange, 'openingRange') }) : chart.openingRange;
  return Object.freeze({ ...chart, structureEligibility: top, bars, levels: Object.freeze(levels), openingRange });
}
