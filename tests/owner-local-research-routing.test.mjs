// Ephemeral test-only credentials; no Owner or live credential is used.
import { randomBytes as randomFixtureBytes } from 'node:crypto';
// Synthetic paths only. No server/listener, real binding, database or runtime access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareOwnerRoots, ownerEnvironment, verifyOwnerBinding } from '../src/owner-local-startup.mjs';
import { resolveOwnerResearchRoot } from '../src/owner-local-research-root.mjs';
import { admitOwner, assertOwnerMode, assertOwnerRoots, OWNER_RISK_VERSION, buildOwnerVersion } from '../src/owner-local-acceptance.mjs';
import { assertMarketCandidateMode, assertMarketCandidateEnvironmentRoots,
  MARKET_CANDIDATE_SCOPE, MARKET_CANDIDATE_PREVIEW } from '../src/cru21-market-candidate.mjs';
import { readBoundedFile, assertOperationsOutputRoot } from '../src/daily-data-operations-files.mjs';

const runId = '12345678-1234-1234-1234-123456789abc';
function fixture(t) {
  const base = path.resolve('data');
  fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, 'owner-research-routing-'));
  t.after(() => {
    assert.ok(home.startsWith(base + path.sep));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const binding = { sourceRoot: path.join(home, 'runtime'), readDataRoot: path.join(home, 'standalone/data'),
    producerDataRoot: path.join(home, 'producer/data'), researchRoot: path.join(home, 'standalone/v2'),
    branch: 'codex/cru61-smc-cvd-profile-v1', expectedHead: '1'.repeat(40),
    expectedTree: '2'.repeat(40), expectedBaseMain: '3'.repeat(40) };
  for (const dir of [binding.sourceRoot, binding.readDataRoot, binding.producerDataRoot,
    path.join(binding.researchRoot, 'data'), path.join(binding.researchRoot, 'reports')])
    fs.mkdirSync(dir, { recursive: true });
  const database = path.join(binding.researchRoot, 'data/research-v2.sqlite');
  const report = path.join(binding.researchRoot, 'reports/latest-backtest.json');
  fs.writeFileSync(database, 'TINY SYNTHETIC INPUT');
  fs.writeFileSync(report, '{"fixture":"sibling-research"}');
  return { home, binding, database, report };
}

test('explicit Owner sibling research root routes both V2 inputs when readDataRoot/v2 is absent', t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.binding.readDataRoot, 'v2')), false);
  const roots = prepareOwnerRoots(f.binding, runId);
  const env = ownerEnvironment(f.binding, roots, {});
  assert.equal(env.V2_RESEARCH_DATABASE_PATH, f.database);
  assert.equal(env.V2_BACKTEST_REPORT_PATH, f.report);
  assert.equal(env.TX_CHART_DATA_ROOT, f.binding.readDataRoot);
  assert.equal(env.CRU34_LIVE_DATA_ROOT, f.binding.producerDataRoot);
  assert.equal(env.DATA_OPERATIONS_OUTPUT_ROOT, path.join(f.binding.readDataRoot, 'quality/daily-data-operations'));
});

test('unexpected, nonlocal, traversal and runtime-overlapping research roots fail before private writes', t => {
  const { home, binding } = fixture(t);
  for (const researchRoot of [null, '', 'v2', '//foreign/share/v2', path.join(home, 'foreign/v2'),
    path.join(binding.readDataRoot, 'v2'), binding.sourceRoot, binding.producerDataRoot,
    binding.researchRoot + path.sep + '..' + path.sep + 'v2']) {
    assert.throws(() => prepareOwnerRoots({ ...binding, researchRoot }, runId), /OWNER_RESEARCH_ROOT_REJECTED/);
    assert.deepEqual(fs.readdirSync(binding.sourceRoot), []);
  }
  for (const patch of [{ sourceRoot: binding.researchRoot }, { sourceRoot: path.dirname(binding.researchRoot) },
    { producerDataRoot: binding.researchRoot }, { producerDataRoot: path.join(binding.researchRoot, 'data') }]) {
    assert.throws(() => prepareOwnerRoots({ ...binding, ...patch }, runId), /ROOT_REJECTED/);
    assert.deepEqual(fs.readdirSync(binding.sourceRoot), []);
    assert.equal(fs.existsSync(path.join(binding.researchRoot, 'data/owner-local-acceptance')), false);
  }
});

test('explicit root requires existing research directories and DB; no fallback or private writes on missing inputs', t => {
  const f = fixture(t);
  fs.unlinkSync(f.database);
  assert.throws(() => prepareOwnerRoots(f.binding, runId), /OWNER_RESEARCH_PATH_UNAVAILABLE/);
  assert.deepEqual(fs.readdirSync(f.binding.sourceRoot), []);
  fs.writeFileSync(f.database, 'TINY');
  fs.unlinkSync(f.report);
  assert.equal(resolveOwnerResearchRoot(f.binding), f.binding.researchRoot, 'absent report is not fabricated');
  fs.rmdirSync(path.dirname(f.report));
  assert.throws(() => prepareOwnerRoots(f.binding, runId), /OWNER_RESEARCH_PATH_UNAVAILABLE/);
  assert.deepEqual(fs.readdirSync(f.binding.sourceRoot), []);
});

