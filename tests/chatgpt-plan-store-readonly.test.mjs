import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as stores from '../src/chatgpt-plan-store.mjs';

const USER = 'S-1-5-21-100-200-300-1001', SYSTEM = 'S-1-5-18', ADMINS = 'S-1-5-32-544';
const TRUSTED_INSTALLER = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const HEADER = Buffer.from('01000000d08c9ddf0115d1118c7a00c04fc297eb', 'hex');
const opaque = () => Buffer.concat([HEADER, Buffer.alloc(96, 7)]).toString('base64');
const plain = () => ({ schema: 'cru21-siwc-vault-v1', hostId: `urn:uuid:${randomUUID()}`, registrations: {} });
// Synthetic envelope only: no Windows credential or DPAPI operation.
const encodeFixture = value => Buffer.concat([HEADER, Buffer.from(value)]).toString('base64');
const decodeFixture = value => Buffer.from(value, 'base64').subarray(HEADER.length).toString('utf8');
function fixture(t, { existing = true, cipher = opaque() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-status-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const localAppData = path.join(root, 'Local'), parent = path.join(localAppData, 'TaiwanQuantDashboard'), dir = path.join(parent, 'ChatGPTPlan'), file = path.join(dir, 'siwc-v1.dpapi');
  fs.mkdirSync(localAppData);
  if (existing) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, cipher); }
  return { root, localAppData, parent, dir, file, lock: path.join(dir, 'siwc-v1.writer-lock') };
}
function security({ paths }) {
  return { currentUserSid: USER, entries: paths.map(({ path: target, kind }) => ({ path: target, ownerSid: USER, protected: true, reparsePoint: false, rules: [{ sid: USER, type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2032127 }, { sid: SYSTEM, type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2032127 }, ...(kind === 'ancestor' ? [{ sid: ADMINS, type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2032127 }, { sid: 'S-1-5-32-545', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 1179817 }] : [])] })) };
}
function options(f, extra = {}) { return { platform: 'win32', localAppData: f.localAppData, securityInspector: security, ...extra }; }
function snapshot(root) {
  const out = [];
  function visit(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name), stat = fs.lstatSync(file); out.push([path.relative(root, file), stat.mode, stat.size, stat.mtimeMs, stat.ino, stat.isFile() ? fs.readFileSync(file).toString('base64') : null]); if (stat.isDirectory()) visit(file); } }
  visit(root); return out;
}
function readonlyFs(calls) {
  const io = { ...fs };
  for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'writeSync', 'renameSync', 'unlinkSync', 'rmSync', 'chmodSync', 'chownSync']) io[name] = () => { calls.push(name); throw new Error(`unexpected write: ${name}`); };
  io.openSync = (file, flags, ...args) => { if (typeof flags === 'string' ? !['r', 'rs'].includes(flags) : (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC))) { calls.push('open-write'); throw new Error('unexpected write open'); } return fs.openSync(file, flags, ...args); };
  return io;
}

