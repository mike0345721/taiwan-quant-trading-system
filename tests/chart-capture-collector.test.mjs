import test from "node:test";
import assert from "node:assert/strict";
import { createKnownCaptureCollector, knownCaptureIntervals } from "../src/chart-capture-coverage.mjs";
import { loadGovernedTradingCalendar } from "../src/market-state-forward-shadow-calendar.mjs";
// Frozen 9f4288 physical capture state machine, independent of collector.
const ORACLE_SOURCE = "import { classifyTxChartSession } from './dashboard-tx-chart.mjs';\n\n// Known reception interruptions are different from an unknown native sequence.\n// Keep lifecycle evidence in physical ledger order; never infer zero loss from silence.\nexport const CAPTURE_EVENT_KINDS = Object.freeze(['provider_event', 'session_down', 'bridge_stopped']);\nconst isCaptureKind = kind => CAPTURE_EVENT_KINDS.includes(kind);\nconst time = value => {\n  if (typeof value !== 'string' || !value.trim()) return null;\n  const zoned = /(?:Z|[+-]\\d{2}:\\d{2})$/i.test(value) ? value : value + '+08:00';\n  const result = Date.parse(zoned);\n  return Number.isFinite(result) ? result : null;\n};\nconst iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;\nfunction governedSessionStart(value, calendar) {\n  if (!calendar) return null;\n  try { return time(classifyTxChartSession(iso(value), calendar).sessionStart); }\n  catch { return null; }\n}\n\nexport function compactCaptureEvidence(record) {\n  if (!isCaptureKind(record?.kind)) return null;\n  const payload = record.payload || {};\n  return { kind: record.kind, product: record.product, eventId: record.eventId,\n    receivedAt: record.receivedAt, exchangeTimestamp: record.exchangeTimestamp,\n    duplicate: record.duplicate === true, sequenceGap: record.sequenceGap,\n    executionAuthorized: record.executionAuthorized, orderRoutesEnabled: record.orderRoutesEnabled,\n    payload: { code: payload.code, datetime: payload.datetime, eventCode: payload.eventCode,\n      event: payload.event, info: payload.info, processId: payload.processId } };\n}\n\nfunction failureReason(record, contract) {\n  if (record.kind === 'session_down') return 'RECORDED_SESSION_DOWN';\n  if (record.kind === 'bridge_stopped') return 'RECORDED_BRIDGE_STOP';\n  if (record.kind !== 'provider_event') return null;\n  const code = record.payload?.eventCode;\n  if (code === 12 || code === 13) return 'RECORDED_PROVIDER_RECONNECTION';\n  const topic = record.payload?.info;\n  // BidAsk-only or another contract's failed subscription cannot invalidate TX OHLC.\n  if (code === 4 && typeof topic === 'string' && topic.startsWith('TIC/')\n    && topic.split('/').at(-1) === contract) return 'RECORDED_TICK_SUBSCRIPTION_PROBLEM';\n  return null;\n}\n\nexport function knownCaptureIntervals(records, { actualContract, cutoff, calendar = null } = {}) {\n  const at = time(cutoff);\n  if (!Number.isFinite(at) || typeof actualContract !== 'string') return Object.freeze([]);\n  const intervals = [];\n  let previousTick = null, pending = null;\n  for (const record of records || []) {\n    if (!record || record.duplicate === true) continue;\n    const receipt = time(record.receivedAt);\n    if (!Number.isFinite(receipt) || receipt > at) continue;\n    if (record.kind === 'futures_tick') {\n      const payload = record.payload || {}, source = time(payload.datetime);\n      if (payload.simtrade === true || payload._product_family !== 'TX'\n        || payload.code !== actualContract || record.product !== actualContract\n        || payload._target_code !== actualContract || !Number.isFinite(source)\n        || Math.max(source, receipt) > at || !(Number(payload.close) > 0) || !(Number(payload.volume) > 0)) continue;\n      // A physically later callback can carry an older trade. It must not\n      // regress the source watermark or erase the pending interruption.\n      if (previousTick != null && source < previousTick) continue;\n      if (pending) {\n        if ((pending.start != null && source <= pending.start)\n          || source <= pending.failureSourceWatermark) continue;\n        const witnessSessionStart = governedSessionStart(source, calendar);\n        if (calendar && (witnessSessionStart == null\n          || (pending.sessionFloor != null && witnessSessionStart < pending.sessionFloor))) continue;\n        intervals.push(Object.freeze({ startSourceAt: iso(pending.start), endSourceAt: iso(source),\n          detectedAt: iso(pending.detected), restorationAvailableAt: iso(Math.max(source, receipt)),\n          reasonCodes: Object.freeze([...pending.reasons]), witnesses: Object.freeze(pending.witnesses) }));\n        pending = null;\n      }\n      previousTick = source;\n      continue;\n    }\n    const reason = failureReason(record, actualContract);\n    if (!reason) continue;\n    const event = time(record.payload?.datetime);\n    if (!Number.isFinite(event) || Math.max(event, receipt) > at) continue;\n    // Bounds are source-time observations surrounding a recorded failure, not\n    // a claimed physical outage duration or cross-clock error estimate.\n    const sessionFloor = governedSessionStart(event, calendar);\n    if (!pending) pending = { start: previousTick, detected: Math.max(event, receipt),\n      failureSourceWatermark: event, sessionFloor, reasons: new Set(), witnesses: [] };\n    else {\n      pending.failureSourceWatermark = Math.max(pending.failureSourceWatermark, event);\n      if (sessionFloor != null) pending.sessionFloor = Math.max(pending.sessionFloor ?? sessionFloor, sessionFloor);\n    }\n    pending.reasons.add(reason);\n    if (pending.witnesses.length < 8) pending.witnesses.push(Object.freeze({\n      kind: record.kind, eventId: record.eventId ?? null, receivedAt: record.receivedAt, reason }));\n  }\n  if (pending) intervals.push(Object.freeze({ startSourceAt: iso(pending.start), endSourceAt: null,\n    detectedAt: iso(pending.detected), restorationAvailableAt: null,\n    reasonCodes: Object.freeze([...pending.reasons]), witnesses: Object.freeze(pending.witnesses) }));\n  return Object.freeze(intervals);\n}\n\nexport function captureIntervalOverlaps(intervals, start, end) {\n  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;\n  return (intervals || []).some(interval => {\n    const from = time(interval.startSourceAt), reportedUntil = time(interval.endSourceAt);\n    // An inverted/empty restoration interval is uncertainty, not a proof of no loss.\n    const until = from != null && reportedUntil != null && reportedUntil <= from ? null : reportedUntil;\n    // Missing start/end means unverified coverage to the corresponding boundary.\n    return (until == null || until > start) && (from == null || from < end);\n  });\n}\n\nexport function restrictKnownCaptureLoss(value, affected) {\n  if (!affected) return value;\n  return Object.freeze({ ...value,\n    ...(value.status === 'READY' ? { status: 'QUALITY_INSUFFICIENT' } : {}),\n    qualityStatus: 'QUALITY_INSUFFICIENT', reason: 'KNOWN_CAPTURE_INTERRUPTION',\n    qualityReasons: Object.freeze([...new Set([...(value.qualityReasons || []), 'KNOWN_CAPTURE_INTERRUPTION'])]),\n    captureCoverage: Object.freeze({ state: 'KNOWN_INTERRUPTION',\n      reason: 'KNOWN_CAPTURE_INTERRUPTION', completeMarketWindow: false,\n      numericValues: 'PRESERVED_OBSERVED_SUBSET_NOT_CERTIFIED_COMPLETE_RANGE' }) });\n}\n";
const oracleModule = ORACLE_SOURCE.replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL('../src/' + relative.slice(2), import.meta.url).href}'`);
const { knownCaptureIntervals: oracle } = await import('data:text/javascript;base64,' + Buffer.from(oracleModule).toString('base64'));
const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const start = Date.parse('2026-10-13T15:00:00+08:00');
const iso = ms => new Date(ms).toISOString();
const options = { calendar, actualContract: 'TXFJ6', cutoff: iso(start + 1200000) };
function tick(at, extra = {}) {
  return { kind: 'futures_tick', product: 'TXFJ6', receivedAt: iso(at), exchangeTimestamp: iso(at), sequenceGap: 0,
    executionAuthorized: false, orderRoutesEnabled: false, payload: { datetime: iso(at), code: 'TXFJ6', _target_code: 'TXFJ6', _product_family: 'TX', close: 100, volume: 1 }, ...extra };
}
function failure(at, kind = 'provider_event', eventCode = 4, info = 'TIC/v1/FOP/*/TFE/TXFJ6') {
  return { kind, eventId: `failure-${at}-${kind}-${eventCode}`, receivedAt: iso(at), payload: { datetime: iso(at), eventCode, info } };
}
function compare(records, config = options) {
  const original = JSON.stringify(records);
  const collector = createKnownCaptureCollector(config);
  for (const record of records) collector.append(record);
  const actual = collector.finish();
  assert.deepEqual(actual, oracle(records, config));
  assert.deepEqual(knownCaptureIntervals(records, config), actual);
  assert.equal(collector.finish(), actual);
  assert.ok(Object.isFrozen(actual));
  assert.throws(() => collector.append(tick(start)), /CAPTURE_COLLECTOR_FINISHED/);
  assert.equal(JSON.stringify(records), original);
  return actual;
}

