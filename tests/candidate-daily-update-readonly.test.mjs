import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { SessionStore, parseCookies, safeEqual } from '../src/security.mjs';
import { readDataOperationsReaderIdentity } from '../src/dashboard-data-operations-reader-identity.mjs';
import { buildDailyBatchVerdict } from '../src/daily-batch-verdict.mjs';

const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const configSource = fs.readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const reason = 'CANDIDATE_READ_ONLY_DAILY_UPDATE';

const redirectedReason = 'RESEARCH_READ_PATHS_REDIRECTED_DAILY_UPDATE';
test('formal health reports the actual service paths, not config or environment guesses', async () => {
  const paths = { databasePath: path.resolve('/synthetic-research/data/research-v2.sqlite'),
    reportPath: path.resolve('/synthetic-research/reports/latest-backtest.json') };
  const h = harness(undefined, paths);
  const res = await h.request('/healthz', { authenticated: false });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.researchReaderPaths, paths);
  assert.notEqual(paths.databasePath, h.config.v2DatabasePath);
  assert.equal(res.body.runtimeReady, false);
  assert.equal(h.starts.length, 0);
});
for (const kind of ['databasePath', 'reportPath', 'both']) test(`redirected ${kind} blocks the writer after auth and CSRF without changing batch status`, async () => {
  const paths = {};
  if (kind !== 'reportPath') paths.databasePath = path.resolve('/synthetic-research/data/research-v2.sqlite');
  if (kind !== 'databasePath') paths.reportPath = path.resolve('/synthetic-research/reports/latest-backtest.json');
  const h = harness(undefined, paths);
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST', authenticated: false })).body.error, 'AUTH_REQUIRED');
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST', csrf: false })).body.error, 'CSRF_INVALID');
  const res = await h.request('/api/v2/daily-update', { method: 'POST' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, redirectedReason);
  assert.deepEqual(res.body.data, { state: 'BLOCKED', reasonCodes: [redirectedReason] });
  const status = await h.request('/api/v2/daily-update');
  assert.deepEqual(status.body.data, h.batchStatus);
  assert.deepEqual(status.body.manualRun, { allowed: false, state: 'BLOCKED', reasonCodes: [redirectedReason] });
  assert.equal(status.body.processRunning, false);
  assert.equal(h.starts.length, 0);
});
test('explicit appRoot defaults remain writable with the existing lifecycle', async () => {
  const config = readConfig();
  const h = harness(undefined, { databasePath: config.v2DatabasePath, reportPath: config.v2ReportPath });
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST' })).status, 202);
  assert.equal(h.starts.length, 1);
  assert.equal((await h.request('/api/v2/daily-update')).body.manualRun, undefined);
});
for (const mode of ['candidateReadOnly', 'marketCandidate', 'ownerLocal']) test(`${mode} does not gain the formal path fields or the formal writer rule`, async () => {
  const h = harness(mode === 'candidateReadOnly' ? '1' : undefined, {
    databasePath: path.resolve('/synthetic-other/research.sqlite'),
    reportPath: path.resolve('/synthetic-other/report.json'),
    ownerLocal: mode === 'ownerLocal', marketCandidate: mode !== 'candidateReadOnly',
  });
  const health = await h.request('/healthz', { authenticated: false });
  assert.equal(health.status, 200);
  assert.equal(health.body.researchReaderPaths, undefined);
  // Outer candidate route guards are separately covered by the candidate server tests.
  const post = await h.request('/api/v2/daily-update', { method: 'POST' });
  assert.equal(post.status, mode === 'candidateReadOnly' ? 403 : 202);
  if (mode === 'candidateReadOnly') assert.equal(post.body.error, reason);
});
test('unchanged page displays redirected writer reason and does not poll or claim success', async () => {
  const h = harness(undefined, { databasePath: path.resolve('/synthetic-other/research.sqlite') });
  const alerts = [], handlers = {}, button = { disabled: false };
  button.addEventListener = (event, handler) => { handlers[event] = handler; };
  let polls = 0;
  const context = { $: id => id === 'daily-update-button' ? button : { prepend: box => alerts.push(box) },
    document: { createElement: () => ({ setAttribute() {} }) },
    api: async (url, options) => { const res = await h.request(url, options); if (res.status >= 400) throw Error(res.body.error); return res.body; },
    monitorDailyUpdate: async () => { polls++; },
  };
  vm.runInNewContext(appSource.slice(appSource.indexOf("$('daily-update-button').addEventListener"), appSource.indexOf("$('refresh-button').addEventListener")), context);
  await handlers.click();
  assert.equal(polls, 0); assert.equal(h.starts.length, 0);
  assert.equal(alerts.length, 1); assert.ok(alerts[0].textContent.includes(redirectedReason));
  assert.doesNotMatch(alerts[0].textContent, /已啟動/); assert.equal(button.disabled, false);
});


// Execute the real config and request handler in memory. No server import,
// socket, child process, external request, real credential or data file is used.
function readConfig(flag) {
  const context = { path, fileURLToPath,
    assertOwnerSelected: () => false, ownerAdmission: () => null, readManagedConfig() { throw Error('UNEXPECTED_MANAGED_CONFIG'); },
    process: { env: { NODE_ENV: 'production', DASHBOARD_PASSWORD_HASH: 'synthetic-config-only',
      ...(flag === undefined ? {} : { DASHBOARD_CANDIDATE_READ_ONLY: flag }) } } };
  const code = configSource.replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify('file:///C:/synthetic-reader/src/config.mjs'))
    .replace(/^export /gm, '');
  vm.runInNewContext(`${code}\nvalidateConfig();globalThis.result=config;`, context);
  return context.result;
}

