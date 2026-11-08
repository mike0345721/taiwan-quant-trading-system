// Explicit interactive HTTP proposal. No TLS/native approval or durable consent receipt.
import path from 'node:path';
import { assertCandidateModeBoundary, assertCandidateRoots, MARKET_CANDIDATE_BRANCH } from './cru21-market-candidate.mjs';
import { hashPassword } from './security.mjs';
import { resolveOwnerResearchRoot } from './owner-local-research-root.mjs';
import { ownerJournalRoot } from './owner-local-journal.mjs';
export { assertOwnerJournalFilesystemRoots } from './owner-local-journal.mjs';

export const OWNER_SCOPE = 'OWNER_LOCAL_ACCEPTANCE_HTTP_V1';
export const OWNER_PREVIEW = 'OWNER_LOCAL_ACCEPTANCE_HTTP';
export const OWNER_ORIGIN = 'http://localhost:18723';
export const OWNER_COOKIE = 'twchip_owner_local_http_v1';
export const OWNER_RISK_VERSION = 'owner-local-http-risk-v1';
export const OWNER_NOTICE = 'Owner local acceptance v1 | HTTP | NOT PRODUCTION | NOT LIVE QUALIFIED | No TLS encryption/server identity. Do not share or forward. Secure cookie browser behavior requires Owner verification.';
let admission = null;
let stopHandler = null;
let stopping = false;

export function assertOwnerConsent(input) {
  if (input?.accepted !== true || input.riskVersion !== OWNER_RISK_VERSION
      || typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 1024)
    throw Error('OWNER_INTERACTIVE_CONSENT_AND_PASSWORD_REQUIRED');
}

// Called only by the stdin launcher after its interactive dialog and binding checks.
// This is a process-local trust boundary, not protection against same-user code modification.
export function admitOwner(input, binding, runId) {
  assertOwnerConsent(input);
  if (admission || !/^[a-f0-9-]{36}$/.test(runId)) throw Error('OWNER_ADMISSION_REJECTED');
  admission = Object.freeze({ passwordHash: hashPassword(input.password), binding: Object.freeze({ ...binding }), runId });
  input.password = '';
  return admission;
}

