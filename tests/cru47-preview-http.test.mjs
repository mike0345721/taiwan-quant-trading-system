import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { hashPassword } from '../src/security.mjs';

const root = process.cwd();
const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const password = 'Abcdef123456';
const passwordHash = hashPassword(password);

async function freePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, pathname, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      headers: {
        Host: `127.0.0.1:${port}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* test reports raw text */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.once('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startDashboard({ preview = true } = {}) {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cru47-http-'));
  fs.mkdirSync(path.join(tempRoot, 'history'), { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  const instanceId = crypto.randomUUID().replaceAll('-', '');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), NODE_ENV: preview ? 'development' : 'production',
      TRUST_PROXY: '0', COOKIE_SECURE: '0', MOCK_DATA: 'true', REFRESH_INTERVAL_SECONDS: '0',
      DASHBOARD_PASSWORD_HASH: passwordHash,
      DASHBOARD_DATA_ROOT: tempRoot, DASHBOARD_STATE_DIR: path.join(tempRoot, 'state'),
      DASHBOARD_PREVIEW_TYPE: preview ? 'CRU47_OWNER_PREVIEW' : '',
      DASHBOARD_PREVIEW_BRANCH: preview ? 'codex/cru-47-localhost-owner-preview-auto-auth-v1' : '',
      DASHBOARD_PREVIEW_DATA_MODE: preview ? 'GOVERNED_LOCAL_DATA' : '',
      DASHBOARD_PREVIEW_AUTO_AUTH: preview ? '1' : '0',
      DASHBOARD_PREVIEW_INSTANCE_ID: preview ? instanceId : '',
      DASHBOARD_PREVIEW_EXPECTED_COMMIT: preview ? candidateCommit : '',
      DASHBOARD_PREVIEW_BOOTSTRAP_SHA256: preview ? digest : '',
      DASHBOARD_PREVIEW_CANONICAL_ORIGIN: preview ? origin : '',
      DASHBOARD_PREVIEW_BOOTSTRAP_TTL_SECONDS: '60',
      DASHBOARD_PREVIEW_SESSION_TTL_MINUTES: '30',
    },
  });
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(chunk.toString('utf8')));
  let health = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode != null) break;
    try {
      const response = await request(port, '/healthz');
      if (response.status === 200) { health = response; break; }
    } catch { /* startup race */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(health, `SERVER_NOT_READY:${errors.join('')}`);
  return { port, tempRoot, token, instanceId, origin, child, health };
}

async function stopDashboard(runtime) {
  if (runtime.child.exitCode == null) {
    runtime.child.kill('SIGTERM');
    await Promise.race([once(runtime.child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  fs.rmSync(runtime.tempRoot, { recursive: true, force: true });
}

function cookieFrom(response) {
  return String(response.headers['set-cookie'] || '').split(';')[0];
}

test('CRU-47 real HTTP bootstrap is one-use, isolated, and keeps CSRF enforced', { timeout: 60_000 }, async () => {
  const runtime = await startDashboard({ preview: true });
  let secondRuntime = null;
  try {
    const publicHealth = runtime.health.json;
    assert.equal(publicHealth.versionTruth.previewType, 'CRU47_OWNER_PREVIEW');
    assert.equal(publicHealth.versionTruth.exactHead, candidateCommit);
    assert.equal(publicHealth.localPreviewAutoAuth.effective, true);
    assert.equal(JSON.stringify(publicHealth).includes(runtime.token), false);
    assert.equal(publicHealth.localPreviewAutoAuth.capabilitySha256, undefined);

    assert.equal((await request(runtime.port, '/api/session')).json.authenticated, false);
    const exchange = (overrides = {}) => request(runtime.port, '/api/auth/preview-bootstrap', {
      method: 'POST',
      headers: {
        Origin: runtime.origin,
        'X-Preview-Bootstrap-Capability': runtime.token,
        ...(overrides.headers || {}),
      },
      body: { instanceId: runtime.instanceId, candidateCommit, ...(overrides.body || {}) },
    });

    assert.equal((await exchange({ headers: { 'X-Preview-Bootstrap-Capability': 'wrong' } })).status, 403);
    assert.equal((await exchange({ headers: { Origin: 'http://evil.invalid' } })).status, 403);
    assert.equal((await exchange({ headers: { 'X-Forwarded-For': '127.0.0.1' } })).status, 403);
    assert.equal((await exchange({ headers: { Host: `localhost:${runtime.port}` } })).status, 403);
    assert.equal((await exchange({ body: { instanceId: 'wrong_instance_1234' } })).status, 403);

    const passwordLogin = await request(runtime.port, '/api/auth/login', {
      method: 'POST', body: { password, remember: true },
    });
    assert.equal(passwordLogin.status, 200);
    assert.match(String(passwordLogin.headers['set-cookie']), new RegExp(`^twchip_preview_${runtime.instanceId}=`));
    assert.doesNotMatch(String(passwordLogin.headers['set-cookie']), /twchip_session=/);
    const passwordCookie = cookieFrom(passwordLogin);
    assert.equal((await request(runtime.port, '/api/session', { headers: { Cookie: passwordCookie } })).json.authenticated, true);
    assert.equal((await request(runtime.port, '/api/auth/logout', {
      method: 'POST', headers: { Cookie: passwordCookie, Origin: runtime.origin }, body: {},
    })).status, 403);
    assert.equal((await request(runtime.port, '/api/auth/logout', {
      method: 'POST', headers: { Cookie: passwordCookie, Origin: runtime.origin,
        'X-CSRF-Token': passwordLogin.json.csrfToken }, body: {},
    })).status, 200);

    const concurrent = await Promise.all([exchange(), exchange()]);
    assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);
    const success = concurrent.find((item) => item.status === 200);
    assert.equal(success.status, 200, success.text);
    assert.match(String(success.headers['set-cookie']), new RegExp(`^twchip_preview_${runtime.instanceId}=`));
    assert.match(String(success.headers['set-cookie']), /HttpOnly/);
    assert.match(String(success.headers['set-cookie']), /SameSite=Strict/);
    assert.match(String(success.headers['set-cookie']), /Max-Age=1800/);
    assert.doesNotMatch(String(success.headers['set-cookie']), /Secure/);
    assert.equal((await exchange()).status, 409);

    const cookie = cookieFrom(success);
    const session = await request(runtime.port, '/api/session', { headers: { Cookie: cookie } });
    assert.equal(session.json.authenticated, true);
    assert.equal(session.json.authenticationMode, 'LOCAL_OWNER_PREVIEW_AUTO_AUTH');
    assert.equal(session.json.previewInstanceId, runtime.instanceId);
    secondRuntime = await startDashboard({ preview: true });
    assert.equal((await request(secondRuntime.port, '/api/session', { headers: { Cookie: cookie } })).json.authenticated, false);
    assert.equal((await request(runtime.port, '/api/v1/security-status', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await request(runtime.port, '/api/auth/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: runtime.origin, 'X-CSRF-Token': 'wrong' }, body: {},
    })).status, 403);
    assert.equal((await request(runtime.port, '/api/auth/logout', {
      method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': success.json.csrfToken }, body: {},
    })).status, 401);
    assert.equal((await request(runtime.port, '/api/auth/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: runtime.origin,
        'X-CSRF-Token': success.json.csrfToken }, body: {},
    })).status, 200);
    assert.equal((await request(runtime.port, '/api/session', { headers: { Cookie: cookie } })).json.authenticated, false);
  } finally {
    if (secondRuntime) await stopDashboard(secondRuntime);
    await stopDashboard(runtime);
  }
});

test('normal runtime rejects preview bootstrap and preserves the formal cookie path', { timeout: 60_000 }, async () => {
  const runtime = await startDashboard({ preview: false });
  try {
    const disabled = await request(runtime.port, '/api/auth/preview-bootstrap', {
      method: 'POST', headers: { Origin: runtime.origin, 'X-Preview-Bootstrap-Capability': runtime.token },
      body: { instanceId: runtime.instanceId, candidateCommit },
    });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.json.error, 'PREVIEW_AUTO_AUTH_DISABLED');
    const login = await request(runtime.port, '/api/auth/login', {
      method: 'POST', body: { password, remember: false },
    });
    assert.equal(login.status, 200);
    assert.match(String(login.headers['set-cookie']), /^twchip_session=/);
    assert.doesNotMatch(String(login.headers['set-cookie']), /^twchip_preview_/);
  } finally {
    await stopDashboard(runtime);
  }
});
