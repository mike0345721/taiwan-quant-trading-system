import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dailyCodeRoot, dailyBindingKey, validateDailyBinding, readDailyBinding, inspectDailySource,
  dailyStorageRoots, assertDailyEnvironment, assertDailyArguments } from '../src/daily-storage-binding.mjs';
import { assertExistingDailyDatabase } from '../src/daily-storage-database.mjs';
import { runBoundDaily } from '../scripts/run-bound-daily-update.mjs';
import { v2Config } from '../v2/src/config.mjs';
import { openDatabase, applyMigrations } from '../v2/src/db.mjs';
import { loadV1Snapshots, importSnapshots } from '../v2/src/history-importer.mjs';
import { rebuildFeatures } from '../v2/src/features.mjs';
import { runQualityChecks } from '../v2/src/quality.mjs';
import { buildDailyUpdateGateSummary } from '../src/daily-update-gates.mjs';
import { buildDailyBatchVerdict } from '../src/daily-batch-verdict.mjs';

const read = name => fs.readFileSync(path.join(dailyCodeRoot, name), 'utf8');
const strip = text => text.replace(/\bimport\s*(?:[^;'"\n]*?from\s*|[\s\S]*?}\s*from\s*)?['"][^'"]+['"];\s*/g, '').replace(/^export /gm, '');
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
function snapshot(root) {
  const rows = [];
  const walk = dir => { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), st = fs.lstatSync(file);
    rows.push([path.relative(root, file), st.isDirectory() ? 'dir' : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    if (st.isDirectory()) walk(file);
  } }; walk(root); return rows;
}
function fixture(t) {
  const base = path.join(dailyCodeRoot, 'data'); fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, 'daily-binding-test-'));
  t.after(() => { assert.ok(home.startsWith(base + path.sep)); fs.rmSync(home, { recursive: true, force: true }); });
  const source = path.join(home, 'source'), storage = path.join(home, 'storage'), decoy = path.join(home, 'decoy');
  for (const root of [source, storage, decoy]) for (const dir of ['v2/data', 'v2/reports', 'v2/logs', 'v2/config', 'v2/migrations', 'data/history', 'data/intraday/archive', 'data/live-events', 'data/forward'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const dbFile = path.join(storage, 'v2/data/research-v2.sqlite');
  const db = new DatabaseSync(dbFile);
  applyMigrations(db, path.join(dailyCodeRoot, 'v2/migrations'));
  db.exec("INSERT INTO raw_snapshots VALUES('2026-10-01',NULL,NULL,'live','{}','fixture','2026-10-02'); INSERT INTO market_daily(trade_date,tx_close) VALUES('2026-10-01',20000)"); db.close();
  fs.writeFileSync(path.join(source, 'source-marker.mjs'), 'source remains unchanged');
  fs.writeFileSync(path.join(decoy, 'v2/data/research-v2.sqlite'), 'DO NOT OPEN');
  fs.writeFileSync(path.join(storage, 'v2/config/forward-v3.4.json'), 'INVALID OLD SPEC');
  fs.writeFileSync(path.join(source, 'v2/config/forward-v3.4.json'), read('v2/config/forward-v3.4.json'));
  fs.writeFileSync(path.join(source, 'v2/migrations/999_fixture.sql'), 'CREATE TABLE source_migration_marker(value TEXT);');
  fs.writeFileSync(path.join(storage, 'v2/migrations/999_fixture.sql'), 'INVALID STORAGE MIGRATION');
  const binding = { schema: 'daily-writer-binding-v1', machine: os.hostname(), sourceRoot: source, storageAppRoot: storage, expectedHead: head, expectedTree: tree };
  const options = { env: {}, codeRoot: source, inspectSource: () => ({ head, tree }) };
  const bindingPath = path.join(home, 'binding.json'); fs.writeFileSync(bindingPath, JSON.stringify(binding));
  const roots = validateDailyBinding(binding, options);
  return { home, source, storage, decoy, dbFile, binding, bindingPath, options, roots };
}
function configFor(roots, env = {}) {
  const text = strip(read('v2/src/config.mjs')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(roots.sourceRoot, 'v2/src/config.mjs')).href));
  const context = { path, fileURLToPath, process: { env, argv: [] }, dailyStorageRoots: () => roots, assertDailyArguments };
  vm.runInNewContext(text + '\nglobalThis.result=v2Config();', context);
  return context.result;
}

test('bound preflight and entry dry-run read metadata and create no directories, DB or children', t => {
  const f = fixture(t), before = snapshot(f.home), calls = [];
  for (const mode of ['--preflight', '--dry-run']) {
    const result = runBoundDaily(['--binding', f.bindingPath, mode], {}, {
      preflight: file => readDailyBinding(file, f.options), spawn: (...args) => calls.push(args),
    });
    assert.equal(result.storageAppRoot, f.storage); assert.equal(result.ownerAcceptance, 'NOT_ASSESSED');
  }
  assert.deepEqual(calls, []); assert.deepEqual(snapshot(f.home), before);
  fs.unlinkSync(f.dbFile);
  assert.throws(() => readDailyBinding(f.bindingPath, f.options));
  assert.equal(fs.existsSync(f.dbFile), false);
  const missing = { ...f.binding, storageAppRoot: path.join(f.home, 'absent') };
  assert.throws(() => validateDailyBinding(missing, f.options)); assert.equal(fs.existsSync(missing.storageAppRoot), false);
});

test('machine, SHA/tree, root overlap, unknown keys/env/CLI, empty DB and hardlink fail closed', t => {
  const f = fixture(t), before = snapshot(f.home);
  for (const change of [{ machine: 'different-machine' }, { expectedHead: 'c'.repeat(40) }, { expectedTree: 'd'.repeat(40) },
    { sourceRoot: f.decoy }, { storageAppRoot: f.source }, { storageAppRoot: path.join(f.source, 'v2') },
    { storageAppRoot: f.home }, { unexpected: true }, { storageAppRoot: '//server/share' }])
    assert.throws(() => validateDailyBinding({ ...f.binding, ...change }, f.options));
  for (const name of ['V2_DATABASE_PATH', 'V1_HISTORY_PATH', 'NODE_OPTIONS', 'GIT_DIR', 'DAILY_STORAGE_ROOT', 'V2_BACKFILL_START', 'UNKNOWN_TEST_OVERRIDE'])
    assert.throws(() => validateDailyBinding(f.binding, { ...f.options, env: { [name]: 'unexpected' } }), /ENV_REJECTED/);
  assert.throws(() => assertDailyEnvironment({ V2_BREADTH_MAX_JOBS: '99' }, { stage: true }), /ENV_REJECTED/);
  assert.doesNotThrow(() => assertDailyEnvironment({ V2_BREADTH_MAX_JOBS: '12' }, { stage: true }));
  assert.throws(() => assertDailyArguments([], ['--database', f.decoy], { [dailyBindingKey]: f.bindingPath }), /ARGUMENT_REJECTED/);
  assert.throws(() => runBoundDaily(['--binding', f.bindingPath, '--execute', '--skip-quality'], {}), /ARGUMENT/);
  assert.deepEqual(snapshot(f.home), before);
  fs.linkSync(f.dbFile, path.join(f.storage, 'v2/data/alias.sqlite'));
  assert.throws(() => readDailyBinding(f.bindingPath, f.options), /ALIAS_REJECTED/);
  fs.unlinkSync(path.join(f.storage, 'v2/data/alias.sqlite'));
  // Exercise alias rejection without creating a junction or retrying a denied
  // native symlink operation on the host.
  const originalStat = fs.lstatSync;
  fs.lstatSync = function (target, ...args) {
    const stat = originalStat.call(this, target, ...args);
    if (path.resolve(target) === f.storage) stat.isSymbolicLink = () => true;
    return stat;
  };
  try { assert.throws(() => readDailyBinding(f.bindingPath, f.options), /ALIAS_REJECTED/); }
  finally { fs.lstatSync = originalStat; }
  assert.doesNotThrow(() => assertExistingDailyDatabase(f.roots));
  const db = new DatabaseSync(f.dbFile); db.exec('DELETE FROM market_daily'); db.close();
  assert.throws(() => assertExistingDailyDatabase(f.roots), /POPULATED_DATABASE_REQUIRED/);
});

test('source admission verifies top-level, exact HEAD/tree, clean state, aliases and physical Git blob bytes', t => {
  const f = fixture(t), sourceFile = path.join(f.source, 'source-marker.mjs'), bytes = fs.readFileSync(sourceFile);
  const hash = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  let dirty = '', top = f.source;
  const seen = [];
  const git = (_exe, args, options) => {
    seen.push(args); assert.equal(options.env.GIT_DIR, undefined); assert.ok(args.includes('--no-optional-locks'));
    const output = args.includes('--show-toplevel') ? top : args.includes('HEAD^{tree}') ? tree : args.includes('status') ? dirty
      : args.includes('ls-tree') ? `100644 blob ${hash}\tsource-marker.mjs\0` : head;
    return { status: 0, stdout: output };
  };
  assert.deepEqual(inspectDailySource(f.source, {}, git), { head, tree });
  dirty = ' M source-marker.mjs'; assert.throws(() => inspectDailySource(f.source, {}, git), /DIRTY/); dirty = '';
  top = f.home; assert.throws(() => inspectDailySource(f.source, {}, git), /ROOT_REJECTED/); top = f.source;
  fs.writeFileSync(sourceFile, 'changed despite a clean index flag');
  assert.throws(() => inspectDailySource(f.source, {}, git), /BYTES_REJECTED/);
  fs.writeFileSync(sourceFile, bytes); fs.linkSync(sourceFile, path.join(f.source, 'alias'));
  assert.throws(() => inspectDailySource(f.source, {}, git), /ALIAS_REJECTED/);
  assert.ok(seen.length > 0);
});

test('v2 defaults remain compatible and bound data/cache/reports differ from code spec/migrations', t => {
  const defaults = v2Config({});
  assert.equal(defaults.root, path.join(dailyCodeRoot, 'v2')); assert.equal(defaults.dataRoot, defaults.root);
  assert.equal(defaults.databasePath, path.join(defaults.root, 'data/research-v2.sqlite'));
  assert.equal(v2Config({ V2_DATABASE_PATH: '../fixture.sqlite' }).databasePath, path.join(dailyCodeRoot, 'fixture.sqlite'));
  const f = fixture(t), config = configFor(f.roots);
  assert.equal(config.root, path.join(f.source, 'v2')); assert.equal(config.dataRoot, path.join(f.storage, 'v2'));
  assert.equal(config.databasePath, f.dbFile); assert.equal(config.reportsPath, path.join(f.storage, 'v2/reports'));
  assert.equal(config.historyPath, path.join(f.storage, 'data/history')); assert.equal(config.latestPath, path.join(f.storage, 'data/latest.json'));
  assert.equal(config.migrationsPath, path.join(f.source, 'v2/migrations'));
  assert.equal(dailyStorageRoots(f.decoy, {}).storageAppRoot, f.decoy);
});

function runner(f, { dry = false, locked = false, fail = [] } = {}) {
  const calls = [], inspections = [], outputs = [];
  const proc = { argv: ['node', 'runner', ...(dry ? ['--dry-run'] : [])], env: { [dailyBindingKey]: f.bindingPath },
    execPath: process.execPath, pid: process.pid, exitCode: 0, exit(code) { throw Error(`EXIT_${code}`); } };
  const source = strip(read('v2/scripts/run-v3-daily-update.mjs')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(f.source, 'v2/scripts/run-v3-daily-update.mjs')).href));
  const lock = path.join(f.storage, 'v2/data/.v3-daily-update.lock');
  if (locked) fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  const context = { fs, path, fileURLToPath, process: proc, Date, Intl,
    dailyStorageRoots: () => f.roots, assertDailyArguments() {}, assertExistingDailyDatabase,
    console: { log: value => outputs.push(value), error: value => outputs.push(value) }, buildDailyUpdateGateSummary, buildDailyBatchVerdict,
    inspectDailyMarket: args => { inspections.push(args); return { status: 'VALID', tradeDate: args.tradeDate }; },
    spawnSync(exe, args, options) { calls.push({ exe, args, options }); return { status: fail.includes(path.basename(args[0])) ? 2 : 0 }; } };
  try { vm.runInNewContext(source, context); } catch (error) { if (!/EXIT_/.test(error.message)) throw error; outputs.push(error.message); }
  return { calls, inspections, outputs, proc, lock };
}