test('initialize:false rejects a missing vault before encrypting, locking or persisting', t => {
  const f = fixture(t); fs.unlinkSync(f.file); let encryptions = 0;
  assert.throws(() => stores.createProtectedPlanStore({ dir: f.dir, initialize: false, encrypt: value => { encryptions++; return value; }, decrypt: value => value }), /CREDENTIAL_STORE_MISSING/);
  assert.equal(encryptions, 0);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('readValidation rejects before loading or decrypting an existing store', t => {
  const f = fixture(t, { cipher: JSON.stringify(plain()) }); let decryptions = 0, validations = 0;
  assert.throws(() => stores.createProtectedPlanStore({ dir: f.dir, initialize: false, encrypt: value => value, decrypt: value => { decryptions++; return value; }, readValidation() { validations++; throw new Error('READ_VALIDATION_DENIED'); } }), /READ_VALIDATION_DENIED/);
  assert.equal(validations, 1); assert.equal(decryptions, 0);
});

test('inspect existing opaque store repeatedly without mutation, decryption or account claims', t => {
  const f = fixture(t), before = snapshot(f.root), mutations = []; let decryptions = 0;
  for (let i = 0; i < 3; i++) {
    const status = stores.inspectWindowsPlanStore(options(f, { fs: readonlyFs(mutations), decrypt() { decryptions++; throw new Error('forbidden'); } }));
    assert.deepEqual(status, { state: 'PRESENT_UNVERIFIED', reason: 'ACCOUNT_METADATA_NOT_LOADED', accountMetadataLoaded: false });
  }
  assert.deepEqual(mutations, []); assert.equal(decryptions, 0); assert.deepEqual(snapshot(f.root), before);
});

test('missing store is reported without mkdir, sidecar, ACL setter or writer lock', t => {
  const f = fixture(t, { existing: false }), before = snapshot(f.root), mutations = [];
  const status = stores.inspectWindowsPlanStore(options(f, { fs: readonlyFs(mutations) }));
  assert.equal(status.state, 'MISSING'); assert.equal(status.reason, 'CREDENTIAL_STORE_MISSING');
  assert.deepEqual(snapshot(f.root), before); assert.deepEqual(mutations, []);
});

test('unknown writer lock remains BUSY and unchanged across status retries', t => {
  const f = fixture(t); fs.writeFileSync(f.lock, 'unknown writer'); const before = snapshot(f.root);
  for (let i = 0; i < 2; i++) assert.equal(stores.inspectWindowsPlanStore(options(f)).reason, 'CREDENTIAL_STORE_BUSY');
  assert.deepEqual(snapshot(f.root), before);
});

test('non-Windows entry refuses before native security or crypto adapters', t => {
  const f = fixture(t); let securityCalls = 0;
  assert.throws(() => stores.inspectWindowsPlanStore(options(f, { platform: 'linux', securityInspector() { securityCalls++; throw new Error('forbidden'); } })), /WINDOWS_PROTECTED_STORE_REQUIRED/);
  assert.equal(securityCalls, 0);
});

test('unsafe store or file ACLs fail closed without repair, decryption or leaked paths', t => {
  for (const variant of ['extra-store-writer', 'file-admin', 'owner', 'null-dacl', 'bad-sid', 'unknown-rule']) {
    const f = fixture(t), before = snapshot(f.root), mutations = [];
    const securityInspector = request => {
      const result = security(request), dir = result.entries.find(entry => entry.path === f.dir), file = result.entries.find(entry => entry.path === f.file);
      if (variant === 'extra-store-writer') dir.rules.push({ sid: 'S-1-1-0', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2032127 });
      if (variant === 'file-admin') file.rules.push({ sid: ADMINS, type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2032127 });
      if (variant === 'owner') dir.ownerSid = 'S-1-5-21-999-999-999-999';
      if (variant === 'null-dacl') dir.rules = [];
      if (variant === 'bad-sid') result.currentUserSid = 'unknown';
      if (variant === 'unknown-rule') file.rules[0].rights = 'FullControl';
      return result;
    };
    const status = stores.inspectWindowsPlanStore(options(f, { securityInspector, fs: readonlyFs(mutations) }));
    assert.equal(status.state, 'UNSAFE', variant); assert.equal(status.accountMetadataLoaded, false);
    assert.equal(JSON.stringify(status).includes(f.root), false);
    assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
  }
});

test('ancestor delete-child, write-data, ACL and owner permissions cannot be granted to other SIDs', t => {
  for (const rights of [2, 16, 64, 256, 65536, 262144, 524288, 0x40000000, 0x10000000, 1245631]) {
    const f = fixture(t);
    const status = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) { const result = security(request); result.entries.find(entry => entry.path === f.localAppData).rules.push({ sid: 'S-1-1-0', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights }); return result; } }));
    assert.equal(status.reason, 'CREDENTIAL_ACL_UNSAFE', String(rights));
  }
});

