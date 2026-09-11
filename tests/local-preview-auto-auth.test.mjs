import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { LocalPreviewAutoAuth, inspectLocalPreviewBoundary } from '../src/local-preview-auto-auth.mjs';

const token = 'unit-cap';
const digest = crypto.createHash('sha256').update(token).digest('hex');
const commit = 'a'.repeat(40);
const origin = 'http://127.0.0.1:8796';

function request({ peer = '127.0.0.1', local = '127.0.0.1', host = '127.0.0.1:8796',
  requestOrigin = origin, forwarded = false } = {}) {
  return {
    socket: { remoteAddress: peer, localAddress: local },
    headers: { host, origin: requestOrigin, ...(forwarded ? { 'x-forwarded-for': '127.0.0.1' } : {}) },
  };
}

function manager(options = {}, clock = () => 1_000) {
  return new LocalPreviewAutoAuth({
    enabled: true,
    instanceId: 'instance_1234567890',
    candidateCommit: commit,
    canonicalOrigin: origin,
    capabilitySha256: digest,
    bootstrapTtlMs: 60_000,
    sessionTtlMs: 1_800_000,
    ...options,
  }, { now: clock });
}

test('preview auto-auth is off unless explicitly enabled and status contains no capability material', () => {
  const disabled = new LocalPreviewAutoAuth({ enabled: false });
  assert.equal(disabled.status().effective, false);
  assert.equal(disabled.consume({}).error, 'PREVIEW_AUTO_AUTH_DISABLED');
  const status = manager().status();
  assert.equal(status.effective, true);
  assert.equal(status.reason, 'ACTIVE');
  assert.equal(JSON.stringify(status).includes(token), false);
  assert.equal(JSON.stringify(status).includes(digest), false);
});

test('preview boundary requires actual loopback, exact Host and Origin, and rejects proxy headers', () => {
  assert.equal(inspectLocalPreviewBoundary(request(), origin, { requireOrigin: true }).ready, true);
  assert.equal(inspectLocalPreviewBoundary(request({ peer: '192.168.1.2' }), origin, { requireOrigin: true }).ready, false);
  assert.equal(inspectLocalPreviewBoundary(request({ local: '0.0.0.0' }), origin, { requireOrigin: true }).ready, false);
  assert.equal(inspectLocalPreviewBoundary(request({ host: 'localhost:8796' }), origin, { requireOrigin: true }).ready, false);
  assert.equal(inspectLocalPreviewBoundary(request({ requestOrigin: 'http://evil.invalid' }), origin, { requireOrigin: true }).ready, false);
  assert.equal(inspectLocalPreviewBoundary(request({ forwarded: true }), origin, { requireOrigin: true }).ready, false);
  assert.equal(inspectLocalPreviewBoundary(request({ peer: '::ffff:127.0.0.1', local: '::ffff:127.0.0.1' }),
    origin, { requireOrigin: true }).ready, true);
});

test('capability is instance and commit bound, single use, and invalid attempts do not consume it', () => {
  const auth = manager();
  assert.equal(auth.consume({ token: 'wrong', instanceId: 'instance_1234567890', candidateCommit: commit, req: request() }).error,
    'PREVIEW_CAPABILITY_INVALID');
  assert.equal(auth.consume({ token, instanceId: 'wrong_instance_1234', candidateCommit: commit, req: request() }).error,
    'PREVIEW_INSTANCE_MISMATCH');
  assert.equal(auth.consume({ token, instanceId: 'instance_1234567890', candidateCommit: 'b'.repeat(40), req: request() }).error,
    'PREVIEW_CANDIDATE_MISMATCH');
  assert.equal(auth.consume({ token, instanceId: 'instance_1234567890', candidateCommit: commit, req: request() }).ok, true);
  assert.equal(auth.status().reason, 'BOOTSTRAP_CONSUMED');
  assert.equal(auth.consume({ token, instanceId: 'instance_1234567890', candidateCommit: commit, req: request() }).error,
    'PREVIEW_CAPABILITY_REPLAYED');
});

test('expired capability fails closed and health reports expiry truthfully', () => {
  let now = 1_000;
  const auth = manager({}, () => now);
  now = 61_000;
  assert.equal(auth.status().reason, 'BOOTSTRAP_EXPIRED');
  assert.equal(auth.status().effective, false);
  assert.equal(auth.consume({ token, instanceId: 'instance_1234567890', candidateCommit: commit, req: request() }).error,
    'PREVIEW_CAPABILITY_EXPIRED');
});
