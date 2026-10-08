import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDashboardReadDataRoot } from '../src/dashboard-source-binding.mjs';

function sourceFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-source-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, 'formal-data');
  const shared = path.join(root, 'shared-data');
  fs.mkdirSync(local);
  fs.mkdirSync(shared);
  return { root, local, shared, options: { dataDir: local, host: '127.0.0.1', port: 8787,
    actualDataMode: 'LIVE', formalReadRoot: shared } };
}

test('default selection keeps the configured local data root', () => {
  const dataDir = path.resolve('local-data');
  assert.equal(resolveDashboardReadDataRoot({ dataDir }), dataDir);
});

test('formal source binding reads the existing shared root without redirecting local writes', (t) => {
  const { local, shared, options } = sourceFixture(t);
  const source = path.join(shared, 'source.json');
  fs.writeFileSync(source, '{"source":"shared"}');
  const before = fs.statSync(source);
  Object.freeze(options);
  assert.equal(resolveDashboardReadDataRoot(options), shared);
  assert.equal(options.dataDir, local);
  assert.deepEqual(fs.readdirSync(local), []);
  assert.deepEqual(fs.readdirSync(shared), ['source.json']);
  assert.equal(fs.readFileSync(source, 'utf8'), '{"source":"shared"}');
  assert.equal(fs.statSync(source).mtimeMs, before.mtimeMs);
});

test('formal source binding rejects candidate roots even when both paths are equal', (t) => {
  const { shared, options } = sourceFixture(t);
  for (const candidateReadRoot of [shared, path.join(shared, 'candidate')]) {
    assert.throws(() => resolveDashboardReadDataRoot({ ...options, candidateReadRoot }), /DASHBOARD_READ_ROOT_CONFLICT/);
  }
});

test('formal source binding requires the actual LIVE loopback formal boundary', (t) => {
  const { options } = sourceFixture(t);
  const invalid = [
    { host: '0.0.0.0' }, { host: 'localhost' }, { host: null },
    { port: 18722 }, { port: 8790 }, { port: 8791 }, { port: '8787' },
    { actualDataMode: 'MOCK' }, { actualDataMode: 'live' }, { actualDataMode: null },
    { previewType: 'CRU21_OWNER_PREVIEW' }, { previewType: 'CRU44_OWNER_PREVIEW' },
    { previewType: 'INTEGRATION_OWNER_PREVIEW' }, { previewType: 'UNKNOWN' },
    { isolatedMode: true },
  ];
  for (const overrides of invalid) {
    assert.throws(() => resolveDashboardReadDataRoot({ ...options, ...overrides }), /FORMAL_READ_ROOT_REJECTED/,
      JSON.stringify(overrides));
  }
});

test('formal source binding requires a readable existing directory and creates nothing', (t) => {
  const { root, options } = sourceFixture(t);
  const file = path.join(root, 'ordinary-file.json');
  const missing = path.join(root, 'missing-data');
  fs.writeFileSync(file, '{}');
  for (const formalReadRoot of [file, missing, '   ', true]) {
    assert.throws(() => resolveDashboardReadDataRoot({ ...options, formalReadRoot }), /FORMAL_READ_ROOT_DIRECTORY_REQUIRED/);
  }
  assert.equal(fs.existsSync(missing), false);
});

test('candidate source selection preserves the existing inline isolated-port conditions', (t) => {
  const { local, shared } = sourceFixture(t);
  const options = { dataDir: local, host: '127.0.0.1', port: 18722,
    inlineEnabled: true, candidateReadRoot: shared, previewType: 'CRU21_OWNER_PREVIEW' };
  assert.equal(resolveDashboardReadDataRoot(options), shared);
  for (const overrides of [{ inlineEnabled: false }, { host: '0.0.0.0' }, { port: 8787 }, { port: 8790 }, { port: 8791 }]) {
    assert.throws(() => resolveDashboardReadDataRoot({ ...options, ...overrides }), /INLINE_CANDIDATE_READ_ROOT_REJECTED/);
  }
});

test('isolated defaults remain unchanged without a formal override', () => {
  const dataDir = path.resolve('isolated-data');
  assert.equal(resolveDashboardReadDataRoot({ dataDir, isolatedMode: true }), dataDir);
});
