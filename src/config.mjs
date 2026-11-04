import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManagedConfig } from './cru55-managed-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
// Explicit reader boundary; absent/0 preserves the existing formal behavior.
const candidateReadOnly = process.env.DASHBOARD_CANDIDATE_READ_ONLY;
if (candidateReadOnly && !['0', '1'].includes(candidateReadOnly)) throw Error('CANDIDATE_READ_ONLY_FLAG_INVALID');
const candidateV2Binding = process.env.DASHBOARD_CANDIDATE_V2_BINDING || '';
if (candidateV2Binding && (candidateV2Binding !== 'GOVERNED_ACTIVE_V1' || candidateReadOnly !== '1')) throw Error('CANDIDATE_V2_BINDING_INVALID');
// Refuse incompatible managed inputs before opening an acceptance/binding file.
if (process.env.DASHBOARD_RELEASE_SCOPE && Object.entries(process.env)
  .some(([key,value]) => value && /^(CRU55_|FORWARD_SHADOW_)/i.test(key))) throw Error('LOCAL_MARKET_MODE_REJECTED');
if (process.env.CRU21_GUEST_ENABLED && !['0','1'].includes(process.env.CRU21_GUEST_ENABLED)) throw Error('GUEST_FLAG_INVALID');
// Reject incompatible modes before evaluating any managed acceptance file.
if (process.env.CRU21_GUEST_ENABLED === '1' && ['CRU55_ACCEPTANCE_CONFIG','CRU55_INTEGRATION_CANDIDATE','CRU55_RUNTIME_BINDING','CRU55_DYNAMIC_ROOT','DASHBOARD_FORMAL_READ_ROOT','FORWARD_SHADOW_RUNTIME_ROOT']
  .some(key => process.env[key] && !(key === 'CRU55_INTEGRATION_CANDIDATE' && process.env[key] === '0'))) throw Error('GUEST_INCOMPATIBLE_MODE');
const cru55Candidate = process.env.CRU55_INTEGRATION_CANDIDATE === '1';
const candidateRun = process.env.CRU55_RUN_ID || '';
if (cru55Candidate && !/^run-[0-9]{13}-[a-f0-9]{12}$/.test(candidateRun)) throw Error('CRU55_RUN_ID_REQUIRED');
const candidateData = path.join(appRoot, 'data/cru55-private/integration-runtime', candidateRun);
const acceptance=process.env.CRU55_ACCEPTANCE_CONFIG?readManagedConfig(process.env.CRU55_ACCEPTANCE_CONFIG,{runtimeRoot:appRoot,candidate:true}):null;
if(acceptance&&(cru55Candidate||process.env.CRU55_RUNTIME_BINDING||process.env.HOST!=='127.0.0.1'
  ||path.resolve(process.env.CRU55_DYNAMIC_ROOT||'')!==acceptance.readerRoot))throw Error('CRU55_ACCEPTANCE_ROUTING');
const acceptanceData=acceptance?path.join(appRoot,'data/cru55-dynamic/acceptance',acceptance.runId):null;
if(acceptance){
  const expected={TX_CHART_DATA_ROOT:acceptanceData,TX_CHART_CACHE_ROOT:path.join(acceptanceData,'dashboard-chart-cache'),CRU34_LIVE_DATA_ROOT:acceptanceData,
    CRU34_LIVE_SNAPSHOT_PATH:path.join(acceptanceData,'runtime/cru34-live/latest.json'),CRU34_LIVE_STATUS_PATH:path.join(acceptanceData,'runtime/cru34-live/status.json'),
    V2_RESEARCH_DATABASE_PATH:path.join(acceptanceData,'v2/data/research-v2.sqlite'),V2_BACKTEST_REPORT_PATH:path.join(acceptanceData,'v2/reports/latest-backtest.json'),DATA_OPERATIONS_OUTPUT_ROOT:path.join(acceptanceData,'quality/daily-data-operations')};
  if(Object.entries(expected).some(([key,value])=>path.resolve(process.env[key]||'')!==value)||process.env.FORWARD_SHADOW_RUNTIME_ROOT)throw Error('CRU55_ACCEPTANCE_INPUT_ROUTING');
}

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
  cru55Acceptance: acceptance,
  candidateReadOnly: candidateReadOnly === '1',
  candidateV2Binding,
  dataDir: acceptanceData || (cru55Candidate ? candidateData : path.join(appRoot, 'data')),
  historyDir: path.join(acceptanceData || (cru55Candidate ? candidateData : path.join(appRoot,'data')), 'history'),
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
