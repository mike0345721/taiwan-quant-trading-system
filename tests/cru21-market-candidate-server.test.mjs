// Trusted current source, captured HTTP callback and synthetic dependencies.
// This VM is not a sandbox for arbitrary JS. TLS/native FS/Browser are NOT_RUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { observedFlowAtChart } from '../src/dashboard-observed-flow.mjs';
import { ownerJournalRoot, ownerJournalBinding } from '../src/owner-local-journal.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const actualNames = ['server.mjs', 'src/security.mjs', 'src/http-utils.mjs',
  'src/owner-local-acceptance.mjs', 'src/owner-local-research-root.mjs', 'src/owner-local-journal.mjs',
  'src/cru21-market-candidate.mjs', 'src/dashboard-source-binding.mjs',
  'src/candidate-market-inputs.mjs', 'src/data-quality.mjs',
  'src/dashboard-data-health.mjs', 'src/dashboard-decision-workspace.mjs',
  'src/dashboard-dw4-evidence.mjs', 'src/dw4-evidence-conflict-monitor.mjs',
  'src/index-leadership.mjs', 'src/decision-level-watch.mjs', 'src/structural-eligibility.mjs',
  'src/decision-quality-p0.mjs', 'src/scenario-target-diagnostics.mjs',
  'src/market-observation-journal.mjs', 'src/market-observation-core.mjs',
  'src/cvd-observation-core.mjs', 'src/tx-intraday-pressure-path-efficiency.mjs',
  'src/volume-profile-core.mjs', 'src/market-structure-core.mjs'];
const source = Object.fromEntries(actualNames.map(name => [name, fs.readFileSync(path.join(sourceRoot, name), 'utf8')]));
const sourceHashes = Object.fromEntries(Object.entries(source).map(([name, bytes]) =>
  [name, crypto.createHash('sha256').update(bytes).digest('hex')]));
