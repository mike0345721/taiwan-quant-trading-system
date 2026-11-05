import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart, classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { loadTxDecisionChart, clearTxChartLedgerCache } from '../src/dashboard-tx-chart-source.mjs';
import { attachTimestampDependencyQuality } from '../src/chart-timestamp-dependency-quality.mjs';
import { attachSourceTimeStructureEligibility } from '../src/source-time-structure.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const start = Date.parse('2026-10-13T15:00:00+08:00');
const iso = value => new Date(value).toISOString();
function tick(at, price = 100, delay = -20) {
  return { kind: 'futures_tick', product: 'TXFJ6', exchangeTimestamp: iso(at), receivedAt: iso(at + delay),
    eventId: `tick-${at}-${price}`, duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'TXFJ6', datetime: iso(at), close: price, volume: 2, simtrade: false, _product_family: 'TX', _target_code: 'TXFJ6' } };
}
function sample() {
  const records = [100, 110, 99, 108].flatMap((price, i) => [tick(start + i * 300000, price),
    tick(start + i * 300000 + 20000, price + 5), tick(start + i * 300000 + 40000, price - 5)]);
  const cutoff = iso(start + 3 * 300000 + 41000);
  const normalized = records.map(record => ({ ...record, receivedAt: record.exchangeTimestamp }));
  const initial = buildTxDecisionChart(normalized, { calendar, timeframe: '5m', mode: 'LIVE', tradeDate: '2026-10-14', session: 'NIGHT', asOf: cutoff });
  const violations = records.map(record => ({ actualContract: 'TXFJ6', sessionTradeDate: '2026-10-14', session: 'NIGHT', sessionId: '2026-10-13-NIGHT',
    exchangeTimestamp: record.exchangeTimestamp, effectiveAvailableAt: record.exchangeTimestamp }));
  const chart = attachTimestampDependencyQuality({ ...initial, qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'],
    timeLineageViolationCount: records.length }, violations, { cutoff });
  return { records, chart, cutoff };
}
const apply = (value, options = {}) => attachSourceTimeStructureEligibility(value.chart, value.records, { calendar, cutoff: value.cutoff, ...options });
const reasons = chart => chart.structureEligibility.reasonCodes;
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'structureEligibility').map(([key, item]) => [key, strip(item)]));
}