function harness(flag, { databasePath, reportPath, ownerLocal = false, marketCandidate = false } = {}) {
  const config = readConfig(flag), starts = [], journal = [];
  const sessions = new SessionStore(60_000), session = sessions.create('127.0.0.1');
  const decisionJournalPath = path.join(config.dataDir, 'decision-workspace/journal.ndjson');
  const batchStatus = { state: 'completed_with_warnings', completedAt: '2026-11-03T13:25:00Z', failures: [{ key: 'taifex' }] };
  const context = { config, path, URL, sessions, parseCookies, safeEqual, buildDailyBatchVerdict,
    process: { execPath: 'synthetic-node', env: { V2_DATABASE_PATH: 'synthetic-protected-source' } },
    crypto: { randomUUID: () => 'synthetic-request' }, console,
    requestIsHttps: () => false, setSecurityHeaders() {}, clientIp: () => '127.0.0.1',
    cru55: null, formalEntry: null, marketCandidate, ownerLocal, inlineHandler: async () => false,
    OWNER_COOKIE: 'synthetic-owner-cookie', ownerRequestAllowed: () => true, assertOwnerJournalFilesystemRoots() {},
    assertMarketCandidateFilesystemRoots() {}, marketCandidateRouteAllowed: () => true, marketCandidateQueryAllowed: () => true,
    marketCandidateStartup: { roots: {} }, OWNER_SCOPE: 'synthetic-owner', MARKET_CANDIDATE_SCOPE: 'synthetic-candidate',
    currentCru46RuntimeReadiness: () => ({ runtimeReady: false }),
    runtimeIdentity: { commit: 'a'.repeat(40), status: 'VERIFIED' },
    runtimeVersion: { approvedMainCommit: 'b'.repeat(40), syncState: 'MISMATCH' },
    inlineEnabled: false, localMarketOnly: false, productSurfaceContract: {}, operatingCalendar: null,
    assessTaifexMarketSession: () => ({ state: 'UNKNOWN' }),
    readDataOperationsReaderIdentity,
    v2Research: { databasePath: databasePath ?? config.v2DatabasePath, reportPath: reportPath ?? config.v2ReportPath,
      dailyUpdateStatus: () => structuredClone(batchStatus) },
    sendJson(res, status, body) { res.status = status; res.body = JSON.parse(JSON.stringify(body)); },
    readJson: async req => req.body,
    spawn(...args) { const child = new EventEmitter(); starts.push({ args, child }); return child; },
    decisionJournalPath, decisionOutcomesPath: path.join(config.dataDir, 'decision-workspace/journal-outcomes.ndjson'),
    appendDecisionJournal(file, body) { assert.equal(file, decisionJournalPath); const entry = { ...body, recordHash: 'a'.repeat(64) }; journal.push(entry); return entry; },
    readDecisionJournal(file) { assert.equal(file, decisionJournalPath); return journal; },
    readDecisionOutcomes: () => [],
  };
  const auth = serverSource.slice(serverSource.indexOf('function getSession(req)'), serverSource.indexOf('const inlineEnabled ='));
  const handler = serverSource.slice(serverSource.indexOf('const requestHandler ='), serverSource.indexOf('const server ='));
  assert.ok(auth && handler && handler.includes("pathname === '/api/v2/daily-update'"));
  vm.runInNewContext(`let dailyUpdateProcess=null;\n${auth}\n${handler}\nglobalThis.handle=requestHandler;`, context);
  async function request(url, { method = 'GET', authenticated = true, csrf = true, body = {} } = {}) {
    const res = { setHeader() {} };
    await context.handle({ url, method, body, headers: {
      ...(authenticated ? { cookie: `${ownerLocal ? 'synthetic-owner-cookie' : marketCandidate || config.candidateReadOnly ? 'twchip_candidate_session' : 'twchip_session'}=${session.id}` } : {}),
      ...(csrf ? { 'x-csrf-token': session.csrf } : {}),
    } }, res);
    return res;
  }
  return { request, starts, config, journal, batchStatus };
}

