import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, SessionStore, LoginRateLimiter,
  sessionCookie, clearSessionCookie } from '../src/security.mjs';

test('scrypt password hash can be verified', () => {
  const encoded = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(verifyPassword('wrong password', encoded), false);
});

test('session expires', async () => {
  const store = new SessionStore(10);
  const session = store.create('127.0.0.1');
  assert.ok(store.get(session.id));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(store.get(session.id), null);
});

test('remembered session uses its own lifetime', () => {
  const store = new SessionStore(10);
  const session = store.create('127.0.0.1', 60_000);
  assert.equal(session.ttlMs, 60_000);
  assert.ok(session.expiresAt - session.createdAt >= 60_000);
});

test('login rate limiter blocks repeated failures', () => {
  const limiter = new LoginRateLimiter({ windowMs: 60_000, maxAttempts: 2 });
  limiter.fail('x'); limiter.fail('x');
  assert.equal(limiter.check('x').allowed, false);
  limiter.success('x');
  assert.equal(limiter.check('x').allowed, true);
});

test('session cookies preserve the formal name and allow an isolated preview name', () => {
  assert.match(sessionCookie('formal'), /^twchip_session=formal;/);
  const preview = sessionCookie('preview', {
    secure: false, maxAgeSeconds: 1800, name: 'twchip_preview_session',
  });
  assert.match(preview, /^twchip_preview_session=preview;/);
  assert.match(preview, /HttpOnly/);
  assert.match(preview, /SameSite=Strict/);
  assert.match(preview, /Max-Age=1800/);
  assert.doesNotMatch(preview, /Secure/);
  assert.match(clearSessionCookie({ secure: false, name: 'twchip_preview_session' }),
    /^twchip_preview_session=;/);
  assert.throws(() => sessionCookie('x', { name: 'bad-name' }), /INVALID_COOKIE_NAME/);
});
