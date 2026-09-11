import crypto from 'node:crypto';
import fs from 'node:fs';

const SCRYPT_PREFIX = 'scrypt-v1';
const KEY_LENGTH = 64;

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('密碼至少需要 12 個字元');
  }
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${SCRYPT_PREFIX}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [prefix, saltB64, hashB64] = String(encoded || '').split('$');
    if (prefix !== SCRYPT_PREFIX || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    if (expected.length !== KEY_LENGTH) return false;
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export class SessionStore {
  constructor(ttlMs, { filePath = null } = {}) {
    this.ttlMs = ttlMs;
    this.filePath = filePath;
    this.sessions = new Map();
    this.#load();
  }

  #key(id) {
    return crypto.createHash('sha256').update(String(id || '')).digest('base64url');
  }

  #load() {
    if (!this.filePath) return;
    try {
      const rows = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const now = Date.now();
      for (const [key, session] of Object.entries(rows || {})) {
        if (session?.expiresAt > now && session?.csrf) this.sessions.set(key, session);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('[sessions] Could not load saved sessions');
    }
  }

  #save() {
    if (!this.filePath) return;
    const rows = Object.fromEntries(this.sessions);
    fs.writeFileSync(this.filePath, `${JSON.stringify(rows, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  create(ip, ttlMs = this.ttlMs, metadata = {}) {
    const id = randomToken(32);
    const csrf = randomToken(24);
    const now = Date.now();
    const session = { id, csrf, ip, createdAt: now, ttlMs, expiresAt: now + ttlMs,
      metadata: { ...metadata } };
    this.sessions.set(this.#key(id), { ...session, id: undefined });
    this.#save();
    return session;
  }

  get(id) {
    if (!id) return null;
    const session = this.sessions.get(this.#key(id));
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(this.#key(id));
      this.#save();
      return null;
    }
    return { ...session, id };
  }

  delete(id) {
    if (id && this.sessions.delete(this.#key(id))) this.#save();
  }

  cleanup() {
    const now = Date.now();
    let changed = false;
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) { this.sessions.delete(key); changed = true; }
    }
    if (changed) this.#save();
  }
}

export class LoginRateLimiter {
  constructor({ windowMs = 15 * 60_000, maxAttempts = 5 } = {}) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
    this.entries = new Map();
  }

  check(ip) {
    const now = Date.now();
    const entry = this.entries.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(ip, { attempts: 0, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.attempts >= this.maxAttempts) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  fail(ip) {
    const now = Date.now();
    const entry = this.entries.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(ip, { attempts: 1, resetAt: now + this.windowMs });
    } else {
      entry.attempts += 1;
    }
  }

  success(ip) {
    this.entries.delete(ip);
  }
}

export function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

function validCookieName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(String(name || ''))) throw new Error('INVALID_COOKIE_NAME');
  return name;
}

export function sessionCookie(sessionId, { secure = true, maxAgeSeconds = 28_800,
  name = 'twchip_session' } = {}) {
  const parts = [
    `${validCookieName(name)}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = true, name = 'twchip_session' } = {}) {
  const parts = [`${validCookieName(name)}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
