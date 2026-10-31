import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/security.mjs';

// Disposable authenticated HTTP regression, MOCK data only. Never L4/L5 evidence.
test('F1/F3/F6 protected Flow GET, normal login, CSRF/logout, and honest research 503', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-http-'));
  const source = fileURLToPath(new URL('..', import.meta.url));
  for (const item of ['server.mjs', 'src', 'v2/src', 'config']) {
    fs.cpSync(path.join(source, item), path.join(root, item), { recursive: true });
  }
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const password = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1',
      MOCK_DATA: 'true', COOKIE_SECURE: 'false', REFRESH_INTERVAL_SECONDS: '0',
      DASHBOARD_PASSWORD_HASH: hashPassword(password), CRU34_LIVE_SNAPSHOT_PATH: '', CRU34_LIVE_STATUS_PATH: '',
      CRU34_SNAPSHOT_ARTIFACT_PATH: '', V2_RESEARCH_DATABASE_PATH: path.join(root, 'missing.sqlite'),
      V2_BACKTEST_REPORT_PATH: path.join(root, 'missing.json') }, stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode == null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try { await fetch(base + '/api/session'); break; }
    catch (error) { if (attempt > 80 || child.exitCode != null) throw error; await new Promise(r => setTimeout(r, 50)); }
  }
  assert.equal((await fetch(base + '/api/v1/observed-flow')).status, 401);
  assert.equal((await fetch(base + '/api/v1/research-evidence')).status, 401);
  const login = await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const session = await login.json(); const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };
  const flow = await fetch(base + '/api/v1/observed-flow', { headers });
  assert.equal(flow.status, 200); assert.equal(flow.headers.get('cache-control'), 'no-store');
  assert.equal((await flow.json()).data.sourceState, 'UNAVAILABLE');
  const research=await fetch(base+'/api/v1/research-evidence',{headers});
  assert.equal(research.status,200);assert.equal(research.headers.get('cache-control'),'no-store');
  const evidence=(await research.json()).data;
  assert.equal(evidence.schemaVersion,'dashboard-research-evidence-v1');
  assert.equal(evidence.depth.state,'UNAVAILABLE');assert.equal(evidence.comparison.metrics,null);
  assert.equal(evidence.executionAuthorized,false);
  assert.equal((await fetch(base+'/api/v1/research-evidence',{method:'POST',headers,body:'{}'})).status,404);
  for (const [endpoint, reason] of [['research','V2_DATABASE_NOT_READY'], ['backtests','V2_BACKTEST_NOT_READY']]) {
    const response = await fetch(base + '/api/v2/' + endpoint, { headers });
    assert.equal(response.status, 503); assert.equal((await response.json()).error, reason);
  }
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, 'x-csrf-token': session.csrfToken }, body: '{}' })).status, 200);
  assert.equal((await fetch(base + '/api/v1/observed-flow', { headers })).status, 401);
  assert.equal((await fetch(base + '/api/v1/research-evidence', { headers })).status, 401);
});
