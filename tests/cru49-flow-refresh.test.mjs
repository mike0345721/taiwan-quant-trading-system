import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = { setTimeout, clearTimeout, AbortController, performance, console };
vm.runInNewContext(fs.readFileSync(new URL('../public/observed-flow-refresh.js', import.meta.url), 'utf8'), sandbox);
const { createFlowChannel } = sandbox.Cru49Flow;
const at = n => new Date(n).toISOString();
const flow = (ordinal, now = 10000, instance = 'a') => ({
  sourceState: 'LIVE', formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
  source: { sourceMode: 'LIVE', availableAt: at(now), observedAt: at(now), validUntil: at(now + 15000) },
  identity: { instrument: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-14', session: 'NIGHT', continuityEpoch: 'TX:7' },
  lineage: { sourceLedgerIdentity: 'ledger', cutoffLedgerOrdinal: ordinal },
  delivery: { runtimeCommit: 'head', workerInstanceId: instance, servedAt: at(now) },
  windows: Object.fromEntries(['primary60s','context300s','window900s','window1800s','window3600s','window14400s'].map(k => [k, { status: 'QUALITY_INSUFFICIENT', pressure: { pressureRatio: .2, classifiedCoverage: .8 } }]))
});
test('F3 validUntil expires without response; timestamps and values unchanged', () => {
  let now = 10000; const c = createFlowChannel({ now: () => now });
  c.merge(flow(10), c.ticket());
  assert.equal(c.view().sourceState, 'LIVE'); now = 25000;
  assert.equal(c.view().sourceState, 'LIVE'); now++;
  assert.equal(c.view().sourceState, 'STALE');
  assert.equal(c.view().source.availableAt, at(10000));
  assert.equal(c.view().windows.primary60s.pressure.pressureRatio, .2);
});
test('F4 late dashboard, ordinal/time regression and identity switches', () => {
  const c = createFlowChannel({ now: () => 10000 });
  const slow = c.ticket(); c.merge(flow(20), c.ticket());
  assert.equal(c.merge(flow(10), slow), false);
  assert.equal(c.merge(flow(19), c.ticket()), false);
  assert.equal(c.merge(flow(1, 10000, 'b'), c.ticket()), true);
  assert.equal(c.view().lineage.cutoffLedgerOrdinal, 1);
  assert.equal(c.merge(flow(30), c.ticket()), false, 'retired worker identity cannot return');
});

test('F4 unavailable response does not erase the last verified identity watermark', () => {
  const c = createFlowChannel({ now: () => 10000 });
  c.merge(flow(20), c.ticket());
  c.merge({ sourceState: 'UNAVAILABLE', windows: null }, c.ticket());
  assert.equal(c.merge(flow(10), c.ticket()), false);
  assert.equal(c.view().sourceState, 'UNAVAILABLE');
  assert.equal(c.merge(flow(21), c.ticket()), true);
});
test('F3 malformed/future timestamps and transport failure never LIVE; reset rejects previous session', () => {
  const c = createFlowChannel({ now: () => 10000 });
  const old = c.ticket(); c.merge(flow(1), old); c.fail('TIMEOUT');
  assert.notEqual(c.view().sourceState, 'LIVE'); c.reset();
  assert.equal(c.merge(flow(2), old), false);
  const missing = flow(3); delete missing.source.validUntil; c.merge(missing, c.ticket());
  assert.notEqual(c.view().sourceState, 'LIVE');
  c.merge(flow(4, 30000), c.ticket()); assert.notEqual(c.view().sourceState, 'LIVE');
});

function harness(request) {
  let clock = 10000, visible = true, id = 0;
  const timers = new Map(), renders = [];
  const c = createFlowChannel({ now: () => clock, monotonic: () => clock, request,
    visible: () => visible, render: v => renders.push(v),
    schedule: (fn, ms) => { timers.set(++id, { fn, at: clock + ms }); return id; },
    cancel: key => timers.delete(key) });
  return { c, renders, timers, hide: () => { visible = false; c.visibilityChanged(); },
    restore: () => { visible = true; c.visibilityChanged(); },
    tick: async ms => {
      clock += ms;
      const due = [...timers].filter(([,t]) => t.at <= clock);
      for (const [key, timer] of due) { if (timers.delete(key)) timer.fn(); }
      for (let n = 0; n < 8; n++) await Promise.resolve();
    } };
}
test('F1/F2/F5 independent boot and visible restore; slow request never overlaps, no busy retry', async () => {
  let calls = 0, active = 0, max = 0, resolve;
  const h = harness(signal => new Promise((yes, no) => {
    calls++; active++; max = Math.max(max, active);
    resolve = data => { active--; yes({ data }); };
    signal.addEventListener('abort', () => { active--; no(new Error('aborted')); }, { once: true });
  }));
  h.c.start(); assert.equal(calls, 1);
  await h.c.poll(); await h.tick(5000); assert.equal(calls, 1);
  resolve(flow(1, 15000)); await h.tick(0);
  assert.equal(h.c.view().sourceState, 'LIVE');
  h.hide(); await h.tick(5000); assert.equal(calls, 1);
  h.restore(); assert.equal(calls, 2);
  await h.tick(8000); assert.equal(h.c.view().unavailableReason, 'FLOW_REQUEST_TIMEOUT');
  assert.equal(calls, 2); await h.tick(5000); assert.equal(calls, 3); assert.equal(max, 1);
  h.c.stop(); await h.tick(0);
});
test('F3 HTTP 200 expired payload and 401 stop/relogin have separate lifecycle', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; if (calls === 1) return { data: flow(1, -10000) };
    const e = new Error('AUTH_REQUIRED'); e.status = 401; throw e; });
  h.c.start(); await h.tick(0); assert.notEqual(h.c.view().sourceState, 'LIVE');
  await h.tick(5000); assert.equal(h.c.view().sourceState, 'UNAVAILABLE');
  await h.tick(50000); assert.equal(calls, 2);
  const old = h.c.ticket(); h.c.reset(); assert.equal(h.c.merge(flow(2), old), false);
});
test('F4 newer source timestamps and all six values retained; chart identities never spliced', () => {
  let chart = flow(1).identity;
  const c = createFlowChannel({ now: () => 10000, chartIdentity: () => chart });
  const fresh = flow(20); c.merge(fresh, c.ticket());
  assert.equal(JSON.stringify(c.view().windows), JSON.stringify(fresh.windows));
  const late = c.ticket(); c.merge(flow(21), c.ticket()); c.fail('OLD_FAILURE', late);
  assert.equal(c.view().sourceState, 'LIVE');
  assert.equal(c.merge(flow(22, 9000), c.ticket()), false);
  chart = { ...chart, session: 'DAY' };
  assert.equal(c.view().unavailableReason, 'CHART_FLOW_IDENTITY_MISMATCH');
  c.merge({ ...flow(1, 10000, 'new'), identity: chart }, c.ticket());
  assert.equal(c.view().sourceState, 'LIVE');
});
test('F2 app bootstrap starts Flow before slow dashboard; V2 endpoints are page-owned', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const boot = app.slice(app.indexOf('async function loadDashboard()'), app.indexOf('function reportDashboardLoadError'));
  assert.doesNotMatch(boot, /loadV2Research|loadV2Backtests/);
  assert.match(app, /view === 'dashboard-view'\) flowChannel.start\(\)/);
  assert.match(app, /\['options', 'research'\].includes\(selected\)/);
  assert.match(boot, /flowChannel.merge\(payload.decisionWorkspace\?\.observedFlow, flowTicket\)/);
  assert.match(app, /const value = flowChannel.view\(\);/);
});
