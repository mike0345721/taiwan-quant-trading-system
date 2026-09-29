import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareFormalEntry } from '../src/cru55-formal-entry.mjs';
import { sourceDirectoryIdentity } from '../src/cru55-runtime-binding.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
import { hashPassword } from '../src/security.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const stable = fs.readFileSync(path.join(source, 'public/index.html'), 'utf8');
const required = ['data-dashboard-page="quality"',
  'id="data-operations-read-status"', 'id="data-operations-refresh"', 'id="data-operations-content"'];
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru57-surface-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cru57-surface-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function bindingFixture(t) {
  const root = temporary(t), runtime = path.join(root, 'runtime');
  fs.mkdirSync(runtime);
  const git = args => execFileSync('git', args, { cwd: runtime, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  git(['init', '--quiet']);
  fs.writeFileSync(path.join(runtime, 'identity.txt'), 'ISOLATED UNIT TEST ONLY\n');
  git(['add', 'identity.txt']);
  git(['-c', 'user.name=CRU57 test', '-c', 'user.email=cru57@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test identity']);
  const head = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/main', head]);
  const data = path.join(runtime, 'data'), sourceRoot = path.join(data, 'live-events');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.cpSync(path.join(source, 'public'), path.join(runtime, 'public'), { recursive: true });
  const outputRoot = path.join(data, 'cru55-runtime/output/stream-unit-test');
  const binding = { schemaVersion: 'cru55-runtime-binding-v1', state: 'OWNER_APPROVED',
    runtimeRoot: runtime, runtimeCommit: head, dataRoot: data, sourceRoot, outputRoot, readerRoot: outputRoot,
    outputVersion: 'stream-unit-test', producer: 'STREAM_PAGED_V2', sourceVerification: 'FULL_PREFIX_BEFORE_PUBLICATION',
    sourceAlias: { kind: 'PLAIN', physicalRoot: sourceRoot, targetIdentity: sourceDirectoryIdentity(sourceRoot) },
    sourceSelection: { kind: 'DATED_CALENDAR_LEDGER', startDate: '2026-09-01' },
    ownerDecisionUrl: 'https://linear.app/example/issue/TEST-57', ...SAFETY };
  const file = path.join(root, 'binding.json');
  const save = value => fs.writeFileSync(file, JSON.stringify(value));
  save(binding);
  return { runtime, binding, file, save, outputRoot, git };
}
async function render(handle, pathname) {
  let body, status;
  const matched = await handle({ method: 'GET' }, {
    writeHead: code => { status = code; }, end: bytes => { body = String(bytes); },
  }, new URL(pathname, 'http://localhost'), () => true);
  return { matched, status, body };
}
function withEnv(t, binding, dynamic) {
  const names = ['CRU55_RUNTIME_BINDING', 'CRU55_DYNAMIC_ROOT'];
  const old = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }));
  for (const [i, value] of [binding, dynamic].entries()) {
    if (value === undefined) delete process.env[names[i]]; else process.env[names[i]] = value;
  }
}

test('LL-012: source presence and env-only candidates cannot intercept either default route', async t => {
  withEnv(t);
  for (const dynamic of [undefined, path.join(temporary(t), 'absent-output')]) {
    if (dynamic) process.env.CRU55_DYNAMIC_ROOT = dynamic;
    const handle = prepareFormalEntry({ publicDir: path.join(source, 'public') }, () => null);
    assert.equal(handle.runtimeBinding.defaultSurfaceEligible, false);
    assert.equal(handle.runtimeBinding.state, dynamic ? 'CANDIDATE_UNBOUND' : 'UNCONFIGURED');
    for (const route of ['/', '/index.html']) assert.equal((await render(handle, route)).matched, false);
    if (dynamic) assert.equal(fs.existsSync(dynamic), false, 'no writer/output side effect');
  }
});