test('exact TrustedInstaller ancestor ownership permits existing read-only records without repair', t => {
  const data = plain(), f = fixture(t, { cipher: encodeFixture(JSON.stringify(data)) }), before = snapshot(f.root), mutations = [];
  const securityInspector = request => { const result = security(request); result.entries[0].ownerSid = TRUSTED_INSTALLER; return result; };
  assert.equal(stores.inspectWindowsPlanStore(options(f, { securityInspector, fs: readonlyFs(mutations) })).state, 'PRESENT_UNVERIFIED');
  const store = stores.openExistingWindowsPlanStore(options(f, { securityInspector, fs: readonlyFs(mutations), decrypt: decodeFixture, encrypt() { throw new Error('ENCRYPT_FORBIDDEN'); } }));
  assert.equal(store.hostId, data.hostId); assert.deepEqual(store.list(), []);
  assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
});

test('ancestor create-subdirectory permission creates no replacement capability on the selected path', t => {
  for (const variant of ['direct', 'read-and-create', 'no-propagate']) {
    const f = fixture(t), before = snapshot(f.root), mutations = [];
    const result = stores.inspectWindowsPlanStore(options(f, { fs: readonlyFs(mutations), securityInspector(request) {
      const result = security(request), ancestor = result.entries.find(entry => entry.path === f.localAppData);
      ancestor.rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: variant === 'no-propagate' ? 3 : 0, propagation: variant === 'no-propagate' ? 1 : 0, rights: variant === 'read-and-create' ? (1179817 | 4) : 4 });
      if (variant === 'no-propagate') result.entries.find(entry => entry.path === f.parent).rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: true, inheritance: 0, propagation: 0, rights: 4 });
      return result;
    } }));
    assert.equal(result.state, 'PRESENT_UNVERIFIED', variant);
    assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
  }
});

test('Windows servicing owner and sibling creation coexist with an inherit-only creator grant', t => {
  const f = fixture(t);
  const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
    const result = security(request), root = result.entries[0]; root.ownerSid = TRUSTED_INSTALLER;
    root.rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 4 });
    root.rules.push({ sid: 'S-1-3-0', type: 'Allow', inherited: false, inheritance: 3, propagation: 2, rights: -536805376 });
    return result;
  } }));
  assert.equal(result.state, 'PRESENT_UNVERIFIED');
});

test('unknown owners and lookalike service SIDs remain unsafe even with only read grants', t => {
  for (const ownerSid of [TRUSTED_INSTALLER.slice(0, -1) + '5', 'S-1-5-80-1-2-3-4-5', 'S-1-5-21-999-999-999-999']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) { const result = security(request); result.entries[0].ownerSid = ownerSid; result.entries[0].rules = [{ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 1179817 }]; return result; } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE');
  }
});

test('TrustedInstaller identity never grants leaf ownership or an ancestor privileged ACE bypass', t => {
  for (const variant of ['directory-owner', 'file-owner', 'ancestor-full-ace', 'directory-read-ace', 'file-read-ace']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request), dir = result.entries.find(entry => entry.path === f.dir), file = result.entries.find(entry => entry.path === f.file);
      if (variant === 'directory-owner') dir.ownerSid = TRUSTED_INSTALLER;
      else if (variant === 'file-owner') file.ownerSid = TRUSTED_INSTALLER;
      else (variant === 'ancestor-full-ace' ? result.entries[0] : variant === 'directory-read-ace' ? dir : file).rules.push({ sid: TRUSTED_INSTALLER, type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: variant === 'ancestor-full-ace' ? 2032127 : 1179817 });
      return result;
    } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE', variant);
  }
});

test('TrustedInstaller cannot own an otherwise exact writer lease before decryption or persistence', t => {
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(plain())) }), original = fs.readFileSync(f.file); let decryptions = 0, encryptions = 0;
  const store = stores.openExistingWindowsPlanStore(options(f, { decrypt(value) { decryptions++; return decodeFixture(value); }, encrypt(value) { encryptions++; return encodeFixture(value); }, securityInspector(request) {
    const result = security(request), lock = result.entries.find(entry => entry.path === f.lock); if (lock) lock.ownerSid = TRUSTED_INSTALLER; return result;
  } }));
  const beforeDecryptions = decryptions;
  assert.throws(() => store.save({ issuer: 'fixture', client_id: 'fixture', subject: 'fixture' }), /CREDENTIAL_ACL_UNSAFE/);
  assert.equal(decryptions, beforeDecryptions); assert.equal(encryptions, 0);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(f.lock), false);
});

