import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { InlineAssistant } from '../src/ask-gpt-inline-service.mjs';
import { createInlineHandler } from '../src/ask-gpt-inline-http.mjs';
import { PlanError } from '../src/chatgpt-plan-auth.mjs';

function fixture(t, metadata = { state: 'PRESENT_UNVERIFIED', reason: 'ACCOUNT_METADATA_NOT_LOADED', accountMetadataLoaded: false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-status-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'receipts');
  const calls = { inspect: 0, existing: 0, initialize: 0, transport: 0, setup: 0, refresh: 0, catalog: 0, model: 0 };
  const key = 'a'.repeat(64), now = 1800000000000;
  const store = { reload() {}, list: () => [{ key, label: '已保存帳號', expiresAt: now + 999999 }],
    get: () => ({ scopes: ['chatgpt.tokens.use.direct'], expiresAt: now + 999999, refresh_token: 'REDACTED' }) };
  const assistant = new InlineAssistant({ enabled: true, root, runtimeCommit: 'a'.repeat(40), now: () => now,
    inspectStore: () => { calls.inspect++; if (metadata instanceof Error) throw metadata; return metadata; },
    storeFactory: () => { calls.existing++; return store; },
    initializeStoreFactory: () => { calls.initialize++; return store; },
    configureTransport: () => { calls.transport++; },
    setupStarter: async () => { calls.setup++; return { server: { listening: true }, launchUrl: 'http://127.0.0.1:18721/#fixture', expiresAt: 'fixture', close: async () => {} }; },
    snapshotProvider: () => { throw Error('NO_SNAPSHOT_ON_STATUS'); },
    operations: { freshPlanRecord: async () => { calls.refresh++; }, planCatalog: async () => { calls.catalog++; }, analysePlan: async () => { calls.model++; } },
  });
  t.after(() => assistant.close());
  return { dir, root, assistant, calls, store, key, now };
}
const noMutationCalls = calls => assert.deepEqual({ existing: calls.existing, initialize: calls.initialize,
  transport: calls.transport, setup: calls.setup, refresh: calls.refresh, catalog: calls.catalog, model: calls.model },
{ existing: 0, initialize: 0, transport: 0, setup: 0, refresh: 0, catalog: 0, model: 0 });

test('constructing the enabled status service does not create receipt or credential state', t => {
  const f = fixture(t); assert.equal(fs.existsSync(f.root), false); noMutationCalls(f.calls);
});

test('repeated automatic status inspects metadata without constructing or decrypting a store', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) {
    const result = f.assistant.connection();
    assert.equal(result.storeState, 'PRESENT_UNVERIFIED');
    assert.equal(result.reason, 'ACCOUNT_METADATA_NOT_LOADED');
    assert.deepEqual(result.accounts, []); assert.equal(result.accountMetadataLoaded, false);
    assert.equal(result.credentialsLoaded, false);
  }
  assert.equal(f.calls.inspect, 5); noMutationCalls(f.calls);
  assert.equal(fs.existsSync(f.root), false);
});

for (const reason of ['CREDENTIAL_STORE_MISSING', 'CREDENTIAL_STORE_BUSY', 'CREDENTIAL_ACL_UNSAFE', 'CREDENTIAL_STORE_UNREADABLE']) {
  test(`${reason} remains unavailable through status retries without repair or setup`, t => {
    const f = fixture(t, new PlanError(reason));
    for (let i = 0; i < 3; i++) {
      const status = f.assistant.connection(); assert.equal(status.reason, reason);
      assert.deepEqual(status.accounts, []); assert.equal(status.credentialsLoaded, false);
    }
    noMutationCalls(f.calls); assert.equal(fs.existsSync(f.root), false);
  });
}

test('unrecognized inspector fields and failures never expose private paths or fake connected accounts', t => {
  const f = fixture(t, { state: 'PRESENT_UNVERIFIED', reason: 'ACCOUNT_METADATA_NOT_LOADED', accountMetadataLoaded: false,
    accounts: [{ key: 'private' }], path: '/private/location', token: 'REDACTED' });
  const result = f.assistant.connection();
  assert.deepEqual(result.accounts, []); assert.doesNotMatch(JSON.stringify(result), /private|REDACTED/);
  noMutationCalls(f.calls);
  const g = fixture(t, new Error('/private/location'));
  assert.equal(g.assistant.connection().reason, 'REQUEST_FAILED');
});

test('explicit existing-account read preserves registrations without setup, refresh or model requests', t => {
  const f = fixture(t), result = f.assistant.loadAccounts();
  assert.equal(result.accountMetadataLoaded, true); assert.equal(result.reason, null);
  assert.equal(result.accounts[0].key, f.key); assert.equal(result.accounts[0].planPermission, true);
  assert.equal(f.calls.existing, 1); assert.equal(f.calls.initialize, 0);
  assert.equal(f.calls.setup + f.calls.refresh + f.calls.catalog + f.calls.model, 0);
  assert.doesNotMatch(JSON.stringify(result), /refresh_token|REDACTED/);
  assert.equal(fs.existsSync(f.root), false);
});

