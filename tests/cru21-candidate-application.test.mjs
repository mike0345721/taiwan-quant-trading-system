import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomBytes, randomUUID } from 'node:crypto';
import { APPLICATION_FILES, APPLICATION_PRODUCT, buildApplicationBundle, verifyApplicationBundle,
  applicationSHA256, APPLICATION_BUNDLE_SHA256, validateApplicationPacket,
  runIsolatedApplication, validateApplicationRoot } from '../scripts/cru21-normal-candidate/application-isolation.mjs';

const productRoot = process.env.CRU21_APPLICATION_SOURCE_ROOT;
const bundle = productRoot ? buildApplicationBundle(productRoot) : null;
const sourceMissing = !bundle ? 'NOT_RUN: CRU21_APPLICATION_SOURCE_ROOT must name the frozen f221 source' : false;
function fixture(t) {
  const root = path.join(os.tmpdir(), 'cru21-candidate-integration-20261028-' + randomUUID());
  const windowId = randomUUID(), nonce = randomBytes(32).toString('hex');
  return { root, windowId, nonce, bundle, intentHash: 'a'.repeat(64) };
}
function packetFor(f) {
  const intent = { schema: 'cru21-candidate-integration-intent-v1', mode: 'ISOLATED_NORMAL_APPLICATION',
    runtimeAllowed: false, windowId: f.windowId, nonce: f.nonce, productHead: APPLICATION_PRODUCT.head,
    productTree: APPLICATION_PRODUCT.tree, startMonoMs: 0, startUtcTicks: 1, durationMs: 3000,
    manifestSha256: 'b'.repeat(64) };
  const intentUTF8 = JSON.stringify(intent) + '\n', bundleUTF8 = JSON.stringify(bundle) + '\n';
  return { schema: 'cru21-normal-application-input-v1', root: f.root, windowId: f.windowId, nonce: f.nonce,
    mode: 'ISOLATED_NORMAL_APPLICATION', runtimeAllowed: false,
    productHead: APPLICATION_PRODUCT.head, productTree: APPLICATION_PRODUCT.tree,
    intent: { sha256: applicationSHA256(intentUTF8), contentUTF8: intentUTF8 },
    bundle: { sha256: applicationSHA256(bundleUTF8), contentUTF8: bundleUTF8 } };
}

