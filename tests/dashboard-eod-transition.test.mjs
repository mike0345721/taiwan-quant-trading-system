import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const slice = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a) + a.length));
test('dashboard live to partial removes rejected snapshot and EOD output; later publication renders again', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, textContent: 'OLD_EOD', style: { removeProperty() {} },
      classList: { remove() {} }, querySelector: selector => node(id + ':' + selector), setAttribute() {}, prepend() {}, remove() {}, replaceChildren(...items) {
        this.textContent = items.map(x => x.textContent ?? x).join('');
      } });
    return nodes.get(id);
  };
  const live = { dataMode: 'live', revision: 1 }, views = [];
  let payload = { data: live };
  const context = { state: { csrfToken: 'synthetic', snapshot: null }, $: node,
    document: { createElement: () => ({ textContent: '', setAttribute() {}, append() {} }), querySelectorAll: () => [] },
    flowChannel: { ticket: () => 1, isCurrentSession: () => true, merge() {} },
    api: async () => payload, loadHistory: async () => {}, loadBacktest: async () => {},
    render(snapshot) { context.state.snapshot = snapshot; node('market-cards').textContent = 'EOD_' + snapshot.revision; },
    renderDecisionWorkspace() { views.push(context.state.snapshot); },
    loadIndexLeadership: async () => {}, renderIndexLeadershipFailure() {},
    loadTxDecisionChart: async () => {}, loadLiveMarketPulse: async () => {},
    reportCru46BrowserRuntimeProof: async () => {}, loadDecisionJournal: async () => {}, renderPrelive() {},
    renderDealerMap() {}, renderOptionOiChart() {},
  };
  const start = app.indexOf('function renderSnapshotUnavailable(');
  vm.runInNewContext((start < 0 ? '' : slice('function renderSnapshotUnavailable(', 'function render(snapshot)'))
    + slice('async function loadDashboard()', 'function reportDashboardLoadError('), context);
  await context.loadDashboard(); assert.equal(context.state.snapshot, live);
  payload = { data: null, service: { degraded: { status: 'PARTIAL', reason: 'EOD_SNAPSHOT_UNAVAILABLE', eodReason: 'EOD_SNAPSHOT_DATA_MODE_REJECTED' } } };
  await context.loadDashboard();
  assert.equal(context.state.snapshot, null, 'quarantined EOD must not remain in Terminal state');
  assert.equal(views.at(-1), null);
  assert.doesNotMatch(node('market-cards').textContent, /EOD_1|OLD_EOD/);
  assert.match(node('market-cards').textContent, /UNAVAILABLE/);
  assert.match(node('alert-area').textContent, /UNAVAILABLE/);
  assert.doesNotMatch(node('alert-area').textContent, /OLD_EOD/);
  assert.match(node('v3-gate-risk:small').textContent, /UNAVAILABLE/);
  payload = { data: { dataMode: 'live', revision: 3 } };
  await context.loadDashboard(); assert.equal(context.state.snapshot.revision, 3);
  assert.equal(node('market-cards').textContent, 'EOD_3');
});