test('collector matches frozen physical state machine for repeated failures and final open interval', () => {
  const records = [tick(start), ...Array.from({ length: 12 }, (_, index) => failure(start + 1000 + index, index % 2 ? 'session_down' : 'provider_event', index % 3 ? 12 : 13)),
    tick(start + 2000), failure(start + 3000, 'bridge_stopped')];
  const result = compare(records);
  assert.equal(result.length, 2);
  assert.equal(result[0].witnesses.length, 8);
  assert.equal(result[1].endSourceAt, null);
  compare([]);
});

test('collector retains all tick, identity, availability and provider-topic guards', () => {
  const invalidTicks = [null, tick(start + 2000, { duplicate: true }), tick(start + 2000, { receivedAt: null }),
    tick(start + 2000, { receivedAt: iso(start + 1300000) }), tick(start + 1300000),
    tick(start + 2000, { product: 'TXFK6' })];
  for (const patch of [{ simtrade: true }, { _product_family: 'MX' }, { code: 'TXFK6' }, { _target_code: 'TXFK6' },
    { datetime: 'invalid' }, { close: 0 }, { volume: null }]) {
    const row = tick(start + 2000); Object.assign(row.payload, patch); invalidTicks.push(row);
  }
  const result = compare([tick(start), failure(start + 1000), ...invalidTicks]);
  assert.equal(result[0].endSourceAt, null);
  for (const record of [failure(start + 1000, 'provider_event', 4, 'QUO/v1/FOP/*/TFE/TXFJ6'),
    failure(start + 1000, 'provider_event', 4, 'TIC/v1/FOP/*/TFE/TXFK6'),
    failure(start + 1000, 'provider_event', 1), failure(start + 1300000),
    { ...failure(start + 1000), duplicate: true }, { ...failure(start + 1000), receivedAt: null }]) {
    assert.equal(compare([tick(start), record]).length, 0);
  }
});

