import test from "node:test";
import assert from "node:assert/strict";
import { attachSourceTimeStructureEligibility, createSourceTimeStructureAudit } from "../src/source-time-structure.mjs";
import { buildTxDecisionChart } from "../src/dashboard-tx-chart.mjs";
import { loadGovernedTradingCalendar } from "../src/market-state-forward-shadow-calendar.mjs";
// Frozen 9f4288 source oracle: deliberately retained unchanged, no git required in CI.
const ORACLE_SOURCE = "import { classifyTxChartSession, compareTxChartTicks, txChartTickOrderKey } from './dashboard-tx-chart.mjs';\nimport { knownCaptureIntervals, captureIntervalOverlaps, restrictKnownCaptureLoss } from './chart-capture-coverage.mjs';\n\nconst FIVE_MINUTES = 300_000;\nconst FRESH_MS = 120_000;\nconst TIME_REASON = 'TIMESTAMP_LINEAGE_INSUFFICIENT';\nconst SESSION_CACHE = new WeakMap();\nconst CURRENT_LEVELS = ['currentDayHigh', 'currentDayLow', 'nightHigh', 'nightLow', 'vwap', 'openingRangeHigh', 'openingRangeLow'];\nconst finitePositive = value => typeof value !== 'boolean' && value !== '' && value != null\n  && Number.isFinite(Number(value)) && Number(value) > 0;\n\n// Preserve sub-millisecond source ordering for the audit. Aggregation retains\n// its existing millisecond buckets; this does not assert clock accuracy.\nfunction timestamp(value) {\n  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})?$/i.test(value)) return null;\n  const zoned = /(?:Z|[+-]\\d{2}:\\d{2})$/i.test(value) ? value : value + '+08:00';\n  const ms = Date.parse(zoned);\n  if (!Number.isFinite(ms)) return null;\n  const parts = value.match(/^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2}):(\\d{2})/).slice(1).map(Number);\n  const wall = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));\n  if ([wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds()]\n    .some((part, index) => part !== parts[index])) return null;\n  const fraction = zoned.match(/\\.(\\d+)(?:Z|[+-]\\d{2}:\\d{2})$/i)?.[1] || '';\n  return { ms, order: BigInt(ms) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3) || '0') };\n}\nconst iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;\nfunction sourceSession(record, calendar) {\n  // Reuse only date classification; every raw identity/quality/availability\n  // guard below still runs. Avoid redoing Intl/calendar work on every live poll.\n  const time = record.payload.datetime;\n  const cached = SESSION_CACHE.get(record);\n  if (cached?.time === time && cached.calendar === calendar) return cached.context;\n  const context = classifyTxChartSession(time, calendar);\n  SESSION_CACHE.set(record, { time, calendar, context });\n  return context;\n}\nconst reasonsOf = value => Array.isArray(value?.qualityReasons) ? value.qualityReasons : [];\nfunction permittedQuality(value) {\n  if (value?.qualityReasons != null && !Array.isArray(value.qualityReasons)) return false;\n  const reasons = reasonsOf(value);\n  return ['PASS', 'QUALITY_INSUFFICIENT'].includes(value?.qualityStatus)\n    && reasons.every(reason => reason === TIME_REASON)\n    && (value.qualityStatus === 'PASS' || reasons.includes(TIME_REASON));\n}\nfunction eligibility(reasons, availableAt = null, extra = {}) {\n  const reasonCodes = Object.freeze([...new Set(reasons)]);\n  return Object.freeze({ schemaVersion: 'source-time-structure-v1', state: reasonCodes.length ? 'BLOCKED' : 'ELIGIBLE',\n    basis: 'REPORTED_SOURCE_TIME_GEOMETRY', availableAt, reasonCodes,\n    scope: 'LIVE_DESCRIPTIVE_ONLY', executionAuthorized: false, ...extra });\n}\n\n/** Add a narrow calculation capability without changing any quality or value.\n * Records are the pre-normalization, physical-order TX cache inputs. This is\n * neither a replay certificate nor permission for Tick/Quote chronology use.\n */\nexport function attachSourceTimeStructureEligibility(chart, records, { calendar, cutoff, explicitAsOf = false } = {}) {\n  if (!chart) return chart;\n  const reasons = [];\n  const at = timestamp(cutoff)?.ms;\n  if (chart.mode !== 'LIVE' || explicitAsOf) reasons.push('LIVE_CURRENT_ONLY');\n  if (chart.timeframe !== '5m') reasons.push('FIVE_MINUTE_STRUCTURE_ONLY');\n  // Outside this new capability's scope retain legacy per-value behavior,\n  // including conservative replay rendering. A top-level refusal is additive.\n  if (reasons.length) return Object.freeze({ ...chart, structureEligibility: eligibility(reasons, chart.availableAt ?? null) });\n  if (chart.source !== 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK') reasons.push('SOURCE_UNSUPPORTED');\n  if (chart.executionAuthorized !== false || chart.orderRoutesEnabled !== false || chart.formalWeight !== 0 || chart.researchOnly !== true) reasons.push('CHART_SAFETY_BOUNDARY_INVALID');\n  if (!calendar || !Number.isFinite(at)) reasons.push('SOURCE_CONTEXT_MISSING');\n  if (!chart.actualContract || !chart.tradeDate || !['DAY', 'NIGHT'].includes(chart.session) || !chart.sessionId\n    || chart.contractConsistencyState !== 'MATCH' || chart.contractRollover?.detected !== false\n    || chart.availableContracts?.length !== 1 || chart.availableContracts[0] !== chart.actualContract) reasons.push('SOURCE_IDENTITY_UNVERIFIED');\n  if (!permittedQuality(chart)) reasons.push('NON_TIMESTAMP_QUALITY_RESTRICTION');\n  if (chart.sequenceGapEventCount !== 0 || chart.sequenceGapSize !== 0 || chart.futureDataViolations !== 0) reasons.push('CONTINUITY_OR_FUTURE_VIOLATION');\n\n  const inputs = [];\n  let duplicateExcludedCount = 0, futureExcludedCount = 0, scopedRecordCount = 0;\n  let previousSourceOrder = null;\n  for (const record of records || []) {\n    if (record?.kind !== 'futures_tick') continue;\n    if (record.duplicate === true || record.payload?.simtrade === true) { duplicateExcludedCount++; continue; }\n    const payload = record.payload || {};\n    const event = timestamp(payload.datetime), envelope = timestamp(record.exchangeTimestamp), received = timestamp(record.receivedAt);\n    if (!event || !envelope || !received) { reasons.push('RAW_TIMESTAMP_MISSING_OR_INVALID'); continue; }\n    if (event.order !== envelope.order) { reasons.push('SOURCE_TIMESTAMP_CONFLICT'); continue; }\n    let context;\n    try { context = sourceSession(record, calendar); }\n    catch { reasons.push('SOURCE_SESSION_UNRESOLVED'); continue; }\n    if (context.sessionTradeDate !== chart.tradeDate || context.session !== chart.session || context.sessionId !== chart.sessionId) continue;\n    scopedRecordCount++;\n    const effectiveMs = Math.max(event.ms, received.ms);\n    if (Number.isFinite(at) && effectiveMs > at) { futureExcludedCount++; continue; }\n    if (payload._product_family !== 'TX' || !/^TXF[A-L]\\d$/.test(chart.actualContract || '')\n      || [record.product, payload.code, payload._target_code].some(code => code !== chart.actualContract)) {\n      reasons.push('RAW_IDENTITY_MISMATCH'); continue;\n    }\n    if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) reasons.push('RAW_SAFETY_BOUNDARY_INVALID');\n    if (!finitePositive(payload.close) || !finitePositive(payload.volume)) { reasons.push('RAW_PRICE_OR_VOLUME_INVALID'); continue; }\n    if (record.sequenceGap !== 0) reasons.push('RAW_SEQUENCE_GAP_OR_UNKNOWN');\n    if (previousSourceOrder != null && event.order < previousSourceOrder) reasons.push('SOURCE_EVENT_TIME_REGRESSION');\n    previousSourceOrder = event.order;\n    // The chart loader changes availability text only for a negative delta.\n    // Preserve that exact provenance for fallback event IDs, and preserve the\n    // original physical input order separately for the chronology audit.\n    const chartOrderKey = txChartTickOrderKey({ eventId: record.eventId, actualContract: chart.actualContract,\n      exchangeTimestamp: payload.datetime, availableAt: received.ms < event.ms ? iso(event.ms) : record.receivedAt,\n      price: Number(payload.close), volume: Number(payload.volume) });\n    inputs.push({ eventMs: event.ms, receivedMs: received.ms, effectiveMs, price: Number(payload.close), volume: Number(payload.volume), chartOrderKey });\n  }\n  if (!inputs.length || inputs.length !== chart.sourceEventCount) reasons.push('SOURCE_INPUT_COUNT_MISMATCH');\n  const last = inputs.at(-1);\n  if (!last || !Number.isFinite(at) || last.eventMs > at || last.receivedMs > at\n    || at - last.eventMs > FRESH_MS || at - last.receivedMs > FRESH_MS) reasons.push('SOURCE_EVENT_OR_RECEIPT_STALE');\n  // Chart ordering has a deterministic event-ID tie-break; it does not claim\n  // that equal source times establish physical ordering. Compare to its exact\n  // selected tick rather than accepting any price within the tied timestamp.\n  const selected = inputs.reduce((latest, input) => !latest || compareTxChartTicks(input.chartOrderKey, latest.chartOrderKey) >= 0 ? input : latest, null);\n  if (!selected || !Number.isFinite(at) || selected.eventMs > at || selected.receivedMs > at\n    || at - selected.eventMs > FRESH_MS || at - selected.receivedMs > FRESH_MS) reasons.push('SELECTED_SOURCE_EVENT_OR_RECEIPT_STALE');\n  if (!selected || timestamp(chart.lastEventTime)?.ms !== selected.eventMs || Number(chart.lastPrice) !== selected.price) reasons.push('LATEST_SOURCE_MISMATCH');\n  const captureIntervals = knownCaptureIntervals(records, { actualContract: chart.actualContract, cutoff, calendar });\n  const sessionStart = timestamp(chart.bars?.[0]?.sessionStart)?.ms\n    ?? inputs.reduce((earliest, input) => Math.min(earliest, input.eventMs), Infinity);\n  const maxAvailable = inputs.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);\n  if (timestamp(chart.availableAt)?.ms !== maxAvailable) reasons.push('CHART_AVAILABILITY_MISMATCH');\n  const audit = Object.freeze({ scopedRecordCount, includedInputCount: inputs.length, duplicateExcludedCount, futureExcludedCount,\n    sourceEventWatermark: iso(last?.eventMs), sourceReceiptAt: iso(last?.receivedMs), effectiveAvailableAt: iso(maxAvailable),\n    selectedSourceEventTime: iso(selected?.eventMs), selectedSourceReceiptAt: iso(selected?.receivedMs),\n    selectedSourceEventId: selected?.chartOrderKey.eventId ?? null,\n    chronologyQualityPreserved: true,\n    feedCompleteness: captureIntervalOverlaps(captureIntervals, sessionStart, at) ? 'KNOWN_CAPTURE_INTERRUPTION' : 'UNKNOWN_NO_NATIVE_SEQUENCE',\n    ...(captureIntervals.length ? { captureIntervals } : {}), replayEligible: false,\n    priceConfirmationEligible: false, flowConfirmationEligible: false });\n  const top = eligibility(reasons, iso(maxAvailable), { audit });\n  const baseReasons = [...top.reasonCodes];\n  const completion = end => inputs.find(input => input.eventMs >= end);\n  const bars = Object.freeze((chart.bars || []).map(bar => {\n    const bad = [...baseReasons];\n    const start = timestamp(bar.time)?.ms, end = start + FIVE_MINUTES;\n    const sourceRows = inputs.filter(input => input.eventMs >= start && input.eventMs < end);\n    // Existing exact-session-close semantics place the closing tick in the preceding bucket.\n    if (end === timestamp(bar.sessionEnd)?.ms) sourceRows.push(...inputs.filter(input => input.eventMs === end));\n    const closedBy = completion(end);\n    const captureAffected = captureIntervalOverlaps(captureIntervals, start, end);\n    if (captureAffected) bad.push('KNOWN_CAPTURE_INTERRUPTION');\n    if (!Number.isFinite(start) || end > at || !closedBy || closedBy.effectiveMs > at) bad.push('SOURCE_COMPLETION_NOT_OBSERVED');\n    if (['actualContract', 'tradeDate', 'session', 'sessionId'].some(key => bar[key] !== chart[key])) bad.push('BAR_IDENTITY_MISMATCH');\n    if (!permittedQuality(bar) || bar.sequenceGapCount !== 0) bad.push('BAR_NON_TIMESTAMP_QUALITY');\n    if (!sourceRows.length || sourceRows.length !== bar.eventCount || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finitePositive)) bad.push('BAR_INPUTS_UNVERIFIED');\n    const inputAvailable = sourceRows.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);\n    const available = Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity);\n    return Object.freeze({ ...restrictKnownCaptureLoss(bar, captureAffected), structureEligibility: eligibility(bad, iso(available), {\n      completionAvailableAt: iso(closedBy?.effectiveMs), completionSourceEventTime: iso(closedBy?.eventMs) }) });\n  }));\n  const levelEligibility = (value, name) => {\n    const bad = [...baseReasons];\n    const expectedSource = name.startsWith('openingRange') ? 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900'\n      : name === 'vwap' ? 'SESSION_EXACT_TX_TICK_VWAP' : 'ACTUAL_TX_TICK_STREAM';\n    if (!permittedQuality(value) || !finitePositive(value.value ?? value.high)\n      || value.source !== expectedSource\n      || ['actualContract', 'tradeDate', 'session'].some(key => value[key] !== chart[key])) bad.push('LEVEL_INPUTS_UNVERIFIED');\n    if (timestamp(value.availableAt)?.ms == null || timestamp(value.availableAt).ms > at) bad.push('LEVEL_AVAILABILITY_INVALID');\n    let inputRows = inputs, closedBy = null;\n    // A LIVE cumulative reference must account for an open outage after its\n    // last tick, not stop checking at that tick's own availability.\n    let windowStart = sessionStart, windowEnd = at;\n    if (name.startsWith('openingRange')) {\n      const start = timestamp(chart.tradeDate + 'T08:45:00+08:00')?.ms;\n      const end = timestamp(chart.tradeDate + 'T09:00:00+08:00')?.ms;\n      inputRows = inputs.filter(input => input.eventMs >= start && input.eventMs < end);\n      windowStart = start; windowEnd = end;\n      closedBy = completion(end);\n      if (chart.session !== 'DAY' || !inputRows.length || !closedBy || closedBy.effectiveMs > at\n        || !['READY', 'QUALITY_INSUFFICIENT'].includes(chart.openingRange?.status)) bad.push('OPENING_RANGE_COMPLETION_UNVERIFIED');\n    }\n    if (captureIntervalOverlaps(captureIntervals, windowStart, windowEnd)) bad.push('KNOWN_CAPTURE_INTERRUPTION');\n    const inputAvailable = inputRows.reduce((value, input) => Math.max(value, input.effectiveMs), -Infinity);\n    return eligibility(bad, iso(Math.max(inputAvailable, closedBy?.effectiveMs ?? -Infinity)),\n      closedBy ? { completionAvailableAt: iso(closedBy.effectiveMs) } : {});\n  };\n  const levels = { ...(chart.levels || {}) };\n  for (const name of CURRENT_LEVELS) if (levels[name]?.availability === 'AVAILABLE') {\n    const proof = levelEligibility(levels[name], name);\n    levels[name] = Object.freeze({ ...restrictKnownCaptureLoss(levels[name], proof.reasonCodes.includes('KNOWN_CAPTURE_INTERRUPTION')), structureEligibility: proof });\n  }\n  let openingRange = chart.openingRange;\n  if (openingRange && ['READY', 'QUALITY_INSUFFICIENT'].includes(openingRange.status)) {\n    const proof = levelEligibility(openingRange, 'openingRange');\n    openingRange = Object.freeze({ ...restrictKnownCaptureLoss(openingRange, proof.reasonCodes.includes('KNOWN_CAPTURE_INTERRUPTION')), structureEligibility: proof });\n  }\n  return Object.freeze({ ...chart, structureEligibility: top, bars, levels: Object.freeze(levels), openingRange });\n}\n";
const oracleModule = ORACLE_SOURCE.replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL('../src/' + relative.slice(2), import.meta.url).href}'`);
const { attachSourceTimeStructureEligibility: oracle } = await import('data:text/javascript;base64,' + Buffer.from(oracleModule).toString('base64'));
const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const iso = value => new Date(value).toISOString();
const night = Date.parse('2026-10-13T15:00:00+08:00');
const day = Date.parse('2026-10-13T08:45:00+08:00');
function tick(at, price = 100, delay = 0) {
  return { kind: 'futures_tick', product: 'TXFJ6', exchangeTimestamp: iso(at), receivedAt: iso(at + delay),
    eventId: `tick-${at}-${price}`, duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'TXFJ6', datetime: iso(at), close: price, volume: 2, simtrade: false, _product_family: 'TX', _target_code: 'TXFJ6' } };
}
function sample(start = night) {
  const records = [100, 110, 99, 108].flatMap((price, i) => [tick(start + i * 300000, price, -20),
    tick(start + i * 300000 + 20000, price + 5, -20), tick(start + i * 300000 + 40000, price - 5, -20)]);
  return fixture(records, iso(start + 3 * 300000 + 41000), start === day ? 'DAY' : 'NIGHT');
}
function fixture(records, cutoff, session = 'NIGHT') {
  // Unzoned exchange timestamps are Taipei source time, as in the loader.
  // Date.parse alone uses the host zone and moves this fixture eight hours on UTC CI.
  const sourceMs = value => Date.parse(typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value + '+08:00' : value);
  const normalized = records.map(record => record.kind === 'futures_tick' && sourceMs(record.receivedAt) < sourceMs(record.payload.datetime)
    ? { ...record, receivedAt: iso(sourceMs(record.payload.datetime)) } : record);
  const chart = buildTxDecisionChart(normalized, { calendar, timeframe: '5m', mode: 'LIVE', tradeDate: session === 'DAY' ? '2026-10-13' : '2026-10-14', session, asOf: cutoff });
  return { records, chart, cutoff };
}
function compare(value, options = {}) {
  const before = JSON.stringify(value);
  const args = { calendar, cutoff: value.cutoff, ...options };
  const expected = oracle(value.chart, value.records, args);
  let passes = 0;
  const iterable = { *[Symbol.iterator]() { assert.equal(++passes, 1); for (const row of value.records) yield structuredClone(row); } };
  const actual = attachSourceTimeStructureEligibility(value.chart, iterable, args);
  assert.deepEqual(actual, expected);
  // Exercise the same frozen oracle across every physical-record boundary.
  const resumed=createSourceTimeStructureAudit(value.chart,args);
  if(!resumed.done)for(const record of value.records)resumed.append(structuredClone(record));
  assert.deepEqual(resumed.done?resumed.value:resumed.finish(),expected);
  assert.equal(JSON.stringify(value), before);
  assert.ok(passes <= 1, 'raw audit and capture share one pass');
  assert.ok(Object.isFrozen(actual.structureEligibility));
  return actual;
}

