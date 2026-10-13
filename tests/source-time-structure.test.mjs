import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart } from '../src/dashboard-tx-chart.mjs';
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
    assert.equal(JSON.parse(fs.readFileSync(metadataPath)).schemaVersion,'dw2-tx-tick-cache-v2');
  }
});
