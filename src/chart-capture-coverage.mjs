import { classifyTxChartSession } from './dashboard-tx-chart.mjs';

// Known reception interruptions are different from an unknown native sequence.
// Keep lifecycle evidence in physical ledger order; never infer zero loss from silence.
export const CAPTURE_EVENT_KINDS = Object.freeze(['provider_event', 'session_down', 'bridge_stopped']);
const isCaptureKind = kind => CAPTURE_EVENT_KINDS.includes(kind);
const time = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + '+08:00';
  const result = Date.parse(zoned);
  return Number.isFinite(result) ? result : null;
};
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
function governedSessionStart(value, calendar) {
  if (!calendar) return null;
  try { return time(classifyTxChartSession(iso(value), calendar).sessionStart); }
  catch { return null; }
}

export function compactCaptureEvidence(record) {
  if (!isCaptureKind(record?.kind)) return null;
  const payload = record.payload || {};
  return { kind: record.kind, product: record.product, eventId: record.eventId,
    receivedAt: record.receivedAt, exchangeTimestamp: record.exchangeTimestamp,
    duplicate: record.duplicate === true, sequenceGap: record.sequenceGap,
    executionAuthorized: record.executionAuthorized, orderRoutesEnabled: record.orderRoutesEnabled,
    payload: { code: payload.code, datetime: payload.datetime, eventCode: payload.eventCode,
      event: payload.event, info: payload.info, processId: payload.processId } };
}

function failureReason(record, contract) {
  if (record.kind === 'session_down') return 'RECORDED_SESSION_DOWN';
  if (record.kind === 'bridge_stopped') return 'RECORDED_BRIDGE_STOP';
  if (record.kind !== 'provider_event') return null;
  const code = record.payload?.eventCode;
  if (code === 12 || code === 13) return 'RECORDED_PROVIDER_RECONNECTION';
  const topic = record.payload?.info;
  // BidAsk-only or another contract's failed subscription cannot invalidate TX OHLC.
  if (code === 4 && typeof topic === 'string' && topic.startsWith('TIC/')
    && topic.split('/').at(-1) === contract) return 'RECORDED_TICK_SUBSCRIPTION_PROBLEM';
  return null;
}

export function knownCaptureIntervals(records, { actualContract, cutoff, calendar = null } = {}) {
  const at = time(cutoff);
  if (!Number.isFinite(at) || typeof actualContract !== 'string') return Object.freeze([]);
  const intervals = [];
  let previousTick = null, pending = null;
  for (const record of records || []) {
    if (!record || record.duplicate === true) continue;
    const receipt = time(record.receivedAt);
    if (!Number.isFinite(receipt) || receipt > at) continue;
    if (record.kind === 'futures_tick') {
      const payload = record.payload || {}, source = time(payload.datetime);
      if (payload.simtrade === true || payload._product_family !== 'TX'
        || payload.code !== actualContract || record.product !== actualContract
        || payload._target_code !== actualContract || !Number.isFinite(source)
        || Math.max(source, receipt) > at || !(Number(payload.close) > 0) || !(Number(payload.volume) > 0)) continue;
      // A physically later callback can carry an older trade. It must not
      // regress the source watermark or erase the pending interruption.
      if (previousTick != null && source < previousTick) continue;
      if (pending) {
        if (pending.start != null && source <= pending.start) continue;
        const witnessSessionStart = governedSessionStart(source, calendar);
        if (calendar && (witnessSessionStart == null
          || (pending.sessionFloor != null && witnessSessionStart < pending.sessionFloor))) continue;
        intervals.push(Object.freeze({ startSourceAt: iso(pending.start), endSourceAt: iso(source),
          detectedAt: iso(pending.detected), restorationAvailableAt: iso(Math.max(source, receipt)),
          reasonCodes: Object.freeze([...pending.reasons]), witnesses: Object.freeze(pending.witnesses) }));
        pending = null;
      }
      previousTick = source;
      continue;
    }
    const reason = failureReason(record, actualContract);
    if (!reason) continue;
    const event = time(record.payload?.datetime);
    if (!Number.isFinite(event) || Math.max(event, receipt) > at) continue;
    // Bounds are source-time observations surrounding a recorded failure, not
    // a claimed physical outage duration or cross-clock error estimate.
    const sessionFloor = governedSessionStart(event, calendar);
    if (!pending) pending = { start: previousTick, detected: Math.max(event, receipt), sessionFloor, reasons: new Set(), witnesses: [] };
    else if (sessionFloor != null) pending.sessionFloor = Math.max(pending.sessionFloor ?? sessionFloor, sessionFloor);
    pending.reasons.add(reason);
    if (pending.witnesses.length < 8) pending.witnesses.push(Object.freeze({
      kind: record.kind, eventId: record.eventId ?? null, receivedAt: record.receivedAt, reason }));
  }
  if (pending) intervals.push(Object.freeze({ startSourceAt: iso(pending.start), endSourceAt: null,
    detectedAt: iso(pending.detected), restorationAvailableAt: null,
    reasonCodes: Object.freeze([...pending.reasons]), witnesses: Object.freeze(pending.witnesses) }));
  return Object.freeze(intervals);
}

export function captureIntervalOverlaps(intervals, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  return (intervals || []).some(interval => {
    const from = time(interval.startSourceAt), reportedUntil = time(interval.endSourceAt);
    // An inverted/empty restoration interval is uncertainty, not a proof of no loss.
    const until = from != null && reportedUntil != null && reportedUntil <= from ? null : reportedUntil;
    // Missing start/end means unverified coverage to the corresponding boundary.
    return (until == null || until > start) && (from == null || from < end);
  });
}

export function restrictKnownCaptureLoss(value, affected) {
  if (!affected) return value;
  return Object.freeze({ ...value,
    ...(value.status === 'READY' ? { status: 'QUALITY_INSUFFICIENT' } : {}),
    qualityStatus: 'QUALITY_INSUFFICIENT', reason: 'KNOWN_CAPTURE_INTERRUPTION',
    qualityReasons: Object.freeze([...new Set([...(value.qualityReasons || []), 'KNOWN_CAPTURE_INTERRUPTION'])]),
    captureCoverage: Object.freeze({ state: 'KNOWN_INTERRUPTION',
      reason: 'KNOWN_CAPTURE_INTERRUPTION', completeMarketWindow: false,
      numericValues: 'PRESERVED_OBSERVED_SUBSET_NOT_CERTIFIED_COMPLETE_RANGE' }) });
}