test('source-time capability preserves all values, anomalies and raw inputs; forming bar stays blocked', () => {
  const value = sample(), before = JSON.stringify(value);
  const chart = apply(value);
  assert.equal(chart.structureEligibility.state, 'ELIGIBLE');
  assert.equal(chart.structureEligibility.scope, 'LIVE_DESCRIPTIVE_ONLY');
  assert.equal(chart.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.equal(chart.timeLineageViolationCount, 12);
  assert.ok(chart.bars.slice(0, 3).every(bar => bar.structureEligibility.state === 'ELIGIBLE'));
  assert.equal(chart.bars[3].structureEligibility.state, 'BLOCKED');
  assert.ok(chart.bars[3].structureEligibility.reasonCodes.includes('SOURCE_COMPLETION_NOT_OBSERVED'));
  assert.equal(chart.levels.nightHigh.structureEligibility.state, 'ELIGIBLE');
  assert.equal(chart.levels.vwap.structureEligibility.state, 'ELIGIBLE');
  assert.equal(chart.levels.openingRangeHigh.structureEligibility, undefined);
  assert.equal(chart.levels.previousDayHigh.structureEligibility, undefined);
  assert.deepEqual(strip(chart), value.chart);
  assert.equal(JSON.stringify(value), before);
  assert.ok(Object.isFrozen(chart.structureEligibility));
  assert.equal(chart.structureEligibility.audit.priceConfirmationEligible, false);
});

test('bar completion is known only when the crossing source tick is itself available', () => {
  const value = sample();
  value.records[3] = { ...value.records[3], receivedAt: iso(start + 300000 + 2500) };
  const chart = apply(value);
  assert.equal(chart.bars[0].structureEligibility.completionAvailableAt, iso(start + 300000 + 2500));
  assert.equal(chart.bars[0].structureEligibility.availableAt, iso(start + 300000 + 2500));
  assert.equal(chart.bars[0].availableAt, value.chart.bars[0].availableAt);
});

test('unknown/non-time chart quality, continuity, identity and mode fail closed', () => {
  const cases = [
    [{ qualityReasons: ['OTHER_QUALITY'] }, 'NON_TIMESTAMP_QUALITY_RESTRICTION'],
    [{ qualityReasons: [] }, 'NON_TIMESTAMP_QUALITY_RESTRICTION'],
    [{ qualityStatus: 'UNKNOWN' }, 'NON_TIMESTAMP_QUALITY_RESTRICTION'],
    [{ sequenceGapEventCount: 1 }, 'CONTINUITY_OR_FUTURE_VIOLATION'],
    [{ executionAuthorized: true }, 'CHART_SAFETY_BOUNDARY_INVALID'],
    [{ availableAt: iso(start) }, 'CHART_AVAILABILITY_MISMATCH'],
    [{ contractConsistencyState: 'MISMATCH' }, 'SOURCE_IDENTITY_UNVERIFIED'],
    [{ contractRollover: { detected: true } }, 'SOURCE_IDENTITY_UNVERIFIED'],
    [{ mode: 'REPLAY' }, 'LIVE_CURRENT_ONLY'],
    [{ timeframe: '1m' }, 'FIVE_MINUTE_STRUCTURE_ONLY'],
  ];
  for (const [patch, reason] of cases) {
    const value = sample(); value.chart = { ...value.chart, ...patch };
    const result = apply(value);
    assert.equal(result.structureEligibility.state, 'BLOCKED');
    assert.ok(reasons(result).includes(reason), reason);
    if (reason === 'LIVE_CURRENT_ONLY' || reason === 'FIVE_MINUTE_STRUCTURE_ONLY') assert.equal(result.bars, value.chart.bars);
    else assert.ok(result.bars.every(bar => bar.structureEligibility.state === 'BLOCKED'));
  }
  assert.ok(reasons(apply(sample(), { explicitAsOf: true })).includes('LIVE_CURRENT_ONLY'));
});

test('raw malformed inputs cannot silently disappear into an eligible source subset', () => {
  const patches = [
    [record => ({ ...record, receivedAt: null }), 'RAW_TIMESTAMP_MISSING_OR_INVALID'],
    [record => ({ ...record, receivedAt: '2026-02-30T07:00:00Z' }), 'RAW_TIMESTAMP_MISSING_OR_INVALID'],
    [record => ({ ...record, exchangeTimestamp: iso(start + 1) }), 'SOURCE_TIMESTAMP_CONFLICT'],
    [record => ({ ...record, product: 'TXFK6' }), 'RAW_IDENTITY_MISMATCH'],
    [record => ({ ...record, sequenceGap: 1 }), 'RAW_SEQUENCE_GAP_OR_UNKNOWN'],
    [record => ({ ...record, payload: { ...record.payload, volume: 0 } }), 'RAW_PRICE_OR_VOLUME_INVALID'],
    [record => ({ ...record, executionAuthorized: true }), 'RAW_SAFETY_BOUNDARY_INVALID'],
  ];
  for (const [patch, reason] of patches) {
    const value = sample(); value.records[0] = patch(value.records[0]);
    assert.ok(reasons(apply(value)).includes(reason), reason);
  }
});

test('source regressions are rejected while equal source timestamps are permitted', () => {
  const value = sample();
  [value.records[1], value.records[2]] = [value.records[2], value.records[1]];
  assert.ok(reasons(apply(value)).includes('SOURCE_EVENT_TIME_REGRESSION'));
  const equal = sample();
  equal.records[1] = { ...equal.records[1], exchangeTimestamp: equal.records[0].exchangeTimestamp,
    payload: { ...equal.records[1].payload, datetime: equal.records[0].exchangeTimestamp } };
  assert.equal(apply(equal).structureEligibility.state, 'ELIGIBLE');
});

function loadLatestTieFixture(t, records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-latest-tie-'));
  fs.mkdirSync(path.join(root, 'live-events'));
  const file = path.join(root, 'live-events', '2026-10-13.ndjson');
  const bytes = Buffer.from(records.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(file, bytes);
  t.after(() => {
    assert.deepEqual(fs.readFileSync(file), bytes);
    fs.rmSync(root, { recursive: true, force: true });
    clearTxChartLedgerCache();
  });
  const cutoff = iso(start + 2000);
  return { records, cutoff, chart: loadTxDecisionChart({ dataRoot: root, calendar, now: new Date(cutoff) }) };
}

function tiedTicks() {
  // Same ordering pattern observed in the real 00:02:42.184 sample; synthetic
  // IDs/prices avoid committing raw Ledger records into the test repository.
  return [['z-earlier', 100, '143550'], ['a-later', 101, '143920']].map(([eventId, price, receipt]) => {
    const record = tick(start + 184, price);
    record.eventId = eventId;
    record.exchangeTimestamp = record.payload.datetime = '2026-10-13T15:00:00.184000';
    record.receivedAt = `2026-10-13T15:00:00.${receipt}+08:00`;
    return record;
  });
}

test('live loader preserves chart event-ID selection for equal source time and effective availability', t => {
  const value = loadLatestTieFixture(t, tiedTicks());
  assert.equal(value.chart.lastPrice, 100);
  assert.equal(value.records.at(-1).payload.close, 101);
  assert.equal(value.chart.structureEligibility.state, 'ELIGIBLE');
  assert.equal(value.chart.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.equal(value.chart.timeLineageViolationCount, 2);
  assert.equal(value.chart.structureEligibility.audit.priceConfirmationEligible, false);
});

test('latest-source correspondence rejects a different tied price and a changed last-event time', t => {
  const value = loadLatestTieFixture(t, tiedTicks());
  for (const patch of [{ lastPrice: 101 }, { lastEventTime: iso(start + 185) }]) {
    const result = apply({ ...value, chart: { ...value.chart, ...patch } });
    assert.equal(result.structureEligibility.state, 'BLOCKED');
    assert.ok(reasons(result).includes('LATEST_SOURCE_MISMATCH'));
  }
});

test('chart-selected source keeps its own raw receipt freshness when the physical last tick is fresh', t => {
  for (const selectedReceiptAge of [122000, 120000]) {
    const records = tiedTicks();
    for (const record of records) record.exchangeTimestamp = record.payload.datetime = iso(start + 1000);
    records[0].receivedAt = iso(start + 2000 - selectedReceiptAge);
    records[1].receivedAt = iso(start + 980);
    const value = loadLatestTieFixture(t, records);
    assert.equal(value.chart.lastPrice, 100);
    assert.equal(value.chart.structureEligibility.audit.sourceReceiptAt, records[1].receivedAt);
    assert.equal(value.chart.structureEligibility.audit.selectedSourceReceiptAt, records[0].receivedAt);
    assert.equal(value.chart.structureEligibility.audit.selectedSourceEventTime, records[0].exchangeTimestamp);
    assert.equal(value.chart.structureEligibility.audit.selectedSourceEventId, 'z-earlier');
    assert.equal(reasons(value.chart).includes('SOURCE_EVENT_OR_RECEIPT_STALE'), false);
    if (selectedReceiptAge > 120000) {
      assert.equal(value.chart.structureEligibility.state, 'BLOCKED');
      assert.ok(reasons(value.chart).includes('SELECTED_SOURCE_EVENT_OR_RECEIPT_STALE'));
    } else {
      assert.equal(value.chart.structureEligibility.state, 'ELIGIBLE');
      assert.ok(reasons(apply({ ...value, chart: { ...value.chart, lastPrice: 101 } })).includes('LATEST_SOURCE_MISMATCH'));
    }
  }
});

test('latest-source correspondence shares fallback ID provenance for negative and nonnegative receipt delta', t => {
  for (const negativeDelta of [true, false]) {
    const records = tiedTicks();
    for (const record of records) {
      delete record.eventId;
      if (!negativeDelta) record.receivedAt = '2026-10-13T15:00:00.300550+08:00';
    }
    const value = loadLatestTieFixture(t, records);
    assert.equal(value.chart.structureEligibility.state, 'ELIGIBLE', negativeDelta ? 'adjusted ISO availability' : 'original receipt spelling');
    assert.ok([100, 101].includes(value.chart.lastPrice));
    const otherPrice = value.chart.lastPrice === 100 ? 101 : 100;
    assert.ok(reasons(apply({ ...value, chart: { ...value.chart, lastPrice: otherPrice } })).includes('LATEST_SOURCE_MISMATCH'));
  }
});

test('latest-source correspondence keeps receipt ordering ahead of event-ID and physical ordering', t => {
  const records = tiedTicks();
  records[0].eventId = 'a-earlier-physical';
  records[0].receivedAt = '2026-10-13T15:00:00.400000+08:00';
  records[1].eventId = 'z-later-physical';
  records[1].receivedAt = '2026-10-13T15:00:00.300000+08:00';
  const value = loadLatestTieFixture(t, records);
  assert.equal(value.chart.lastPrice, 100);
  assert.equal(value.chart.structureEligibility.state, 'ELIGIBLE');
  assert.equal(value.chart.qualityStatus, 'PASS');
});

test('positive sub-millisecond source progression retains existing chart millisecond tie ordering', t => {
  const records = tiedTicks();
  records[0].exchangeTimestamp = records[0].payload.datetime = '2026-10-13T15:00:00.184100';
  records[1].exchangeTimestamp = records[1].payload.datetime = '2026-10-13T15:00:00.184200';
  const value = loadLatestTieFixture(t, records);
  assert.equal(value.chart.lastPrice, 100);
  assert.equal(value.chart.lastEventTime, iso(start + 184));
  assert.equal(value.chart.structureEligibility.state, 'ELIGIBLE');
  const reversed = { ...value, records: [...records].reverse() };
  assert.ok(reasons(apply(reversed)).includes('SOURCE_EVENT_TIME_REGRESSION'));
});

test('sub-millisecond disagreement and regressions remain observable', () => {
  const value = sample();
  value.records[0] = { ...value.records[0], exchangeTimestamp: '2026-10-13T07:00:00.000002Z',
    payload: { ...value.records[0].payload, datetime: '2026-10-13T07:00:00.000001Z' } };
  assert.ok(reasons(apply(value)).includes('SOURCE_TIMESTAMP_CONFLICT'));
  const regression = sample();
  regression.records[0] = { ...regression.records[0], exchangeTimestamp: '2026-10-13T07:00:00.000002Z',
    payload: { ...regression.records[0].payload, datetime: '2026-10-13T07:00:00.000002Z' } };
  regression.records[1] = { ...regression.records[1], exchangeTimestamp: '2026-10-13T07:00:00.000001Z',
    payload: { ...regression.records[1].payload, datetime: '2026-10-13T07:00:00.000001Z' } };
  assert.ok(reasons(apply(regression)).includes('SOURCE_EVENT_TIME_REGRESSION'));
});

test('raw receipt freshness is independent of effective max availability', () => {
  const value = sample();
  value.records.at(-1).receivedAt = iso(Date.parse(value.cutoff) - 120001);
  assert.ok(reasons(apply(value)).includes('SOURCE_EVENT_OR_RECEIPT_STALE'));
});

test('each bar and current level preserves its own non-time quality restrictions', () => {
  const value = sample();
  value.chart = { ...value.chart, bars: value.chart.bars.map((bar, i) => i ? bar : { ...bar, qualityReasons: ['SEQUENCE_CONTINUITY_INSUFFICIENT'] }),
    levels: { ...value.chart.levels, vwap: { ...value.chart.levels.vwap, qualityReasons: ['UNKNOWN_INPUT'] } } };
  const result = apply(value);
  assert.equal(result.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.bars[0].structureEligibility.state, 'BLOCKED');
  assert.equal(result.levels.vwap.structureEligibility.state, 'BLOCKED');
});

test('future inputs remain excluded and cannot act as a completion watermark', () => {
  const value = sample();
  value.records.push(tick(start + 4 * 300000, 200));
  const result = apply(value);
  assert.equal(result.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.structureEligibility.audit.futureExcludedCount, 1);
  assert.equal(result.bars.at(-1).structureEligibility.state, 'BLOCKED');
});

test('a valid different session is independent but a different contract in this session blocks', () => {
  const value = sample();
  value.records.unshift(tick(Date.parse('2026-10-13T09:00:00+08:00')));
  assert.equal(apply(value).structureEligibility.state, 'ELIGIBLE');
  const foreign = tick(start + 1);
  foreign.product = foreign.payload.code = foreign.payload._target_code = 'TXFK6';
  value.records.splice(2, 0, foreign);
  assert.ok(reasons(apply(value)).includes('RAW_IDENTITY_MISMATCH'));
});

test('DAY opening range uses only its frozen inputs and observed source completion', t => {
  const dayStart = Date.parse('2026-10-13T08:45:00+08:00');
  const records = [100, 110, 99, 108].flatMap((price, i) => [tick(dayStart + i * 300000, price), tick(dayStart + i * 300000 + 40000, price + 2)]);
  records[6].receivedAt = iso(dayStart + 3 * 300000 + 2500);
  const cutoff = iso(dayStart + 3 * 300000 + 41000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-source-or-'));
  fs.mkdirSync(path.join(root, 'live-events'));
  fs.writeFileSync(path.join(root, 'live-events', '2026-10-13.ndjson'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); clearTxChartLedgerCache(); });
  const result = loadTxDecisionChart({ dataRoot: root, calendar, mode: 'LIVE', now: new Date(cutoff) });
  assert.equal(result.openingRange.status, 'QUALITY_INSUFFICIENT');
  assert.equal(result.openingRange.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.openingRange.structureEligibility.availableAt, iso(dayStart + 3 * 300000 + 2500));
  assert.equal(result.levels.openingRangeHigh.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.levels.openingRangeLow.structureEligibility.state, 'ELIGIBLE');
  assert.equal(result.levels.openingRangeHigh.qualityStatus, 'QUALITY_INSUFFICIENT');
});

test('loader attaches capability only to current LIVE calls and leaves ledger bytes unchanged', t => {
  const value = sample();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-source-time-'));
  fs.mkdirSync(path.join(root, 'live-events'));
  const file = path.join(root, 'live-events', '2026-10-13.ndjson');
  const bytes = Buffer.from(value.records.map(record => JSON.stringify(record)).join('\n') + '\n');
  fs.writeFileSync(file, bytes);
  t.after(() => { assert.deepEqual(fs.readFileSync(file), bytes); fs.rmSync(root, { recursive: true, force: true }); clearTxChartLedgerCache(); });
  const args = { dataRoot: root, calendar, now: new Date(value.cutoff), mode: 'LIVE', timeframe: '5m' };
  const live = loadTxDecisionChart(args);
  assert.equal(live.structureEligibility.state, 'ELIGIBLE');
  assert.equal(live.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.equal(loadTxDecisionChart({ ...args, asOf: value.cutoff }).structureEligibility.state, 'BLOCKED');
  assert.equal(loadTxDecisionChart({ ...args, mode: 'REPLAY' }).structureEligibility.state, 'BLOCKED');
});

test('loader and restored caches preserve unknown raw sequence evidence and reject legacy coercion', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-raw-sequence-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); clearTxChartLedgerCache(); });
  for (const [index, gap] of [undefined, null, '', 'invalid'].entries()) {
    const value = sample(), dataRoot = path.join(root, String(index)), cacheRoot = path.join(dataRoot, 'cache');
    fs.mkdirSync(path.join(dataRoot, 'live-events'), { recursive: true });
    value.records[0].sequenceGap = gap;
    fs.writeFileSync(path.join(dataRoot, 'live-events', '2026-10-13.ndjson'), value.records.map(JSON.stringify).join('\n')+'\n');
    const args = { dataRoot, cacheRoot, calendar, now:new Date(value.cutoff) };
    assert.ok(reasons(loadTxDecisionChart(args)).includes('RAW_SEQUENCE_GAP_OR_UNKNOWN'));
    clearTxChartLedgerCache();
    assert.ok(reasons(loadTxDecisionChart(args)).includes('RAW_SEQUENCE_GAP_OR_UNKNOWN'));
    // A valid-hash legacy cache falsely contains explicit zero. It must be
    // invalidated and rebuilt from raw evidence, not accepted for eligibility.
    const metadataPath=path.join(cacheRoot,fs.readdirSync(cacheRoot).find(n=>n.endsWith('.meta.json')));
    const recordsPath=path.join(cacheRoot,fs.readdirSync(cacheRoot).find(n=>n.endsWith('.ndjson')));
    const metadata=JSON.parse(fs.readFileSync(metadataPath));
    const oldRecords=fs.readFileSync(recordsPath,'utf8').trim().split('\n').map(JSON.parse);
    oldRecords[0].sequenceGap=0;
    const bytes=Buffer.from(oldRecords.map(JSON.stringify).join('\n')+'\n');
    fs.writeFileSync(recordsPath,bytes);
    fs.writeFileSync(metadataPath,JSON.stringify({...metadata,schemaVersion:'dw2-tx-tick-cache-v1',
      cacheSize:bytes.length,cacheHash:crypto.createHash('sha256').update(bytes).digest('hex')}));
    clearTxChartLedgerCache();
    assert.ok(reasons(loadTxDecisionChart(args)).includes('RAW_SEQUENCE_GAP_OR_UNKNOWN'));
    assert.equal(JSON.parse(fs.readFileSync(metadataPath)).schemaVersion,'dw2-tx-tick-cache-v3');
  }
});