test('application bundle is exactly the frozen f221 source subset and HTML', { skip: sourceMissing }, () => {
  const files = verifyApplicationBundle(bundle);
  assert.equal(bundle.productHead, APPLICATION_PRODUCT.head);
  assert.equal(bundle.productTree, APPLICATION_PRODUCT.tree);
  assert.deepEqual(Object.keys(files), Object.keys(APPLICATION_FILES));
  assert.match(files['server.mjs'], /new SessionStore/);
  assert.match(files['server.mjs'], /createInlineHandler/);
});
for (const edit of [
  copy => { copy.productHead = '807f940e4195153b9c2c83fc2ba0923ec0049203'; },
  copy => { copy.productTree = '0'.repeat(40); },
  copy => { copy.files['server.mjs'].content += '\n// changed'; },
  copy => { copy.files['src/security.mjs'].sha256 = '0'.repeat(64); },
  copy => { copy.files['extra.mjs'] = { sha256: '0'.repeat(64), content: '' }; },
  copy => { delete copy.files['public/index.html']; },
]) {
  test('wrong product, changed source, missing or added bundle files fail closed', { skip: sourceMissing }, () => {
    const copy = structuredClone(bundle); edit(copy);
    assert.throws(() => verifyApplicationBundle(copy), /APPLICATION_(BUNDLE_IDENTITY_REJECTED|SOURCE_HASH_MISMATCH)/);
  });
}
test('fixed authority rejects foreign roots, nonces and window identities', t => {
  const f = fixture(t);
  assert.throws(() => validateApplicationRoot('/workspace', f.windowId, f.nonce), /APPLICATION_TEMP_ROOT_REQUIRED/);
  assert.throws(() => validateApplicationRoot(f.root, '../foreign', f.nonce), /APPLICATION_BINDING_REJECTED/);
  assert.throws(() => validateApplicationRoot(f.root, f.windowId, 'not-a-nonce'), /APPLICATION_BINDING_REJECTED/);
});
test('real normal application callback verifies password Session CSRF and read-only AI without sockets', {
  skip: sourceMissing || (typeof vm.SourceTextModule !== 'function' ? 'requires --experimental-vm-modules, no fallback execution' : false),
}, async t => {
  const f = fixture(t), result = await runIsolatedApplication(f);
  assert.equal(result.schema, 'cru21-normal-application-handshake-v1');
  assert.equal(result.productHead, APPLICATION_PRODUCT.head);
  assert.equal(result.productTree, APPLICATION_PRODUCT.tree);
  assert.equal(result.entrySHA256, APPLICATION_FILES['server.mjs']);
  assert.equal(result.intentHash, f.intentHash); assert.equal(result.nonce, f.nonce);
  assert.equal(result.capturedNormalHandler, true);
  assert.equal(result.normalAuthVerified, true); assert.equal(result.sessionCsrfVerified, true);
  assert.equal(result.automaticAIStatusReadOnlyVerified, true);
  assert.equal(result.storeInspectorClass, 'SYNTHETIC_MISSING_NO_STORE');
  assert.equal(result.automaticStatusWrites + result.automaticStatusCredentialCalls, 0);
  assert.equal(result.listenerOpened, false); assert.equal(result.runtimeAllowed, false);
  assert.equal(result.networkCalls + result.childProcessCalls + result.realCredentialReads, 0);
  assert.deepEqual(result.observations.map(({ method, route, status }) => [method, route, status]), [
    ['GET', '/api/v1/ask-gpt/status', 401], ['GET', '/api/v1/ask-gpt/status', 401],
    ['POST', '/api/auth/login', 401], ['POST', '/api/auth/login', 200], ['GET', '/api/session', 200],
    ['GET', '/api/v1/ask-gpt/status', 200], ['GET', '/api/v1/ask-gpt/status', 200],
    ['POST', '/api/v1/ask-gpt/accounts', 403], ['POST', '/api/v1/ask-gpt/accounts', 403],
    ['GET', '/', 200], ['GET', '/api/v1/observed-flow', 200],
  ]);
  assert.ok(result.observations.every(x => /^[a-f0-9]{64}$/.test(x.responseSHA256)));
  assert.equal(result.filesystemClass, 'SYNTHETIC_MEMORY');
  assert.deepEqual(result.privateWritePaths, []);
  assert.ok(result.syntheticWritePaths.includes('synthetic-app/data/sessions.json'));
  assert.doesNotMatch(JSON.stringify(result), /scrypt-v1|csrfToken|twchip_session=/);
  await assert.rejects(runIsolatedApplication(f), /APPLICATION_WINDOW_ALREADY_ATTEMPTED/);
});
test('bad bundle is rejected before consuming an in-memory application attempt', {
  skip: sourceMissing || (typeof vm.SourceTextModule !== 'function' ? 'requires --experimental-vm-modules' : false),
}, async t => {
  const f = fixture(t), changed = structuredClone(bundle); changed.files['server.mjs'].content += '\n';
  await assert.rejects(runIsolatedApplication({ ...f, bundle: changed }), /APPLICATION_SOURCE_HASH_MISMATCH/);
  const result = await runIsolatedApplication(f);
  assert.deepEqual(result.privateWritePaths, []);
});
test('physical private-state alias is never followed by the memory-only application', {
  skip: sourceMissing || (typeof vm.SourceTextModule !== 'function' ? 'requires --experimental-vm-modules' : process.platform === 'win32' ? 'unit symlink creation is not authorized on Windows' : false),
}, async t => {
  const f = fixture(t), data = path.join(f.root, 'private', f.windowId, 'synthetic-app', 'data');
  fs.mkdirSync(data, { recursive: true }); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const foreign = path.join(f.root, 'foreign-synthetic-only'); fs.writeFileSync(foreign, '{}\n');
  fs.symlinkSync(foreign, path.join(data, 'sessions.json'));
  const result = await runIsolatedApplication(f);
  assert.equal(result.normalAuthVerified, true); assert.equal(result.filesystemClass, 'SYNTHETIC_MEMORY');
  assert.deepEqual(result.privateWritePaths, []);
  assert.equal(fs.readFileSync(foreign, 'utf8'), '{}\n');
});
test('normal handler and Session run with all host pathname filesystem methods disabled', {
  skip: sourceMissing || (typeof vm.SourceTextModule !== 'function' ? 'requires --experimental-vm-modules' : false),
}, async t => {
  const f = fixture(t), packet = packetFor(f), names = ['lstatSync', 'statSync', 'existsSync', 'realpathSync', 'readFileSync',
    'writeFileSync', 'mkdirSync', 'readdirSync', 'openSync'];
  const original = Object.fromEntries(names.map(name => [name, fs[name]])); let calls = 0;
  for (const name of names) fs[name] = () => { calls++; throw Error('HOST_FILESYSTEM_MUST_NOT_BE_USED'); };
  let result;
  try {
    const input = validateApplicationPacket(packet, f);
    result = await runIsolatedApplication(input);
  }
  finally { for (const name of names) fs[name] = original[name]; }
  assert.equal(calls, 0); assert.equal(result.applicationPathReads + result.applicationPathWrites, 0);
  assert.equal(result.normalAuthVerified, true); assert.deepEqual(result.privateWritePaths, []);
});
test('fixed stdin packet binds root, window, nonce, bytes and frozen bundle without filesystem access', { skip: sourceMissing }, t => {
  const f = fixture(t), packet = packetFor(f), input = validateApplicationPacket(packet, f);
  assert.equal(packet.bundle.sha256, APPLICATION_BUNDLE_SHA256);
  assert.equal(input.intentHash, packet.intent.sha256);
  assert.equal(input.bundle.productHead, APPLICATION_PRODUCT.head);
});
for (const edit of [
  copy => { copy.root += '-foreign'; },
  copy => { copy.nonce = '0'.repeat(64); },
  copy => { copy.runtimeAllowed = true; },
  copy => { copy.mode = 'NORMAL_CANDIDATE'; },
  copy => { copy.productHead = '0'.repeat(40); },
  copy => { copy.intent.contentUTF8 += ' '; },
  copy => { copy.bundle.contentUTF8 += ' '; },
  copy => { copy.execute = 'arbitrary-script'; },
  copy => { const value = JSON.parse(copy.intent.contentUTF8); value.durationMs = 900001; copy.intent.contentUTF8 = JSON.stringify(value); copy.intent.sha256 = applicationSHA256(copy.intent.contentUTF8); },
]) test('stdin packet rejects altered binding, approval flags, bytes or deadline', { skip: sourceMissing }, t => {
  const f = fixture(t), changed = packetFor(f); edit(changed);
  assert.throws(() => validateApplicationPacket(changed, f), /APPLICATION_(PACKET|INTENT_BINDING)/);
});