test('hard-linked DB and report are rejected without changing either input or creating private files', t => {
  const f = fixture(t);
  for (const file of [f.database, f.report]) {
    const before = fs.readFileSync(file);
    const alias = path.join(f.home, 'hardlink-input');
    fs.linkSync(file, alias);
    assert.throws(() => prepareOwnerRoots(f.binding, runId), /OWNER_PATH_ALIAS_REJECTED/);
    assert.throws(() => readBoundedFile(file), /OPERATIONS_INPUT_LINK_REJECTED/);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(fs.readFileSync(alias), before);
    assert.deepEqual(fs.readdirSync(f.binding.sourceRoot), []);
    fs.unlinkSync(alias);
  }
});

test('research root directory alias is rejected before private writes', t => {
  const f = fixture(t), moved = path.join(f.home, 'aliased-research');
  fs.renameSync(f.binding.researchRoot, moved);
  fs.symlinkSync(moved, f.binding.researchRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareOwnerRoots(f.binding, runId), /OWNER_PATH_ALIAS_REJECTED/);
  assert.deepEqual(fs.readdirSync(f.binding.sourceRoot), []);
  assert.equal(fs.readFileSync(path.join(moved, 'data/research-v2.sqlite'), 'utf8'), 'TINY SYNTHETIC INPUT');
});

test('omitted root preserves legacy fixture routing even when a sibling DB exists', t => {
  const f = fixture(t), { researchRoot, ...legacy } = f.binding;
  const env = ownerEnvironment(legacy, prepareOwnerRoots(legacy, runId), {
    V2_RESEARCH_DATABASE_PATH: f.database, V2_BACKTEST_REPORT_PATH: f.report, researchRoot,
    DASHBOARD_OWNER_RESEARCH_ROOT: researchRoot, NODE_OPTIONS: 'synthetic-hook', PRIVATE_INPUT: 'NO_LEAK',
  });
  assert.equal(env.V2_RESEARCH_DATABASE_PATH, path.join(legacy.readDataRoot, 'v2/data/research-v2.sqlite'));
  assert.equal(env.V2_BACKTEST_REPORT_PATH, path.join(legacy.readDataRoot, 'v2/reports/latest-backtest.json'));
  for (const key of ['researchRoot', 'DASHBOARD_OWNER_RESEARCH_ROOT', 'NODE_OPTIONS', 'PRIVATE_INPUT'])
    assert.equal(env[key], undefined);
  assert.equal(fs.existsSync(path.join(legacy.readDataRoot, 'v2')), false);
  assert.equal(fs.readFileSync(f.database, 'utf8'), 'TINY SYNTHETIC INPUT');
});

test('Owner research binding does not expand the Data Quality output root policy', t => {
  const f = fixture(t);
  const roots = prepareOwnerRoots(f.binding, runId), env = ownerEnvironment(f.binding, roots, {});
  assert.equal(assertOperationsOutputRoot(roots.readDataRoot, env.DATA_OPERATIONS_OUTPUT_ROOT), env.DATA_OPERATIONS_OUTPUT_ROOT);
  assert.throws(() => assertOperationsOutputRoot(roots.readDataRoot, path.join(f.binding.researchRoot, 'quality/daily-data-operations')),
    /OPERATIONS_OUTPUT_ROOT_NOT_GOVERNED/);
});

test('binding verification checks research metadata as well as the original exact source identity', t => {
  const f = fixture(t), seen = [];
  const binding = { ...f.binding, schema: 'owner-local-acceptance-binding-v1', machineName: 'SYNTHETIC' };
  // verifyOwnerBinding prohibits development worktrees. Use synthetic paths and
  // injected metadata/git observations; never query a real runtime checkout.
  const options = { machineName: 'SYNTHETIC', inspect(file, directory = true) { seen.push([file, directory]); },
    git(args) { return args[0] === 'status' ? '' : args[0] === 'branch' ? binding.branch
      : args[1] === 'HEAD' ? binding.expectedHead : args[1] === 'HEAD^{tree}' ? binding.expectedTree : binding.expectedBaseMain; } };
  // Path must be outside the worktrees segment for this pure identity check.
  binding.sourceRoot = path.join(path.parse(f.home).root, 'synthetic-owner-runtime');
  assert.equal(verifyOwnerBinding(binding, binding.sourceRoot, options), binding);
  assert.ok(seen.some(([file, directory]) => file === f.database && directory === false));
  assert.ok(seen.some(([file, directory]) => file === f.report && directory === false));
  assert.throws(() => verifyOwnerBinding({ ...binding, researchRoot: f.home }, binding.sourceRoot, options), /OWNER_RESEARCH_ROOT_REJECTED/);
});

