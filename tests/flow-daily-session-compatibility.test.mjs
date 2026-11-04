import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const refresh = fs.readFileSync(new URL('../public/observed-flow-refresh.js', import.meta.url), 'utf8');
const home = fs.readFileSync(new URL('../public/home-workspace.js', import.meta.url), 'utf8');
function load(withChannel = true) {
  const host = { setTimeout, clearTimeout, AbortController, performance, console };
  host.window = host;
  if (withChannel) vm.runInNewContext(refresh, host);
  vm.runInNewContext(home, host);
  return { C: host.Cru49Flow, H: host.HomeWorkspace };
}
const now = Date.parse('2026-11-04T02:00:00.000Z');
const at = offset => new Date(now + offset).toISOString();
const definitions = [
  ['1m', 'primary60s'], ['5m', 'context300s'], ['15m', 'window900s'],
  ['30m', 'window1800s'], ['1h', 'window3600s'], ['4h', 'window14400s'],
].map(([key, source]) => ({ key, source, label: key, data: 'GOVERNED' }));
const serialize = value => JSON.stringify(value);
function fixture(session = 'DAY') {
  const identity = { instrument: 'TX', actualContract: 'TEST-TX', tradeDate: '2026-11-04', session, continuityEpoch: 'TX:7' };
  return {
    now, rendered: true, focusAllowed: true, selectedFlowWindow: '15m', flowDefinitions: definitions,
    marketOperating: { state: session, marketShouldBeActive: true },
    chart: { actualContract: identity.actualContract, tradeDate: identity.tradeDate, session: 'NIGHT_PLUS_DAY',
      mode: 'LIVE', timeframe: '1D', availableAt: at(-1000), qualityStatus: 'PASS', bars: [{}] },
    flow: { identity, sourceState: 'LIVE', researchQuality: { status: 'READY' },
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      source: { sourceMode: 'LIVE', availableAt: at(-1000), observedAt: at(-1000), validUntil: at(15000) },
      lineage: { sourceLedgerIdentity: 'synthetic-ledger', cutoffLedgerOrdinal: 20 },
      delivery: { runtimeCommit: 'a'.repeat(40), workerInstanceId: 'synthetic-worker', servedAt: at(0) },
      windows: Object.fromEntries(definitions.map((d, i) => [d.source, { status: 'READY', truthState: 'LIVE',
        pressure: { status: 'READY', pressureRatio: i / 10, classifiedCoverage: 1,
          buyProxyVolume: 100 + i, sellProxyVolume: 100, unknownVolume: 0, totalExecutedVolume: 200 + i, netAggressiveFlowProxy: i },
        response: { status: 'READY', displacementPoints: i }, pathEfficiency: { status: 'READY', value: 0.5 } }])) },
    watch: { identity: { ...identity }, sourceAvailableAt: at(-1000), decisionFocus: { state: 'ACTIVE_REFERENCE' }, evidenceGate: { actionableRrAllowed: false } },
  };
}
function channel(C, input, clock = () => now) {
  const c = C.createFlowChannel({ now: clock, monotonic: () => 0, chartIdentity: () => input.chart });
  assert.equal(c.merge(input.flow, c.ticket()), true);
  return c;
}
function rows(H, input, c) { return H.flowRows({ ...input, flow: c.view() }); }

for (const session of ['DAY', 'NIGHT']) test(`daily union displays actual ${session} Flow without rewriting source or watch identity`, () => {
  const { C, H } = load(), x = fixture(session), before = serialize(x), c = channel(C, x);
  const value = c.view();
  assert.equal(value.sourceState, 'LIVE');
  assert.equal(value.windows, x.flow.windows);
  assert.equal(value.identity.session, session);
  assert.equal(value.identity.continuityEpoch, 'TX:7');
  assert.equal(rows(H, x, c).length, 6);
  for (const row of rows(H, x, c)) assert.equal(row.available, true, row.key);
  const view = H.derive({ ...x, flow: value });
  assert.equal(view.flowCurrent, true);
  assert.equal(view.mismatch, false);
  assert.equal(view.focus, 'blocked', 'daily union must not relax DAY/NIGHT watch identity');
  assert.equal(x.watch.evidenceGate.actionableRrAllowed, false);
  assert.equal(serialize(x), before);
});

test('5m to 1D to 5m retains six independent windows and chosen Flow window', () => {
  const { C, H } = load(), x = fixture(), c = channel(C, x), snapshots = [];
  for (const timeframe of ['5m', '1D', '5m']) {
    x.chart.timeframe = timeframe; x.chart.session = timeframe === '1D' ? 'NIGHT_PLUS_DAY' : 'DAY';
    const value = c.view(), projected = rows(H, x, c);
    assert.equal(value.sourceState, 'LIVE');
    snapshots.push(serialize(projected.map(row => [row.key, row.ratio, row.net, row.coverage, row.side, row.qualified])));
    assert.equal(H.quickFlowView(projected[2], { ...x, flow: value }).hasRatio, true);
    assert.equal(x.selectedFlowWindow, '15m');
    assert.equal(value.identity.continuityEpoch, 'TX:7');
  }
  assert.equal(snapshots[0], snapshots[1]); assert.equal(snapshots[1], snapshots[2]);
});

