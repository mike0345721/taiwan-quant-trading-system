// Fixed PR104 normal-handler slice, evaluated without sockets or external inputs.
// These 12 files exclude decision-journal.mjs and public/ask-gpt-inline.js;
// their V1 behavior and browser UI are not exercised by this VM evidence.
// This VM executes trusted hash-frozen source; it is not a sandbox for arbitrary JS.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { URL, pathToFileURL } from 'node:url';

export const APPLICATION_PRODUCT = Object.freeze({
  head: '4ae16de9a5af0166744626d44a49cb5bcebed675',
  tree: 'ac2d522e6d42934dbb563599a04df61f56fc9145',
  branch: 'codex/cru21-repository-closeout-20261029',
  main: '4d8251686bdb4abbdb469bc00ae798717c0fd583',
});
export const APPLICATION_BUNDLE_SHA256 = '44cef1c049569d38508c9b3e0abbcfd824c0b8278cc42f7c85f2b4805ad74961';
export const APPLICATION_FILES = Object.freeze({
  'server.mjs': '170afc0c9af5c68155eacf963a44948519803f469f99e1b0a7a291a036ba334f',
  'src/security.mjs': '0c5cb1e5c6cf655ee6f7513d51dc069134dd039570656865d4cf47871abcf7b7',
  'src/http-utils.mjs': '37ba312a73e5481358400223488d94ff4ab9c80989d37e72179c07feba0deb57',
  'src/ask-gpt-inline-service.mjs': 'edb8b1c1a63016e1c623f576b60e8c84da7eeda821b03d7dd0f78376be90123e',
  'src/ask-gpt-inline-http.mjs': '4219801bc410e9805556e3ab945cfb9c590f009d2bf44b7d8d78f30d35d673cd',
  'src/chatgpt-plan-auth.mjs': '984485936c4a66c6299322e08d0868abb7370addaf3f84a370ed731a3d62b8e6',
  'src/ask-gpt-inline-verification.mjs': 'f4b8dac5edeee1f0bd451b30b392975ab6b21ba8edba4274d71d43209896b011',
  'src/cru21-preview-contract.mjs': '82e9144db49c2a0e63dc31bd1dccb351becf6bf262be742e890f867df00b078a',
  'src/dashboard-source-binding.mjs': 'f228f50c7692faa5945f1c3bbb0c53a2d71a1fdf2b0d2f1fe705a3ea3c1bd4c1',
  'src/dashboard-integration-contract.mjs': '6a0384918e88e555775dd4b6e1fb396368e4b571251df223e1006fe24c55ae5f',
  'src/cache-store.mjs': 'c376cee85fc1b3c87cb5b3fe499e39cb3b3fe68e0af76855e1a059730a35fa5f',
  'public/index.html': '72959ff2fe1488b2e0ddd8a7f092c49f07f134b3883a5fa976b4e6cba2070e7f',
});
const ROOT_PREFIX = 'cru21-candidate-integration-20261028-';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NONCE = /^[a-f0-9]{64}$/;
const attemptedWindows = new Set();
export const applicationSHA256 = value => crypto.createHash('sha256').update(value).digest('hex');
const insist = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const within = (root, file) => { const rel = path.relative(root, path.resolve(file)); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
function safeExisting(file, kind = 'directory') {
  const st = fs.lstatSync(file);
  insist(!st.isSymbolicLink() && (kind === 'directory' ? st.isDirectory() : st.isFile() && st.nlink === 1)
    && path.resolve(fs.realpathSync(file)) === path.resolve(file), 'APPLICATION_PATH_IDENTITY_REJECTED');
  return st;
}
export function validateApplicationRoot(root, windowId, nonce) {
  insist(typeof root === 'string' && path.isAbsolute(root), 'APPLICATION_ROOT_REQUIRED');
  insist(root === path.resolve(root) && path.basename(root).startsWith(ROOT_PREFIX)
    && UUID.test(path.basename(root).slice(ROOT_PREFIX.length)), 'APPLICATION_TEMP_ROOT_REQUIRED');
  insist(UUID.test(windowId) && NONCE.test(nonce), 'APPLICATION_BINDING_REJECTED');
  // Pure syntax/binding check. Only the native host validates the actual root;
  // the Node runtime never opens or follows this namespace on disk.
  const windowRoot = path.join(root, 'authority', 'windows', windowId);
  return Object.freeze({ root, windowId, nonce, windowRoot, privateRoot: path.join(root, 'private', windowId) });
}
export function validateApplicationPacket(packet, { root, windowId, nonce }) {
  const bounds = validateApplicationRoot(root, windowId, nonce);
  insist(exact(packet, ['schema', 'root', 'windowId', 'nonce', 'mode', 'runtimeAllowed', 'productHead', 'productTree', 'intent', 'bundle'])
    && packet.schema === 'cru21-normal-application-input-v1' && packet.root === bounds.root
    && packet.windowId === windowId && packet.nonce === nonce && packet.mode === 'ISOLATED_NORMAL_APPLICATION'
    && packet.runtimeAllowed === false && packet.productHead === APPLICATION_PRODUCT.head
    && packet.productTree === APPLICATION_PRODUCT.tree, 'APPLICATION_PACKET_BINDING_REJECTED');
  for (const key of ['intent', 'bundle']) {
    const item = packet[key], limit = key === 'intent' ? 65536 : 1048576;
    insist(exact(item, ['sha256', 'contentUTF8']) && NONCE.test(item.sha256) && typeof item.contentUTF8 === 'string'
      && Buffer.byteLength(item.contentUTF8) <= limit && applicationSHA256(item.contentUTF8) === item.sha256,
    'APPLICATION_PACKET_BYTES_REJECTED');
  }
  insist(packet.bundle.sha256 === APPLICATION_BUNDLE_SHA256, 'APPLICATION_PACKET_BUNDLE_REJECTED');
  const intent = JSON.parse(packet.intent.contentUTF8);
  insist(intent.schema === 'cru21-candidate-integration-intent-v1' && intent.windowId === windowId && intent.nonce === nonce
    && intent.productHead === APPLICATION_PRODUCT.head && intent.productTree === APPLICATION_PRODUCT.tree
    && Number.isSafeInteger(intent.durationMs) && intent.durationMs >= 1 && intent.durationMs <= 900000
    && NONCE.test(intent.manifestSha256 || '') && intent.runtimeAllowed === false
    && intent.mode === 'ISOLATED_NORMAL_APPLICATION', 'APPLICATION_INTENT_BINDING_REJECTED');
  const bundle = JSON.parse(packet.bundle.contentUTF8); verifyApplicationBundle(bundle);
  return { ...bounds, bundle, intentHash: packet.intent.sha256 };
}
export function buildApplicationBundle(productRoot) {
  insist(typeof productRoot === 'string' && path.isAbsolute(productRoot), 'APPLICATION_SOURCE_REQUIRED');
  safeExisting(productRoot);
  const files = {};
  for (const [name, expected] of Object.entries(APPLICATION_FILES)) {
    const file = path.join(productRoot, name); safeExisting(file, 'file');
    const content = fs.readFileSync(file, 'utf8');
    insist(applicationSHA256(content) === expected, 'APPLICATION_SOURCE_HASH_MISMATCH');
    files[name] = { sha256: expected, content };
  }
  return { schema: 'cru21-normal-application-bundle-v1', productHead: APPLICATION_PRODUCT.head,
    productTree: APPLICATION_PRODUCT.tree, files };
}
export function verifyApplicationBundle(bundle) {
  insist(exact(bundle, ['schema', 'productHead', 'productTree', 'files'])
    && bundle.schema === 'cru21-normal-application-bundle-v1'
    && bundle.productHead === APPLICATION_PRODUCT.head && bundle.productTree === APPLICATION_PRODUCT.tree
    && exact(bundle.files, Object.keys(APPLICATION_FILES)), 'APPLICATION_BUNDLE_IDENTITY_REJECTED');
  const copy = {};
  for (const [name, expected] of Object.entries(APPLICATION_FILES)) {
    const file = bundle.files[name];
    insist(exact(file, ['sha256', 'content']) && typeof file.content === 'string'
      && file.sha256 === expected && applicationSHA256(file.content) === expected, 'APPLICATION_SOURCE_HASH_MISMATCH');
    copy[name] = file.content;
  }
  return Object.freeze(copy);
}

export async function runIsolatedApplication({ root, windowId, nonce, bundle, intentHash, captureObserver }) {
  insist(typeof vm.SourceTextModule === 'function', 'APPLICATION_VM_MODULES_REQUIRED');
  const bounds = validateApplicationRoot(root, windowId, nonce), files = verifyApplicationBundle(bundle);
  insist(NONCE.test(intentHash), 'APPLICATION_INTENT_HASH_REQUIRED');
  const privateParent = path.join(bounds.root, 'private');
  const appRoot = path.join(bounds.privateRoot, 'synthetic-app');
  const dataDir = path.join(appRoot, 'data');
  const historyDir = path.join(dataDir, 'history');
  const sessionFile = path.join(dataDir, 'sessions.json'), latestFile = path.join(dataDir, 'latest.json');
  // All application Session/cache state is synthetic memory. There are no
  // private files, directory opens or ordinary Temp-path reads in this runtime.
  const attemptKey = bounds.windowRoot;
  insist(!attemptedWindows.has(attemptKey), 'APPLICATION_WINDOW_ALREADY_ATTEMPTED');
  attemptedWindows.add(attemptKey);
  const fixedDirectories = new Set([privateParent, bounds.privateRoot, appRoot, dataDir, historyDir]);
  const memoryFiles = new Map([[sessionFile, Buffer.from('{}\n')], [latestFile, Buffer.from('null\n')]]);
  const virtualPublic = path.join(appRoot, 'public');
  const counters = { networkCalls: 0, childProcessCalls: 0, credentialCalls: 0,
    syntheticGitObservations: 0, syntheticMarketRefreshes: 0, outsideFileAttempts: 0 };
  const writes = [], observations = [], listeners = {}, startupTasks = [];
  let callback = null, listenIntent = null, createdServer = null;
  const deny = code => { throw Object.assign(new Error(code), { code }); };
  const noNetwork = () => { counters.networkCalls++; return deny('APPLICATION_NETWORK_FORBIDDEN'); };
  const noCredential = () => { counters.credentialCalls++; return deny('APPLICATION_CREDENTIAL_OPERATION_FORBIDDEN'); };
  const location = file => {
    if (typeof file !== 'string' || !within(bounds.privateRoot, file)) { counters.outsideFileAttempts++; return deny('APPLICATION_FILE_BOUNDARY_REJECTED'); }
    const resolved = path.resolve(file);
    insist(!resolved.toLowerCase().includes('siwc-v1') && !resolved.toLowerCase().includes('chatgptplan'), 'APPLICATION_REAL_VAULT_FORBIDDEN');
    return resolved;
  };
  const missing = () => { throw Object.assign(new Error('Synthetic path does not exist'), { code: 'ENOENT' }); };
  const fileCheck = file => {
    const resolved = location(file);
    if (!memoryFiles.has(resolved) && !fixedDirectories.has(resolved)) return missing();
    return resolved;
  };
  const memoryStat = file => {
    const checked = fileCheck(file), directory = fixedDirectories.has(checked);
    return { isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false,
      size: directory ? 0 : memoryFiles.get(checked).length, nlink: 1, dev: 0, ino: 0 };
  };
  const memoryRead = (file, encoding) => {
    const checked = fileCheck(file); insist(memoryFiles.has(checked), 'APPLICATION_MEMORY_FILE_REQUIRED');
    const bytes = Buffer.from(memoryFiles.get(checked));
    return encoding ? bytes.toString(typeof encoding === 'string' ? encoding : encoding.encoding || 'utf8') : bytes;
  };
  const virtual = file => path.resolve(file) === path.join(virtualPublic, 'index.html');
  const privateFs = {
    existsSync(file) { const resolved = location(file); return memoryFiles.has(resolved) || fixedDirectories.has(resolved); },
    lstatSync: memoryStat, statSync: memoryStat,
    realpathSync(file) { return fileCheck(file); },
    readFileSync: memoryRead,
    mkdirSync(file, options) {
      const checked = fileCheck(file); insist(fixedDirectories.has(checked) && options?.recursive === true, 'APPLICATION_DIRECTORY_CREATION_FORBIDDEN');
      // CacheStore.init on the synthetic history directory is a no-op.
      return undefined;
    },
    writeFileSync(file, content, options) {
      const checked = fileCheck(file); insist(checked === sessionFile, 'APPLICATION_FILE_WRITE_FORBIDDEN');
      insist(typeof content === 'string' || Buffer.isBuffer(content), 'APPLICATION_MEMORY_CONTENT_REJECTED');
      writes.push(path.relative(bounds.privateRoot, checked).split(path.sep).join('/')); memoryFiles.set(checked, Buffer.from(content));
    },
  };
  const fsSync = new Proxy(privateFs, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : () => deny('APPLICATION_FS_OPERATION_FORBIDDEN'); } });
  const promises = {
    async mkdir(file, options) { return privateFs.mkdirSync(file, options); },
    async readFile(file, encoding) {
      if (virtual(file)) return encoding ? files['public/index.html'] : Buffer.from(files['public/index.html']);
      return memoryRead(file, encoding);
    },
    async stat(file) { if (virtual(file)) return { isFile: () => true }; return memoryStat(file); },
    async readdir(file) { insist(fileCheck(file) === historyDir, 'APPLICATION_DIRECTORY_ENUMERATION_FORBIDDEN'); return []; },
  };
  const fsPromises = new Proxy(promises, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : async () => deny('APPLICATION_FS_OPERATION_FORBIDDEN'); } });
  const password = 'Synthetic-only-' + nonce;
  const salt = Buffer.from(nonce.slice(0, 32), 'hex');
  const passwordHash = 'scrypt-v1$' + salt.toString('base64url') + '$' + crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
  const config = Object.freeze({ appRoot, publicDir: virtualPublic, dataDir, historyDir,
    host: '127.0.0.1', port: 18722, nodeEnv: 'production', passwordHash, mockData: false,
    cru55Candidate: false, cru55Acceptance: null, sessionTtlMs: 300000, rememberedSessionTtlMs: 300000,
    refreshIntervalMs: 0, upstreamTimeoutMs: 1000, trustProxy: false, cookieSecure: false });
  const environment = Object.freeze({ ASK_GPT_INLINE_ENABLED: '1', DASHBOARD_PREVIEW_TYPE: 'CRU21_OWNER_PREVIEW',
    DASHBOARD_PREVIEW_BRANCH: APPLICATION_PRODUCT.branch, DASHBOARD_PREVIEW_EXPECTED_HEAD: APPLICATION_PRODUCT.head,
    DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN: APPLICATION_PRODUCT.main, ASK_GPT_CANDIDATE_READ_ROOT: path.join(appRoot, 'synthetic-read'),
    LOCALAPPDATA: path.join(bounds.privateRoot, 'SyntheticLocal') });
  const processView = Object.freeze({ env: environment, platform: 'win32', pid: process.pid,
    on(signal, fn) { insist(['SIGINT', 'SIGTERM'].includes(signal), 'APPLICATION_PROCESS_EVENT_REJECTED'); listeners[signal] = fn; },
    exit() { deny('APPLICATION_PROCESS_EXIT_FORBIDDEN'); }, kill() { deny('APPLICATION_PROCESS_CONTROL_FORBIDDEN'); } });
  const context = vm.createContext({ Buffer, URL, AbortController, AbortSignal, TextEncoder, TextDecoder,
    structuredClone, process: processView, fetch: noNetwork, console: Object.freeze({ log() {}, error() {}, warn() {} }),
    setInterval() { return Object.freeze({ unref() {} }); }, clearInterval() {},
    setTimeout(fn) { queueMicrotask(fn); return Object.freeze({ unref() {} }); }, clearTimeout() {},
  }, { codeGeneration: { strings: false, wasm: false } });
  const modules = new Map();
  const synthetic = (id, exports) => {
    if (!modules.has(id)) modules.set(id, new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier: id }));
    return modules.get(id);
  };
  const unavailable = () => Object.freeze({ state: 'UNAVAILABLE', ready: false, synthetic: true,
    reason: 'ISOLATED_SYNTHETIC_INPUT_UNAVAILABLE', researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false });
  const genericDeny = () => deny('APPLICATION_UNMODELED_DOMAIN_OPERATION');
  const imports = new Map();
  for (const source of Object.values(files)) {
    for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const names = match[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+as\s+/)[0]);
      const list = imports.get(match[2]) || new Set(); names.forEach(name => list.add(name)); imports.set(match[2], list);
    }
  }
  const overrides = {
    'src/config.mjs': { config, validateConfig() { insist(config.passwordHash && config.nodeEnv === 'production', 'APPLICATION_NORMAL_AUTH_REQUIRED'); } },
    'src/market-data.mjs': { MarketDataService: class { async refresh() { counters.syntheticMarketRefreshes++; return deny('ISOLATED_SYNTHETIC_MARKET_REFRESH_UNAVAILABLE'); } } },
    'src/v2-research.mjs': { V2ResearchService: class {} },
    'src/cru55-formal-entry.mjs': { prepareFormalEntry: () => null },
    'src/market-state-forward-shadow-calendar.mjs': { loadGovernedTradingCalendar: unavailable },
    'src/operating-calendar.mjs': { loadOperatingCalendar: unavailable },
    'src/dashboard-tx-chart-source.mjs': { loadTxDecisionChart: unavailable },
    'src/dashboard-flow-refresh.mjs': { loadFlowRefresh: unavailable },
    'src/chatgpt-plan-store.mjs': { inspectWindowsPlanStore: () => ({ state: 'MISSING', reason: 'CREDENTIAL_STORE_MISSING', accountMetadataLoaded: false }),
      openExistingWindowsPlanStore: noCredential, createWindowsPlanStore: noCredential },
    'src/runtime-identity.mjs': { readRuntimeIdentity: (_root, options) => ({ commit: options?.ref ? APPLICATION_PRODUCT.main : APPLICATION_PRODUCT.head }),
      buildRuntimeVersionStatus: () => ({ runtimeCommit: APPLICATION_PRODUCT.head, approvedMainCommit: APPLICATION_PRODUCT.main, syncState: 'SYNTHETIC_SOURCE_OBSERVATION', sourceIdentityEvidence: 'SYNTHETIC' }) },
  };
  const children = {
    spawn() { counters.childProcessCalls++; deny('APPLICATION_CHILD_PROCESS_FORBIDDEN'); },
    execFileSync(exe, args) {
      insist(exe === 'git' && (JSON.stringify(args) === '["status","--porcelain"]' || JSON.stringify(args) === '["branch","--show-current"]'), 'APPLICATION_CHILD_PROCESS_FORBIDDEN');
      counters.syntheticGitObservations++; return args[0] === 'status' ? '' : APPLICATION_PRODUCT.branch + '\n';
    },
  };
  const http = { createServer(handler) {
    insist(callback === null && typeof handler === 'function', 'APPLICATION_SERVER_CAPTURE_REJECTED'); callback = handler;
    createdServer = Object.assign(new EventEmitter(), {
      listen(port, host, ready) { insist(listenIntent === null && port === 18722 && host === '127.0.0.1', 'APPLICATION_LISTEN_INTENT_REJECTED');
        listenIntent = { port, host }; startupTasks.push(Promise.resolve().then(() => { this.emit('listening'); return ready?.(); })); return this; },
      address() { return listenIntent ? { address: listenIntent.host, port: listenIntent.port, family: 'IPv4' } : null; },
      close(fn) { fn?.(); },
    });
    return createdServer;
  } };
  if (captureObserver !== undefined) {
    insist(typeof captureObserver === 'function', 'APPLICATION_CAPTURE_OBSERVER_INVALID');
    // Only the explicit test API accepts this hook; the fixed native runner
    // never accepts a hook or function from its ticket, argv or environment.
    captureObserver(http);
  }
  const builtins = { 'node:http': { default: http }, 'node:crypto': { default: crypto, randomBytes: crypto.randomBytes,
    randomUUID: crypto.randomUUID, createHash: crypto.createHash, createPublicKey: crypto.createPublicKey,
    verify: crypto.verify, timingSafeEqual: crypto.timingSafeEqual }, 'node:fs': { default: fsSync },
    'node:fs/promises': { default: fsPromises }, 'node:path': { default: path }, 'node:url': { URL } , 'node:child_process': children };
  function getModule(id) {
    if (modules.has(id)) return modules.get(id);
    if (Object.hasOwn(builtins, id)) return synthetic(id, builtins[id]);
    if (Object.hasOwn(files, id) && id.endsWith('.mjs')) {
      const mod = new vm.SourceTextModule(files[id], { context, identifier: id,
        importModuleDynamically() { deny('APPLICATION_DYNAMIC_IMPORT_FORBIDDEN'); },
        initializeImportMeta(meta) { meta.url = pathToFileURL(path.join(appRoot, id)).href; } });
      modules.set(id, mod); return mod;
    }
    const names = new Set();
    for (const [specifier, values] of imports) {
      if (specifier.startsWith('.') && path.posix.normalize(path.posix.join('src', specifier)) === id) values.forEach(name => names.add(name));
      if (specifier === './' + id) values.forEach(name => names.add(name));
    }
    insist(names.size > 0 && !id.startsWith('node:') && !id.includes('..'), 'APPLICATION_MODULE_NOT_ALLOWLISTED');
    const exports = Object.fromEntries([...names].map(name => [name, genericDeny]));
    Object.assign(exports, overrides[id] || {});
    return synthetic(id, exports);
  }
  const main = getModule('server.mjs');
  await main.link((specifier, referencing) => {
    const id = specifier.startsWith('node:') ? specifier : path.posix.normalize(path.posix.join(path.posix.dirname(referencing.identifier), specifier));
    return getModule(id);
  });
  await main.evaluate({ timeout: 5000 }); await Promise.all(startupTasks);
  insist(callback && listenIntent && createdServer, 'APPLICATION_NORMAL_HANDLER_MISSING');
  async function dispatch(method, route, { body, cookie, csrf, origin = true } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: route, socket: { remoteAddress: '127.0.0.1', encrypted: false },
      headers: { host: '127.0.0.1:18722', 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(origin ? { origin: 'http://127.0.0.1:18722' } : {}) } });
    const headers = {}, chunks = []; let status = null;
    const res = { headersSent: false, setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code, values = {}) { status = code; for (const [key, value] of Object.entries(values)) this.setHeader(key, value); this.headersSent = true; },
      end(value = '') { chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); } };
    await callback(req, res);
    insist(Number.isInteger(status), 'APPLICATION_RESPONSE_MISSING');
    const raw = Buffer.concat(chunks), result = { status, headers, raw };
    observations.push({ method, route, status, responseSHA256: applicationSHA256(raw) });
    return result;
  }
  const anonymous = await dispatch('GET', '/api/v1/ask-gpt/status'); insist(anonymous.status === 401, 'APPLICATION_ANONYMOUS_NOT_REJECTED');
  const foreign = await dispatch('GET', '/api/v1/ask-gpt/status', { cookie: 'twchip_session=synthetic-foreign-session' });
  insist(foreign.status === 401, 'APPLICATION_FOREIGN_SESSION_NOT_REJECTED');
  const badLogin = await dispatch('POST', '/api/auth/login', { body: { password: password + '-wrong', remember: false } });
  insist(badLogin.status === 401, 'APPLICATION_BAD_PASSWORD_NOT_REJECTED');
  const login = await dispatch('POST', '/api/auth/login', { body: { password, remember: false } });
  const loginValue = JSON.parse(login.raw);
  insist(login.status === 200 && loginValue.ok && typeof loginValue.csrfToken === 'string', 'APPLICATION_NORMAL_LOGIN_FAILED');
  const setCookie = login.headers['set-cookie'];
  insist(typeof setCookie === 'string' && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), 'APPLICATION_SESSION_COOKIE_REJECTED');
  const cookie = setCookie.split(';')[0], csrf = loginValue.csrfToken;
  const session = await dispatch('GET', '/api/session', { cookie });
  insist(session.status === 200 && JSON.parse(session.raw).authenticated === true, 'APPLICATION_SESSION_FAILED');
  const writeCount = writes.length;
  for (let i = 0; i < 2; i++) {
    const status = await dispatch('GET', '/api/v1/ask-gpt/status', { cookie }); const data = JSON.parse(status.raw).data;
    insist(status.status === 200 && data.enabled === true && data.storeState === 'MISSING'
      && data.credentialsLoaded === false && data.accountMetadataLoaded === false && data.accounts.length === 0, 'APPLICATION_READONLY_AI_STATUS_FAILED');
  }
  const automaticStatusWrites = writes.length - writeCount;
  insist(automaticStatusWrites === 0 && counters.credentialCalls === 0, 'APPLICATION_STATUS_SIDE_EFFECT');
  const csrfRejected = await dispatch('POST', '/api/v1/ask-gpt/accounts', { cookie, body: {} });
  insist(csrfRejected.status === 403, 'APPLICATION_CSRF_NOT_REJECTED');
  const originRejected = await dispatch('POST', '/api/v1/ask-gpt/accounts', { cookie, csrf, origin: false, body: {} });
  insist(originRejected.status === 403, 'APPLICATION_ORIGIN_NOT_REJECTED');
  const html = await dispatch('GET', '/');
  insist(html.status === 200 && applicationSHA256(html.raw) === APPLICATION_FILES['public/index.html']
    && html.raw.includes(Buffer.from('id="login-form"')) && html.raw.includes(Buffer.from('id="ai-status"')), 'APPLICATION_STATIC_UI_FAILED');
  const flow = await dispatch('GET', '/api/v1/observed-flow', { cookie });
  insist(flow.status === 200 && JSON.parse(flow.raw).data.synthetic === true, 'APPLICATION_SYNTHETIC_SURFACE_FAILED');
  insist(counters.networkCalls === 0 && counters.childProcessCalls === 0 && counters.credentialCalls === 0
    && counters.outsideFileAttempts === 0 && counters.syntheticMarketRefreshes === 1, 'APPLICATION_ISOLATION_BOUNDARY_FAILED');
  return { schema: 'cru21-normal-application-handshake-v1', windowId, nonce,
    productHead: APPLICATION_PRODUCT.head, productTree: APPLICATION_PRODUCT.tree, pid: process.pid,
    intentHash, entrySHA256: APPLICATION_FILES['server.mjs'], capturedNormalHandler: true,
    normalAuthVerified: true, sessionCsrfVerified: true, automaticAIStatusReadOnlyVerified: true,
    storeInspectorClass: 'SYNTHETIC_MISSING_NO_STORE', automaticStatusWrites,
    automaticStatusCredentialCalls: counters.credentialCalls,
    listenerOpened: false, networkCalls: 0, childProcessCalls: 0, realCredentialReads: 0,
    filesystemClass: 'SYNTHETIC_MEMORY', privateWritePaths: [], syntheticWritePaths: [...new Set(writes)].sort(),
    applicationPathReads: 0, applicationPathWrites: 0, observations, syntheticDependencies: {
      marketRefresh: 'UNAVAILABLE_NO_NETWORK', chartAndFlow: 'SYNTHETIC_UNAVAILABLE',
      credentialInspector: 'SYNTHETIC_MISSING_NO_STORE', gitMetadata: 'SYNTHETIC_PIN_OBSERVATION',
      normalConfig: 'SYNTHETIC_PRIVATE_CONFIG', staticHtml: 'HASH_FROZEN_PRODUCT_BYTES',
      fileSystem: 'FS_SYNTHETIC_MEMORY_NO_RUNTIME_PATH_IO',
    }, knownLimits: [
      'Trusted hash-frozen server source is executed; this VM is not an arbitrary-JavaScript security sandbox.',
      'HTTP callback and static HTML are exercised without a socket or browser; no real login or rendered screen is claimed.',
      'Store inspector returns synthetic MISSING; native reader, ciphertext, accounts and DPAPI are not exercised.',
      'Market, chart, flow and Git observations are explicitly synthetic; no live-data or candidate-runtime qualification.',
      'Session/cache filesystem is entirely synthetic memory; no native filesystem or root-metadata qualification is claimed.',
    ], evidenceClass: 'NORMAL_APPLICATION_VM_SYNTHETIC_DEPENDENCIES', runtimeAllowed: false };
}