const head = '1'.repeat(40), tree = '2'.repeat(40), base = '3'.repeat(40);
const branch = 'codex/cru61-smc-cvd-profile-v1';
const appRoot = path.resolve('/synthetic-app'), readRoot = path.resolve('/synthetic-read');
const producerRoot = path.resolve('/synthetic-producer'), dataRoot = path.join(appRoot, 'data');
const sessionFile = path.join(dataRoot, 'sessions.json');
const futuresAuditFile = path.join(readRoot, 'live-events/futures-audits/latest.json');
// Fresh synthetic login input; no reusable account credential is kept in source.
const password = crypto.randomBytes(32).toString('base64url');
const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const passwordHash = 'scrypt-v1$' + salt.toString('base64url') + '$' + crypto.scryptSync(password, salt, 64,
  { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
const unavailable = reason => ({ state: 'UNAVAILABLE', status: 'UNAVAILABLE', ready: false,
  reason, researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false,
  recommendation: false, systemDirectionalSignal: false });

// Newly constructed test data, never read from a market file or a live source.
function syntheticMarketInputs() {
  const availableAt = new Date().toISOString();
  const identity = { actualContract: 'TXFK6', tradeDate: '2026-11-02', session: 'DAY' };
  const bar = { ...identity, time: availableAt, open: 100,
    high: 102, low: 99, close: 101, volume: 7 };
  const chart = { schemaVersion: 'governed-tx-decision-chart-v2', syntheticFixture: true,
    mode: 'LIVE', status: 'READY', qualityStatus: 'PASS', ...identity, timeframe: '5m', availableAt, asOf: availableAt,
    bars: [bar], vwap: [], levels: {}, lastPrice: bar.close };
  const flow = { schemaVersion: 'dashboard-observed-flow-v1', syntheticFixture: true,
    sourceState: 'LIVE', identity, source: { sourceMode: 'LIVE', availableAt, observedAt: availableAt,
      validUntil: new Date(Date.parse(availableAt) + 60000).toISOString() },
    windows: { primary60s: { status: 'READY', truthState: 'LIVE', pressure: { status: 'READY',
      pressureRatio: 0.25, classifiedCoverage: 1, totalExecutedVolume: 7 },
      response: { status: 'READY', displacementPoints: 1 }, pathEfficiency: { status: 'READY', value: 0.5 } } },
    researchQuality: { status: 'PASS' }, formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false, recommendation: false, systemDirectionalSignal: false };
  return { chart, flow };
}

function harness({ env: envPatch = {}, config: configPatch = {}, observed = {}, nodeVersion=process.versions.node,
  owner = false, consent = true } = {}) {
  const runId = '12345678-1234-1234-1234-123456789abc';
  const dataRoot = path.join(appRoot, owner ? 'data/owner-local-acceptance/' + runId : 'data');
  const sessionFile = path.join(dataRoot, 'sessions.json');
  let effectivePasswordHash = passwordHash;
  const counters = { network: 0, bridge: 0, spawn: 0, marketConstructor: 0, marketRefresh: 0,
    cacheConstructor: 0, cacheInit: 0, cacheRead: 0, cacheWrite: 0, intervals: 0,
    credential: 0, aiOperation: 0, forbiddenOther: 0, tlsCapture: 0, fsReads: [], fsWrites: [], git: [], chartSelections: [] };
  const memory = new Map([[sessionFile, Buffer.from('{}\n')]]);
  const directories = new Set([appRoot, readRoot, producerRoot, dataRoot,
    path.join(dataRoot, 'dashboard-chart-cache'), path.join(dataRoot, 'decision-workspace')]);
  const journalBinding = { sourceRoot: appRoot, readDataRoot: readRoot, producerDataRoot: producerRoot };
  const journalRoot = ownerJournalRoot(journalBinding), journalManifest = path.join(journalRoot, 'binding.json');
  if (owner) {
    directories.add(journalRoot); directories.add(path.join(journalRoot, 'decision-workspace'));
    memory.set(journalManifest, Buffer.from(JSON.stringify(ownerJournalBinding(journalBinding)) + '\n'));
  }
  for (const dir of [...directories]) {
    let current = dir;
    for (;;) { directories.add(current); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  }
  let handler = null, intent = null;
  const startup = [];
  const deny = category => {
    if (Object.hasOwn(counters, category)) counters[category]++;
    else counters.forbiddenOther++;
    throw Error('SYNTHETIC_FORBIDDEN_' + category);
  };
  const env = { DASHBOARD_RELEASE_SCOPE: 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE',
    DASHBOARD_PREVIEW_TYPE: 'CRU21_MARKET_RESEARCH_CANDIDATE', DASHBOARD_PREVIEW_BRANCH: branch,
    DASHBOARD_PREVIEW_EXPECTED_HEAD: head, DASHBOARD_PREVIEW_EXPECTED_TREE: tree,
    DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN: base, ASK_GPT_INLINE_ENABLED: '0', CRU21_GUEST_ENABLED: '0',
    DASHBOARD_TLS_BUNDLE: path.resolve('/synthetic-tls/candidate.dpapi'), DASHBOARD_TLS_BUNDLE_SHA256: 'b'.repeat(64),
    DASHBOARD_TLS_CERT_SHA256: 'a'.repeat(64), DASHBOARD_CANDIDATE_READ_ROOT: readRoot,
    TX_CHART_DATA_ROOT: readRoot, TX_CHART_CACHE_ROOT: path.join(dataRoot, 'dashboard-chart-cache'),
    CRU34_LIVE_DATA_ROOT: producerRoot, CRU34_LIVE_SNAPSHOT_PATH: path.join(producerRoot, 'runtime/cru34-live/latest.json'),
    CRU34_LIVE_STATUS_PATH: path.join(producerRoot, 'runtime/cru34-live/status.json'),
    V2_RESEARCH_DATABASE_PATH: path.join(readRoot, 'v2/data/research-v2.sqlite'),
    V2_BACKTEST_REPORT_PATH: path.join(readRoot, 'v2/reports/latest-backtest.json'),
    DATA_OPERATIONS_OUTPUT_ROOT: path.join(readRoot, 'quality/daily-data-operations'),
    ...(owner ? {DASHBOARD_RELEASE_SCOPE:'OWNER_LOCAL_ACCEPTANCE_HTTP_V1',DASHBOARD_PREVIEW_TYPE:'OWNER_LOCAL_ACCEPTANCE_HTTP',
      REFRESH_INTERVAL_SECONDS:'0',DASHBOARD_TLS_BUNDLE:'',DASHBOARD_TLS_BUNDLE_SHA256:'',DASHBOARD_TLS_CERT_SHA256:''} : {}), ...envPatch };
  const config = Object.freeze({ appRoot, publicDir: path.join(appRoot, 'public'), dataDir: dataRoot,
    historyDir: path.join(dataRoot, 'history'), host: '127.0.0.1', port: 18723, nodeEnv: 'production',
    get passwordHash() { return effectivePasswordHash; }, candidateReadOnly:owner,
    v2DatabasePath: env.V2_RESEARCH_DATABASE_PATH, v2ReportPath: env.V2_BACKTEST_REPORT_PATH,
    cookieSecure: true, mockData: false, trustProxy: false, cru55Candidate: false, cru55Acceptance: null,
    sessionTtlMs: 300000, rememberedSessionTtlMs: 600000, refreshIntervalMs: 300000, upstreamTimeoutMs: 1000,
    ...configPatch });
  const readMemory = (name, encoding) => {
    counters.fsReads.push(name);
    assert.ok([sessionFile, futuresAuditFile, ...(owner ? [journalManifest] : [])].includes(name), 'Only the private Session, bound Owner manifest or fixed synthetic input audit may be read');
    const bytes = memory.get(name);
    if (!bytes) throw Object.assign(Error('Synthetic file missing'), { code: 'ENOENT' });
    return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
  };
  const memoryFs = new Proxy({
    readFileSync: readMemory,
    writeFileSync(name, content) {
      assert.equal(name, sessionFile, 'all persistent writes must remain private Session writes');
      counters.fsWrites.push(name); memory.set(name, Buffer.from(content));
    },
    existsSync(name) {
      assert.equal(name, path.join(readRoot, 'market-state/forward-shadow/governance/taifex-official-calendar-exception.json'));
      return false;
    },
    lstatSync(name) {
      assert.ok(directories.has(name) || memory.has(name), 'Only the synthetic namespace may be inspected: ' + name);
      return { isSymbolicLink: () => observed.namespaceAlias === name,
        isDirectory: () => directories.has(name), isFile: () => memory.has(name), nlink: 1 };
    },
    statSync(name) { assert.ok(owner && name === journalManifest); return { size: memory.get(name).length }; },
    realpathSync(name) {
      assert.ok(directories.has(name) || memory.has(name)); return name;
    },
    readdirSync(name) {
      assert.ok([path.join(dataRoot, 'dashboard-chart-cache'), path.join(dataRoot, 'dashboard-chart-cache/market-observation'), path.join(dataRoot, 'decision-workspace'),
        ...(owner ? [journalRoot, path.join(journalRoot, 'decision-workspace')] : [])].includes(name));
      return [...new Set([...directories,...memory.keys()])].filter(p=>p!==name&&path.dirname(p)===name).map(p=>path.basename(p));
    },
  }, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : () => deny('filesystem:' + String(key)); } });
  const memoryPromises = new Proxy({}, { get() { return async () => deny('filesystem-promises'); } });
  const never = () => deny('unmodeled-domain');
  const bridge = () => deny('bridge');
  const off = () => unavailable('SYNTHETIC_INPUT_UNAVAILABLE');
  const mocks = {
    'src/config.mjs': { config, validateConfig() { assert.equal(config.nodeEnv, 'production'); assert.equal(config.passwordHash, effectivePasswordHash); } },
    'src/cache-store.mjs': { CacheStore: class {
      constructor(options) { counters.cacheConstructor++; assert.equal(options.dataDir, readRoot); assert.equal(options.historyDir, path.join(readRoot, 'history')); }
      async init() { counters.cacheInit++; throw Error('Candidate must not initialize a read-only source cache'); }
      async loadLatest() { counters.cacheRead++; return observed.snapshot ? structuredClone(observed.snapshot) : null; }
      async listHistory() { return []; }
      async save() { return deny('cacheWrite'); }
    } },
    'src/market-data.mjs': { MarketDataService: class {
      constructor() { deny('marketConstructor'); }
      async refresh() { return deny('marketRefresh'); }
    } },
    'src/ask-gpt-inline-service.mjs': { InlineAssistant: class {
      constructor(options) { assert.equal(options.enabled, false); }
      connection() { return { enabled: false, storeState: 'DISABLED', credentialsLoaded: false }; }
      async close() {}
      ensure() { return deny('credential'); }
      loadAccounts() { return deny('credential'); }
      models() { return deny('aiOperation'); }
      run() { return deny('aiOperation'); }
      startSetup() { return deny('aiOperation'); }
    } },
    'src/ask-gpt-inline-http.mjs': { createInlineHandler({ assistant }) {
      return async (req, res, url) => {
        if (!url.pathname.startsWith('/api/v1/ask-gpt/')) return false;
        if (req.method !== 'GET' || url.pathname !== '/api/v1/ask-gpt/status') return deny('aiOperation');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: assistant.connection() })); return true;
      };
    } },
    'src/cru21-preview-contract.mjs': { buildCru21PreviewVersion: never, validateCru21PreviewVersionTruth: never },
    'src/derived-metrics.mjs': { enrichSnapshot: snapshot => snapshot },
    'src/signal-engine.mjs': { buildSignal: never },
    'src/six-axis-shadow.mjs': { buildSixAxisShadow: off },
    'src/backtest.mjs': { backtestComponents: never },
    'src/v2-research.mjs': { V2ResearchService: class {
      decisionSupport() { return off(); }
      dailyUpdateStatus() { return off(); }
      query() { return off(); }
      backtestReport() { return off(); }
    } },
    'src/dashboard-v2-reader-binding.mjs': { createGovernedV2Reader: () => null },
    'src/dashboard-data-operations-reader-identity.mjs': { readDataOperationsReaderIdentity: off },
    'src/intraday-confirmation.mjs': { loadPriceConfirmation: off },
    'src/intraday-replay-catalog.mjs': { listReplayDays: () => [], loadCatalogReplay: () => ({ totalBars: 0 }) },
    'src/market-feed.mjs': { marketFeedReadiness: off },
    'src/shioaji-bridge-client.mjs': { inspectIx0001Leadership: bridge, inspectShioajiBridge: bridge, inspectShioajiLatest: bridge },
    'v2/src/trading-costs.mjs': { costScenarios: () => [] },
    'src/dashboard-data-operations.mjs': { readDataOperations: off },
    'src/data-operations-binding.mjs': { resolveOperationsReader: off },
    'src/dashboard-runtime-truth.mjs': { readDashboardRuntimeTruth: never },
    'src/decision-journal.mjs': { appendDecisionJournal: never, readDecisionJournal: () => [], appendDecisionOutcome: never, readDecisionOutcomes: () => [] },
    'src/market-state-forward-shadow-calendar.mjs': { loadGovernedTradingCalendar: off },
    'src/taifex-market-operation.mjs': { assessTaifexMarketSession: off },
    'src/operating-calendar.mjs': { loadOperatingCalendar: off },
    'src/dashboard-tx-chart-service.mjs': { createTxChartService(options) {
      assert.equal(options.dataRoot, readRoot); assert.equal(options.cacheRoot, path.join(dataRoot, 'dashboard-chart-cache'));
      const result = () => observed.chart ? structuredClone(observed.chart) : off();
      return { async load(selection) {
        counters.chartSelections.push(structuredClone(selection));
        if (selection?.observation === true) {
          if(observed.persistObservationNamespace){
            const dir=path.join(dataRoot,'dashboard-chart-cache/market-observation');directories.add(dir);
            memory.set(path.join(dir,'a'.repeat(64)+'.producer-fragment.observation.sqlite'),Buffer.from('SYNTHETIC_NAMESPACE_ONLY'));
          }
          return observed.observation ? structuredClone(observed.observation) : off();
        }
        if (observed.chartError) return off();
        return result();
      }, peek: result, async close() { return deny('close'); } };
    }, continuationPending: () => false },
    // WP 0-2 background catch-up: in this harness start() issues the single startup
    // warm request the server made before 0-2, and schedules no timer of its own.
    'src/dashboard-tx-chart-pump.mjs': { createTxChartPump(options) {
      return { start() { void options.load(); }, stop() {} };
    } },
    'src/daily-batch-verdict.mjs': { buildDailyBatchVerdict: () => null },
    'src/cru55-formal-entry.mjs': { prepareFormalEntry: never },
    'src/market-change-feed.mjs': { buildMarketChangeFeed: () => ({ events: [] }), chartMarkersFromEvents: () => [] },
    'src/runtime-identity.mjs': {
      readRuntimeIdentity(root, options) {
        assert.equal(root, appRoot); return { status: 'VERIFIED', commit: options?.ref ? observed.base ?? base : observed.head ?? head };
      },
      buildRuntimeVersionStatus({ runtimeIdentity, approvedMainIdentity, runtimeStartedAt }) {
        return { runtimeCommit: runtimeIdentity.commit, approvedMainCommit: approvedMainIdentity.commit,
          runtimeStartedAt, syncState: 'MISMATCH' };
      },
      validateFormalRuntimeVersionTruth: never,
    },
    'src/dashboard-integration-contract.mjs': { buildCru44PreviewVersion: never, buildIntegrationPreviewVersion: never,
      CRU44_PRODUCT_SURFACE_CONTRACT: {}, CRU46_PRODUCT_SURFACE_CONTRACT: {},
      selectDashboardProductSurface: () => ({ synthetic: true, deliveryAccepted: false }),
      validateCru44PreviewVersionTruth: never, validateIntegrationPreviewVersionTruth: never },
    'src/dashboard-live-breadth-source.mjs': { loadIx0001BreadthForWorkspace: off },
    'src/dashboard-observed-flow.mjs': { observedFlowAtChart, loadDashboardObservedFlow: () => observed.flow ? structuredClone(observed.flow) : off() },
    'src/dashboard-research-evidence.mjs': { buildResearchEvidence: off, readLatestResearchQuote: off, readResearchResult: off },
    'src/dashboard-flow-refresh.mjs': { loadFlowRefresh: () => {
      if (observed.flowError) throw Error('SYNTHETIC_FLOW_SOURCE_FAILURE');
      return observed.flow ? structuredClone(observed.flow) : off();
    } },
    'src/market-pulse-live.mjs': { buildMarketPulseLive({ bridgeLatest }) { return unavailable(bridgeLatest.reason); } },
    'src/dashboard-runtime-readiness.mjs': {
      buildCru46Readiness: () => ({ runtimeReady: { parity: off() }, identityReady: true, runtimePreflightReady: false,
        ownerPreviewReady: false }),
      inspectChartPayload: off, inspectChartVendorRuntime: off, inspectCru34LiveProducer: off,
      inspectObservedFlowPayload: off, normalizeBrowserRuntimeProof: never, validateBrowserRuntimeParity: off,
      validateBrowserRuntimeProof: off,
    },
    'src/dashboard-local-tls.mjs': {
      assertLocalMarketMode: never,
      createDashboardServer(callback, candidateEnv, candidateConfig) {
        counters.tlsCapture++;
        assert.equal(candidateEnv.DASHBOARD_RELEASE_SCOPE, 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE');
        assert.equal(candidateConfig.cookieSecure, true); assert.equal(handler, null); handler = callback;
        return { listen(port, host, ready) {
          assert.equal(port, 18723); assert.equal(host, '127.0.0.1'); intent = { host, port };
          startup.push(Promise.resolve().then(() => ready?.())); return this;
        }, close() { return deny('close'); } };
      },
    },
  };
  const child = {
    spawn() { return deny('spawn'); },
    execFileSync(executable, args) {
      assert.equal(executable, 'git'); counters.git.push(args.join(' '));
      assert.equal(JSON.stringify(args.slice(0, 5)), '["--no-optional-locks","-c","core.fsmonitor=false","-c","core.untrackedCache=false"]');
      const command = args.slice(5);
      if (owner && JSON.stringify(command) === '["rev-parse","HEAD"]') return observed.head ?? head;
      if (owner && JSON.stringify(command) === '["rev-parse","refs/heads/main"]') return observed.base ?? base;
      if (JSON.stringify(command) === '["rev-parse","HEAD^{tree}"]') return observed.tree ?? tree;
      if (JSON.stringify(command) === '["branch","--show-current"]') return observed.branch ?? branch;
      if (JSON.stringify(command) === '["status","--porcelain"]') return observed.dirty ? ' M synthetic-source\n' : '';
      return deny('spawn');
    },
  };
  const network = new Proxy({}, { get() { return () => deny('network'); } });
  const ownerHttp = { createServer(callback) {
    assert.equal(handler,null); handler=callback;
    return {listen(port,host,ready){assert.equal(port,18723);assert.equal(host,'127.0.0.1');
      intent={host,port};startup.push(Promise.resolve().then(()=>ready?.()));return this;},close(){deny('close');}};
  } };
  const builtins = { 'node:http': { default: owner ? ownerHttp : network }, 'node:crypto': { default: crypto, createHash: crypto.createHash },
    'node:fs': { default: memoryFs }, 'node:fs/promises': { default: memoryPromises },
    'node:path': { default: path }, 'node:url': { URL }, 'node:child_process': child };
  const context = vm.createContext({ Buffer, URL, TextEncoder, TextDecoder, AbortController, AbortSignal,
    structuredClone, process: Object.freeze({ env: Object.freeze(env), execPath: '/synthetic/node', platform: process.platform, versions:{...process.versions,node:nodeVersion},
      on(signal) { assert.ok(['SIGINT', 'SIGTERM'].includes(signal)); }, exit() { return deny('exit'); } }),
    fetch() { return deny('network'); }, console: Object.freeze({ log() {}, warn() {}, error() {} }),
    setInterval() { return deny('intervals'); }, clearInterval() {},
    setTimeout(fn) { queueMicrotask(fn); return { unref() {} }; }, clearTimeout() {},
  }, { codeGeneration: { strings: false, wasm: false } });
  const modules = new Map();
  function module(id) {
    if (modules.has(id)) return modules.get(id);
    let result;
    if (Object.hasOwn(source, id)) {
      result = new vm.SourceTextModule(source[id], { context, identifier: id,
        initializeImportMeta(meta) { meta.url = pathToFileURL(path.join(appRoot, id)).href; },
        importModuleDynamically() { return deny('dynamic-import'); } });
    } else {
      const exports = builtins[id] || mocks[id];
      assert.ok(exports, 'Every dependency must be explicitly closed: ' + id);
      result = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context, identifier: id });
    }
    modules.set(id, result); return result;
  }
  async function start() {
    assert.equal(typeof vm.SourceTextModule, 'function', 'Run with --experimental-vm-modules');
    const main = module('server.mjs');
    await main.link((specifier, referencing) => module(specifier.startsWith('node:') ? specifier
      : path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier), specifier))));
    if (owner && consent) {
      const admission = module('src/owner-local-acceptance.mjs'); await admission.evaluate();
      effectivePasswordHash = admission.namespace.admitOwner({accepted:true,riskVersion:'owner-local-http-risk-v1',password},
        {sourceRoot:appRoot,readDataRoot:readRoot,producerDataRoot:producerRoot,expectedHead:head,expectedTree:tree,expectedBaseMain:base},runId).passwordHash;
    }
    await main.evaluate({ timeout: 5000 }); await Promise.all(startup);
    assert.equal(typeof handler, 'function'); return intent;
  }
  async function dispatch(method, route, { body, cookie, csrf, headers:headerPatch={}, remoteAddress='127.0.0.1' } = {}) {
    assert.equal(typeof handler, 'function');
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: route, socket: { remoteAddress, encrypted: !owner },
      headers: { host: '127.0.0.1:18723', origin: 'https://127.0.0.1:18723', 'content-type': 'application/json',
        ...(owner ? {host:'localhost:18723',origin:'http://localhost:18723','sec-fetch-site':'same-origin'} : {}),
        ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headerPatch } });
    const headers = {}, chunks = []; let status = null;
    const res = { setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code, values = {}) { status = code; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
      end(value = '') { chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); } };
    await handler(req, res); assert.equal(typeof status, 'number');
    const raw = Buffer.concat(chunks).toString('utf8');
    return { status, headers, raw, json: () => JSON.parse(raw) };
  }
  async function login() {
    const response = await dispatch('POST', '/api/auth/login', { body: { password } });
    assert.equal(response.status, 200);
    return { response, cookie: response.headers['set-cookie'].split(';')[0], csrf: response.json().csrfToken };
  }
  return { start, dispatch, login, counters, memory };
}

