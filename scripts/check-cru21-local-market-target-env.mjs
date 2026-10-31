// Pure validation of the AI-disabled deployment target. No application, store or TLS loading.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const scope = 'MARKET_RESEARCH_AI_DISABLED';
const reject = code => { throw new Error(code); };
const winPath = value => {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value)
      || /[\r\n\0<>"|?*]/.test(value) || value.slice(2).includes(':')
      || value.slice(3).split(/[\\/]/).some(part => /[ .]$/.test(part))) reject('ROUTING_PATH_INVALID');
  return path.win32.resolve(value).toLowerCase();
};

function parseWindowsEnvironment(text) {
  const result = Object.create(null);
  for (const [name, value] of Object.entries(parseEnv(text))) {
    const key = name.toUpperCase();
    if (Object.hasOwn(result, key)) reject('ENVIRONMENT_CASE_COLLISION');
    result[key] = value;
  }
  return result;
}

// A bound evidence reference is necessary, but is not proof of trust or a successful login.
// The deployment controller must independently verify that evidence before any cutover.
function permitsSecureCookieUpgrade(plan, original, target) {
  if (target.COOKIE_SECURE !== '1') reject('SECURE_COOKIE_REQUIRED');
  if (target.COOKIE_SECURE === original.COOKIE_SECURE) {
    if (plan.cookieMigration != null) reject('COOKIE_MIGRATION_NOT_APPLICABLE');
    return false;
  }
  const migration = plan.cookieMigration;
  if (original.COOKIE_SECURE !== '0' || !migration || typeof migration !== 'object' || Array.isArray(migration)
      || migration.schema !== 'cru21-secure-cookie-migration-v1'
      || migration.from !== '0' || migration.to !== '1' || migration.ownerApproved !== true
      || migration.candidateHead !== plan.head
      || migration.httpsOrigin !== 'https://127.0.0.1:8787'
      || !/^[a-f0-9]{64}$/.test(migration.transportEvidenceSha256 || '')) reject('COOKIE_MIGRATION_APPROVAL_REQUIRED');
  return true;
}

export function assertLocalMarketTargetEnvironment(plan, targetText, originalText) {
  if (plan?.schema !== 'cru21-rollout-plan-v4-local-market' || plan.scope !== scope
      || !/^[a-f0-9]{40}$/.test(plan.head || '')) reject('PLAN_SCHEMA_INVALID');
  const target = parseWindowsEnvironment(targetText), original = parseWindowsEnvironment(originalText);
  const formal = winPath(plan.formal), primary = winPath(plan.primary);
  if (formal === primary || formal.startsWith(primary + '\\') || primary.startsWith(formal + '\\')
      || winPath(plan.oldRuntimeRoot) !== formal
      || winPath(plan.readDataRoot) !== winPath(path.win32.join(primary, 'data'))
      || winPath(plan.producerDataRoot) !== winPath(path.win32.join(formal, 'data'))) reject('ROOT_BINDING_INVALID');
  for (const [key, expected] of Object.entries({ HOST:'127.0.0.1', PORT:'8787', MOCK_DATA:'0', NODE_ENV:'production',
    ASK_GPT_INLINE_ENABLED:'0', COOKIE_SECURE:'1', DASHBOARD_RELEASE_SCOPE:scope })) {
    if (target[key] !== expected) reject('TARGET_CONFIGURATION_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(plan.tlsCertSha256 || '') || target.DASHBOARD_TLS_CERT_SHA256 !== plan.tlsCertSha256
      || winPath(target.DASHBOARD_TLS_BUNDLE) !== winPath(plan.tlsBundle)) reject('TLS_IDENTITY_INVALID');
  if (!original.DASHBOARD_PASSWORD_HASH || target.DASHBOARD_PASSWORD_HASH !== original.DASHBOARD_PASSWORD_HASH) reject('AUTHENTICATION_CHANGED');
  const cookieUpgrade = permitsSecureCookieUpgrade(plan, original, target);
  for (const key of ['TRUST_PROXY', 'SESSION_TTL_MINUTES', 'REMEMBER_SESSION_DAYS']) {
    if (target[key] !== original[key]) reject('AUTHENTICATION_CONFIGURATION_CHANGED');
  }
  if (![undefined, '', '0', 'false'].includes(target.TRUST_PROXY)
      || ![undefined, '', '0'].includes(target.CRU21_GUEST_ENABLED)
      || ![undefined, '', '1'].includes(target.NODE_TLS_REJECT_UNAUTHORIZED)) reject('UNSAFE_RUNTIME_MODE');
  const forbidden = /^(DASHBOARD_PREVIEW_|CRU55_|FORWARD_SHADOW_)/;
  const forbiddenKeys = new Set(['ASK_GPT_CANDIDATE_READ_ROOT', 'DASHBOARD_ENV_PATH', 'DASHBOARD_RUNTIME_COMMIT',
    'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SYSTEMROOT', 'WINDIR', 'PATH',
    'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
    'CRU34_SNAPSHOT_ARTIFACT_PATH', 'CRU34_SNAPSHOT_FRESHNESS_CUTOFF']);
  for (const [key, value] of Object.entries(target)) {
    if (value && (forbidden.test(key) || forbiddenKeys.has(key))) reject('INCOMPATIBLE_ROUTING');
  }
  const expectedPaths = {
    DASHBOARD_FORMAL_READ_ROOT: plan.readDataRoot,
    TX_CHART_DATA_ROOT: plan.readDataRoot,
    TX_CHART_CACHE_ROOT: path.win32.join(formal, 'data/dashboard-chart-cache'),
    CRU34_LIVE_DATA_ROOT: plan.producerDataRoot,
    CRU34_LIVE_SNAPSHOT_PATH: path.win32.join(plan.producerDataRoot, 'runtime/cru34-live/latest.json'),
    CRU34_LIVE_STATUS_PATH: path.win32.join(plan.producerDataRoot, 'runtime/cru34-live/status.json'),
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (winPath(target[key]) !== winPath(expected)) reject('READ_ROOT_OR_PRODUCER_ROUTING_CHANGED');
  }
  const mutable = new Set(['HOST', 'PORT', 'MOCK_DATA', 'NODE_ENV', 'ASK_GPT_INLINE_ENABLED',
    'DASHBOARD_RELEASE_SCOPE', 'DASHBOARD_TLS_BUNDLE', 'DASHBOARD_TLS_CERT_SHA256', ...Object.keys(expectedPaths)]);
  if (cookieUpgrade) mutable.add('COOKIE_SECURE');
  for (const key of new Set([...Object.keys(original), ...Object.keys(target)])) {
    if (!mutable.has(key) && target[key] !== original[key]) reject('UNRELATED_CONFIGURATION_CHANGED');
  }
  return Object.freeze({ ready:true, formalOnly:true, scope, credentialsPrinted:false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) reject('USAGE');
    const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    assertLocalMarketTargetEnvironment(plan, fs.readFileSync(process.argv[3], 'utf8'), fs.readFileSync(process.argv[4], 'utf8'));
    console.log('LOCAL_MARKET_TARGET_ROUTING_PASS');
  } catch {
    // Never echo paths, values, password hashes or parser excerpts.
    console.error('LOCAL_MARKET_TARGET_ROUTING_REJECTED');
    process.exitCode = 2;
  }
}
