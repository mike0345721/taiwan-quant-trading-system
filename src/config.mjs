import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} 必須是 ${min}～${max} 的整數`);
  }
  return value;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

export const config = Object.freeze({
  appRoot,
  publicDir: path.join(appRoot, 'public'),
  dataDir: path.resolve(process.env.DASHBOARD_DATA_ROOT || path.join(appRoot, 'data')),
  stateDir: path.resolve(process.env.DASHBOARD_STATE_DIR || process.env.DASHBOARD_DATA_ROOT || path.join(appRoot, 'data')),
  historyDir: path.resolve(process.env.DASHBOARD_DATA_ROOT || path.join(appRoot, 'data'), 'history'),
  host: process.env.HOST || '127.0.0.1',
  port: intEnv('PORT', 8787, 1, 65535),
  nodeEnv: process.env.NODE_ENV || 'production',
  passwordHash: process.env.DASHBOARD_PASSWORD_HASH || '',
  sessionTtlMs: intEnv('SESSION_TTL_MINUTES', 480, 5, 1440) * 60_000,
  rememberedSessionTtlMs: intEnv('REMEMBER_SESSION_DAYS', 30, 1, 90) * 86_400_000,
  refreshIntervalMs: intEnv('REFRESH_INTERVAL_SECONDS', 300, 0, 86_400) * 1000,
  upstreamTimeoutMs: intEnv('UPSTREAM_TIMEOUT_MS', 12_000, 1_000, 60_000),
  trustProxy: boolEnv('TRUST_PROXY', false),
  cookieSecure: boolEnv('COOKIE_SECURE', true),
  mockData: boolEnv('MOCK_DATA', false),
  previewType: process.env.DASHBOARD_PREVIEW_TYPE || '',
  previewAutoAuthRequested: boolEnv('DASHBOARD_PREVIEW_AUTO_AUTH', false),
  previewInstanceId: process.env.DASHBOARD_PREVIEW_INSTANCE_ID || '',
  previewExpectedCommit: String(process.env.DASHBOARD_PREVIEW_EXPECTED_COMMIT || '').toLowerCase(),
  previewBootstrapSha256: String(process.env.DASHBOARD_PREVIEW_BOOTSTRAP_SHA256 || '').toLowerCase(),
  previewCanonicalOrigin: process.env.DASHBOARD_PREVIEW_CANONICAL_ORIGIN || '',
  previewBootstrapTtlMs: intEnv('DASHBOARD_PREVIEW_BOOTSTRAP_TTL_SECONDS', 60, 1, 300) * 1000,
  previewSessionTtlMs: intEnv('DASHBOARD_PREVIEW_SESSION_TTL_MINUTES', 30, 5, 60) * 60_000,
});

export function validateConfig() {
  if (!config.passwordHash && config.nodeEnv === 'production') {
    throw new Error('正式環境必須設定 DASHBOARD_PASSWORD_HASH');
  }
  if (config.host === '0.0.0.0' && !config.passwordHash) {
    throw new Error('對外監聽時必須設定 DASHBOARD_PASSWORD_HASH');
  }
  if (config.previewAutoAuthRequested) {
    const expectedOrigin = `http://127.0.0.1:${config.port}`;
    const valid = config.nodeEnv !== 'production'
      && Boolean(config.passwordHash)
      && config.previewType === 'CRU47_OWNER_PREVIEW'
      && config.host === '127.0.0.1'
      && config.trustProxy === false
      && config.cookieSecure === false
      && /^[A-Za-z0-9_-]{16,128}$/.test(config.previewInstanceId)
      && /^[0-9a-f]{40}$/.test(config.previewExpectedCommit)
      && /^[0-9a-f]{64}$/.test(config.previewBootstrapSha256)
      && config.previewCanonicalOrigin === expectedOrigin;
    if (!valid) throw new Error('LOCAL_PREVIEW_AUTO_AUTH_CONFIG_INVALID');
  }
}
