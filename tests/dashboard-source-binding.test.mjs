import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
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

// Evaluate the server's shipped path declarations without opening a socket,
// starting upstream polling, or evaluating any private configuration file.
function serverSourcePaths(config, env = {}, ownerRoots = null) {
  const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const names = ['txChartDataRoot', 'txChartCacheRoot', 'cru34LiveSnapshotPath',
    'cru34LiveStatusPath', 'cru34LiveDataRoot', 'cru34LiveProjectionRoot', 'decisionJournalPath'];
  const root = source.match(/const readDataRoot = [\s\S]*?\n\}\);/);
  assert.ok(root, 'server source binding must remain inspectable');
  const declarations = names.map(name => {
    const declaration = source.match(new RegExp(`const ${name} = [\\s\\S]*?;`));
    assert.ok(declaration, name);
    return declaration[0];
  });
  return vm.runInNewContext(root[0] + '\n' + declarations.join('\n')
    + '\n({' + ['readDataRoot', ...names].join(',') + '})', {
    config, process: { env }, path, cru55: null, expectedDataMode: 'live', resolveDashboardReadDataRoot,
    ownerLocal: ownerRoots !== null, marketCandidateStartup: ownerRoots ? { roots: ownerRoots } : null,
  });
}

test('server bound sources share the selected read root while output stays private', t => {
  const { root, local, shared } = sourceFixture(t);
  const config = { appRoot: root, dataDir: local, host: '127.0.0.1', port: 8787 };
  for (const env of [
    { DASHBOARD_FORMAL_READ_ROOT: shared },
    { ASK_GPT_CANDIDATE_READ_ROOT: shared, ASK_GPT_INLINE_ENABLED: '1', DASHBOARD_PREVIEW_TYPE: 'CRU21_OWNER_PREVIEW' },
  ]) {
    const paths = serverSourcePaths({ ...config, port: env.ASK_GPT_CANDIDATE_READ_ROOT ? 18722 : 8787 }, env);
    assert.equal(paths.readDataRoot, shared);
    assert.equal(paths.txChartDataRoot, shared, 'chart must read the bound source, not private writes');
    assert.equal(paths.cru34LiveDataRoot, shared, 'Flow and research quote must use the bound source');
    assert.equal(paths.cru34LiveProjectionRoot, path.join(shared, 'runtime', 'cru34-live'));
    assert.equal(paths.txChartCacheRoot, path.join(local, 'dashboard-chart-cache'));
    assert.equal(paths.decisionJournalPath, path.join(local, 'decision-workspace', 'journal.ndjson'));
    assert.deepEqual(fs.readdirSync(local), []);
    assert.deepEqual(fs.readdirSync(shared), []);
  }
});

test('server source defaults and explicit projection bindings remain independent of private outputs', t => {
  const { root, local, shared } = sourceFixture(t);
  const config = { appRoot: root, dataDir: local, host: '127.0.0.1', port: 8787 };
  const defaults = serverSourcePaths(config);
  assert.equal(defaults.txChartDataRoot, local);
  assert.equal(defaults.cru34LiveDataRoot, local);
  assert.equal(defaults.cru34LiveProjectionRoot, path.join(local, 'runtime', 'cru34-live'));
  assert.equal(defaults.cru34LiveSnapshotPath, null, 'a read root alone must not select a live snapshot');
  const projection = path.join(root, 'projection');
  const explicit = serverSourcePaths(config, { DASHBOARD_FORMAL_READ_ROOT: shared,
    TX_CHART_DATA_ROOT: path.join(root, 'chart'), CRU34_LIVE_DATA_ROOT: path.join(root, 'flow'),
    CRU34_LIVE_SNAPSHOT_PATH: path.join(projection, 'latest.json'),
    CRU34_LIVE_STATUS_PATH: path.join(projection, 'status.json') });
  assert.equal(explicit.txChartDataRoot, path.join(root, 'chart'));
  assert.equal(explicit.cru34LiveDataRoot, path.join(root, 'flow'));
  assert.equal(explicit.cru34LiveProjectionRoot, projection);
  assert.equal(explicit.txChartCacheRoot, path.join(local, 'dashboard-chart-cache'));
});

// Evaluate the shipped conditional declaration; do not replace it with fixture output.
test('admitted Owner source uses its verified root, persistent journal and per-launch cache', t => {
  const { root, local, shared } = sourceFixture(t);
  const journalRoot = path.join(root, 'owner-local-daily');
  const nextPrivate = path.join(root, 'next-launch');
  fs.mkdirSync(journalRoot); fs.mkdirSync(nextPrivate);
  const config = { appRoot: root, dataDir: local, host: '127.0.0.1', port: 18723 };
  const roots = { readDataRoot: shared, journalRoot };
  const selected = serverSourcePaths(config, {}, roots);
  assert.equal(selected.readDataRoot, shared);
  assert.equal(selected.txChartDataRoot, shared);
  assert.equal(selected.txChartCacheRoot, path.join(local, 'dashboard-chart-cache'));
  assert.equal(selected.decisionJournalPath, path.join(journalRoot, 'decision-workspace', 'journal.ndjson'));
  assert.notEqual(selected.decisionJournalPath, path.join(local, 'decision-workspace', 'journal.ndjson'));
  const reopened = serverSourcePaths({ ...config, dataDir: nextPrivate }, {}, roots);
  assert.equal(reopened.decisionJournalPath, selected.decisionJournalPath);
  assert.equal(reopened.txChartCacheRoot, path.join(nextPrivate, 'dashboard-chart-cache'));
  assert.notEqual(reopened.txChartCacheRoot, selected.txChartCacheRoot);
  for (const dir of [local, shared, journalRoot, nextPrivate]) assert.deepEqual(fs.readdirSync(dir), []);
});

test('Owner path projection cannot silently substitute per-launch storage for a missing journal root', t => {
  const { root, local, shared } = sourceFixture(t);
  const config = { appRoot: root, dataDir: local, host: '127.0.0.1', port: 18723 };
  assert.throws(() => serverSourcePaths(config, {}, { readDataRoot: shared }));
  assert.deepEqual(fs.readdirSync(local), []);
  assert.deepEqual(fs.readdirSync(shared), []);
});