test('create-subdirectory permission is still forbidden on protected directory and file leaves', t => {
  for (const target of ['directory', 'file']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request); result.entries.find(entry => entry.path === (target === 'directory' ? f.dir : f.file)).rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 4 }); return result;
    } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE', target);
  }
});

test('parent delete-child and child delete grants remain unsafe despite a child delete denial', t => {
  for (const variant of ['parent-delete-child', 'child-directory-delete', 'child-file-delete']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request), dir = result.entries.find(entry => entry.path === f.dir), file = result.entries.find(entry => entry.path === f.file);
      dir.rules.unshift({ sid: 'S-1-5-11', type: 'Deny', inherited: false, inheritance: 0, propagation: 0, rights: 65536 });
      file.rules.unshift({ sid: 'S-1-5-11', type: 'Deny', inherited: false, inheritance: 0, propagation: 0, rights: 65536 });
      const target = variant === 'parent-delete-child' ? result.entries.find(entry => entry.path === f.parent) : variant === 'child-directory-delete' ? dir : file;
      target.rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: variant === 'parent-delete-child' ? 64 : 65536 });
      return result;
    } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE', variant);
  }
});

test('effective inherited child creation and no-propagate dangerous writes do not inherit ancestor exceptions', t => {
  for (const variant of ['effective-leaf-create', 'effective-child-delete', 'no-propagate-write']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request), ancestor = result.entries.find(entry => entry.path === f.localAppData);
      if (variant === 'no-propagate-write') ancestor.rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 3, propagation: 1, rights: 2 });
      else {
        ancestor.rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: false, inheritance: 3, propagation: 2, rights: variant === 'effective-leaf-create' ? 4 : 65536 });
        result.entries.find(entry => entry.path === (variant === 'effective-leaf-create' ? f.dir : f.parent)).rules.push({ sid: 'S-1-5-11', type: 'Allow', inherited: true, inheritance: 0, propagation: 0, rights: variant === 'effective-leaf-create' ? 4 : 65536 });
      }
      return result;
    } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE', variant);
  }
});

test('safe inherited file ACL and normal ancestor Administrators/read-only Users remain compatible', t => {
  const f = fixture(t);
  const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
    const result = security(request), file = result.entries.find(entry => entry.path === f.file);
    file.protected = false; file.rules.forEach(rule => { rule.inherited = true; });
    return result;
  } }));
  assert.equal(result.state, 'PRESENT_UNVERIFIED');
});

test('malformed, truncated, oversized or non-DPAPI-looking opaque data is unavailable without decrypt', t => {
  for (const cipher of ['', 'not encrypted at all', 'e30=', Buffer.alloc(100).toString('base64'), HEADER.toString('base64'), `${opaque()}*`, 'a'.repeat(1048577)]) {
    const f = fixture(t, { cipher }), before = snapshot(f.root); let decryptions = 0;
    const result = stores.inspectWindowsPlanStore(options(f, { decrypt() { decryptions++; throw new Error('must never decrypt'); } }));
    assert.ok(['UNREADABLE', 'UNSAFE'].includes(result.state));
    assert.equal(decryptions, 0); assert.deepEqual(snapshot(f.root), before);
  }
});