function noExternalEffects(h) {
  for (const name of ['network', 'bridge', 'spawn', 'marketConstructor', 'marketRefresh', 'cacheInit',
    'cacheWrite', 'intervals', 'credential', 'aiOperation', 'forbiddenOther']) assert.equal(h.counters[name], 0, name);
  assert.ok(h.counters.fsReads.every(name => [sessionFile, futuresAuditFile].includes(name)));
  assert.ok(h.counters.fsWrites.every(name => name === sessionFile));
}

test('Owner scope cannot start from environment without interactive process admission', async () => {
  const h=harness({owner:true,consent:false});
  await assert.rejects(h.start(),/OWNER_INTERACTIVE_ADMISSION_REQUIRED/);
  assert.equal(h.counters.cacheConstructor,0);assert.deepEqual(h.counters.fsWrites,[]);assert.equal(h.counters.tlsCapture,0);
});

test('Owner HTTP uses the original handler/auth with dedicated cookie and no HTTPS qualification', async () => {
  const h=harness({owner:true});await h.start();
  assert.equal(h.counters.tlsCapture,0);
  for(const options of [{headers:{host:'127.0.0.1:18723'}},{headers:{origin:'http://localhost:8787'}},
    {headers:{'sec-fetch-site':'cross-site'}},{headers:{forwarded:'for=127.0.0.1'}},{remoteAddress:'192.0.2.1'}]) {
    assert.equal((await h.dispatch('POST','/api/auth/login',{body:{password},...options})).status,403);
  }
  assert.deepEqual(h.counters.fsWrites,[]);
  assert.equal((await h.dispatch('POST','/api/auth/login',{body:{password:'wrong'}})).status,401);
  const auth=await h.login();assert.match(auth.cookie,/^twchip_owner_local_http_v1=/);
  assert.match(auth.response.headers['set-cookie'],/Secure/);assert.match(auth.response.headers['set-cookie'],/HttpOnly/);
  assert.match(auth.response.headers['set-cookie'],/SameSite=Strict/);
  for(const name of ['twchip_session','twchip_candidate_session','cru55_main_session']) {
    const foreign=auth.cookie.replace('twchip_owner_local_http_v1',name);
    assert.equal((await h.dispatch('GET','/api/session',{cookie:foreign})).json().authenticated,false);
  }
  assert.equal((await h.dispatch('GET','/api/session',auth)).json().authenticated,true);
  assert.equal((await h.dispatch('POST','/api/auth/logout',{cookie:auth.cookie})).status,403);
  for(const route of ['/api/v1/refresh','/api/v2/daily-update','/api/v1/ask-gpt/setup','/api/v1/cru46-browser-runtime-proof'])
    assert.equal((await h.dispatch('POST',route,{...auth,body:{}})).status,403);
  const health=(await h.dispatch('GET','/healthz')).json();
  assert.equal(health.candidateRelease,null);assert.equal(health.localRelease,null);
  assert.equal(health.versionTruth.transport,'HTTP');assert.equal(health.versionTruth.dataMode,'UNQUALIFIED');
  assert.equal(health.runtimeReady.ready,false);assert.equal(health.ownerPreviewReady.ready,false);
  assert.equal(health.ownerLocalAcceptance.secureCookieBrowserVerification,'NOT_RUN');
  assert.equal((await h.dispatch('POST','/api/auth/logout',{...auth,body:{}})).status,200);
  assert.equal((await h.dispatch('GET','/api/session',auth)).json().authenticated,false);
  assert.ok(h.counters.fsWrites.every(p=>p.includes(path.join('data','owner-local-acceptance'))));
  for(const k of ['network','bridge','spawn','marketConstructor','marketRefresh','cacheInit','cacheWrite','intervals','credential','aiOperation'])
    assert.equal(h.counters[k],0,k);
});

