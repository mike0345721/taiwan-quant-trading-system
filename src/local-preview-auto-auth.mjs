import crypto from 'node:crypto';

export function previewSessionCookieName(instanceId) {
  const normalized = String(instanceId || '').replace(/[^A-Za-z0-9_]/g, '');
  if (!/^[A-Za-z0-9_]{16,128}$/.test(normalized)) throw new Error('PREVIEW_INSTANCE_ID_INVALID');
  return `twchip_preview_${normalized}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function equalHex(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function inspectLocalPreviewBoundary(req, canonicalOrigin, { requireOrigin = false } = {}) {
  const expectedHost = new URL(canonicalOrigin).host;
  const peer = req?.socket?.remoteAddress || '';
  const local = req?.socket?.localAddress || '';
  const host = String(req?.headers?.host || '').toLowerCase();
  const origin = String(req?.headers?.origin || '');
  const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']
    .some((name) => req?.headers?.[name] != null);
  const reasons = [];
  if (peer !== '127.0.0.1' && peer !== '::ffff:127.0.0.1') reasons.push('PEER_NOT_LOOPBACK');
  if (local !== '127.0.0.1' && local !== '::ffff:127.0.0.1') reasons.push('LISTENER_NOT_LOOPBACK');
  if (host !== expectedHost) reasons.push('HOST_NOT_ALLOWLISTED');
  if (forwarded) reasons.push('FORWARDED_HEADERS_REJECTED');
  if (requireOrigin && origin !== canonicalOrigin) reasons.push('ORIGIN_NOT_ALLOWLISTED');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export class LocalPreviewAutoAuth {
  constructor(options, { now = () => Date.now() } = {}) {
    this.now = now;
    this.enabled = options.enabled === true;
    this.instanceId = options.instanceId || null;
    this.candidateCommit = options.candidateCommit || null;
    this.canonicalOrigin = options.canonicalOrigin || null;
    this.capabilitySha256 = options.capabilitySha256 || null;
    this.bootstrapTtlMs = options.bootstrapTtlMs || 60_000;
    this.sessionTtlMs = options.sessionTtlMs || 30 * 60_000;
    this.startedAt = this.now();
    this.bootstrapExpiresAt = this.startedAt + this.bootstrapTtlMs;
    this.consumed = false;
  }

  status() {
    const expired = this.enabled && !this.consumed && this.now() >= this.bootstrapExpiresAt;
    return Object.freeze({
      enabled: this.enabled,
      effective: this.enabled && !expired,
      reason: this.enabled ? (this.consumed ? 'BOOTSTRAP_CONSUMED' : expired ? 'BOOTSTRAP_EXPIRED' : 'ACTIVE') : 'DISABLED',
      instanceId: this.enabled ? this.instanceId : null,
      candidateCommit: this.enabled ? this.candidateCommit : null,
      canonicalOrigin: this.enabled ? this.canonicalOrigin : null,
      bootstrapExpiresAt: this.enabled ? new Date(this.bootstrapExpiresAt).toISOString() : null,
      bootstrapConsumed: this.enabled ? this.consumed : false,
      sessionTtlMs: this.enabled ? this.sessionTtlMs : null,
    });
  }

  requestAllowed(req, options) {
    if (!this.enabled) return Object.freeze({ ready: false, reasons: Object.freeze(['DISABLED']) });
    return inspectLocalPreviewBoundary(req, this.canonicalOrigin, options);
  }

  consume({ token, instanceId, candidateCommit, req }) {
    if (!this.enabled) return { ok: false, error: 'PREVIEW_AUTO_AUTH_DISABLED' };
    const boundary = this.requestAllowed(req, { requireOrigin: true });
    if (!boundary.ready) return { ok: false, error: 'PREVIEW_BOUNDARY_REJECTED', reasons: boundary.reasons };
    if (this.now() >= this.bootstrapExpiresAt) return { ok: false, error: 'PREVIEW_CAPABILITY_EXPIRED' };
    if (this.consumed) return { ok: false, error: 'PREVIEW_CAPABILITY_REPLAYED' };
    if (instanceId !== this.instanceId) return { ok: false, error: 'PREVIEW_INSTANCE_MISMATCH' };
    if (candidateCommit !== this.candidateCommit) return { ok: false, error: 'PREVIEW_CANDIDATE_MISMATCH' };
    if (!equalHex(sha256(token), this.capabilitySha256)) {
      return { ok: false, error: 'PREVIEW_CAPABILITY_INVALID' };
    }
    this.consumed = true;
    return { ok: true };
  }
}
