// Fixed AI-disabled candidate contract. This does not authorize a live window.
import path from 'node:path';
import fs from 'node:fs';

export const MARKET_CANDIDATE_SCOPE = 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE';
export const MARKET_CANDIDATE_PREVIEW = 'CRU21_MARKET_RESEARCH_CANDIDATE';
export const MARKET_CANDIDATE_BRANCH = 'codex/cru61-daily-use-repair-20261103';
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const fail = code => { throw Error(code); };

export function assertMarketCandidateMode(env, config) {
  const selected = env.DASHBOARD_RELEASE_SCOPE === MARKET_CANDIDATE_SCOPE;
  if (!selected) {
    if (env.DASHBOARD_PREVIEW_TYPE === MARKET_CANDIDATE_PREVIEW || env.DASHBOARD_CANDIDATE_READ_ROOT)
      fail('MARKET_CANDIDATE_SCOPE_REQUIRED');
    return false;
  }
  if (config.host !== '127.0.0.1' || config.port !== 18723 || config.nodeEnv !== 'production'
      || config.mockData !== false || config.cookieSecure !== true || config.trustProxy !== false
      || config.cru55Candidate || config.cru55Acceptance || env.ASK_GPT_INLINE_ENABLED !== '0'
      || env.DASHBOARD_PREVIEW_TYPE !== MARKET_CANDIDATE_PREVIEW
      || env.DASHBOARD_PREVIEW_BRANCH !== MARKET_CANDIDATE_BRANCH
      || !sha(env.DASHBOARD_PREVIEW_EXPECTED_HEAD) || !sha(env.DASHBOARD_PREVIEW_EXPECTED_TREE)
      || !sha(env.DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN)
      || ![undefined, '', '0'].includes(env.CRU21_GUEST_ENABLED)
      || Object.entries(env).some(([key, value]) => value && /^(CRU55_|FORWARD_SHADOW_)/i.test(key))
      || Object.entries(env).some(([key, value]) => value && /^GIT_/i.test(key))
      || env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
      || ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
        'DASHBOARD_FORMAL_READ_ROOT', 'ASK_GPT_CANDIDATE_READ_ROOT', 'DASHBOARD_RUNTIME_COMMIT',
        'DATA_OPERATIONS_MANIFEST_PATH', 'CRU34_SNAPSHOT_ARTIFACT_PATH', 'CRU34_SNAPSHOT_FRESHNESS_CUTOFF']
        .some(key => env[key])) fail('MARKET_CANDIDATE_MODE_REJECTED');
  if (!path.isAbsolute(env.DASHBOARD_TLS_BUNDLE || '') || /^[\\/]{2}/.test(env.DASHBOARD_TLS_BUNDLE || '')
      || !hash(env.DASHBOARD_TLS_BUNDLE_SHA256) || !hash(env.DASHBOARD_TLS_CERT_SHA256))
    fail('MARKET_CANDIDATE_TLS_IDENTITY_REQUIRED');
  return true;
}

export function assertMarketCandidateRoots({ sourceRoot, privateDataRoot, readDataRoot, producerDataRoot, chartCacheRoot } = {}) {
  const input = { sourceRoot, privateDataRoot, readDataRoot, producerDataRoot, chartCacheRoot };
  if (Object.values(input).some(value => typeof value !== 'string' || !path.isAbsolute(value)
      || /^[\\/]{2}/.test(value) || /[\0\r\n]/.test(value))) fail('MARKET_CANDIDATE_ROOT_REQUIRED');
  const roots = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, path.resolve(value)]));
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const equal = (left, right) => normalized(left) === normalized(right);
  const inside = (left, right) => { const relative = path.relative(normalized(left), normalized(right));
    return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  if (!equal(roots.privateDataRoot, path.join(roots.sourceRoot, 'data'))
      || !equal(roots.chartCacheRoot, path.join(roots.privateDataRoot, 'dashboard-chart-cache'))
      || [[roots.sourceRoot, roots.readDataRoot], [roots.sourceRoot, roots.producerDataRoot],
        [roots.readDataRoot, roots.producerDataRoot]].some(([left, right]) => inside(left, right) || inside(right, left)))
    fail('MARKET_CANDIDATE_SPLIT_ROOT_REJECTED');
  return Object.freeze(roots);
}