test('symlink, hardlink, directory and reparse file identities are rejected', t => {
  for (const variant of ['file-symlink', 'file-hardlink', 'directory-symlink', 'ancestor-symlink', 'native-reparse']) {
    const f = fixture(t);
    if (variant === 'file-symlink') { fs.renameSync(f.file, path.join(f.root, 'cipher')); fs.symlinkSync(path.join(f.root, 'cipher'), f.file); }
    if (variant === 'file-hardlink') fs.linkSync(f.file, path.join(f.root, 'cipher-hardlink'));
    if (variant === 'directory-symlink') { fs.renameSync(f.dir, path.join(f.root, 'real-dir')); fs.symlinkSync(path.join(f.root, 'real-dir'), f.dir, 'dir'); }
    if (variant === 'ancestor-symlink') { fs.renameSync(f.localAppData, path.join(f.root, 'real-local')); fs.symlinkSync(path.join(f.root, 'real-local'), f.localAppData, 'dir'); }
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) { const result = security(request); if (variant === 'native-reparse') result.entries[0].reparsePoint = true; return result; } }));
    assert.equal(result.state, 'UNSAFE', variant);
  }
});

test('security inspection failures and retries remain read-only, redact details and do not self-repair', t => {
  const f = fixture(t), before = snapshot(f.root), mutations = []; let checks = 0;
  for (let i = 0; i < 2; i++) {
    const result = stores.inspectWindowsPlanStore(options(f, { fs: readonlyFs(mutations), securityInspector() { checks++; throw new Error(`private path ${f.file}`); } }));
    assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'CREDENTIAL_SECURITY_INSPECTION_FAILED', accountMetadataLoaded: false });
  }
  assert.equal(checks, 2); assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
});

test('file replacement or ACL change during metadata read refuses the observation', t => {
  for (const variant of ['inode', 'acl']) {
    const f = fixture(t); let calls = 0, replaced = false;
    const io = { ...fs, readFileSync(file, ...args) {
      const value = fs.readFileSync(file, ...args);
      if (typeof file === 'number' && !replaced && variant === 'inode') { replaced = true; fs.renameSync(f.file, path.join(f.root, 'original')); fs.writeFileSync(f.file, value); }
      return value;
    } };
    const status = stores.inspectWindowsPlanStore(options(f, { fs: io, securityInspector(request) {
      calls++; const result = security(request);
      if (variant === 'acl' && calls > 1) result.entries.find(entry => entry.path === f.dir).rules.push({ sid: 'S-1-1-0', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2 });
      return result;
    } }));
    assert.equal(status.state, 'UNSAFE', variant);
  }
});

test('explicit existing open loads synthetic accounts without initialization, locks or encryption', t => {
  const data = plain(), record = { issuer: 'fixture', client_id: 'fixture', subject: 'fixture', email: 'synthetic@example.invalid', expiresAt: 12345 }, key = stores.registrationKey(record);
  data.registrations[key] = record;
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(data)) }), before = snapshot(f.root), mutations = []; let decryptions = 0, encryptions = 0;
  const store = stores.openExistingWindowsPlanStore(options(f, { fs: readonlyFs(mutations), decrypt(value) { decryptions++; return decodeFixture(value); }, encrypt() { encryptions++; throw new Error('not a write action'); } }));
  assert.equal(store.hostId, data.hostId); assert.equal(store.get(key).subject, 'fixture'); assert.equal(store.list().length, 1);
  assert.equal(decryptions, 1); assert.equal(encryptions, 0); assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
  store.reload(); assert.equal(decryptions, 2);
});

test('explicit open rejects missing, unsafe, corrupt and locked stores before decrypting', t => {
  for (const variant of ['missing', 'unsafe', 'corrupt', 'lock']) {
    const f = fixture(t, { existing: variant !== 'missing', cipher: variant === 'corrupt' ? 'garbage' : opaque() });
    if (variant === 'lock') fs.writeFileSync(f.lock, 'foreign lock');
    const before = snapshot(f.root); let decryptions = 0;
    assert.throws(() => stores.openExistingWindowsPlanStore(options(f, { decrypt() { decryptions++; return JSON.stringify(plain()); }, securityInspector(request) {
      const result = security(request); if (variant === 'unsafe') result.entries.at(-1).ownerSid = 'S-1-1-0'; return result;
    } })));
    assert.equal(decryptions, 0); assert.deepEqual(snapshot(f.root), before);
  }
});

