import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readDataOperationsReaderIdentity } from '../src/dashboard-data-operations-reader-identity.mjs';

const serverSource = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const handler = serverSource.slice(serverSource.indexOf('const requestHandler ='), serverSource.indexOf('const server = createDashboardServer'));
const manifestHash = 'a'.repeat(64), calendarHash = 'b'.repeat(64);
const reason = 'DATA_OPERATIONS_READER_UNVERIFIED';
const unavailable = { schemaVersion: 'data-operations-reader-identity-v1', state: 'UNVERIFIED', reasonCodes: [reason] };

// Execute the real handler with synthetic process settings and an injected
// bounded-binding resolver. No socket, config/env file, database or ledger opens.
function harness({ candidateReadOnly = true, manifestPath = 'C:/synthetic/governed.json', outputRoot = 'C:/synthetic/output', resolver } = {}) {
  const calls = [], calendar = { fileHash: calendarHash }, receipts = [];
  const resolve = options => {
    calls.push(options);
    return resolver ? resolver(options) : { bindingIdentity: { manifestSha256: manifestHash, calendarSha256: calendarHash } };
  };
  const context = {
    URL, process: { env: { DATA_OPERATIONS_MANIFEST_PATH: manifestPath, DATA_OPERATIONS_OUTPUT_ROOT: outputRoot } },
    config: { candidateReadOnly, dataDir: 'C:/synthetic/candidate/data' },
    crypto: { randomUUID: () => 'synthetic' }, requestIsHttps: () => false, setSecurityHeaders() {}, clientIp: () => 'loopback',
    cru55: null, formalEntry: null, inlineHandler: async () => false, runtimeIdentity: { commit: 'c'.repeat(40), status: 'VERIFIED' },
    runtimeVersion: {}, currentCru46RuntimeReadiness: () => ({ runtimeReady: { ready: false, reasons: ['EXISTING_BLOCKER'] } }),
    inlineEnabled: false, localMarketOnly: false, productSurfaceContract: {}, operatingCalendar: calendar,
    assessTaifexMarketSession: () => ({ state: 'UNKNOWN' }),
    readDataOperationsReaderIdentity: options => readDataOperationsReaderIdentity(options, resolve),
    resolveOperationsReader: resolve,
    requireSession: () => ({ synthetic: true }),
    readDataOperations(options) { receipts.push(options); return { bindingIdentity: options.bindingIdentity }; },
    spawn() { throw Error('NO_CHILD_ALLOWED'); },
    sendJson(res, status, body) { res.status = status; res.body = JSON.parse(JSON.stringify(body)); },
    console: { error() {} },
  };
  vm.runInNewContext(`${handler}\nglobalThis.handle=requestHandler;`, context);
  async function request(url = '/healthz') {
    const res = { setHeader() {} };
    await context.handle({ url, method: 'GET', headers: {} }, res);
    return res;
  }
  return { request, calls, receipts, calendar };
}

test('health reports actual validated reader identity and uses the same effective options as the authenticated GET', async () => {
  const h = harness();
  const health = await h.request();
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.dataOperationsReader, { schemaVersion: 'data-operations-reader-identity-v1', state: 'VALIDATED',
    bindingIdentity: { manifestSha256: manifestHash, calendarSha256: calendarHash } });
  assert.equal(h.calls.length, 1);
  assert.equal(h.receipts.length, 0, 'health must not read operations receipts');
  const get = await h.request('/api/v1/data-operations');
  assert.equal(get.status, 200);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), JSON.parse(JSON.stringify(h.calls[1])));
  assert.equal(h.calls[0].calendar, h.calendar);
  assert.deepEqual(health.body.runtimeReady, { ready: false, reasons: ['EXISTING_BLOCKER'] });
  assert.doesNotMatch(JSON.stringify(health.body.dataOperationsReader), /synthetic|path|output/i);
});

test('health exposes the effective different manifest identity instead of claiming an entry pin', async () => {
  const wrong = 'd'.repeat(64);
  const h = harness({ manifestPath: 'C:/synthetic/other-governed.json', resolver: () => ({ bindingIdentity: { manifestSha256: wrong, calendarSha256: calendarHash } }) });
  const health = await h.request();
  assert.equal(health.body.dataOperationsReader?.bindingIdentity?.manifestSha256, wrong);
  assert.notEqual(health.body.dataOperationsReader.bindingIdentity.manifestSha256, manifestHash);
  assert.equal(h.receipts.length, 0);
});

test('missing manifest is explicitly unverified without reading a default local output', async () => {
  const h = harness({ manifestPath: '' });
  const health = await h.request();
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.dataOperationsReader, unavailable);
  assert.equal(h.calls.length, 0);
  assert.equal(h.receipts.length, 0);
});

test('wrong or unreadable manifest remains unverified with a fixed public reason and no raw errors', async () => {
  for (const detail of ['OPERATIONS_BINDING_INVALID:C:/private/secret-path', 'private-calendar-error']) {
    const h = harness({ resolver() { throw Error(detail); } });
    const health = await h.request();
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.dataOperationsReader, unavailable);
    assert.equal(h.calls.length, 1);
    assert.equal(h.receipts.length, 0);
    assert.doesNotMatch(JSON.stringify(health.body), /secret-path|private-calendar|OPERATIONS_BINDING_INVALID/);
  }
});

test('default non-reader health adds no binding reads even when a manifest is configured', async () => {
  for (const candidateReadOnly of [false, undefined]) {
    // harness defaults to true; explicitly force absent config through false.
    const h = harness({ candidateReadOnly: candidateReadOnly === true, resolver() { throw Error('NO_READ_ALLOWED'); } });
    const health = await h.request();
    assert.equal(health.status, 200);
    assert.equal(health.body.dataOperationsReader, null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.receipts.length, 0);
  }
});

test('identity projection rejects missing or malformed hashes and drops all additional resolver fields', () => {
  for (const invalid of [undefined, null, '', 0, false, 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    for (const key of ['manifestSha256', 'calendarSha256']) {
      const identity = { manifestSha256: manifestHash, calendarSha256: calendarHash, [key]: invalid };
      assert.deepEqual(readDataOperationsReaderIdentity({ candidateReadOnly: true, manifestPath: 'synthetic' }, () => ({ bindingIdentity: identity })), unavailable);
    }
  }
  const projected = readDataOperationsReaderIdentity({ candidateReadOnly: true, manifestPath: 'synthetic' }, () => ({
    path: 'private', bindingIdentity: { manifestSha256: manifestHash, calendarSha256: calendarHash, secret: 'private' },
  }));
  assert.deepEqual(Object.keys(projected.bindingIdentity), ['manifestSha256', 'calendarSha256']);
  for (const candidateReadOnly of [false, undefined, null, 'true', 1])
    assert.equal(readDataOperationsReaderIdentity({ candidateReadOnly }, () => { throw Error('NO_READ_ALLOWED'); }), null);
});
