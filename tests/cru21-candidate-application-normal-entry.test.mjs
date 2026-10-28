import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { NORMAL_PRODUCT, NORMAL_SOURCE_MANIFEST_SHA256, normalSourceClosure, normalLiveEligibility,
  verifyNormalEntryTicket, normalEnvironmentPlan, attachNormalListeningObserver, exerciseNormalBootstrap,
  bootstrapNormalEntry, requiredNormalVendors, buildNormalVendorManifest, verifyNormalVendorClosure,
  normalCanonicalSHA256, verifyNormalNativeAdmission, assertNormalLocalPath,
  normalListeningHandshake } from '../scripts/cru21-normal-candidate/application-normal-entry.mjs';
import { buildApplicationBundle, runIsolatedApplication } from '../scripts/cru21-normal-candidate/application-isolation.mjs';

const productRoot = process.env.CRU21_APPLICATION_SOURCE_ROOT;
const gitExecutable = process.env.CRU21_APPLICATION_GIT_EXECUTABLE || (process.platform === 'linux' ? '/usr/bin/git' : null);
const sourceMissing = !productRoot ? 'NOT_RUN: CRU21_APPLICATION_SOURCE_ROOT must select frozen f221'
  : !gitExecutable ? 'NOT_RUN: CRU21_APPLICATION_GIT_EXECUTABLE must select the test Git binary' : false;