test('candidate read-only switch is opt-in, reports its actual health identity and rejects misspellings', async () => {
  assert.equal(readConfig().candidateReadOnly, false);
  assert.equal(readConfig('0').candidateReadOnly, false);
  assert.equal(readConfig('1').candidateReadOnly, true);
  for (const invalid of ['true', 'false', 'yes', '1 ', 'unexpected'])
    assert.throws(() => readConfig(invalid), /CANDIDATE_READ_ONLY_FLAG_INVALID/);
  for (const flag of [undefined, '0', '1']) {
    const h = harness(flag), health = await h.request('/healthz', { authenticated: false });
    assert.equal(health.status, 200);
    assert.equal(health.body.candidateReadOnly, flag === '1');
    assert.equal(typeof health.body.candidateReadOnly, 'boolean');
    assert.equal(health.body.runtimeReady, false, 'capability identity must not promote readiness');
    assert.equal(h.starts.length, 0);
  }
});

test('read-only batch POST retains authentication and CSRF before blocking every child spawn', async () => {
  const h = harness('1');
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST', authenticated: false })).body.error, 'AUTH_REQUIRED');
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST', csrf: false })).body.error, 'CSRF_INVALID');
  for (let n = 0; n < 2; n++) {
    const res = await h.request('/api/v2/daily-update', { method: 'POST' });
    assert.equal(h.starts.length, 0, 'read-only POST must never reach child_process.spawn');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, reason);
    assert.equal(res.body.data.state, 'BLOCKED');
    assert.deepEqual(res.body.data.reasonCodes, [reason]);
  }
});

test('read-only GET preserves actual batch status and reports the manual-run restriction separately', async () => {
  const h = harness('1');
  const res = await h.request('/api/v2/daily-update');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, h.batchStatus);
  assert.deepEqual(res.body.manualRun, { allowed: false, state: 'BLOCKED', reasonCodes: [reason] });
  assert.equal(res.body.processRunning, false);
  assert.equal(h.starts.length, 0);
});

for (const flag of [undefined, '0']) test(`default batch lifecycle remains unchanged (flag=${flag ?? 'absent'})`, async () => {
  const h = harness(flag);
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST', csrf: false })).status, 403);
  assert.equal(h.starts.length, 0);
  const first = await h.request('/api/v2/daily-update', { method: 'POST' });
  assert.equal(first.status, 202); assert.equal(first.body.data.state, 'starting');
  assert.equal(h.starts.length, 1);
  assert.equal(h.starts[0].args[1][0], path.join(h.config.appRoot, 'v2/scripts/run-v3-daily-update.mjs'));
  assert.equal(h.starts[0].args[2].cwd, path.join(h.config.appRoot, 'v2'));
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST' })).body.error, 'DAILY_UPDATE_ALREADY_RUNNING');
  assert.equal(h.starts.length, 1);
  const status = await h.request('/api/v2/daily-update');
  assert.equal(status.body.manualRun, undefined); assert.equal(status.body.processRunning, true);
  h.starts[0].child.emit('exit', 0);
  assert.equal((await h.request('/api/v2/daily-update', { method: 'POST' })).status, 202);
  assert.equal(h.starts.length, 2);
});

test('read-only batch boundary keeps authenticated separate journal save/read dispatch usable', async () => {
  const h = harness('1'), body = { intent: 'NO_TRADE', setup: 'Synthetic boundary test' };
  assert.equal((await h.request('/api/v1/decision-journal', { method: 'POST', csrf: false, body })).status, 403);
  const saved = await h.request('/api/v1/decision-journal', { method: 'POST', body });
  assert.equal(saved.status, 201); assert.equal(saved.body.executionAuthorized, false);
  const read = await h.request('/api/v1/decision-journal');
  assert.equal(read.status, 200); assert.deepEqual(read.body.data, [saved.body.data]);
  assert.equal(read.body.storage, 'LOCAL_APPEND_ONLY_ISOLATED');
  assert.equal(h.starts.length, 0);
});

test('existing button shows BLOCKED reason, remains visible and does not poll or claim batch started', async () => {
  const h = harness('1'), alerts = [], button = { disabled: false, hidden: false }, handlers = {};
  button.addEventListener = (event, handler) => { handlers[event] = handler; };
  let polls = 0;
  const context = { $: id => id === 'daily-update-button' ? button : { prepend: box => alerts.push(box) },
    document: { createElement: () => ({ attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }) },
    api: async (url, options) => { const res = await h.request(url, options); if (res.status >= 400) throw Error(res.body.error); return res.body; },
    monitorDailyUpdate: async () => { polls++; },
  };
  const handler = appSource.slice(appSource.indexOf("$('daily-update-button').addEventListener"), appSource.indexOf("$('refresh-button').addEventListener"));
  vm.runInNewContext(handler, context);
  await handlers.click();
  assert.equal(polls, 0); assert.equal(h.starts.length, 0);
  assert.equal(button.hidden, false); assert.equal(button.disabled, false); assert.equal(button.textContent, '每日資料更新');
  assert.equal(alerts.length, 1); assert.equal(alerts[0].className, 'alert warning');
  assert.equal(alerts[0].attributes.role, 'status');
  assert.match(alerts[0].textContent, /BLOCKED/); assert.match(alerts[0].textContent, /候選唯讀/);
  assert.ok(alerts[0].textContent.includes(reason)); assert.doesNotMatch(alerts[0].textContent, /已啟動/);
});