// Execute the actual private cache helper with an instrumented original
// classifier. No production exports or alternate classification rules are added.
function sessionCacheHarness() {
  let calls = 0;
  const source = fs.readFileSync(new URL('../src/source-time-structure.mjs', import.meta.url), 'utf8')
    .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
  const cached = vm.runInNewContext(source + '\nsourceSession;', {
    classifyTxChartSession(time, selectedCalendar) { calls++; return classifyTxChartSession(time, selectedCalendar); },
  });
  return { classify(time, selectedCalendar = calendar, record = { payload: { datetime: time } }) {
    const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(time) ? time : time + '+08:00';
    return cached(record, selectedCalendar, Date.parse(zoned));
  }, get calls() { return calls; } };
}
function classificationOutcome(fn) {
  try { return { context: fn() }; } catch (error) { return { error: error.message }; }
}

test('minute session cache matches original classifier across day/night open, close, midnight and dates', () => {
  const cached = sessionCacheHarness();
  const boundaries = [
    '2026-10-13T08:45:00+08:00', '2026-10-13T13:45:00+08:00',
    '2026-10-13T15:00:00+08:00', '2026-10-14T00:00:00+08:00',
    '2026-10-14T05:00:00+08:00', '2026-10-14T08:45:00+08:00',
    '2026-10-16T15:00:00+08:00', '2026-10-17T00:00:00+08:00',
    '2026-10-17T05:00:00+08:00', '2026-10-18T08:45:00+08:00',
  ];
  for (const boundary of boundaries) {
    const at = Date.parse(boundary);
    const sequence = [-60001, -60000, -1001, -1000, -1, 0, 1, 500, 999, 1000, 1001, 59999, 60000, 60001];
    // Repeat in reverse physical order so an error or a later minute cannot
    // supply a stale success when an earlier source timestamp arrives late.
    for (const offset of [...sequence, ...sequence.toReversed()]) {
      const value = iso(at + offset);
      assert.deepEqual(classificationOutcome(() => cached.classify(value)),
        classificationOutcome(() => classifyTxChartSession(value, calendar)), `${boundary} ${offset}`);
    }
  }
  for (const close of ['2026-10-13T13:45:00+08:00', '2026-10-14T05:00:00+08:00']) {
    assert.ok(cached.classify(close));
    assert.throws(() => cached.classify(iso(Date.parse(close) + 1000)), /TX_CHART_EVENT_OUTSIDE_GOVERNED_SESSION/);
    assert.deepEqual(cached.classify(close), classifyTxChartSession(close, calendar));
  }
});