test('entry execute delegates the same runner/code cwd; 35 mocked stages keep lock/storage/failure semantics', t => {
  const f = fixture(t), sourceBefore = snapshot(f.source), decoyBefore = snapshot(f.decoy);
  const entryCalls = [];
  const entry = runBoundDaily(['--binding', f.bindingPath, '--execute'], {}, {
    preflight: file => readDailyBinding(file, f.options), spawn: (...args) => { entryCalls.push(args); return { status: 2 }; },
  });
  assert.equal(entry.exitCode, 2); assert.equal(entryCalls.length, 1);
  assert.equal(entryCalls[0][1][0], path.join(f.source, 'v2/scripts/run-v3-daily-update.mjs'));
  assert.equal(entryCalls[0][2].cwd, path.join(f.source, 'v2'));
  const run = runner(f, { fail: ['quality-report.mjs', 'audit-live-event-ledger-root.mjs', 'audit-data-continuity.mjs'] });
  assert.equal(run.calls.length, 35); assert.equal(run.proc.exitCode, 0, 'only history audits failed (WP 0-6)');
  for (const call of run.calls) {
    assert.equal(path.dirname(call.args[0]), path.join(f.source, 'v2/scripts'));
    assert.equal(call.options.cwd, path.join(f.source, 'v2'));
    assert.equal(call.options.env[dailyBindingKey], f.bindingPath);
    assertDailyEnvironment(call.options.env, { stage: true });
  }
  for (const item of run.inspections) {
    assert.equal(item.databasePath, f.dbFile); assert.equal(item.calendarPath, path.join(f.source, 'config/taifex-official-calendar-2026.json'));
  }
  const status = JSON.parse(fs.readFileSync(path.join(f.storage, 'v2/reports/v3-daily-update-status.json')));
  assert.equal(status.state, 'failed'); assert.equal(status.stages.length, 35); assert.equal(status.gateSummary.quality, 'FAIL');
  assert.notEqual(status.gateSummary.overall, 'PASS'); assert.equal(fs.existsSync(run.lock), false);
  assert.deepEqual(snapshot(f.source), sourceBefore); assert.deepEqual(snapshot(f.decoy), decoyBefore);
  const busy = runner(f, { locked: true });
  assert.equal(busy.calls.length, 0); assert.ok(busy.outputs.includes('EXIT_2')); assert.equal(fs.existsSync(busy.lock), true);
  assert.equal(JSON.parse(fs.readFileSync(busy.lock)).pid, process.pid);
});

