import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_SCOPE, OWNER_PREVIEW, assertOwnerMode, ownerRequestAllowed,
  assertOwnerConsent } from '../src/owner-local-acceptance.mjs';

test('owner mode defaults off and cannot be enabled by scope or password alone', () => {
  assert.equal(assertOwnerMode({}, {}), false);
  assert.throws(() => assertOwnerMode({ DASHBOARD_RELEASE_SCOPE: OWNER_SCOPE }, {}), /OWNER_/);
  for (const input of [null, {}, { accepted: false, password: 'Fixture-only-1234' },
    { accepted: true, password: 'short' }, { accepted: true, password: 'Fixture-only-1234', riskVersion: 'other' }]) {
    assert.throws(() => assertOwnerConsent(input), /OWNER_/);
  }
});

const request = (url = '/', patch = {}) => ({ method: 'GET', url,
  socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:18723' }, ...patch });
test('owner HTTP boundary separates navigation/assets from same-origin API', () => {
  assert.equal(ownerRequestAllowed(request()), true);
  assert.equal(ownerRequestAllowed(request('/app.js')), true);
  assert.equal(ownerRequestAllowed(request('/api/session')), false);
  const api = request('/api/session', { headers: { host: 'localhost:18723',
    'sec-fetch-site': 'same-origin', referer: 'http://localhost:18723/' } });
  assert.equal(ownerRequestAllowed(api), true);
  for (const headers of [{ host: '127.0.0.1:18723' }, { host: 'LOCALHOST:18723' },
    { host: 'localhost:18723', origin: 'https://localhost:18723' },
    { host: 'localhost:18723', origin: 'http://localhost:8787' },
    { host: 'localhost:18723', 'sec-fetch-site': 'same-site' },
    { host: 'localhost:18723', forwarded: '' },
    { host: 'localhost:18723', 'x-forwarded-for': '127.0.0.1' }]) {
    assert.equal(ownerRequestAllowed(request('/', { headers })), false);
  }
  assert.equal(ownerRequestAllowed(request('/', { socket: { remoteAddress: '192.0.2.1' } })), false);
  assert.equal(ownerRequestAllowed(request('http://localhost:18723/')), false);
  assert.equal(ownerRequestAllowed(request('/',{rawHeaders:['Host','localhost:18723','Host','evil.invalid']})),false);
  assert.equal(ownerRequestAllowed(request('/api/auth/login', { method: 'POST', headers: api.headers })), false);
  assert.equal(ownerRequestAllowed(request('/api/auth/login', { method: 'POST',
    headers: { ...api.headers, origin: 'http://localhost:18723' } })), true);
  assert.notEqual(OWNER_SCOPE, 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE');
  assert.notEqual(OWNER_PREVIEW, 'CRU21_MARKET_RESEARCH_CANDIDATE');
});
