import fs from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function setSecurityHeaders(res, { isHttps = false } = {}) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (isHttps) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readJson(req, { maxBytes = 16_384 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

export async function serveStatic(res, publicDir, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.posix.normalize(requested).replace(/^\.\.\/(?:\.\.\/)+/, '');
  const absolute = path.resolve(publicDir, `.${normalized}`);
  const base = path.resolve(publicDir) + path.sep;
  if (!absolute.startsWith(base) && absolute !== path.resolve(publicDir, 'index.html')) return false;
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return false;
    const body = await fs.readFile(absolute);
    const type = MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      // This is a local private dashboard. Always serve the newest UI code so
      // users do not need to restart the server after front-end changes.
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

export function requestIsHttps(req, trustProxy = false) {
  if (req.socket.encrypted) return true;
  if (trustProxy) return String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return false;
}