test('explicit save and rotation accept only their exact owned writer lock; status remains BUSY', async t => {
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(plain())) });
  const store = stores.openExistingWindowsPlanStore(options(f, { encrypt: encodeFixture, decrypt: decodeFixture }));
  const record = { issuer: 'fixture', client_id: 'fixture', subject: 'fixture', expiresAt: 12345 };
  const key = store.save(record); assert.equal(fs.existsSync(f.lock), false);
  let unblock; const wait = new Promise(resolve => { unblock = resolve; });
  const pending = store.updateExclusive(key, async old => { await wait; return { record: { ...old, expiresAt: 23456 }, result: 'rotated' }; });
  const lockBytes = fs.readFileSync(f.lock);
  assert.equal(stores.inspectWindowsPlanStore(options(f)).state, 'BUSY');
  assert.deepEqual(fs.readFileSync(f.lock), lockBytes);
  const other = () => stores.openExistingWindowsPlanStore(options(f, { encrypt: encodeFixture, decrypt: decodeFixture }));
  assert.throws(other, /CREDENTIAL_STORE_BUSY/);
  unblock(); assert.equal(await pending, 'rotated');
  assert.equal(fs.existsSync(f.lock), false); store.reload(); assert.equal(store.get(key).expiresAt, 23456);
});

test('validation after open rejects a new foreign lock before decrypting or writing', t => {
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(plain())) }); let decryptions = 0;
  const store = stores.openExistingWindowsPlanStore(options(f, { encrypt: encodeFixture, decrypt(value) { decryptions++; return decodeFixture(value); } }));
  fs.writeFileSync(f.lock, 'foreign'); const before = snapshot(f.root), prior = decryptions;
  assert.throws(() => store.reload(), /CREDENTIAL_STORE_BUSY/);
  assert.throws(() => store.save({ issuer: 'fixture', client_id: 'fixture', subject: 'fixture' }), /CREDENTIAL_STORE_BUSY/);
  assert.equal(decryptions, prior); assert.deepEqual(snapshot(f.root), before);
});

test('async validation is rejected rather than silently bypassed', t => {
  const f = fixture(t, { cipher: JSON.stringify(plain()) }); let decryptions = 0;
  assert.throws(() => stores.createProtectedPlanStore({ dir: f.dir, initialize: false, readValidation: async () => {}, decrypt(value) { decryptions++; return value; }, encrypt: value => value }), /CREDENTIAL_READ_VALIDATION_INVALID/);
  assert.equal(decryptions, 0);
});

test('cached account access also revalidates safety instead of bypassing a changed ACL', t => {
  const data = plain(), record = { issuer: 'fixture', client_id: 'fixture', subject: 'fixture' }, key = stores.registrationKey(record);
  data.registrations[key] = record;
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(data)) }); let unsafe = false, decryptions = 0;
  const store = stores.openExistingWindowsPlanStore(options(f, { decrypt(value) { decryptions++; return decodeFixture(value); }, securityInspector(request) {
    const result = security(request); if (unsafe) result.entries.find(entry => entry.path === f.dir).rules.push({ sid: 'S-1-1-0', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights: 2 }); return result;
  } }));
  unsafe = true;
  assert.throws(() => store.get(key), /CREDENTIAL_ACL_UNSAFE/);
  assert.throws(() => store.list(), /CREDENTIAL_ACL_UNSAFE/);
  assert.throws(() => store.hostId, /CREDENTIAL_ACL_UNSAFE/);
  assert.equal(decryptions, 1);
});