export function assertMarketCandidateEnvironmentRoots(env, config) {
  const roots = assertMarketCandidateRoots({ sourceRoot: config.appRoot, privateDataRoot: config.dataDir,
    readDataRoot: env.DASHBOARD_CANDIDATE_READ_ROOT, producerDataRoot: env.CRU34_LIVE_DATA_ROOT,
    chartCacheRoot: env.TX_CHART_CACHE_ROOT });
  const expected = { TX_CHART_DATA_ROOT: roots.readDataRoot,
    CRU34_LIVE_SNAPSHOT_PATH: path.join(roots.producerDataRoot, 'runtime/cru34-live/latest.json'),
    CRU34_LIVE_STATUS_PATH: path.join(roots.producerDataRoot, 'runtime/cru34-live/status.json'),
    V2_RESEARCH_DATABASE_PATH: path.join(roots.readDataRoot, 'v2/data/research-v2.sqlite'),
    V2_BACKTEST_REPORT_PATH: path.join(roots.readDataRoot, 'v2/reports/latest-backtest.json'),
    DATA_OPERATIONS_OUTPUT_ROOT: path.join(roots.readDataRoot, 'quality/daily-data-operations') };
  if (Object.entries(expected).some(([key, value]) => typeof env[key] !== 'string'
      || !path.isAbsolute(env[key]) || path.resolve(env[key]) !== value)) fail('MARKET_CANDIDATE_INPUT_ROUTING_REJECTED');
  return roots;
}

// Read-only preflight of the existing, host-provisioned namespace. Native
// admission must retain no-untrusted-writer/rename protections through exit;
// a JS path check cannot provide that operating-system lifetime guarantee.
export function assertMarketCandidateFilesystemRoots(roots, io = fs) {
  const equal = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  const inspect = (target, directory, optional = false) => {
    let current = target;
    for (;;) {
      let st;
      try { st = io.lstatSync(current); }
      catch (error) { if (optional && current === target && error.code === 'ENOENT') return; throw Error('MARKET_CANDIDATE_PATH_UNAVAILABLE'); }
      if (st.isSymbolicLink() || (current === target ? directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1 : !st.isDirectory()))
        fail('MARKET_CANDIDATE_PATH_ALIAS');
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
    if (!equal(path.resolve(io.realpathSync(target)), path.resolve(target))) fail('MARKET_CANDIDATE_PATH_ALIAS');
  };
  for (const dir of [roots.sourceRoot, roots.readDataRoot, roots.producerDataRoot, roots.privateDataRoot,
    roots.chartCacheRoot, path.join(roots.privateDataRoot, 'decision-workspace')]) inspect(dir, true);
  inspect(path.join(roots.privateDataRoot, 'sessions.json'), false, true);
  for (const dir of [roots.chartCacheRoot, path.join(roots.privateDataRoot, 'decision-workspace')]) {
    for (const name of io.readdirSync(dir)) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') fail('MARKET_CANDIDATE_PATH_ALIAS');
      inspect(path.join(dir, name), false);
    }
  }
  return true;
}

export function buildMarketCandidateVersion({ runtimeVersion, branch, dataMode } = {}) {
  return Object.freeze({ ...runtimeVersion, productVersion: 'CRU-21 Scenario Watch',
    previewType: MARKET_CANDIDATE_PREVIEW, previewLabel: '候選審查 · AI 停用 · 尚未批准交付',
    releaseScope: MARKET_CANDIDATE_SCOPE, branch, exactHead: runtimeVersion?.runtimeCommit,
    buildCommit: runtimeVersion?.runtimeCommit, exactTree: runtimeVersion?.runtimeTree,
    buildTree: runtimeVersion?.runtimeTree, baseMainCommit: runtimeVersion?.approvedMainCommit,
    dataMode, aiEnabled: false, complete: false, deliveryAccepted: false });
}