test('repeatable raw iterable matches frozen 9f oracle without array operations', () => {
  const result = compare(sample());
  assert.equal(result.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.bars[0].structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.bars.at(-1).structureEligibility.state, 'BLOCKED');
  const value = sample();
  let iterations = 0;
  const cursor = { *[Symbol.iterator]() { iterations++; const row = {}; for (const record of value.records) { Object.assign(row, structuredClone(record)); yield row; } } };
  assert.deepEqual(attachSourceTimeStructureEligibility(value.chart, cursor, { calendar, cutoff: value.cutoff }), oracle(value.chart, value.records, { calendar, cutoff: value.cutoff }));
  assert.equal(iterations, 1);
});

test('late receipt and physical regression retain first completion rather than earliest time', () => {
  const value = sample();
  value.records[3].receivedAt = iso(night + 305000);
  [value.records[3], value.records[6]] = [value.records[6], value.records[3]];
  const actual = compare(value);
  assert.ok(actual.structureEligibility.reasonCodes.includes('SOURCE_EVENT_TIME_REGRESSION'));
  assert.equal(actual.bars[0].structureEligibility.completionSourceEventTime, iso(night + 600000));
  assert.equal(actual.bars[0].structureEligibility.completionAvailableAt, iso(night + 600000));
  value.records.push(tick(night + 1200000));
  compare(value);
});