test('a metadata failure cannot silently fall through into initialization', t => {
  const f = fixture(t);
  f.assistant.storeFactory = () => { throw new PlanError('CREDENTIAL_ACL_UNSAFE'); };
  assert.throws(() => f.assistant.loadAccounts(), /CREDENTIAL_ACL_UNSAFE/);
  assert.equal(f.calls.initialize + f.calls.setup + f.calls.refresh + f.calls.model, 0);
});

test('settings initialization is invoked only by the explicit setting action', async t => {
  const f = fixture(t); f.assistant.connection(); f.assistant.loadAccounts();
  assert.equal(f.calls.initialize, 0); assert.equal(f.calls.setup, 0);
  const result = await f.assistant.openSetup();
  assert.equal(f.calls.initialize, 1); assert.equal(f.calls.setup, 1);
  assert.equal(result.url, 'http://127.0.0.1:18721/#fixture');
  assert.equal(f.calls.refresh + f.calls.model, 0);
});

test('a setup writer is never reused to bypass a fresh unsafe existing-store read', async t => {
  const f = fixture(t); await f.assistant.openSetup();
  f.assistant.storeFactory = () => { f.calls.existing++; throw new PlanError('CREDENTIAL_ACL_UNSAFE'); };
  assert.throws(() => f.assistant.loadAccounts(), /CREDENTIAL_ACL_UNSAFE/);
  await assert.rejects(f.assistant.models(f.key), /CREDENTIAL_ACL_UNSAFE/);
  assert.equal(f.calls.existing, 2); assert.equal(f.calls.initialize, 1);
  assert.equal(f.calls.refresh + f.calls.catalog + f.calls.model, 0);
});

test('an explicit account read does not replace an active job reader or start setup', t => {
  const f = fixture(t), activeStore = { syntheticActiveReader: true };
  f.assistant.store = activeStore;
  const result = f.assistant.loadAccounts();
  assert.equal(result.accountMetadataLoaded, true);
  assert.equal(f.assistant.store, activeStore); assert.equal(f.calls.existing, 1);
  assert.equal(f.calls.initialize + f.calls.refresh + f.calls.catalog + f.calls.model, 0);
});

test('automatic recovery returns an interrupted copy without initializing store or modifying original evidence', t => {
  const f = fixture(t), id = randomUUID(); fs.mkdirSync(f.root, { recursive: true });
  const record = { schema: 'ask-gpt-inline-receipt-v1', requestId: id, instance: 'old-instance',
    ownerHash: createHash('sha256').update('owner').digest('hex'), phase: 'ANALYSING', text: '',
    updatedAt: '2026-10-27T00:00:00.000Z' };
  const file = path.join(f.root, id + '.json'), raw = JSON.stringify(record); fs.writeFileSync(file, raw);
  for (let i = 0; i < 3; i++) assert.equal(f.assistant.read(id, 'owner').phase, 'INTERRUPTED');
  assert.equal(fs.readFileSync(file, 'utf8'), raw); assert.deepEqual(fs.readdirSync(f.root), [id + '.json']);
  noMutationCalls(f.calls);
  assert.throws(() => f.assistant.read(id, 'foreign'), /REQUEST_NOT_FOUND/);
});

async function request(handler, { method = 'GET', route = 'status', body = {}, session = { id: 'owner' }, origin = true, csrf = true } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:18722',
    'content-type': 'application/json', ...(origin ? { origin: 'http://127.0.0.1:18722' } : {}), ...(csrf ? { 'x-csrf-token': 'fixture' } : {}) } });
  let status, value;
  const res = { headersSent: false, writeHead(code) { status = code; this.headersSent = true; }, end(raw) { value = JSON.parse(raw); } };
  await handler(req, res, new URL('http://127.0.0.1:18722/api/v1/ask-gpt/' + route), session);
  return { status, value };
}
test('HTTP accounts read is explicit POST under the existing Session, Origin, CSRF and JSON guards', async () => {
  let statusCalls = 0, accountCalls = 0, setupCalls = 0;
  const assistant = { connection() { statusCalls++; return { accounts: [] }; }, loadAccounts() { accountCalls++; return { accounts: [] }; }, openSetup() { setupCalls++; } };
  const handler = createInlineHandler({ assistant, port: 18722, requireCsrf(req, res) {
    if (req.headers['x-csrf-token'] === 'fixture') return true;
    res.writeHead(403); res.end(JSON.stringify({ error: 'CSRF_INVALID' })); return false;
  } });
  assert.equal((await request(handler)).status, 200);
  assert.equal((await request(handler, { session: null })).status, 401);
  assert.equal((await request(handler, { method: 'POST', route: 'accounts', session: null })).status, 401);
  assert.equal((await request(handler, { method: 'POST', route: 'accounts', origin: false })).status, 403);
  assert.equal((await request(handler, { method: 'POST', route: 'accounts', csrf: false })).status, 403);
  assert.equal((await request(handler, { route: 'accounts' })).status, 404);
  assert.equal((await request(handler, { method: 'POST', route: 'accounts', body: { initialize: true } })).status, 400);
  assert.equal(accountCalls, 0); assert.equal(statusCalls, 1); assert.equal(setupCalls, 0);
  assert.equal((await request(handler, { method: 'POST', route: 'accounts' })).status, 200);
  assert.equal(accountCalls, 1); assert.equal(setupCalls, 0);
});
