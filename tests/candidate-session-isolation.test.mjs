import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SessionStore, parseCookies, safeEqual, sessionCookie, clearSessionCookie } from '../src/security.mjs';

const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
function harness(candidateReadOnly, cru55 = null) {
  const sessions = new SessionStore(60000), session = sessions.create('127.0.0.1');
  const context = { sessions, parseCookies, safeEqual, sessionCookie, clearSessionCookie,
    config: { candidateReadOnly, nodeEnv: 'test', passwordHash: '', sessionTtlMs: 60000, cookieSecure: true },
    cru55, formalEntry: null, URL, crypto: { randomUUID: () => 'synthetic-session-test' }, console,
    requestIsHttps: () => false, setSecurityHeaders() {}, clientIp: () => '127.0.0.1',
    loginLimiter: { check: () => ({ allowed: true }), success() {} },
    readJson: async () => ({ password: 'synthetic-test-only' }),
    sendJson(res, status, body) { res.status = status; res.body = body; },
  };
  const auth = source.slice(source.indexOf('function getSession(req)'), source.indexOf('const inlineEnabled ='));
  const handler = source.slice(source.indexOf('const requestHandler ='), source.indexOf('const server = createDashboardServer'));
  vm.runInNewContext(`${auth}\n${handler}\nglobalThis.readSession=getSession;globalThis.handle=requestHandler;`, context);
  return { session,
    read(cookie) { return context.readSession({ headers: { cookie } }); },
    async request(url, cookie = '') {
      const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
      await context.handle({ url, method: 'POST', headers: { cookie, 'x-csrf-token': session.csrf } }, res);
      return res;
    },
  };
}

test('reader-only candidate cannot consume a formal localhost session cookie', () => {
  const h = harness(true);
  assert.equal(h.read(`twchip_session=${h.session.id}`), null);
  assert.equal(h.read(`twchip_candidate_session=${h.session.id}`)?.id, h.session.id);
});

test('formal and CRU55 session names remain unchanged', () => {
  const formal = harness(false), managed = harness(true, { guard: () => true });
  assert.equal(formal.read(`twchip_session=${formal.session.id}`)?.id, formal.session.id);
  assert.equal(formal.read(`twchip_candidate_session=${formal.session.id}`), null);
  assert.equal(managed.read(`cru55_main_session=${managed.session.id}`)?.id, managed.session.id);
});

test('candidate login and logout set only the candidate name with original secure attributes', async () => {
  const h = harness(true);
  const login = await h.request('/api/auth/login');
  assert.equal(login.status, 200);
  assert.match(login.headers['Set-Cookie'], /^twchip_candidate_session=/);
  assert.match(login.headers['Set-Cookie'], /HttpOnly/);
  assert.match(login.headers['Set-Cookie'], /SameSite=Strict/);
  assert.match(login.headers['Set-Cookie'], /Secure/);
  const logout = await h.request('/api/auth/logout', `twchip_candidate_session=${h.session.id}`);
  assert.equal(logout.status, 200);
  assert.match(logout.headers['Set-Cookie'], /^twchip_candidate_session=/);
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/);
});