test('nine-digit order, ties and fallback IDs preserve positive and negative receipt delta', () => {
  for (const negative of [true, false]) for (const ids of [true, false]) {
    const records = [['z-earlier', 100, '184000002'], ['a-later', 101, '184000001']].map(([id, price, fraction]) => {
      const row = tick(night + 184, price);
      row.exchangeTimestamp = row.payload.datetime = `2026-10-13T15:00:00.${fraction}`;
      row.receivedAt = `2026-10-13T15:00:00.${negative ? '143550123' : '194550123'}+08:00`;
      if (ids) row.eventId = id; else delete row.eventId;
      return row;
    });
    const result = compare(fixture(records, iso(night + 2000)));
    assert.equal(result.structureEligibility.audit.includedInputCount, 2);
    assert.ok(result.structureEligibility.reasonCodes.includes('SOURCE_EVENT_TIME_REGRESSION'));
    records[1].exchangeTimestamp = records[1].payload.datetime = records[0].exchangeTimestamp;
    const tied = compare(fixture(records, iso(night + 2000)));
    assert.equal(tied.structureEligibility.reasonCodes.includes('SOURCE_EVENT_TIME_REGRESSION'), false);
  }
});

test('missing, malformed, future, identity and quality evidence preserves reason order', () => {
  const changes = [
    row => { row.receivedAt = null; }, row => { row.exchangeTimestamp = '2026-02-30T07:00:00Z'; },
    row => { row.exchangeTimestamp = iso(night + 1); }, row => { row.sequenceGap = undefined; },
    row => { row.sequenceGap = null; }, row => { row.payload.volume = ''; },
    row => { row.payload.close = false; }, row => { row.product = 'TXFK6'; },
    row => { row.executionAuthorized = true; }, row => { row.duplicate = true; },
    row => { row.payload.simtrade = true; }, row => { row.receivedAt = iso(night + 2000000); },
  ];
  for (const change of changes) { const value = sample(); change(value.records[0]); change(value.records[1]); compare(value); }
  const empty = sample(); empty.records = []; compare(empty);
  const missing = sample(); missing.chart = { ...missing.chart, bars: missing.chart.bars.map((bar, index) => index ? bar : { ...bar, time: null }) }; compare(missing);
  compare(sample(), { cutoff: 'invalid' });
  compare(sample(), { explicitAsOf: true });
  compare(sample(), { calendar: null });
  for (const patch of [{ mode: 'REPLAY' }, { timeframe: '1m' }, { qualityReasons: ['OTHER'] }, { availableAt: null }]) {
    const value = sample(); value.chart = { ...value.chart, ...patch }; compare(value);
  }
});