test('daily exception rejects wrong contract/date/session/mode, not just a matching union label', () => {
  const { C, H } = load();
  const cases = [x => x.chart.actualContract = 'OTHER', x => x.chart.tradeDate = '2026-11-03',
    x => x.chart.mode = 'REPLAY', x => delete x.chart.mode, x => x.chart.session = 'DAY',
    x => x.flow.identity.session = 'OTHER', x => x.flow.identity.session = 'NIGHT_PLUS_DAY'];
  for (const mutate of cases) {
    const x = fixture(); mutate(x); const c = channel(C, x);
    assert.equal(c.view().unavailableReason, 'CHART_FLOW_IDENTITY_MISMATCH');
    assert.equal(H.derive({ ...x, flow: c.view() }).flowCurrent, false);
    assert.ok(rows(H, x, c).every(row => !row.available && row.ratio === null));
  }
  for (const key of ['actualContract', 'tradeDate', 'session']) {
    const x = fixture(); delete x.chart[key]; const c = channel(C, x);
    assert.ok(rows(H, x, c).every(row => !row.available && row.ratio === null));
  }
});

test('intraday remains strict, and standalone home fails closed without the shared helper', () => {
  const { C, H } = load(), x = fixture(); x.chart.timeframe = '5m'; x.chart.session = 'NIGHT';
  const c = channel(C, x);
  assert.equal(c.view().unavailableReason, 'CHART_FLOW_IDENTITY_MISMATCH');
  assert.equal(H.derive({ ...x, flow: c.view() }).flowCurrent, false);
  const fallback = load(false).H, daily = fixture();
  assert.equal(fallback.derive(daily).flowCurrent, false);
  assert.ok(fallback.flowRows(daily).every(row => !row.available));
  daily.chart.timeframe = '5m'; daily.chart.session = 'DAY';
  assert.ok(fallback.flowRows(daily).every(row => row.available));
});

test('daily compatibility does not override expiry, malformed time, failures or session reset', () => {
  const { C, H } = load(); let clock = now;
  const x = fixture(), c = channel(C, x, () => clock); clock += 15001;
  assert.equal(c.view().sourceState, 'STALE');
  assert.ok(H.flowRows({ ...x, now: clock, flow: c.view() }).every(row => !row.available && row.ratio === null));
  const y = fixture(); y.flow.source.validUntil = null; const invalid = channel(C, y);
  assert.equal(invalid.view().unavailableReason, 'FLOW_TIME_UNVERIFIED');
  const z = fixture(), failed = channel(C, z), old = failed.ticket();
  failed.fail('FLOW_REQUEST_TIMEOUT'); assert.equal(failed.view().windows, null);
  failed.reset(); assert.equal(failed.merge(z.flow, old), false);
});

test('daily compatibility preserves ordinal, timestamp and continuity-epoch retirement guards', () => {
  const { C } = load(), x = fixture(), c = channel(C, x);
  const lower = structuredClone(x.flow); lower.lineage.cutoffLedgerOrdinal--;
  assert.equal(c.merge(lower, c.ticket()), false);
  const older = structuredClone(x.flow); older.source.availableAt = at(-2000);
  assert.equal(c.merge(older, c.ticket()), false);
  const next = structuredClone(x.flow); next.identity.continuityEpoch = 'TX:8'; next.lineage.cutoffLedgerOrdinal = 1;
  assert.equal(c.merge(next, c.ticket()), true);
  assert.equal(c.merge(x.flow, c.ticket()), false);
  assert.equal(c.view().identity.continuityEpoch, 'TX:8');
});

test('per-window limited, missing, warming and unknown values remain limited without fabricated zero', () => {
  const { C, H } = load(), x = fixture(); x.flow.researchQuality.status = 'QUALITY_INSUFFICIENT';
  const limited = x.flow.windows.primary60s; limited.status = 'QUALITY_INSUFFICIENT';
  limited.pressure.status = 'PARTIAL'; limited.pressure.classifiedCoverage = 0.5;
  x.flow.windows.context300s.truthState = 'WARMING_UP';
  delete x.flow.windows.window900s;
  x.flow.windows.window1800s.pressure.pressureRatio = null;
  const c = channel(C, x), projected = rows(H, x, c);
  assert.equal(projected[0].available, true); assert.equal(projected[0].qualified, false);
  assert.equal(projected[0].ratio, 0); assert.equal(projected[0].side, '不作方向判定');
  assert.equal(projected[1].reason, 'WINDOW_WARMING_UP');
  assert.equal(projected[2].reason, 'WINDOW_MISSING');
  assert.equal(projected[3].ratio, null); assert.equal(projected[3].qualified, false);
  assert.equal(H.quickFlowView(projected[0], { ...x, flow: c.view() }).colorEligible, false);
  assert.equal(H.derive({ ...x, flow: c.view() }).flowQualified, false);
  assert.equal(c.view().windows.primary60s.status, 'QUALITY_INSUFFICIENT');
});

test('fresh Flow stays independent of partial/stale/pending chart, without promoting chart or watch', () => {
  const { C, H } = load();
  for (const mutate of [x => x.chart.qualityStatus = 'QUALITY_INSUFFICIENT',
    x => x.chart.availableAt = at(-120001), x => { x.requestedTimeframe = '5m'; x.chartLoading = true; }]) {
    const x = fixture(); mutate(x); const c = channel(C, x), view = H.derive({ ...x, flow: c.view() });
    assert.equal(view.chartQualified, false); assert.equal(view.focus, 'blocked');
    assert.equal(view.flowCurrent, true); assert.ok(rows(H, x, c).every(row => row.available));
  }
  const closed = fixture(); closed.marketOperating.marketShouldBeActive = false;
  const c = channel(C, closed);
  assert.equal(H.derive({ ...closed, flow: c.view() }).flowCurrent, false);
  assert.ok(rows(H, closed, c).every(row => !row.available));
});
