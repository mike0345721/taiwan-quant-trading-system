import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const cru55Candidate = process.env.CRU55_INTEGRATION_CANDIDATE === '1';
const candidateData = path.join(appRoot, 'data/cru55-private/integration-runtime');

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
  cru55Candidate,
  dataDir: cru55Candidate ? candidateData : path.join(appRoot, 'data'),
  historyDir: cru55Candidate ? path.join(candidateData, 'history') : path.join(appRoot, 'data', 'history'),
  // Explicit read-only research inputs; never redirected to the caller cwd.
  v2DatabasePath: path.resolve(appRoot, process.env.V2_RESEARCH_DATABASE_PATH || 'v2/data/research-v2.sqlite'),
  v2ReportPath: path.resolve(appRoot, process.env.V2_BACKTEST_REPORT_PATH || 'v2/reports/latest-backtest.json'),
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
});

export function validateConfig() {
  if (!config.passwordHash && config.nodeEnv === 'production') {
    throw new Error('正式環境必須設定 DASHBOARD_PASSWORD_HASH');
  }
  if (config.host === '0.0.0.0' && !config.passwordHash) {
    throw new Error('對外監聽時必須設定 DASHBOARD_PASSWORD_HASH');
  }
}