test('opening range and exact DAY/NIGHT close include boundary tick without changing completion', () => {
  const opening = sample(day); opening.records[9].receivedAt = iso(day + 902500);
  const result = compare(opening);
  assert.equal(result.openingRange.structureEligibility.completionAvailableAt, iso(day + 902500));
  for (const [session, end] of [['DAY', '2026-10-13T13:45:00+08:00'], ['NIGHT', '2026-10-14T05:00:00+08:00']]) {
    const close = Date.parse(end);
    const value = fixture([tick(close - 300000), tick(close - 1000, 102), tick(close, 103, 500)], iso(close + 1000), session);
    const chart = compare(value);
    assert.equal(chart.bars.at(-1).eventCount, 3);
    assert.equal(chart.bars.at(-1).structureEligibility.reasonCodes.includes('BAR_INPUTS_UNVERIFIED'), false);
  }
});

test('capture interruption and restoration survive the shared single iterable pass', () => {
  for (const open of [true, false]) {
    const value = sample();
    const at = open ? night + 941000 : night + 250000;
    const failure = { kind: 'session_down', receivedAt: iso(at), eventId: 'capture-loss', payload: { datetime: iso(at) } };
    if (open) { value.records.push(failure); value.cutoff = iso(night + 942000); }
    else value.records.splice(3, 0, failure);
    const actual = compare(value);
    assert.equal(actual.structureEligibility.audit.feedCompleteness, 'KNOWN_CAPTURE_INTERRUPTION');
    assert.equal(actual.structureEligibility.audit.captureIntervals[0].endSourceAt === null, open);
  }
});