test('valid persistent activation preserves CRU55 root transforms and workspace, without creating output', async t => {
  const f = bindingFixture(t); withEnv(t, f.file);
  const handle = prepareFormalEntry({ publicDir: path.join(f.runtime, 'public') }, () => null);
  assert.equal(handle.runtimeBinding.defaultSurfaceEligible, true);
  assert.equal(handle.runtimeBinding.state, 'BOUND');
  assert.equal(handle.runtimeBinding.runtimeCommit, f.binding.runtimeCommit);
  assert.equal(handle.runtimeBinding.fullDayReady, false);
  assert.match(handle.runtimeBinding.bindingHash, /^[a-f0-9]{64}$/);
  for (const route of ['/', '/index.html']) {
    const page = await render(handle, route);
    assert.equal(page.status, 200); assert.equal(page.matched, true);
    assert.match(page.body, /data-formal-entry="true"/); assert.match(page.body, /formal-overview.js/);
    assert.match(page.body, /vendor\/lightweight-charts.js/);
    assert.doesNotMatch(page.body, /SYNTHETIC \/ UI DEMO|CRU-55 · ISOLATED PREVIEW/);
  }
  const workspace = await render(handle, '/workspace?space=futures');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.replace(' data-formal-entry="true"', '')
    .replace('<link rel="stylesheet" href="/workspace.css"><script src="/workspace.js" defer></script>', ''), stable);
  for (const [key, value] of Object.entries(SAFETY)) assert.equal(f.binding[key], value);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test('activation remains fail closed for unapproved, wrong identity, decision, producer, alias and safety', t => {
  const f = bindingFixture(t); withEnv(t, f.file);
  const prepare = () => prepareFormalEntry({ publicDir: path.join(f.runtime, 'public') }, () => null);
  for (const [patch, reason] of [
    [{ state: 'PROPOSED' }, /OWNER_MAIN_GATE/],
    [{ runtimeCommit: 'f'.repeat(40) }, /HEAD_MISMATCH/],
    [{ ownerDecisionUrl: '' }, /OWNER_MAIN_GATE/],
    [{ producer: 'UNREVIEWED' }, /OUTPUT_VERSION|UNREVIEWED_PRODUCER/],
    [{ sourceAlias: null }, /SOURCE_ALIAS/],
    [{ sourceAlias: { ...f.binding.sourceAlias, targetIdentity: { dev: '0', ino: '0', birthtimeNs: '0' } } }, /SOURCE_TARGET_IDENTITY/],
    [{ executionAuthorized: true }, /CONTRACT/],
  ]) { f.save({ ...f.binding, ...patch }); assert.throws(prepare, reason); }
  f.save(f.binding);
  process.env.CRU55_DYNAMIC_ROOT = path.join(f.runtime, 'wrong-output');
  assert.throws(prepare, /READER_ENV_MISMATCH/);
  delete process.env.CRU55_DYNAMIC_ROOT;
  fs.appendFileSync(path.join(f.runtime, 'identity.txt'), 'dirty\n');
  assert.throws(prepare, /TRACKED_CODE_DIRTY/);
});

for (const envOnly of [false, true]) test(`actual server stable root, protected APIs and CSRF (env-only=${envOnly})`, { timeout: 30000 }, async t => {
  const cleanup = [];
  const runtime = temporary({ after: fn => cleanup.push(fn) });
  for (const item of ['server.mjs', 'src', 'v2/src', 'config', 'public'])
    fs.cpSync(path.join(source, item), path.join(runtime, item), { recursive: true });
  // Hermetic API regression only: no requests to production bridge or upstreams.
  fs.writeFileSync(path.join(runtime, 'no-network.mjs'), 'globalThis.fetch = async () => { throw new Error("ISOLATED_TEST_NO_NETWORK"); };');
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const password = crypto.randomBytes(24).toString('hex');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(CRU|DATA_OPERATIONS_|TX_CHART_|DASHBOARD_|FORWARD_SHADOW_|V2_)/.test(key)));
  const child = spawn(process.execPath, ['--import', './no-network.mjs', 'server.mjs'], {
    cwd: runtime, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env,
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), MOCK_DATA: 'true',
      COOKIE_SECURE: 'false', REFRESH_INTERVAL_SECONDS: '0', DASHBOARD_PASSWORD_HASH: hashPassword(password),
      ...(envOnly ? { CRU55_DYNAMIC_ROOT: path.join(runtime, 'absent-candidate-output') } : {}) },
  });
  let log = ''; child.stdout.on('data', b => { log += b; }); child.stderr.on('data', b => { log += b; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    for (const remove of cleanup) remove();
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; ; n++) {
    try { await fetch(base + '/api/session'); break; }
    catch (error) { if (n > 100 || child.exitCode !== null) throw new Error(log, { cause: error }); await new Promise(r => setTimeout(r, 50)); }
  }
  for (const route of ['/', '/index.html']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
    const page = await response.text(); assert.equal(page, stable);
    for (const selector of required) assert.ok(page.includes(selector), selector);
    assert.doesNotMatch(page, /formal-overview.js|CRU55_DYNAMIC_SOURCE_NOT_CONFIGURED/);
  }
  assert.match(await (await fetch(base + '/workspace')).text(), /workspace.js/);
  const health = await (await fetch(base + '/healthz')).json();
  assert.equal(health.cru55Binding.defaultSurfaceEligible, false);
  assert.equal(health.cru55Binding.state, envOnly ? 'CANDIDATE_UNBOUND' : 'UNCONFIGURED');
  for (const route of ['/api/v1/cvd-overview', '/api/v1/dashboard', '/api/v1/data-operations', '/api/v1/observed-flow'])
    assert.equal((await fetch(base + route)).status, 401, route);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200); const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0]; const headers = { cookie, 'content-type': 'application/json' };
  assert.equal((await (await fetch(base + '/api/session', { headers })).json()).authenticated, true);
  for (const route of ['/api/v1/dashboard', '/api/v1/data-operations', '/api/v1/observed-flow'])
    assert.equal((await fetch(base + route, { headers })).status, 200, route);
  const cvd = await fetch(base + '/api/v1/cvd-overview', { headers });
  assert.equal(cvd.status, 503);
  assert.equal((await cvd.json()).reason, envOnly ? 'CRU55_PROJECTION_NOT_AVAILABLE' : 'CRU55_DYNAMIC_SOURCE_NOT_CONFIGURED');
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, 'x-csrf-token': session.csrfToken }, body: '{}' })).status, 200);
  assert.equal((await fetch(base + '/api/v1/data-operations', { headers })).status, 401);
  assert.equal(fs.existsSync(path.join(runtime, 'absent-candidate-output')), false);
  assert.equal(fs.existsSync(path.join(runtime, 'data/cru55-runtime')), false);
});