test('late physical callbacks cannot regress watermark or close before failure source and session floor', () => {
  const close = Date.parse('2026-10-14T05:00:00+08:00');
  const futureNight = Date.parse('2026-10-14T15:00:00+08:00');
  const config = { ...options, cutoff: iso(futureNight + 10000) };
  const records = [tick(close - 1000), failure(futureNight + 1000, 'session_down'),
    tick(close - 2000), tick(close), tick(futureNight), tick(futureNight + 1000), tick(futureNight + 2000)];
  const result = compare(records, config);
  assert.equal(result[0].endSourceAt, iso(futureNight + 2000));
  compare([failure(start + 1000), tick(start + 999), tick(start + 1000), tick(start + 1001)]);
  compare([tick(start), failure(start + 1000), failure(start + 3000), tick(start + 2000), tick(start + 3001)]);
});

test('cutoff equality, receipt delay, nine-digit time and no-calendar boundaries match', () => {
  const cutoff = start + 5000;
  const records = [tick(start), failure(start + 1000), tick(start + 4999, { receivedAt: iso(cutoff + 1) }), tick(cutoff)];
  for (const config of [{ ...options, cutoff: iso(cutoff) }, { ...options, cutoff: iso(cutoff - 1) }, { ...options, calendar: null, cutoff: iso(cutoff) }]) compare(records, config);
  const row = tick(start + 3000); row.payload.datetime = row.receivedAt = '2026-10-13T15:00:03.000999999+08:00';
  compare([tick(start), failure(start + 1000), row]);
  for (const bad of [{ cutoff: 'invalid' }, { actualContract: null }]) {
    const config = { ...options, ...bad };
    compare(records, config);
    const never = { *[Symbol.iterator]() { throw new Error('invalid context must not consume input'); } };
    assert.deepEqual(knownCaptureIntervals(never, config), []);
  }
});