test('deterministic mixed order fixtures preserve oracle output across bars and OR reducers', () => {
  let state = 731;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  for (let run = 0; run < 40; run++) {
    const start = run % 2 ? day : night;
    const records = Array.from({ length: 30 }, (_, index) => tick(start + index * 40000, 100 + random() % 15, (random() % 4000) - 2000));
    for (let index = 0; index < 8; index++) { const a = random() % records.length, b = random() % records.length; [records[a], records[b]] = [records[b], records[a]]; }
    const value = fixture(records, iso(start + 1200000), start === day ? 'DAY' : 'NIGHT');
    if (run % 3 === 0) value.records[random() % records.length].sequenceGap = null;
    compare(value);
  }
});

test('whole-second session cache preserves close fractions, next-second refusal and invalid evidence', () => {
  for (const [session, end] of [['DAY', '2026-10-13T13:45:00+08:00'], ['NIGHT', '2026-10-14T05:00:00+08:00']]) {
    const close = Date.parse(end);
    const value = fixture([tick(close - 300000), tick(close, 103)], iso(close + 2000), session);
    value.records.push(tick(close + 100, 104), tick(close + 999, 105), tick(close + 1000, 106), tick(close + 1999, 107));
    const withinSecond = tick(close + 999, 108);
    withinSecond.exchangeTimestamp = withinSecond.payload.datetime = iso(close + 999).replace('.999Z', '.999999999Z');
    withinSecond.receivedAt = withinSecond.exchangeTimestamp;
    value.records.push(withinSecond);
    // Invalid fields must be checked even when the immediately preceding raw
    // record populated the same second's successful calendar classification.
    const invalid = structuredClone(withinSecond); invalid.receivedAt = null;
    const conflict = structuredClone(withinSecond); conflict.exchangeTimestamp = iso(close + 998);
    value.records.push(invalid, conflict);
    const result = compare(value);
    assert.ok(result.structureEligibility.reasonCodes.includes('SOURCE_SESSION_UNRESOLVED'));
    assert.ok(result.structureEligibility.reasonCodes.includes('RAW_TIMESTAMP_MISSING_OR_INVALID'));
    assert.ok(result.structureEligibility.reasonCodes.includes('SOURCE_TIMESTAMP_CONFLICT'));
    assert.equal(result.structureEligibility.audit.includedInputCount, 5);
    compare(value); // A second traversal must not preserve a failed next-second classification.
  }
});

test('one-shot audit retains capture witnesses excluded by source-time timestamp guards', () => {
  const value = sample();
  const failure = { kind: 'session_down', receivedAt: iso(night + 250000), payload: { datetime: iso(night + 250000) } };
  value.records.splice(3, 0, failure);
  value.records[4].exchangeTimestamp = null; // Still a valid capture restoration witness under original rules.
  const expected = oracle(value.chart, value.records, { calendar, cutoff: value.cutoff });
  const source = (function* () { for (const row of value.records) yield row; })();
  const actual = attachSourceTimeStructureEligibility(value.chart, source, { calendar, cutoff: value.cutoff });
  assert.deepEqual(actual, expected);
  assert.equal(actual.structureEligibility.audit.captureIntervals[0].endSourceAt, iso(night + 300000));
  assert.ok(actual.structureEligibility.reasonCodes.includes('RAW_TIMESTAMP_MISSING_OR_INVALID'));
});
