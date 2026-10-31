// Pure configuration parsing: no application import, env mutation, ACL, account or network action.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const reject = code => { throw new Error(code); };
const winPath = value => {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || /[\r\n\0]/.test(value)) reject('ROUTING_PATH_INVALID');
  return path.win32.resolve(value).toLowerCase();
};

// Windows treats environment names case-insensitively, even when tests run on Linux.
function parseWindowsEnvironment(text) {
  const result = Object.create(null);
  for (const [name, value] of Object.entries(parseEnv(text))) {
    const key = name.toUpperCase();
    if (Object.hasOwn(result, key)) reject('ENVIRONMENT_CASE_COLLISION');
    result[key] = value;
  }
  return result;
}

// This validates a reviewed migration attestation, not HTTPS reachability or Owner identity.
// Deployment still requires the existing exact-version hard gates and private evidence review.
function permitsSecureCookieUpgrade(plan, original, target) {
  if (target.COOKIE_SECURE !== '1') reject('SECURE_COOKIE_REQUIRED');
  const changed = target.COOKIE_SECURE !== original.COOKIE_SECURE;
  const migration = plan.cookieMigration;
  if (!changed) {
    if (migration != null) reject('COOKIE_MIGRATION_NOT_APPLICABLE');
    return false;
  }
  if (original.COOKIE_SECURE !== '0' || !migration || typeof migration !== 'object' || Array.isArray(migration)
      || migration.schema !== 'cru21-secure-cookie-migration-v1'
      || migration.from !== '0' || migration.to !== '1' || migration.ownerApproved !== true
      || typeof plan.head !== 'string' || !/^[a-f0-9]{40}$/.test(plan.head)
      || migration.candidateHead !== plan.head
      || typeof migration.transportEvidenceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(migration.transportEvidenceSha256)) {
    reject('COOKIE_MIGRATION_APPROVAL_REQUIRED');
  }
  let origin;
  try { origin = new URL(migration.httpsOrigin); } catch { reject('COOKIE_MIGRATION_HTTPS_EVIDENCE_REQUIRED'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.origin !== migration.httpsOrigin) reject('COOKIE_MIGRATION_HTTPS_EVIDENCE_REQUIRED');
  return true;
}

export function assertFormalTargetEnvironment(plan, targetText, originalText) {
  if (plan?.schema !== 'cru21-rollout-plan-v3-formal-only') reject('PLAN_SCHEMA_INVALID');
  const target = parseWindowsEnvironment(targetText), original = parseWindowsEnvironment(originalText);
  const formal = winPath(plan.formal), primary = winPath(plan.primary);
  if (formal === primary || winPath(plan.oldRuntimeRoot) !== formal
      || winPath(plan.readDataRoot) !== winPath(path.win32.join(primary, 'data'))
      || winPath(plan.producerDataRoot) !== winPath(path.win32.join(formal, 'data'))) reject('ROOT_BINDING_INVALID');
  for (const [key, expected] of Object.entries({ HOST:'127.0.0.1', PORT:'8787', MOCK_DATA:'0', NODE_ENV:'production', ASK_GPT_INLINE_ENABLED:'1' })) {
    if (target[key] !== expected) reject('TARGET_CONFIGURATION_INVALID');
  }
  if (!original.DASHBOARD_PASSWORD_HASH || target.DASHBOARD_PASSWORD_HASH !== original.DASHBOARD_PASSWORD_HASH) reject('AUTHENTICATION_CHANGED');
  // Original backup bytes remain immutable. Only an explicit 0 -> 1 cookie upgrade may differ.
  const cookieUpgrade = permitsSecureCookieUpgrade(plan, original, target);
  for (const key of ['TRUST_PROXY', 'SESSION_TTL_MINUTES', 'REMEMBER_SESSION_DAYS']) {
    if (target[key] !== original[key]) reject('AUTHENTICATION_CONFIGURATION_CHANGED');
  }
  const forbidden = /^(DASHBOARD_PREVIEW_|CRU55_|FORWARD_SHADOW_)/;
  for (const [key, value] of Object.entries(target)) {
    if (value && (forbidden.test(key) || ['ASK_GPT_CANDIDATE_READ_ROOT','DASHBOARD_ENV_PATH','DASHBOARD_RUNTIME_COMMIT','LOCALAPPDATA','NODE_OPTIONS','CRU34_SNAPSHOT_ARTIFACT_PATH','CRU34_SNAPSHOT_FRESHNESS_CUTOFF'].includes(key))) reject('INCOMPATIBLE_ROUTING');
  }
  if ((target.CRU21_GUEST_ENABLED && target.CRU21_GUEST_ENABLED !== '0') || target.NODE_TLS_REJECT_UNAUTHORIZED === '0') reject('UNSAFE_RUNTIME_MODE');
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
  // Only the declared formal read/cache/Producer bindings and activation below may change.
  const mutable = new Set(['HOST','PORT','MOCK_DATA','NODE_ENV','ASK_GPT_INLINE_ENABLED', ...Object.keys(expectedPaths)]);
  if (cookieUpgrade) mutable.add('COOKIE_SECURE');
  for (const key of new Set([...Object.keys(original), ...Object.keys(target)])) {
    if (!mutable.has(key) && target[key] !== original[key]) reject('UNRELATED_CONFIGURATION_CHANGED');
  }
  return Object.freeze({ ready:true, formalOnly:true, credentialsPrinted:false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) reject('USAGE');
    const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    assertFormalTargetEnvironment(plan, fs.readFileSync(process.argv[3], 'utf8'), fs.readFileSync(process.argv[4], 'utf8'));
    console.log('FORMAL_ONLY_TARGET_ROUTING_PASS');
  } catch {
    // Never echo configuration content, paths, passwords or parser error excerpts.
    console.error('FORMAL_ONLY_TARGET_ROUTING_REJECTED');
    process.exitCode = 2;
  }
}