test('minute cache retains timezone, nanosecond, record-mutation and calendar identity semantics', () => {
  const cached = sessionCacheHarness();
  const times = [
    '2026-10-13T15:00:00.000000001', '2026-10-13T15:00:59.999999999+08:00',
    '2026-10-13T07:00:42.123456789Z', '2026-10-13T09:00:20.500000001+02:00',
    '2026-10-13T06:59:59.999999999Z', '2026-10-13T15:01:00.000000001+08:00',
    '2026-10-14T05:00:00.999999999', '2026-10-14T05:00:01.000000001',
    '2026-10-13T13:45:00.999999999+08:00', '2026-10-13T13:45:01.000000001+08:00',
  ];
  const record = { payload: { datetime: '' } };
  for (const time of times) {
    record.payload.datetime = time;
    assert.deepEqual(classificationOutcome(() => cached.classify(time, calendar, record)),
      classificationOutcome(() => classifyTxChartSession(time, calendar)), time);
  }
  const revised = { ...calendar, tradingDates: new Set([...calendar.tradingDates].filter(date => date !== '2026-10-13')),
    nonTradingDates: new Set([...calendar.nonTradingDates, '2026-10-13']) };
  for (const selectedCalendar of [calendar, revised, calendar]) {
    const time = '2026-10-13T15:00:40.999999999+08:00';
    assert.deepEqual(classificationOutcome(() => cached.classify(time, selectedCalendar)),
      classificationOutcome(() => classifyTxChartSession(time, selectedCalendar)));
  }
});

test('minute cache avoids repeated classifier work without retaining a session-wide tick history', () => {
  const cached = sessionCacheHarness();
  for (let second = 0; second < 120; second++) {
    for (let fraction = 0; fraction < 5; fraction++) {
      const time = iso(start + second * 1000 + fraction * 100);
      assert.deepEqual(cached.classify(time), classifyTxChartSession(time, calendar));
    }
  }
  assert.equal(cached.calls, 2, '600 distinct records across two minutes require two classifications');
  cached.classify(iso(start));
  assert.equal(cached.calls, 3, 'only the latest minute is retained, not the session');
});