const vmMissing = sourceMissing || (typeof vm.SourceTextModule !== 'function' ? 'NOT_RUN: --experimental-vm-modules required' : false);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const helper = fileURLToPath(new URL('../scripts/cru21-normal-candidate/application-normal-entry.mjs', import.meta.url));
function fixture(t) {
  const root = path.join(os.tmpdir(), 'cru21-candidate-integration-20261028-' + crypto.randomUUID());
  fs.mkdirSync(root); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const windowId = crypto.randomUUID(), nonce = crypto.randomBytes(32).toString('hex');
  const evidence = path.join(root, 'authority', 'windows', windowId); fs.mkdirSync(evidence, { recursive: true });
  for (const name of ['chart-read', 'producer-read']) fs.mkdirSync(path.join(root, name));
  const data = path.join(root, 'private', windowId, 'synthetic-app', 'data');
  fs.mkdirSync(path.join(data, 'history'), { recursive: true });
  fs.writeFileSync(path.join(data, 'sessions.json'), '{}\n', { flag: 'wx' });
  fs.writeFileSync(path.join(data, 'latest.json'), 'null\n', { flag: 'wx' });
  const sourceRoot = productRoot || path.join(root, 'NOT_QUALIFIED_SOURCE');
  const privateDataRoot = path.join(sourceRoot, 'data'), producerDataRoot = path.join(root, 'producer-read');
  const projectionRoot = path.join(producerDataRoot, 'runtime', 'cru34-live');
  const ticket = { schema: 'cru21-normal-entry-ticket-v1', mode: 'NORMAL_CANDIDATE', runtimeAllowed: false,
    windowId, nonce, productHead: NORMAL_PRODUCT.head, productTree: NORMAL_PRODUCT.tree,
    sourceManifestSHA256: NORMAL_SOURCE_MANIFEST_SHA256, durationMs: 900000,
    roots: { sourceRoot, chartReadRoot: path.join(root, 'chart-read'), producerDataRoot, projectionRoot,
      snapshotPath: path.join(projectionRoot, 'latest.json'), statusPath: path.join(projectionRoot, 'status.json'),
      privateDataRoot, localAppDataRoot: path.join(privateDataRoot, 'candidate-local-appdata'),
      chartCacheRoot: path.join(privateDataRoot, 'dashboard-chart-cache'),
      evidenceRoot: path.join(privateDataRoot, 'cru21-normal-candidate', windowId) },
    node: { path: process.execPath, sha256: sha(fs.readFileSync(process.execPath)) },
    git: { path: gitExecutable || process.execPath, sha256: sha(fs.readFileSync(gitExecutable || process.execPath)) },
    helperSHA256: sha(fs.readFileSync(helper)), normalAuth: {
      passwordHashSource: 'EXISTING_PROCESS_ENV:DASHBOARD_PASSWORD_HASH', sessionPath: path.join(privateDataRoot, 'sessions.json'),
      csrfRequired: true, guest: false }, intentHash: 'a'.repeat(64) };
  return { root, windowId, nonce, ticket };
}
test('normal CLI admission stays HOLD before reading any ticket or importing source', async () => {
  const gate = normalLiveEligibility(); assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes('HARD_DEADLINE_FAULT_MODEL_UNRESOLVED'));
  const result = await bootstrapNormalEntry({ root: '/does-not-exist', windowId: 'bad', nonce: 'bad', runtimeAllowed: true, approved: true });
  assert.equal(result.status, 'HOLD'); assert.equal(result.spawned, false); assert.equal(result.imported, false);
  assert.equal(result.listenerOpened, false);
});
test('Windows namespace syntax admits regular drive-absolute paths, not fixed-drive qualification', () => {
  for (const value of ['C:\\', 'C:\\safe\\root', 'D:/safe/root']) assert.equal(assertNormalLocalPath(value, 'win32'), value);
  assert.equal(assertNormalLocalPath('/tmp/synthetic-local-root', 'linux'), '/tmp/synthetic-local-root');
});
for (const value of ['\\\\server\\share\\root', '//server/share/root', '\\\\?\\C:\\root', '\\\\.\\C:\\root',
  '\\??\\C:\\root', 'C:relative', '\\Windows', 'C:\\safe\\file:stream']) {
  test('Windows namespace syntax rejects UNC/device/drive-relative input ' + JSON.stringify(value), () => {
    assert.throws(() => assertNormalLocalPath(value, 'win32'), /NORMAL_LOCAL_NAMESPACE_REJECTED/);
  });
}
test('later executable UNC namespace rejects before any binary hash or metadata read', {skip: gitExecutable ? false : 'test Git binary missing'}, t => {
  const f = fixture(t); f.ticket.git.path = '//server/share/git.exe';
  const original = fs.lstatSync; let metadataReads = 0;
  fs.lstatSync = () => { metadataReads++; throw Error('UNEXPECTED_METADATA_READ'); };
  try {
    assert.throws(() => verifyNormalEntryTicket(f.ticket), /NORMAL_LOCAL_NAMESPACE_REJECTED/);
    assert.equal(metadataReads, 0);
  } finally { fs.lstatSync = original; }
});
test('normal source closure is frozen and caller mutation cannot remove coverage', () => {
  const closure = normalSourceClosure();
  assert.equal(sha(JSON.stringify(closure)), NORMAL_SOURCE_MANIFEST_SHA256);
  assert.equal(Object.keys(closure.files).length, 356);
  assert.ok(closure.files['public/index.html']); assert.ok(closure.files['src/config.mjs']);
  assert.ok(closure.files['package-lock.json']);
  delete closure.files['server.mjs']; assert.ok(normalSourceClosure().files['server.mjs']);
});
test('normal ticket verifies source bytes but does not qualify missing vendor/native/live evidence', { skip: sourceMissing }, t => {
  const f = fixture(t), result = verifyNormalEntryTicket(f.ticket);
  assert.equal(result.sourceFilesVerified, 356);
  assert.equal(result.fixedEntry, path.join(productRoot, 'server.mjs'));
  assert.equal(result.externalVendorQualification, 'MISSING_VENDOR_MANIFEST'); assert.equal(result.liveEligibility.allowed, false);
  assert.equal(result.nativeReadLeaseQualification, 'MISSING_NATIVE_ADMISSION');
  const env = normalEnvironmentPlan(f.ticket);
  assert.equal(env.DASHBOARD_PASSWORD_HASH, 'EXISTING_PROCESS_ENV:DASHBOARD_PASSWORD_HASH');
  assert.equal(env.CRU21_GUEST_ENABLED, '0'); assert.equal(env.PORT, '18722');
  assert.equal(env.CRU34_LIVE_DATA_ROOT, f.ticket.roots.producerDataRoot);
  assert.equal(env.ASK_GPT_CANDIDATE_READ_ROOT, f.ticket.roots.chartReadRoot);
  assert.notEqual(env.CRU34_LIVE_DATA_ROOT, env.ASK_GPT_CANDIDATE_READ_ROOT);
  assert.equal('DASHBOARD_FORMAL_READ_ROOT' in env, false); assert.equal('NODE_OPTIONS' in env, false);
  assert.match(env.PATH, /WindowsPowerShell/);
  assert.equal(env.COOKIE_SECURE, '1');
  assert.ok(result.liveEligibility.reasons.includes('NORMAL_LOOPBACK_SECURE_COOKIE_NOT_RUN'));
});
test('original-stdin helper bytes must match the ticket digest instead of self-reading source metadata', {skip: sourceMissing}, t => {
  const f = fixture(t), helperSourceUTF8 = fs.readFileSync(helper, 'utf8');
  assert.equal(verifyNormalEntryTicket(f.ticket, {helperSourceUTF8}).sourceFilesVerified, 356);
  assert.throws(() => verifyNormalEntryTicket(f.ticket, {helperSourceUTF8: helperSourceUTF8 + '\n// altered packet'}), /NORMAL_HELPER_HASH_REJECTED/);
});
test('normal listening frame binds intent and helper while reporting configured auth, not Owner login', t => {
  const f = fixture(t), listener = {address: '127.0.0.1', port: 18722, originalHandlerForwarded: true};
  const frame = normalListeningHandshake(f.ticket, listener);
  assert.equal(frame.intentHash, f.ticket.intentHash); assert.equal(frame.helperSHA256, f.ticket.helperSHA256);
  assert.equal(frame.normalAuthConfigured, true); assert.equal(frame.pid, process.pid);
  assert.equal('ownerLoggedIn' in frame, false);
  assert.throws(() => normalListeningHandshake(f.ticket, {...listener, port: 8790}), /NORMAL_LISTENING_OBSERVATION_REJECTED/);
  assert.equal(normalLiveEligibility().allowed, false);
});
for (const edit of [
  ticket => { ticket.runtimeAllowed = true; },
  ticket => { ticket.approved = true; },
  ticket => { ticket.productHead = '0'.repeat(40); },
  ticket => { ticket.sourceManifestSHA256 = '0'.repeat(64); },
  ticket => { ticket.roots.privateDataRoot = path.join(os.tmpdir(), 'foreign-private'); },
  ticket => { ticket.roots.producerDataRoot = ticket.roots.chartReadRoot; },
  ticket => { ticket.roots.evidenceRoot = path.parse(ticket.roots.chartReadRoot).root; },
  ticket => { ticket.roots.evidenceRoot = path.join(os.tmpdir(), 'foreign-authority'); },
  ticket => { ticket.normalAuth.csrfRequired = false; },
  ticket => { ticket.helperSHA256 = '0'.repeat(64); },
]) test('normal ticket rejects self-approval, wrong version/root/auth/helper', { skip: gitExecutable ? false : 'NOT_RUN: test Git binary not selected' }, t => {
  const f = fixture(t); edit(f.ticket);
  assert.throws(() => verifyNormalEntryTicket(f.ticket), /NORMAL_(TICKET|SPLIT_ROOT|AUTH_BOUNDARY|HELPER_HASH)/);
});
test('same normal observer attaches to f221 captured server listening event and preserves authenticated handler', { skip: vmMissing }, async t => {
  const f = fixture(t), bundle = buildApplicationBundle(productRoot);
  const result = await exerciseNormalBootstrap({ executeIsolatedApplication: ({ captureObserver }) => runIsolatedApplication({
    root: f.root, windowId: f.windowId, nonce: f.nonce, bundle, intentHash: 'a'.repeat(64), captureObserver }) });
  assert.equal(result.evidenceClass, 'ISOLATED_NORMAL_BOOTSTRAP_CONTRACT');
  assert.deepEqual(result.capturedListeningIntent, { address: '127.0.0.1', port: 18722, originalHandlerForwarded: true });
  assert.equal(result.application.normalAuthVerified, true); assert.equal(result.application.sessionCsrfVerified, true);
  assert.equal(result.application.capturedNormalHandler, true); assert.equal(result.application.observations.length, 11);
  assert.equal(result.realListenerObserved, false); assert.equal(result.liveEligibility.allowed, false);
  assert.ok(result.notRun.includes('REAL_SOURCE_DYNAMIC_IMPORT'));
});
test('old result object without an actual listening subscription cannot qualify bootstrap', async () => {
  await assert.rejects(exerciseNormalBootstrap({ executeIsolatedApplication: async () => ({
    evidenceClass: 'NORMAL_APPLICATION_VM_SYNTHETIC_DEPENDENCIES', runtimeAllowed: false,
    listenerOpened: false, capturedNormalHandler: true }) }), /NORMAL_ISOLATED_APPLICATION_EVIDENCE_REJECTED/);
});
test('normal listener observer forwards handler identity and rejects another address without opening sockets', async () => {
  const server = Object.assign(new EventEmitter(), { address: () => ({ address: '127.0.0.1', port: 8790 }) });
  const originalHandler = () => {}, seen = [];
  const facade = { createServer(handler) { seen.push(handler); return server; } }, original = facade.createServer;
  const observer = attachNormalListeningObserver(facade);
  assert.equal(facade.createServer(originalHandler), server); assert.equal(seen[0], originalHandler);
  server.emit('listening'); await assert.rejects(observer.listening, /NORMAL_LISTENER_ADDRESS_REJECTED/);
  observer.restore(); assert.equal(facade.createServer, original);
});