export function ownerAdmission() { return admission; }
export function assertOwnerSelected(env) {
  if (env.DASHBOARD_RELEASE_SCOPE !== OWNER_SCOPE) {
    if (env.DASHBOARD_PREVIEW_TYPE === OWNER_PREVIEW) throw Error('OWNER_SCOPE_REQUIRED');
    return false;
  }
  if (!admission || stopping) throw Error('OWNER_INTERACTIVE_ADMISSION_REQUIRED');
  return true;
}
export function assertOwnerMode(env, config) {
  if (!assertOwnerSelected(env)) return false;
  assertCandidateModeBoundary(env, config, OWNER_PREVIEW);
  if (Object.keys(env).some(key => /^DASHBOARD_TLS_/i.test(key) && env[key])
      || config.passwordHash !== admission.passwordHash || !config.candidateReadOnly
      || env.DASHBOARD_CANDIDATE_V2_BINDING || env.REFRESH_INTERVAL_SECONDS !== '0')
    throw Error('OWNER_MODE_REJECTED');
  const b = admission.binding;
  if (config.appRoot !== b.sourceRoot || env.DASHBOARD_CANDIDATE_READ_ROOT !== b.readDataRoot
      || env.CRU34_LIVE_DATA_ROOT !== b.producerDataRoot
      || env.DASHBOARD_PREVIEW_EXPECTED_HEAD !== b.expectedHead
      || env.DASHBOARD_PREVIEW_EXPECTED_TREE !== b.expectedTree
      || env.DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN !== b.expectedBaseMain)
    throw Error('OWNER_BINDING_REJECTED');
  const researchRoot = resolveOwnerResearchRoot(b);
  if (env.V2_RESEARCH_DATABASE_PATH !== path.join(researchRoot, 'data/research-v2.sqlite')
      || env.V2_BACKTEST_REPORT_PATH !== path.join(researchRoot, 'reports/latest-backtest.json')
      || config.v2DatabasePath !== env.V2_RESEARCH_DATABASE_PATH || config.v2ReportPath !== env.V2_BACKTEST_REPORT_PATH)
    throw Error('OWNER_RESEARCH_ROUTING_REJECTED');
  return true;
}
export function assertOwnerRoots(input) {
  if (!admission) throw Error('OWNER_INTERACTIVE_ADMISSION_REQUIRED');
  const roots = assertCandidateRoots(input, path.join('data', 'owner-local-acceptance', admission.runId));
  return Object.freeze({ ...roots, researchRoot: resolveOwnerResearchRoot(admission.binding),
    journalRoot: ownerJournalRoot(admission.binding) });
}
export function validateOwnerIdentity({ expectedHead, expectedTree, expectedBaseMain, actualHead,
  actualTree, actualBaseMain, actualBranch, sourceClean }) {
  const ready = [expectedHead, expectedTree, expectedBaseMain].every(v => /^[a-f0-9]{40}$/.test(v || ''))
    && expectedHead === actualHead && expectedTree === actualTree && expectedBaseMain === actualBaseMain
    && actualBranch === MARKET_CANDIDATE_BRANCH && sourceClean === true;
  return Object.freeze({ ready, reasons: ready ? [] : ['OWNER_SOURCE_IDENTITY_REJECTED'] });
}
export function buildOwnerVersion({ runtimeVersion, branch }) {
  return Object.freeze({ ...runtimeVersion, productVersion: 'Owner local acceptance v1',
    previewType: OWNER_PREVIEW, previewLabel: OWNER_NOTICE, releaseScope: OWNER_SCOPE, branch,
    exactHead: runtimeVersion.runtimeCommit, exactTree: runtimeVersion.runtimeTree,
    transport: 'HTTP', dataMode: 'UNQUALIFIED', aiEnabled: false, complete: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    deliveryAccepted: false, dataQualificationDeclared: false, httpsQualified: false, nativeQualified: false,
    secureCookieBrowserVerification: 'NOT_RUN', lifecycle: 'OWNER_INTERACTIVE_NO_HARD_DEADLINE' });
}

export function ownerRequestAllowed(req) {
  const h = req.headers || {};
  const names = (req.rawHeaders || []).filter((_, index) => index % 2 === 0).map(name => name.toLowerCase());
  if (['host', 'origin', 'sec-fetch-site'].some(name => names.filter(value => value === name).length > 1)) return false;
  if (req.socket?.remoteAddress !== '127.0.0.1' || h.host !== 'localhost:18723'
      || typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')
      || /[\\\r\n]/.test(req.url)
      || Object.keys(h).some(k => /^(?:forwarded|x-forwarded(?:-.*)?|x-real-ip|via)$/i.test(k))) return false;
  if (h.origin !== undefined && h.origin !== OWNER_ORIGIN) return false;
  if (h['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(h['sec-fetch-site'])) return false;
  let url;
  try { url = new URL(req.url, OWNER_ORIGIN); } catch { return false; }
  if (url.origin !== OWNER_ORIGIN || /%2f|%5c/i.test(url.pathname)) return false;
  const api = url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/healthz';
  if (h.referer !== undefined) {
    try { if (new URL(h.referer).origin !== OWNER_ORIGIN) return false; } catch { return false; }
  }
  if (api) {
    if (h['sec-fetch-site'] !== 'same-origin') return false;
    // Same-origin GET may omit Origin and Referer (the product uses no-referrer).
    // Fetch Metadata is browser-controlled; never use CORS to authorize another origin.
    if (h.origin !== OWNER_ORIGIN && req.method !== 'GET') return false;
  }
  return ['GET', 'HEAD', 'POST'].includes(req.method);
}

export function attachOwnerStop(handler) {
  stopHandler = handler;
  if (stopping) handler();
}
export function stopOwner() {
  if (stopping) return;
  stopping = true;
  stopHandler?.();
}
export function ownerStopping() { return stopping; }