for(const patch of [{HOST:'0.0.0.0'}, {DASHBOARD_RELEASE_SCOPE:'MARKET_RESEARCH_AI_DISABLED_CANDIDATE'},
  {DASHBOARD_TLS_BUNDLE:'/foreign-tls'}, {ASK_GPT_INLINE_ENABLED:'1'}]) {
  test('Owner invalid mode fails before initialization: '+JSON.stringify(patch),async()=>{
    const h=harness({owner:true,env:patch,...(patch.HOST?{config:{host:patch.HOST}}:{})});
    await assert.rejects(h.start());assert.equal(h.counters.cacheConstructor,0);assert.deepEqual(h.counters.fsWrites,[]);
  });
}

test('captured current server starts with no collection, Bridge, timer, child or account effect', async t => {
  t.diagnostic('Actual source SHA256: ' + JSON.stringify(sourceHashes));
  t.diagnostic('Evidence class: captured callback + memory FS; TLS/native filesystem/Browser NOT_RUN. Other domains are explicit synthetic mocks.');
  const h = harness();
  assert.deepEqual(await h.start(), { host: '127.0.0.1', port: 18723 });
  assert.equal(h.counters.cacheConstructor, 1); assert.equal(h.counters.cacheRead, 1); assert.equal(h.counters.tlsCapture, 1);
  assert.deepEqual(h.counters.fsReads, [sessionFile]); assert.deepEqual(h.counters.fsWrites, []);
  noExternalEffects(h);
});