test('runner dry-run is side effect free and a critical failure never marks partial stages completed', t => {
  const f = fixture(t), before = snapshot(f.home);
  assert.equal(runner(f, { dry: true }).calls.length, 0); assert.deepEqual(snapshot(f.home), before);
  const result = runner(f, { fail: ['build-features.mjs'] });
  assert.equal(result.calls.length, 22);
  const status = JSON.parse(fs.readFileSync(path.join(f.storage, 'v2/reports/v3-daily-update-status.json')));
  assert.equal(status.state, 'failed'); assert.equal(status.totalStages, 35); assert.equal(status.stages.length, 22);
});

test('actual prepare uses SQLite in selected storage and source migration, leaves source and decoy bytes intact', t => {
  const f = fixture(t), sourceBefore = snapshot(f.source), decoyBefore = snapshot(f.decoy), config = configFor(f.roots);
  const context = { fs, path, console: { log() {} }, Date, v2Config: () => config, openDatabase, applyMigrations,
    loadV1Snapshots, importSnapshots, rebuildFeatures, runQualityChecks };
  vm.runInNewContext(strip(read('v2/scripts/setup-all.mjs')), context);
  const db = new DatabaseSync(f.dbFile, { readOnly: true });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_migration_marker'").get()); db.close();
  assert.ok(fs.existsSync(path.join(f.storage, 'v2/reports/latest-quality.json')));
  assert.deepEqual(snapshot(f.source), sourceBefore); assert.deepEqual(snapshot(f.decoy), decoyBefore);
});