test('an identical-stamp foreign lock inode cannot be accepted or cleaned as the owned writer', t => {
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(plain())) }); let armed = false, swapped = false, decryptions = 0;
  const backup = path.join(f.root, 'original-writer-lock');
  const store = stores.openExistingWindowsPlanStore(options(f, { encrypt: encodeFixture, decrypt(value) { decryptions++; return decodeFixture(value); }, securityInspector(request) {
    const result = security(request);
    if (armed && fs.existsSync(f.lock)) { armed = false; swapped = true; fs.renameSync(f.lock, backup); fs.writeFileSync(f.lock, fs.readFileSync(backup)); }
    return result;
  } }));
  const originalCipher = fs.readFileSync(f.file), priorDecryptions = decryptions; armed = true;
  assert.throws(() => store.save({ issuer: 'fixture', client_id: 'fixture', subject: 'fixture' }));
  assert.equal(swapped, true); assert.equal(decryptions, priorDecryptions);
  assert.ok(fs.existsSync(backup)); assert.ok(fs.existsSync(f.lock));
  assert.notEqual(fs.statSync(backup).ino, fs.statSync(f.lock).ino);
  assert.deepEqual(fs.readFileSync(backup), fs.readFileSync(f.lock));
  assert.deepEqual(fs.readFileSync(f.file), originalCipher);
});

test('unrelated ancestor directory activity does not invalidate stable protected store identity', t => {
  const f = fixture(t); let changed = false;
  const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
    if (!changed) { changed = true; fs.mkdirSync(path.join(f.root, 'unrelated')); }
    return security(request);
  } }));
  assert.equal(result.state, 'PRESENT_UNVERIFIED');
});

test('a foreign writer lock appearing during the read is BUSY and never cleaned', t => {
  const f = fixture(t); let changed = false;
  const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
    if (!changed) { changed = true; fs.writeFileSync(f.lock, 'appeared'); }
    return security(request);
  } }));
  assert.equal(result.state, 'BUSY'); assert.equal(fs.readFileSync(f.lock, 'utf8'), 'appeared');
});

test('decrypted registrations must be a plain keyed account map rather than a string or array', t => {
  for (const registrations of ['bad', [], { ['a'.repeat(64)]: null }, { ['a'.repeat(64)]: [] }]) {
    const f = fixture(t, { cipher: encodeFixture(JSON.stringify({ ...plain(), registrations })) }), before = snapshot(f.root);
    assert.throws(() => stores.openExistingWindowsPlanStore(options(f, { decrypt: decodeFixture })), /CREDENTIAL_STORE_INVALID/);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('ancestor CREATOR OWNER inherit-only permission does not grant direct access on that ancestor', t => {
  const f = fixture(t);
  const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
    const result = security(request); result.entries.find(entry => entry.path === f.localAppData).rules.push({ sid: 'S-1-3-0', type: 'Allow', inherited: false, inheritance: 3, propagation: 2, rights: 2032127 }); return result;
  } }));
  assert.equal(result.state, 'PRESENT_UNVERIFIED');
});

test('unknown ancestor rights including ACCESS_SYSTEM_SECURITY cannot be treated as read-only', t => {
  for (const rights of [0x01000000, 0x2000, 0x01000004, 0x2004]) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request); result.entries.find(entry => entry.path === f.localAppData).rules.push({ sid: 'S-1-1-0', type: 'Allow', inherited: false, inheritance: 0, propagation: 0, rights }); return result;
    } }));
    assert.equal(result.state, 'UNSAFE');
  }
});

test('loaded account keys, required identity fields and optional metadata are validated before listing', t => {
  const base = { issuer: 'fixture', client_id: 'fixture', subject: 'fixture' };
  for (const change of [{ issuer: '' }, { client_id: 123 }, { subject: '  ' }, { email: {} }, { access_token: 123 }, { refresh_token: [] }, { id_token: {} }, { originalNonce: {} }, { savedAt: 123 }, { expiresAt: '123' }, { expiresAt: -1 }, { earliestRefreshAt: 'tomorrow' }, { scopes: 'scope' }, { scopes: [{}] }]) {
    const record = { ...base, ...change }, registrations = { [stores.registrationKey(record)]: record };
    const f = fixture(t, { cipher: encodeFixture(JSON.stringify({ ...plain(), registrations })) });
    assert.throws(() => stores.openExistingWindowsPlanStore(options(f, { decrypt: decodeFixture })), /CREDENTIAL_STORE_INVALID/, JSON.stringify(change));
  }
  for (const key of ['bad', 'a'.repeat(64), '__proto__']) {
    const registrations = Object.fromEntries([[key, base]]), f = fixture(t, { cipher: encodeFixture(JSON.stringify({ ...plain(), registrations })) });
    assert.throws(() => stores.openExistingWindowsPlanStore(options(f, { decrypt: decodeFixture })), /CREDENTIAL_STORE_INVALID/);
  }
});