export function validateMarketCandidateVersionTruth(version, { expectedHead, expectedTree, actualTree,
  expectedBaseMain, actualBranch, sourceClean, host, port, inlineEnabled, candidateReadRoot, actualDataMode } = {}) {
  const reasons = [];
  if (version?.previewType !== MARKET_CANDIDATE_PREVIEW || version?.releaseScope !== MARKET_CANDIDATE_SCOPE)
    reasons.push('MARKET_CANDIDATE_TYPE_MISMATCH');
  if (host !== '127.0.0.1' || port !== 18723 || inlineEnabled !== false || !candidateReadRoot)
    reasons.push('MARKET_CANDIDATE_BOUNDARY_REJECTED');
  if (!sha(expectedHead) || [version?.runtimeCommit, version?.exactHead, version?.buildCommit].some(value => value !== expectedHead))
    reasons.push('MARKET_CANDIDATE_HEAD_MISMATCH');
  if (!sha(expectedTree) || actualTree !== expectedTree
      || [version?.runtimeTree, version?.exactTree, version?.buildTree].some(value => value !== expectedTree))
    reasons.push('MARKET_CANDIDATE_TREE_MISMATCH');
  if (!sha(expectedBaseMain) || version?.approvedMainCommit !== expectedBaseMain || version?.baseMainCommit !== expectedBaseMain)
    reasons.push('MARKET_CANDIDATE_BASE_MISMATCH');
  if (actualBranch !== MARKET_CANDIDATE_BRANCH || version?.branch !== actualBranch) reasons.push('MARKET_CANDIDATE_BRANCH_MISMATCH');
  if (sourceClean !== true) reasons.push('MARKET_CANDIDATE_DIRTY_SOURCE');
  if (actualDataMode !== 'LIVE' || version?.dataMode !== 'LIVE' || version?.complete !== false
      || version?.deliveryAccepted !== false || version?.aiEnabled !== false) reasons.push('MARKET_CANDIDATE_TRUTH_INVALID');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

// All collection, child-script and AI routes are refused before dispatch. The
// remaining private writes keep the original normal Session and CSRF checks.
export function marketCandidateRouteAllowed(method, pathname) {
  if (pathname.startsWith('/api/v1/ask-gpt/') && pathname !== '/api/v1/ask-gpt/status') return false;
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && ['/api/auth/login', '/api/auth/logout', '/api/v1/decision-journal',
    '/api/v1/decision-journal/outcomes', '/api/v1/cru46-browser-runtime-proof'].includes(pathname);
}

export function marketCandidateQueryAllowed(url) {
  if (!['/api/v1/tx-chart', '/api/v1/market-changes'].includes(url.pathname)) return true;
  if ([...url.searchParams.keys()].some(key => !['timeframe','mode','tradeDate','session','actualContract','asOf'].includes(key)
      || url.searchParams.getAll(key).length !== 1)) return false;
  const date = url.searchParams.get('tradeDate');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z'))
      || new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date)) return false;
  const allowed = {timeframe:['1m','5m','15m','30m','1h','4h','1D'],mode:['LIVE','REPLAY'],session:['DAY','NIGHT']};
  if (Object.entries(allowed).some(([key, values]) => url.searchParams.has(key) && !values.includes(url.searchParams.get(key)))) return false;
  const contract = url.searchParams.get('actualContract'), asOf = url.searchParams.get('asOf');
  return (!contract || /^[A-Z0-9]{1,24}$/.test(contract))
    && (!asOf || /^\d{4}-\d{2}-\d{2}T/.test(asOf) && Number.isFinite(Date.parse(asOf)));
}

export function marketCandidateBrowserBindingMatches(candidate, {exactHead, exactTree, runtimeStartedAt}) {
  return candidate?.candidateScope === MARKET_CANDIDATE_SCOPE && candidate?.previewType === MARKET_CANDIDATE_PREVIEW
    && candidate?.origin === 'https://127.0.0.1:18723' && candidate?.exactHead === exactHead
    && candidate?.exactTree === exactTree && candidate?.runtimeStartedAt === runtimeStartedAt;
}