test('admitted Owner validates both environment and config routing; common server guard uses the bound root', t => {
  const f = fixture(t), roots = prepareOwnerRoots(f.binding, runId);
  const env = ownerEnvironment(f.binding, roots, {});
  const admission = admitOwner({ accepted: true, riskVersion: OWNER_RISK_VERSION,
    password: randomFixtureBytes(24).toString('base64url') }, f.binding, runId);
  const config = { appRoot: roots.sourceRoot, dataDir: roots.privateDataRoot, host: '127.0.0.1', port: 18723,
    nodeEnv: 'production', mockData: false, cookieSecure: true, trustProxy: false, candidateReadOnly: true,
    passwordHash: admission.passwordHash, v2DatabasePath: f.database, v2ReportPath: f.report };
  assert.equal(assertOwnerMode(env, config), true);
  assert.deepEqual(assertMarketCandidateEnvironmentRoots(env, config, assertOwnerRoots), roots);
  for (const key of ['V2_RESEARCH_DATABASE_PATH', 'V2_BACKTEST_REPORT_PATH']) {
    for (const value of [undefined, '', path.join(f.binding.readDataRoot, 'v2/wrong'), path.join(f.home, 'foreign')]) {
      const changed = { ...env, [key]: value };
      assert.throws(() => assertOwnerMode(changed, config), /OWNER_RESEARCH_ROUTING_REJECTED/);
      assert.throws(() => assertMarketCandidateEnvironmentRoots(changed, config, assertOwnerRoots), /INPUT_ROUTING_REJECTED/);
    }
  }
  for (const key of ['v2DatabasePath', 'v2ReportPath'])
    assert.throws(() => assertOwnerMode(env, { ...config, [key]: path.join(f.home, 'foreign') }), /OWNER_RESEARCH_ROUTING_REJECTED/);
  for (const patch of [{ COOKIE_SECURE: '0' }, { ASK_GPT_INLINE_ENABLED: '1' }, { DASHBOARD_CANDIDATE_V2_BINDING: 'GOVERNED_ACTIVE_V1' }]) {
    const changedConfig = patch.COOKIE_SECURE ? { ...config, cookieSecure: false } : config;
    assert.throws(() => assertOwnerMode({ ...env, ...patch }, changedConfig));
  }
  const version = buildOwnerVersion({ runtimeVersion: {}, branch: f.binding.branch });
  for (const key of ['aiEnabled', 'executionAuthorized', 'orderRoutesEnabled', 'deliveryAccepted', 'dataQualificationDeclared'])
    assert.equal(version[key], false);
  assert.equal(version.researchOnly, true); assert.equal(version.formalWeight, 0);
  assert.equal(version.dataMode, 'UNQUALIFIED');
});

test('original HTTPS routing and admission remain strict and cannot select the Owner sibling root', t => {
  const f = fixture(t), privateDataRoot = path.join(f.binding.sourceRoot, 'data');
  const roots = { ...f.binding, privateDataRoot, chartCacheRoot: path.join(privateDataRoot, 'dashboard-chart-cache') };
  const { researchRoot, ...legacy } = f.binding;
  const env = { ...ownerEnvironment(legacy, roots, {}), DASHBOARD_RELEASE_SCOPE: MARKET_CANDIDATE_SCOPE,
    DASHBOARD_PREVIEW_TYPE: MARKET_CANDIDATE_PREVIEW, DASHBOARD_TLS_BUNDLE: path.join(f.home, 'synthetic.dpapi'),
    DASHBOARD_TLS_BUNDLE_SHA256: 'a'.repeat(64), DASHBOARD_TLS_CERT_SHA256: 'b'.repeat(64) };
  const config = { appRoot: roots.sourceRoot, dataDir: privateDataRoot, host: '127.0.0.1', port: 18723,
    nodeEnv: 'production', mockData: false, cookieSecure: true, trustProxy: false };
  assert.equal(assertMarketCandidateMode(env, config), true);
  assert.equal(assertMarketCandidateEnvironmentRoots(env, config).readDataRoot, f.binding.readDataRoot);
  for (const patch of [{ V2_RESEARCH_DATABASE_PATH: f.database }, { V2_BACKTEST_REPORT_PATH: f.report },
    { V2_RESEARCH_DATABASE_PATH: f.database, V2_BACKTEST_REPORT_PATH: f.report }])
    assert.throws(() => assertMarketCandidateEnvironmentRoots({ ...env, ...patch }, config), /INPUT_ROUTING_REJECTED/);
  assert.throws(() => assertMarketCandidateMode({ ...env, DASHBOARD_TLS_BUNDLE: undefined }, config), /TLS_IDENTITY_REQUIRED/);
  assert.equal(fs.existsSync(path.join(roots.sourceRoot, 'data')), false);
});