test('actual normal auth refuses wrong passwords and foreign Sessions, persists only private Secure Session', async () => {
  const h = harness(); await h.start();
  const anonymous = await h.dispatch('GET', '/api/v1/dashboard'); assert.equal(anonymous.status, 401);
  const foreign = await h.dispatch('GET', '/api/v1/dashboard', { cookie: 'twchip_session=foreign-synthetic-id' });
  assert.equal(foreign.status, 401);
  const bad = await h.dispatch('POST', '/api/auth/login', { body: { password: password + '-wrong' } });
  assert.equal(bad.status, 401); assert.equal(bad.json().error, 'INVALID_CREDENTIALS'); assert.equal(h.counters.fsWrites.length, 0);
  const { response, cookie } = await h.login();
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure']) assert.ok(response.headers['set-cookie'].includes(flag));
  assert.ok(response.headers['strict-transport-security']);
  const session = await h.dispatch('GET', '/api/session', { cookie }); assert.equal(session.json().authenticated, true);
  assert.deepEqual(h.counters.fsWrites, [sessionFile]);
  assert.ok(!h.memory.get(sessionFile).toString().includes(cookie.split('=')[1]), 'Stored Session keys are hashes, not raw cookies');
  noExternalEffects(h);
});

test('missing input snapshot remains 503 and no Bridge/upstream fallback is used', async () => {
  const h = harness(); await h.start(); const auth = await h.login();
  const dashboard = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(dashboard.status, 503); assert.equal(dashboard.json().ok, false); assert.equal(dashboard.json().data, null);
  assert.equal(dashboard.json().service.brokerMarketData.reason, 'MARKET_CANDIDATE_NO_LIVE_BRIDGE');
  for (const route of ['/api/v1/market-pulse', '/api/v1/index-leadership']) {
    const response = await h.dispatch('GET', route, auth); assert.equal(response.status, 200);
    assert.equal(response.json().data.state, 'UNAVAILABLE');
    assert.equal(response.json().data.reason, 'MARKET_CANDIDATE_NO_LIVE_BRIDGE');
  }
  noExternalEffects(h);
});