function vendorFixture(t) {
  const f = fixture(t), source = path.join(f.root, 'synthetic-vendor-source'); fs.mkdirSync(source);
  fs.copyFileSync(path.join(productRoot, 'package-lock.json'), path.join(source, 'package-lock.json'));
  for (const vendor of requiredNormalVendors()) {
    const dir = path.join(source, 'node_modules', ...vendor.name.split('/')); fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: vendor.name, version: vendor.version, main: 'index.js'}), {flag: 'wx'});
    fs.writeFileSync(path.join(dir, 'index.js'), '// PURE SYNTHETIC BYTES; NEVER IMPORTED\n', {flag: 'wx'});
  }
  const manifest = buildNormalVendorManifest(source);
  const ticket = {...f.ticket, roots: {...f.ticket.roots, sourceRoot: source},
    vendor: {manifest, manifestSHA256: normalCanonicalSHA256(manifest)}};
  return {...f, source, manifest, ticket};
}
test('vendor qualification verifies existing complete approved bytes, without importing package code', {skip: sourceMissing}, t => {
  const f = vendorFixture(t), result = verifyNormalVendorClosure(f.ticket);
  assert.equal(result.qualification, 'QUALIFIED'); assert.equal(result.filesVerified, 8);
  assert.equal(result.packagePublisherOriginRevalidated, false);
  assert.equal(result.manifestSHA256, f.ticket.vendor.manifestSHA256);
  assert.equal(normalLiveEligibility().allowed, false);
});
for (const [name, edit] of [
  ['omitted file', f => { delete f.ticket.vendor.manifest.files['koffi/index.js']; }],
  ['foreign relative path', f => { f.ticket.vendor.manifest.files['koffi/../../outside'] = 'a'.repeat(64); }],
  ['wrong package version', f => { f.ticket.vendor.manifest.packages[0].version = '0.0.0'; }],
  ['changed existing bytes', f => { fs.writeFileSync(path.join(f.source, 'node_modules/koffi/index.js'), '// CHANGED'); }],
  ['new executable sibling', f => { fs.writeFileSync(path.join(f.source, 'node_modules/koffi/new.js'), '// EXTRA'); }],
]) test('vendor qualification rejects ' + name, {skip: sourceMissing}, t => {
  const f = vendorFixture(t); edit(f);
  f.ticket.vendor.manifestSHA256 = normalCanonicalSHA256(f.ticket.vendor.manifest);
  assert.throws(() => verifyNormalVendorClosure(f.ticket), /NORMAL_VENDOR_/);
});
test('missing actual vendor package remains explicitly unqualified and never installs it', {skip: sourceMissing}, t => {
  const f = vendorFixture(t); fs.rmSync(path.join(f.source, 'node_modules/fancy-canvas'), {recursive: true});
  assert.equal(verifyNormalVendorClosure(f.ticket).qualification, 'MISSING_VENDOR_FILE');
  assert.equal(fs.existsSync(path.join(f.source, 'node_modules/fancy-canvas')), false);
});
test('caller vendor qualification flags cannot replace actual missing bytes', {skip: sourceMissing}, t => {
  const f = vendorFixture(t), vendor = verifyNormalVendorClosure(f.ticket), record = syntheticNativeRecord(f.ticket, vendor);
  fs.rmSync(path.join(f.source, 'node_modules/fancy-canvas'), {recursive: true});
  assert.throws(() => verifyNormalNativeAdmission(record, f.ticket, vendor), /NORMAL_NATIVE_VENDOR_NOT_QUALIFIED/);
});
test('vendor alias is rejected before reading its target content', {skip: sourceMissing || process.platform !== 'linux'}, t => {
  const f = vendorFixture(t), file = path.join(f.source, 'node_modules/koffi/index.js');
  const other = path.join(f.root, 'outside-synthetic.txt'); fs.writeFileSync(other, 'OUTSIDE_SYNTHETIC');
  fs.unlinkSync(file); fs.symlinkSync(other, file);
  assert.throws(() => verifyNormalVendorClosure(f.ticket), /NORMAL_VENDOR_ALIAS_REJECTED/);
});
function syntheticNativeRecord(ticket, vendor) {
  return {schema: 'cru21-normal-native-admission-v1', mode: 'NORMAL_CANDIDATE', productHead: NORMAL_PRODUCT.head,
    productTree: NORMAL_PRODUCT.tree, ticketSHA256: normalCanonicalSHA256(ticket),
    sourceManifestSHA256: NORMAL_SOURCE_MANIFEST_SHA256, vendorManifestSHA256: vendor.manifestSHA256,
    helperSHA256: ticket.helperSHA256, nodeSHA256: ticket.node.sha256, gitSHA256: ticket.git.sha256,
    rootsSHA256: normalCanonicalSHA256(ticket.roots), childPid: process.pid, childCreationFileTime: '134059998776655443',
    sourceRootIdentity: {volumeSerial: 'aabbccdd', fileId: '0011223344556677'},
    leases: {sourceFiles: 356, sourceSHA256: NORMAL_SOURCE_MANIFEST_SHA256, vendorFiles: vendor.filesVerified,
      vendorSHA256: vendor.manifestSHA256, node: true, helper: true, git: true, namespacePolicy: 'NO_UNTRUSTED_NAMESPACE_WRITES'},
    transport: 'ORIGINAL_INHERITED_PIPE', lifetime: 'UNTIL_ORIGINAL_CHILD_EXIT', qualified: true};
}
test('synthetic native-record binding validator accepts complete bindings without granting live eligibility', {skip: sourceMissing}, t => {
  const f = vendorFixture(t), vendor = verifyNormalVendorClosure(f.ticket), record = syntheticNativeRecord(f.ticket, vendor);
  const result = verifyNormalNativeAdmission(record, f.ticket);
  assert.equal(result.qualification, 'QUALIFIED');
  assert.equal(result.evidenceClass, 'BOUND_NATIVE_ADMISSION_RECORD');
  assert.equal(result.originalInheritedPipeRequired, true);
  assert.equal(normalLiveEligibility().allowed, false);
});
test('complete source and vendor bytes produce a qualified bound plan while normal launch remains HOLD', {skip: sourceMissing}, t => {
  const f = vendorFixture(t);
  // Only frozen repository source is copied into this local fixture. These
  // files contain no live data, vault, Session or external vendor contents.
  for (const name of Object.keys(normalSourceClosure().files)) {
    const destination = path.join(f.source, name); fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(productRoot, name), destination);
  }
  const privateDataRoot = path.join(f.source, 'data');
  Object.assign(f.ticket.roots, {privateDataRoot,
    localAppDataRoot: path.join(privateDataRoot, 'candidate-local-appdata'),
    chartCacheRoot: path.join(privateDataRoot, 'dashboard-chart-cache'),
    evidenceRoot: path.join(privateDataRoot, 'cru21-normal-candidate', f.windowId)});
  f.ticket.normalAuth.sessionPath = path.join(privateDataRoot, 'sessions.json');
  const vendor = verifyNormalVendorClosure(f.ticket), record = syntheticNativeRecord(f.ticket, vendor);
  const plan = verifyNormalEntryTicket(f.ticket, {nativeAdmission: record});
  assert.equal(plan.sourceFilesVerified, 356);
  assert.equal(plan.externalVendorQualification, 'QUALIFIED');
  assert.equal(plan.nativeReadLeaseQualification, 'QUALIFIED');
  assert.equal(plan.nativeAdmissionEvidence.evidenceClass, 'BOUND_NATIVE_ADMISSION_RECORD');
  assert.equal(plan.liveEligibility.allowed, false);
});
for (const [name, edit] of [
  ['ticket', r => { r.ticketSHA256 = '0'.repeat(64); }],
  ['roots', r => { r.rootsSHA256 = '0'.repeat(64); }],
  ['source coverage', r => { r.leases.sourceFiles = 1; }],
  ['vendor coverage', r => { r.leases.vendorFiles = 1; }],
  ['mutable namespace', r => { r.leases.namespacePolicy = 'ALLOW_OTHER_MODIFY'; }],
  ['other process', r => { r.childPid += 1; }],
  ['rounded creation time', r => { r.childCreationFileTime = Number(r.childCreationFileTime); }],
  ['path-file transport', r => { r.transport = 'SHARED_PATH_JSON'; }],
  ['released leases', r => { r.lifetime = 'UNTIL_HASH_FINISHES'; }],
]) test('synthetic native-record binding rejects ' + name, {skip: sourceMissing}, t => {
  const f = vendorFixture(t), vendor = verifyNormalVendorClosure(f.ticket), record = syntheticNativeRecord(f.ticket, vendor); edit(record);
  assert.throws(() => verifyNormalNativeAdmission(record, f.ticket), /NORMAL_NATIVE_/);
});