test('all 35 stage routes and root delegates are inspected, including seven caches and frozen spec', async t => {
  const f = fixture(t), config = configFor(f.roots), stagesContext = {};
  const runnerText = read('v2/scripts/run-v3-daily-update.mjs');
  vm.runInNewContext(runnerText.slice(runnerText.indexOf('const stages ='), runnerText.indexOf('function writeJsonAtomic')) + '\nglobalThis.stages=stages;', stagesContext);
  assert.equal(stagesContext.stages.length, 35);
  const special = new Set(['intraday_replay', 'intraday_features', 'intraday_strategy_engineering', 'forward_decisions', 'forward_outcomes', 'forward_ledger_audit', 'paper_event_ledger_audit', 'live_event_ledger_audit', 'data_continuity_audit']);
  for (const stage of stagesContext.stages) {
    if (special.has(stage.key)) continue;
    let selected;
    const STOP = Error('STOP_BEFORE_SQL_OR_NETWORK');
    const context = { fs, path, process: { env: {}, argv: [] }, console: { log() {} }, Date,
      v2Config: () => config, openDatabase: file => { selected = file; throw STOP; } };
    await assert.rejects(vm.runInNewContext('(async()=>{' + strip(read('v2/scripts/' + stage.script)) + '})()', context), /STOP_BEFORE_SQL_OR_NETWORK/);
    assert.equal(selected, f.dbFile, stage.key);
  }
  const caches = ['backfill-domestic-institutions', 'backfill-global-context', 'backfill-option-institutions', 'backfill-option-large-traders', 'backfill-taifex', 'backfill-twse-institution-gross', 'validate-official-history'];
  for (const file of caches) {
    assert.match(read(`v2/scripts/${file}.mjs`), /path.join\(config.dataRoot, 'data',/);
    assert.doesNotMatch(read(`v2/scripts/${file}.mjs`), /path.join\(config.root, 'data'/);
  }
  const forward = read('v2/scripts/update-v3-4-forward.mjs');
  const specLine = forward.split('\n').find(line => line.startsWith('const specification ='));
  const ctx = { fs, path, config }; vm.runInNewContext(specLine + '\nglobalThis.spec=specification;', ctx);
  assert.equal(ctx.spec.version, JSON.parse(read('v2/config/forward-v3.4.json')).version);
  const prefixCases = [
    ['scripts/audit-forward-ledger.mjs', 'const errors =', ['ledgerPath', 'outcomeLedgerPath', 'reportPath']],
    ['scripts/audit-paper-event-ledger.mjs', 'const records =', ['archiveDir', 'ledgerPath', 'reportPath']],
    ['scripts/audit-live-event-ledger.mjs', 'const files =', ['ledgerDir', 'reportDir']],
    ['scripts/build-intraday-research-features.mjs', 'const dataset =', ['archiveDir', 'outputDir']],
    ['scripts/run-intraday-strategy-engineering.mjs', 'const sourceDataset =', ['archiveDir', 'outputDir']],
    ['v2/scripts/update-v3-decision-ledger.mjs', 'if (!fs.existsSync', ['databasePath', 'ledgerPath']],
    ['v2/scripts/resolve-v3-outcomes.mjs', 'const decisions =', ['decisionPath', 'outcomePath', 'statusPath']],
    ['v2/scripts/audit-data-continuity.mjs', 'const db =', ['databasePath', 'liveEventsDir', 'reportPath']],
  ];
  for (const [file, end, names] of prefixCases) {
    const source = strip(read(file)).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(f.source, file)).href));
    for (const roots of [f.roots, dailyStorageRoots(f.source, {})]) {
      const ctx = { path, fs, fileURLToPath, process: { argv: [], env: {} }, dailyStorageRoots: () => roots, assertDailyArguments() {} };
      vm.runInNewContext(source.slice(0, source.indexOf(end)) + `\nglobalThis.routes=[${names.join(',')}];`, ctx);
      for (const route of ctx.routes) assert.ok(route.startsWith(roots.storageAppRoot + path.sep), file + ': ' + route);
    }
  }
  const wrapper = strip(read('v2/scripts/backfill-taifex-replay-root.mjs')).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(f.source, 'v2/scripts/backfill-taifex-replay-root.mjs')).href));
  const calls = [];
  vm.runInNewContext(wrapper, { path, fileURLToPath, process: { platform: 'win32', env: {} }, dailyStorageRoots: () => f.roots,
    assertDailyArguments() {}, spawnSync: (...args) => { calls.push(args); return { status: 0 }; } });
  assert.equal(calls.length, 1); assert.ok(!calls[0][1].includes('Bypass'));
  assert.ok(calls[0][1].includes(path.join(f.source, 'scripts/backfill-taifex-replay.ps1')));
  assert.equal(calls[0][2].cwd, f.source);
  const ps = read('scripts/backfill-taifex-replay.ps1');
  assert.match(ps, /Join-Path \$storageRoot 'data\\intraday\\archive'/);
  assert.match(ps, /Join-Path \$root 'scripts\\build-taifex-replay.mjs'/);
  assert.match(ps, /Join-Path \$root 'scripts\\audit-taifex-replay.mjs'/);
  assert.ok(ps.indexOf('DAILY_STORAGE_PREFLIGHT_FAILED') < ps.indexOf('New-Item'));
  for (const file of ['build-taifex-replay', 'audit-taifex-replay']) {
    const source = read(`scripts/${file}.mjs`);
    assert.doesNotMatch(source, /path.resolve\('(data|v2)'/);
    assert.match(source, /dataPath\('data', 'intraday', 'archive'/);
  }
});