test('observation route authenticates before worker dispatch and retains exact research snapshot without side effects', async () => {
  const cutoff = '2026-11-04T01:05:00.000Z';
  const observation = { schemaVersion: 'cru61-market-observation-v1', syntheticFixture: true,
    snapshotId: 'a'.repeat(64), cutoff, timeframe: '1m', mode: 'REPLAY', status: 'OBSERVATION_CANDIDATE',
    identity: { actualContract: 'TXFK6', tradeDate: '2026-11-04', session: 'DAY',
      continuityEpoch: 'TX:1', sourceLedgerIdentity: 'sha256:' + 'b'.repeat(64) },
    price: { bars: [], last: 101 }, cvd: { value: 2, series: [{ availableAt: cutoff }],
      observedStart: cutoff, classifiedCoverage: 1, unknownVolume: 0 },
    profile: { poc: 101, vah: 101, val: 101, binSize: 1, valueAreaFraction: 0.7,
      partial: true, observedStart: cutoff, observedEnd: cutoff },
    summary: { position: 'synthetic observed fragment', force: 'BUY_PROXY', structure: 'unconfirmed',
      counterEvidence: 'shared inputs', dataStatus: 'CAPTURE_COMPLETENESS_UNPROVEN' },
    rules: { fixtureOnly: true }, reasonCodes: ['CAPTURE_COMPLETENESS_UNPROVEN'], events: [],
    researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false };
  const h = harness({ observed: { observation } }); await h.start();
  const before = h.counters.chartSelections.length;
  assert.equal((await h.dispatch('GET', '/api/v1/market-observation')).status, 401);
  assert.equal((await h.dispatch('GET', '/api/v1/market-observation', { cookie: 'twchip_session=foreign-synthetic-id' })).status, 401);
  assert.equal(h.counters.chartSelections.length, before);
  const auth = await h.login();
  const response = await h.dispatch('GET', '/api/v1/market-observation?timeframe=1m&mode=REPLAY&tradeDate=2026-11-04&session=DAY&actualContract=TXFK6&asOf=' + cutoff, auth);
  assert.equal(response.status, 200);
  assert.deepEqual(h.counters.chartSelections.slice(before), [{ observation: true, timeframe: '1m', mode: 'REPLAY',
    tradeDate: '2026-11-04', session: 'DAY', actualContract: 'TXFK6', asOf: cutoff }]);
  const { journalSnapshot, journalCopy, ...returned } = response.json().data;
  assert.deepEqual(returned, observation);
  assert.ok(journalCopy.includes(`Hash: ${journalSnapshot.snapshotHash}`));
  assert.equal(journalSnapshot.marketObservation.snapshotId, observation.snapshotId);
  assert.deepEqual(journalSnapshot.marketObservation.summary, observation.summary);
  assert.match(journalSnapshot.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(journalSnapshot.executionAuthorized, false); assert.equal(journalSnapshot.orderRoutesEnabled, false);
  const blocked = await h.dispatch('POST', '/api/v1/market-observation', { ...auth, body: { collect: true } });
  assert.equal(blocked.status, 403); assert.equal(blocked.json().error, 'MARKET_CANDIDATE_READ_ONLY');
  assert.equal((await h.dispatch('GET', '/healthz')).status, 200);
  assert.equal(h.counters.chartSelections.length, before + 1, 'blocked writes and health must not queue observation work');
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('existing chart and Flow remain visible through actual builders when the EOD cache is missing', async t => {
  t.diagnostic('Actual repaired source SHA256: ' + JSON.stringify(sourceHashes));
  const h = harness({ observed: syntheticMarketInputs() });
  await h.start(); const auth = await h.login();
  const chart = await h.dispatch('GET', '/api/v1/tx-chart', auth);
  const flow = await h.dispatch('GET', '/api/v1/observed-flow', auth);
  assert.equal(chart.status, 200); assert.equal(chart.json().data.bars.length, 1);
  assert.equal(flow.status, 200); assert.equal(flow.json().data.windows.primary60s.pressure.pressureRatio, 0.25);
  const dashboard = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(dashboard.status, 200); const body = dashboard.json();
  assert.equal(body.data, null); assert.equal(body.ok, true);
  assert.equal(body.service.degraded.status, 'PARTIAL');
  assert.equal(body.service.degraded.reason, 'EOD_SNAPSHOT_UNAVAILABLE');
  assert.equal(body.service.degraded.marketInputs.chart.observationAvailable, true);
  assert.equal(body.service.degraded.marketInputs.flow.observationAvailable, true);
  assert.equal(body.decisionWorkspace.schemaVersion, 'dashboard-decision-workspace-v1');
  assert.equal(body.decisionWorkspace.globalStatus.actualContract, 'TXFK6');
  assert.equal(body.decisionWorkspace.priceChartSlot.price.value, 101);
  assert.equal(body.decisionWorkspace.observedFlow.windows.primary60s.pressure.pressureRatio, 0.25);
  assert.equal(body.decisionWorkspace.snapshot.options.availability, 'UNAVAILABLE');
  assert.equal(body.decisionWorkspace.snapshot.breadth.availability, 'UNAVAILABLE');
  assert.deepEqual(body.decisionWorkspace.degraded, body.service.degraded);
  assert.equal(body.service.degraded.deliveryAccepted, false);
  assert.equal(body.service.degraded.dataQualificationDeclared, false);
  assert.equal(body.decisionWorkspace.snapshot.executionAuthorized, false);
  assert.equal(body.decisionWorkspace.snapshot.orderRoutesEnabled, false); noExternalEffects(h);
});

test('mock-mode cache is quarantined while existing market observations retain the partial workspace', async t => {
  t.diagnostic('Actual wrong-cache-mode repaired source SHA256: ' + JSON.stringify(sourceHashes));
  const h = harness({ observed: { ...syntheticMarketInputs(), snapshot: { dataMode: 'mock',
    generatedAt: new Date().toISOString(), syntheticWrongCache: true,
    futuresMarket: { ok: true, data: { txDay: { contract: 'TXFK6', close: 99999 } } } } } });
  await h.start(); const auth = await h.login(); const response = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(response.status, 200); const body = response.json();
  assert.equal(body.data, null); assert.equal(body.ok, true);
  assert.equal(body.service.degraded.status, 'PARTIAL');
  assert.equal(body.service.degraded.reason, 'EOD_SNAPSHOT_UNAVAILABLE');
  assert.equal(body.service.degraded.eodReason, 'EOD_SNAPSHOT_DATA_MODE_REJECTED');
  assert.equal(body.service.degraded.marketInputs.chart.observationAvailable, true);
  assert.equal(body.service.degraded.marketInputs.flow.observationAvailable, true);
  assert.equal(body.decisionWorkspace.priceChartSlot.price.value, 101);
  assert.deepEqual(body.decisionWorkspace.degraded, body.service.degraded);
  const containsMockNumber = value => typeof value === 'number' ? value === 99999
    : Boolean(value && typeof value === 'object' && Object.values(value).some(containsMockNumber));
  assert.equal(containsMockNumber(body), false); assert.ok(!response.raw.includes('syntheticWrongCache'));
  assert.equal(h.counters.cacheRead, 2); assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('unsupported cache mode with no eligible market input stays 503 without exposing cached values', async () => {
  const h = harness({ observed: { snapshot: { dataMode: 'unsupported-cache-mode',
    generatedAt: new Date().toISOString(), syntheticWrongCache: true,
    futuresMarket: { ok: true, data: { txDay: { contract: 'TXFK6', close: 99999 } } } } } });
  await h.start(); const auth = await h.login(); const response = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(response.status, 503); const body = response.json();
  assert.equal(body.data, null); assert.equal(body.decisionWorkspace, null);
  assert.equal(body.service.degraded.status, 'UNAVAILABLE');
  assert.equal(body.service.degraded.eodReason, 'EOD_SNAPSHOT_DATA_MODE_REJECTED');
  assert.ok(!response.raw.includes('syntheticWrongCache')); noExternalEffects(h);
});

test('valid live-mode EOD cache keeps the existing candidate snapshot response without degraded metadata', async () => {
  const h = harness({ observed: { snapshot: { dataMode: 'live', generatedAt: new Date().toISOString(),
    syntheticLiveCache: true } } });
  await h.start(); const auth = await h.login(); const response = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(response.status, 200); const body = response.json();
  assert.equal(body.data.dataMode, 'live'); assert.equal(body.data.syntheticLiveCache, true);
  assert.equal(body.service.degraded, undefined); assert.equal(body.decisionWorkspace.degraded, undefined);
  assert.equal(body.decisionWorkspace.schemaVersion, 'dashboard-decision-workspace-v1'); noExternalEffects(h);
});

test('read-only candidate observes later EOD publication and quarantines a later wrong-mode cache', async () => {
  const observed = { ...syntheticMarketInputs() };
  const h = harness({ observed }); await h.start(); const auth = await h.login();
  const first = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(first.json().service.degraded.status, 'PARTIAL');
  observed.snapshot = { dataMode: 'live', generatedAt: new Date().toISOString(), publicationRevision: 1 };
  const published = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(published.json().data?.publicationRevision, 1);
  observed.snapshot = { ...observed.snapshot, publicationRevision: 2 };
  const updated = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(updated.json().data?.publicationRevision, 2);
  observed.snapshot = { dataMode: 'mock', forbiddenSyntheticCache: true };
  const quarantined = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(quarantined.json().data, null);
  assert.equal(quarantined.json().service.degraded.eodReason, 'EOD_SNAPSHOT_DATA_MODE_REJECTED');
  assert.ok(!quarantined.raw.includes('forbiddenSyntheticCache'));
  noExternalEffects(h);
});

for (const available of ['chart', 'flow']) {
  test(`${available}-only observed input keeps the candidate partial and missing input explicitly unavailable`, async () => {
    const inputs = syntheticMarketInputs(); const h = harness({ observed: { [available]: inputs[available] } });
    await h.start(); const auth = await h.login(); const response = await h.dispatch('GET', '/api/v1/dashboard', auth);
    assert.equal(response.status, 200); const body = response.json(); assert.equal(body.data, null);
    assert.equal(body.service.degraded.status, 'PARTIAL');
    assert.equal(body.service.degraded.marketInputs[available].observationAvailable, true);
    assert.equal(body.service.degraded.marketInputs[available === 'chart' ? 'flow' : 'chart'].observationAvailable, false);
    assert.equal(body.decisionWorkspace.snapshot.executionAuthorized, false);
    if (available === 'flow') assert.equal(body.decisionWorkspace.priceChartSlot.price.availability, 'UNAVAILABLE');
    else assert.equal(body.decisionWorkspace.observedFlow, null);
    noExternalEffects(h);
  });
}

test('low-quality chart and stale Flow retain their original labels without an EOD or readiness upgrade', async () => {
  const inputs = syntheticMarketInputs();
  inputs.chart.status = 'QUALITY_INSUFFICIENT'; inputs.chart.qualityStatus = 'QUALITY_INSUFFICIENT';
  inputs.chart.qualityReasons = ['TIMESTAMP_LINEAGE_INSUFFICIENT'];
  inputs.flow.sourceState = 'STALE'; inputs.flow.windows.primary60s.truthState = 'STALE';
  inputs.flow.source.availableAt = '2020-01-01T00:00:00.000Z'; inputs.flow.source.validUntil = '2020-01-01T00:01:00.000Z';
  const h = harness({ observed: inputs }); await h.start(); const auth = await h.login();
  const response = await h.dispatch('GET', '/api/v1/dashboard', auth); assert.equal(response.status, 200);
  const body = response.json(); assert.equal(body.data, null); assert.equal(body.service.degraded.status, 'PARTIAL');
  assert.equal(body.decisionWorkspace.priceChartSlot.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.equal(body.decisionWorkspace.observedFlow.sourceState, 'STALE');
  assert.notEqual(body.decisionWorkspace.decisionSummary.readiness, 'READY');
  assert.equal(body.service.degraded.dataQualificationDeclared, false); noExternalEffects(h);
});

test('different chart and Flow identities remain separate and do not grant merged readiness', async () => {
  const inputs = syntheticMarketInputs(); inputs.flow.identity.actualContract = 'TXFL6';
  const h = harness({ observed: inputs }); await h.start(); const auth = await h.login();
  const response = await h.dispatch('GET', '/api/v1/dashboard', auth); assert.equal(response.status, 200);
  const body = response.json(); assert.equal(body.decisionWorkspace.globalStatus.actualContract, 'TXFK6');
  assert.equal(body.decisionWorkspace.observedFlow.identity.actualContract, 'TXFL6');
  assert.notEqual(body.decisionWorkspace.decisionSummary.readiness, 'READY'); noExternalEffects(h);
});

for (const [name, observed] of Object.entries({
  fakeReadyFlags: { chart: { ready: true }, flow: { ready: true } },
  malformedChartContract: { chart: { ...syntheticMarketInputs().chart, actualContract: '../foreign' } },
  malformedFlowContract: { flow: { ...syntheticMarketInputs().flow, identity: { ...syntheticMarketInputs().flow.identity, actualContract: 'NOT_TX' } } },
  noObservedBars: { chart: { ...syntheticMarketInputs().chart, bars: [] } },
  noObservedFlow: { flow: { ...syntheticMarketInputs().flow, windows: {} } },
  sourceFailures: { chartError: true, flowError: true },
})) {
  test(`missing EOD with ${name} stays 503 without constructing a false workspace`, async () => {
    const h = harness({ observed }); await h.start(); const auth = await h.login();
    const response = await h.dispatch('GET', '/api/v1/dashboard', auth); assert.equal(response.status, 503);
    const body = response.json(); assert.equal(body.data, null); assert.equal(body.decisionWorkspace, null);
    assert.equal(body.service.degraded.status, 'UNAVAILABLE'); noExternalEffects(h);
  });
}

for (const invalid of ['chart', 'flow']) {
  test(`a valid sibling cannot promote a malformed ${invalid} into the actual workspace`, async () => {
    const inputs = syntheticMarketInputs();
    if (invalid === 'chart') inputs.chart = { ...inputs.chart, actualContract: 'FAKE_READY', lastPrice: 99999 };
    else inputs.flow = { ...inputs.flow, identity: { ...inputs.flow.identity, actualContract: 'FAKE_READY' } };
    const h = harness({ observed: inputs }); await h.start(); const auth = await h.login();
    const response = await h.dispatch('GET', '/api/v1/dashboard', auth); assert.equal(response.status, 200);
    const body = response.json(); assert.equal(body.service.degraded.marketInputs[invalid].observationAvailable, false);
    if (invalid === 'chart') assert.equal(body.decisionWorkspace.priceChartSlot.price.availability, 'UNAVAILABLE');
    else assert.equal(body.decisionWorkspace.observedFlow, null);
    noExternalEffects(h);
  });
}

test('seeded synthetic live snapshot reaches the real dashboard assembly without scheduler, Bridge or upstream escape', async () => {
  const h = harness({ observed: { snapshot: { dataMode: 'live', asOfDate: '2026-11-02',
    generatedAt: '2026-11-02T00:00:00.000Z', syntheticFixture: true } } });
  await h.start(); const auth = await h.login();
  const response = await h.dispatch('GET', '/api/v1/dashboard', auth);
  assert.equal(response.status, 200); const body = response.json();
  assert.equal(body.ok, true); assert.equal(body.data.syntheticFixture, true);
  assert.equal(body.decisionWorkspace.runtimeVersion.runtimeCommit, head);
  assert.equal(body.decisionWorkspace.schemaVersion, 'dashboard-decision-workspace-v1');
  assert.equal(body.decisionWorkspace.forwardShadowStatus.status, 'UNKNOWN');
  assert.equal(body.decisionWorkspace.globalStatus.mode, 'UNAVAILABLE');
  assert.equal(body.service.brokerMarketData.reason, 'MARKET_CANDIDATE_NO_LIVE_BRIDGE');
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('collection, daily-update, AI/account/setup routes refuse before dispatch even with valid auth/CSRF', async () => {
  const h = harness(); await h.start(); const auth = await h.login();
  for (const [method, route] of [['POST', '/api/v1/refresh'], ['POST', '/api/v2/daily-update'],
    ['POST', '/api/v1/ask-gpt/accounts'], ['POST', '/api/v1/ask-gpt/models'], ['POST', '/api/v1/ask-gpt/setup'],
    ['POST', '/api/v1/ask-gpt/analyse'], ['GET', '/api/v1/ask-gpt/accounts'], ['GET', '/api/v1/ask-gpt/setup']]) {
    const response = await h.dispatch(method, route, { ...auth, body: {} });
    assert.equal(response.status, 403, route); assert.equal(response.json().error, 'MARKET_CANDIDATE_READ_ONLY');
  }
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('actual private logout retains CSRF rejection and valid logout revokes the Session', async () => {
  const h = harness(); await h.start(); const auth = await h.login();
  const missing = await h.dispatch('POST', '/api/auth/logout', { cookie: auth.cookie, body: {} });
  assert.equal(missing.status, 403); assert.equal(missing.json().error, 'CSRF_INVALID');
  const wrong = await h.dispatch('POST', '/api/auth/logout', { ...auth, csrf: 'wrong-synthetic-token', body: {} });
  assert.equal(wrong.status, 403); assert.deepEqual(h.counters.fsWrites, [sessionFile]);
  const logout = await h.dispatch('POST', '/api/auth/logout', { ...auth, body: {} }); assert.equal(logout.status, 200);
  const session = await h.dispatch('GET', '/api/session', { cookie: auth.cookie }); assert.equal(session.json().authenticated, false);
  assert.deepEqual(h.counters.fsWrites, [sessionFile, sessionFile]); noExternalEffects(h);
});

test('candidate health distinguishes unaccepted AI-off identity from formal acceptance', async () => {
  const h = harness(); await h.start(); const response = await h.dispatch('GET', '/healthz');
  assert.equal(response.status, 200); const body = response.json();
  assert.equal(body.versionTruth.runtimeCommit, head); assert.equal(body.versionTruth.runtimeTree, tree);
  assert.equal(body.versionTruth.previewType, 'CRU21_MARKET_RESEARCH_CANDIDATE');
  assert.equal(body.versionTruth.deliveryAccepted, false); assert.equal(body.localRelease, null);
  assert.equal(body.candidateRelease.scope, 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE');
  assert.equal(body.candidateRelease.aiEnabled, false); assert.equal(body.candidateRelease.deliveryAccepted, false);
  noExternalEffects(h);
});

test('candidate remains usable after an observation store appears inside its private cache',async()=>{
  const observed={persistObservationNamespace:true},h=harness({observed});await h.start();const auth=await h.login();
  await h.dispatch('GET','/api/v1/market-observation?mode=LIVE',auth);
  assert.equal(h.counters.chartSelections.at(-1)?.observation,true);
  assert.equal((await h.dispatch('GET','/healthz')).status,200);
  assert.equal((await h.dispatch('GET','/api/session',auth)).json().authenticated,true);
  noExternalEffects(h);
});

test('unsupported Node versions fail before candidate cache or session initialization',async()=>{
  for(const nodeVersion of ['20.20.0','22.12.0','23.3.0']){
    const h=harness({nodeVersion});await assert.rejects(h.start(),/DAILY_RELEASE_REQUIRES_NODE/);
    assert.equal(h.counters.cacheConstructor,0);assert.deepEqual(h.counters.fsWrites,[]);noExternalEffects(h);
  }
});

test('copy context uses the same qualified partial inputs and rereads EOD without acquisition', async () => {
  const observed = syntheticMarketInputs(), h = harness({ observed });
  await h.start(); const auth = await h.login();
  const copy = () => h.dispatch('GET', '/api/v1/ask-gpt-context?question=synthetic', auth);
  let response = await copy();
  assert.equal(response.status, 200); assert.ok(response.json().data.snapshotHash);
  assert.equal(response.json().data.directGptApi, false);
  observed.snapshot = { dataMode: 'live', publicationRevision: 1 };
  response = await copy(); assert.equal(response.status, 200);
  observed.snapshot = { dataMode: 'mock', publicationRevision: 2 };
  response = await copy(); assert.equal(response.status, 200);
  const dashboard = (await h.dispatch('GET', '/api/v1/dashboard', auth)).json();
  assert.equal(dashboard.data, null);
  assert.equal(dashboard.service.degraded.eodReason, 'EOD_SNAPSHOT_DATA_MODE_REJECTED');
  observed.chart = null; observed.flow = null;
  response = await copy(); assert.equal(response.status, 503);
  assert.equal(response.json().error, 'DISCUSSION_SNAPSHOT_UNAVAILABLE');
  noExternalEffects(h);
});

test('date traversal, duplicate selectors and foreign query fields refuse before chart dispatch', async () => {
  const h = harness(); await h.start(); const auth = await h.login();
  const before = h.counters.chartSelections.length;
  for (const query of ['tradeDate=..%2F..%2Fforeign', 'tradeDate=2026-02-30', 'tradeDate=2026-11-02&tradeDate=2026-11-01',
    'mode=MOCK', 'actualContract=TX%2F..%2Fforeign', 'file=foreign-data-root']) {
    for (const route of ['/api/v1/tx-chart', '/api/v1/market-changes', '/api/v1/market-observation']) {
      const response = await h.dispatch('GET', route + '?' + query, auth);
      assert.equal(response.status, 400, route + '?' + query);
      assert.equal(response.json().error, 'MARKET_CANDIDATE_QUERY_REJECTED');
    }
  }
  assert.equal(h.counters.chartSelections.length, before, 'rejected selectors must not dispatch chart or observation work');
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('foreign browser version/origin binding is refused before normalization or accepted proof', async () => {
  const h = harness(); await h.start(); const auth = await h.login();
  const response = await h.dispatch('POST', '/api/v1/cru46-browser-runtime-proof', { ...auth, body: {
    candidateScope: 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE', previewType: 'CRU21_MARKET_RESEARCH_CANDIDATE',
    origin: 'https://127.0.0.1:8787', exactHead: head, exactTree: tree,
  } });
  assert.equal(response.status, 422); assert.equal(response.json().error, 'MARKET_CANDIDATE_BROWSER_BINDING_REJECTED');
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

test('a private namespace alias appearing after login fails closed before a Session mutation', async () => {
  const observed = {}, h = harness({ observed }); await h.start(); const auth = await h.login();
  observed.namespaceAlias = path.join(dataRoot, 'decision-workspace');
  const response = await h.dispatch('POST', '/api/auth/logout', { ...auth, body: {} });
  assert.equal(response.status, 500); assert.equal(response.json().error, 'INTERNAL_ERROR');
  assert.deepEqual(h.counters.fsWrites, [sessionFile]); noExternalEffects(h);
});

for (const [name, changes] of Object.entries({
  wrongHead: { observed: { head: base } }, wrongTree: { observed: { tree: head } },
  wrongBase: { observed: { base: head } }, wrongBranch: { observed: { branch: 'main' } },
  dirtySource: { observed: { dirty: true } }, overlapReadRoot: { env: { DASHBOARD_CANDIDATE_READ_ROOT: dataRoot } },
  wrongProjection: { env: { CRU34_LIVE_SNAPSHOT_PATH: path.join(readRoot, 'wrong/latest.json') } },
  enabledAI: { env: { ASK_GPT_INLINE_ENABLED: '1' } },
  namespaceAlias: { observed: { namespaceAlias: path.join(dataRoot, 'dashboard-chart-cache') } },
  injectedGitDirectory: { env: { GIT_DIR: '/synthetic-foreign-git' } },
})) {
  test(`startup rejects ${name} before cache, Session or captured listener initialization`, async () => {
    const h = harness(changes); await assert.rejects(h.start(), /MARKET_CANDIDATE_/);
    assert.equal(h.counters.cacheConstructor, 0); assert.equal(h.counters.cacheRead, 0);
    assert.equal(h.counters.tlsCapture, 0); assert.deepEqual(h.counters.fsReads, []); assert.deepEqual(h.counters.fsWrites, []);
    noExternalEffects(h);
  });
}