test('legacy minimal records and nullable optional metadata remain readable without account repair', t => {
  const base = { issuer: 'fixture', client_id: 'fixture', subject: 'fixture' };
  for (const extra of [{}, { email: null, access_token: null, refresh_token: null, id_token: null, originalNonce: null, savedAt: null, expiresAt: null, earliestRefreshAt: null, scopes: null }, { email: 'synthetic@example.invalid', access_token: 'synthetic', refresh_token: 'synthetic', id_token: 'synthetic', originalNonce: 'synthetic', savedAt: '2026-10-27T00:00:00.000Z', expiresAt: 0, earliestRefreshAt: 123, scopes: ['synthetic.scope'] }]) {
    const record = { ...base, ...extra }, key = stores.registrationKey(record), data = { ...plain(), registrations: { [key]: record } };
    const f = fixture(t, { cipher: encodeFixture(JSON.stringify(data)) }), before = snapshot(f.root), mutations = [];
    const store = stores.openExistingWindowsPlanStore(options(f, { fs: readonlyFs(mutations), decrypt: decodeFixture }));
    assert.equal(store.list().length, 1); assert.deepEqual(store.get(key), record); assert.deepEqual(mutations, []); assert.deepEqual(snapshot(f.root), before);
  }
});

test('invalid records cannot be saved into an otherwise valid existing vault', t => {
  const f = fixture(t, { cipher: encodeFixture(JSON.stringify(plain())) }), original = fs.readFileSync(f.file); let encryptions = 0;
  const store = stores.openExistingWindowsPlanStore(options(f, { decrypt: decodeFixture, encrypt(value) { encryptions++; return encodeFixture(value); } }));
  assert.throws(() => store.save({ issuer: 'fixture', client_id: 'fixture', subject: 'fixture', expiresAt: {} }), /CREDENTIAL_STORE_INVALID/);
  assert.equal(encryptions, 0); assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.existsSync(f.lock), false);
});

test('inherit-only allowance applies only to ancestors; direct or effective child foreign writes still reject', t => {
  for (const variant of ['direct-ancestor', 'no-propagate-direct', 'directory-inherit-only', 'file-inherit-only', 'effective-child']) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) {
      const result = security(request), ancestor = result.entries.find(entry => entry.path === f.localAppData);
      if (variant === 'direct-ancestor' || variant === 'no-propagate-direct') ancestor.rules.push({ sid: 'S-1-3-0', type: 'Allow', inherited: false, inheritance: 3, propagation: variant === 'direct-ancestor' ? 0 : 1, rights: 2032127 });
      else {
        ancestor.rules.push({ sid: 'S-1-3-0', type: 'Allow', inherited: false, inheritance: 3, propagation: 2, rights: 2032127 });
        const target = result.entries.find(entry => entry.path === (variant === 'directory-inherit-only' ? f.dir : f.file));
        target.rules.push({ sid: 'S-1-3-0', type: 'Allow', inherited: variant === 'effective-child', inheritance: variant === 'effective-child' ? 0 : 3, propagation: variant === 'effective-child' ? 0 : 2, rights: 2032127 });
      }
      return result;
    } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE', variant);
  }
});

test('unknown or inconsistent inheritance flags fail closed', t => {
  for (const flags of [{ inheritance: 4, propagation: 0 }, { inheritance: 3, propagation: 4 }, { inheritance: 0, propagation: 2 }, { inheritance: undefined, propagation: 0 }, { inheritance: 3, propagation: '2' }]) {
    const f = fixture(t);
    const result = stores.inspectWindowsPlanStore(options(f, { securityInspector(request) { const result = security(request); Object.assign(result.entries[0].rules[0], flags); return result; } }));
    assert.equal(result.reason, 'CREDENTIAL_ACL_UNSAFE');
  }
});
