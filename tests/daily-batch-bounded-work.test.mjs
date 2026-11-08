import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../v2/src/db.mjs';
import { runQualityChecks } from '../v2/src/quality.mjs';
import { validateOfficialBackfill } from '../v2/src/official-validation.mjs';
import { rebuildOptionOiChanges } from '../v2/src/official-backfill.mjs';
import { buildDailyUpdateGateSummary } from '../src/daily-update-gates.mjs';
import { dailyStorageRoots, assertDailyArguments } from '../src/daily-storage-binding.mjs';
import { assertExistingDailyDatabase } from '../src/daily-storage-database.mjs';

const script = name => fs.readFileSync(new URL('../v2/scripts/' + name, import.meta.url), 'utf8');
const withoutImports = source => source.replace(/^import .*;\r?\n/gm, '');
const coverageModule = new URL('../v2/src/option-oi-coverage.mjs', import.meta.url);
const helpers = fs.existsSync(coverageModule) ? await import(coverageModule.href) : {};
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  applyMigrations(db, path.resolve('v2/migrations'));
  for (let day = 1; day <= 12; day++) {
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    db.prepare('INSERT INTO raw_snapshots VALUES(?,NULL,NULL,?,?,?,?)').run(date, 'live', '{}', 'fixture', '2026-10-13');
    db.prepare('INSERT INTO market_daily(trade_date,tx_close) VALUES(?,?)').run(date, 20000 + day);
    db.prepare('INSERT INTO options_contract_daily(trade_date,contract,is_active,expiry_date,expiry_date_source) VALUES(?,?,1,?,?)')
      .run(date, '202611', '2026-11-18', 'calendar_estimate');
    for (let strike = 20000; strike < 20600; strike += 100)
      db.prepare('INSERT INTO options_strike_daily(trade_date,contract,strike,call_oi,put_oi) VALUES(?,?,?,?,?)')
        .run(date, '202611', strike, day * 10, 120 - day * 10);
  }
  rebuildOptionOiChanges(db);
  // A historical source failure must remain visible, even though latest rows exist.
  db.exec("INSERT INTO data_sources(trade_date,source_key,ok,stale,fallback_from_cache,error) VALUES('2026-10-01','fixture',0,0,0,'historical failure')");
  const trace = [];
  const traced = { exec: sql => db.exec(sql), close() {}, prepare(sql) {
    const statement = db.prepare(sql);
    return Object.fromEntries(['all', 'get', 'run', 'iterate'].map(method => [method, (...args) => {
      const value = statement[method](...args);
      trace.push({ sql, method, rows: Array.isArray(value) ? value.length : null }); return value;
    }]));
  } };
  return { db, traced, trace };
}
const oiScans = trace => trace.reduce((n, call) => n + (call.sql.match(/FROM\s+option_oi_changes\b/gi) || []).length, 0);

test('daily runner defers TAIFEX duplicate features/quality to the required downstream stages', async () => {
  const source = script('run-v3-daily-update.mjs');
  const context = {};
  vm.runInNewContext(source.slice(source.indexOf('const stages ='), source.indexOf('function writeJsonAtomic')) + '\nglobalThis.items=stages;', context);
  const taifex = context.items.find(stage => stage.key === 'taifex');
  assert.ok(taifex.args?.includes('--defer-derived-to-daily-stages'));
  assert.equal(context.items.filter(stage => stage.key === 'features').length, 1);
  assert.equal(context.items.filter(stage => stage.key === 'quality').length, 1);
  assert.ok(context.items.findIndex(stage => stage.key === 'quality') > context.items.findIndex(stage => stage.key === 'features'));
});

test('actual TAIFEX wrapper defers duplicate work explicitly and retains partial import failure', async () => {
  for (const defer of [true, false]) {
    const calls = [], logs = [], proc = { argv: ['node', 'script', ...(defer ? ['--defer-derived-to-daily-stages'] : [])], env: {}, exitCode: 0 };
    const context = { process: proc, Date, path, console: { log: value => logs.push(value) },
      fs: { mkdirSync() {}, writeFileSync() { calls.push('report'); } },
      v2Config: () => ({ root: '/fixture', dataRoot: '/fixture', databasePath: '/fixture/db', reportsPath: '/fixture/reports' }),
      openDatabase: () => ({ prepare: () => ({ get: () => ({ date: '2026-11-04' }) }), close() { calls.push('close'); } }),
      applyMigrations() {}, backfillTaifex: async () => ({ state: 'PARTIAL_SOURCE_FALLBACK', failures: ['fixture'] }),
      rebuildFeatures() { calls.push('features'); return { rows: 1 }; },
      runQualityChecks() { calls.push('quality'); return { coverage: {}, issues: {}, byRule: [] }; } };
    await vm.runInNewContext('(async()=>{' + withoutImports(script('backfill-taifex.mjs')) + '})()', context);
    assert.equal(proc.exitCode, 1);
    assert.deepEqual(calls, defer ? ['close'] : ['features', 'quality', 'report', 'close']);
    const report = JSON.parse(logs.at(-1)); assert.equal(report.ok, false);
    if (defer) assert.equal(report.derived.state, 'DEFERRED_TO_DAILY_STAGES');
  }
});

test('quality counts full history with one OI scan and retains historical failures', t => {
  const f = fixture(t), result = runQualityChecks(f.traced);
  assert.equal(result.coverage.option_oi_delta_1d_rows, 66);
  assert.equal(result.coverage.option_oi_delta_3d_rows, 54);
  assert.equal(result.coverage.option_oi_delta_5d_rows, 42);
  assert.equal(result.issues.error, 1);
  assert.equal(result.byRule.find(row => row.rule_code === 'SOURCE_FAILED').count, 1);
  assert.equal(oiScans(f.trace), 1, 'three separate full-history delta scans must be combined');
});

test('actual status wrapper keeps exact coverage with one OI scan', t => {
  const f = fixture(t), outputs = [];
  vm.runInNewContext(withoutImports(script('status-report.mjs')), { ...helpers, path, Date,
    fs: { statSync: () => ({ size: 123 }), mkdirSync() {}, writeFileSync: (_file, text) => outputs.push(JSON.parse(text)) },
    v2Config: () => ({ databasePath: '/fixture/db', reportsPath: '/fixture/reports' }),
    openDatabase: () => f.traced, applyMigrations() {}, console: { log() {} } });
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0].counts, { futuresContracts: 0, optionContracts: 12, optionStrikes: 72,
    optionOiChanges: 72, optionOiDelta1d: 66, optionOiDelta3d: 54, optionOiDelta5d: 42,
    globalMarketRows: 0, macroObservations: 0, volatilityRelativeDays: 0 });
  assert.equal(oiScans(f.trace), 1, 'status must aggregate deltas together rather than four full scans');
});

test('official validation returns the same 20 spaced samples without materializing all historical delta rows in JS', t => {
  const f = fixture(t);
  const rows = f.db.prepare('SELECT * FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL AND put_oi_delta_1d IS NOT NULL ORDER BY contract,strike,trade_date').all();
  const expected = Array.from({ length: 20 }, (_, i) => rows[Math.round(i * (rows.length - 1) / 19)])
    .map(row => `option delta ${row.trade_date} ${row.contract} ${row.strike}`);
  const result = validateOfficialBackfill(f.traced, '/SYNTHETIC_NO_CACHE');
  const samples = result.checks.filter(item => item.name.startsWith('option delta '));
  assert.deepEqual(samples.map(item => item.name), expected);
  assert.ok(samples.every(item => item.passed));
  assert.equal(result.coverage.delta_rows, 66);
  assert.equal(result.checks.find(item => item.name === 'at least one year of options').passed, false);
  assert.equal(result.checks.find(item => item.name === 'at least one year of futures').passed, false);
  const materialized = f.trace.filter(call => call.method === 'all' && /FROM\s+option_oi_changes\b/i.test(call.sql));
  assert.ok(materialized.length > 0);
  assert.ok(materialized.every(call => call.rows <= 20), 'only selected sample rows may cross SQLite/JS boundary');
});

test('sample boundary sizes, one-sided NULL deltas and corrupt historical sample retain original validation semantics', t => {
  const f = fixture(t);
  for (const count of [66, 21, 20, 19, 1, 0]) {
    f.db.exec(`DELETE FROM option_oi_changes WHERE rowid NOT IN
      (SELECT rowid FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL AND put_oi_delta_1d IS NOT NULL
       ORDER BY contract,strike,trade_date LIMIT ${count})`);
    const rows = f.db.prepare('SELECT * FROM option_oi_changes ORDER BY contract,strike,trade_date').all();
    const expected = rows.length <= 20 ? rows : Array.from({ length: 20 }, (_, i) => rows[Math.round(i * (rows.length - 1) / 19)]);
    const actual = validateOfficialBackfill(f.traced, '/SYNTHETIC_NO_CACHE');
    assert.deepEqual(actual.checks.filter(c => c.name.startsWith('option delta ')).map(c => c.name),
      expected.map(r => `option delta ${r.trade_date} ${r.contract} ${r.strike}`));
    assert.equal(actual.coverage.delta_rows, count);
  }
  rebuildOptionOiChanges(f.db);
  f.db.exec('UPDATE option_oi_changes SET put_oi_delta_1d=NULL WHERE rowid=(SELECT rowid FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL LIMIT 1)');
  assert.equal(helpers.readOptionOiCoverage(f.db).delta1d, 66);
  assert.equal(helpers.readOptionOiCoverage(f.db).sampleRows, 65);
  f.db.exec('UPDATE option_oi_changes SET call_oi_delta_1d=999 WHERE rowid=(SELECT rowid FROM option_oi_changes WHERE call_oi_delta_1d IS NOT NULL AND put_oi_delta_1d IS NOT NULL ORDER BY contract,strike,trade_date LIMIT 1)');
  const corrupted = validateOfficialBackfill(f.db, '/SYNTHETIC_NO_CACHE');
  assert.equal(corrupted.checks.find(c => c.name.startsWith('option delta ')).passed, false);
});

test('actual daily orchestration passes defer argument and preserves quality/validation failures without executing stage processes', () => {
  const calls = [], reports = [], proc = { argv: ['node', 'fixture'], env: {}, pid: 123, exitCode: 0 };
  const source = withoutImports(script('run-v3-daily-update.mjs')).replaceAll('import.meta.url', JSON.stringify('file:///synthetic/v2/scripts/run-v3-daily-update.mjs'));
  const context = { path, Date, Intl, process: proc, fileURLToPath: () => '/synthetic/v2/scripts/run-v3-daily-update.mjs',
    dailyStorageRoots: () => dailyStorageRoots('/synthetic', {}), assertDailyArguments, assertExistingDailyDatabase,
    buildDailyUpdateGateSummary, inspectDailyMarket: () => ({ status: 'VALID', tradeDate: '2026-11-06' }),
    console: { log() {}, error() {} },
    fs: { mkdirSync() {}, openSync: () => 1, closeSync() {}, unlinkSync() {}, renameSync() {}, appendFileSync() {},
      writeFileSync(_file, bytes) { const value = JSON.parse(bytes); if (value.stages) reports.push(value); } },
    spawnSync(_exe, args, options) {
      calls.push({ args, timeout: options.timeout });
      return { status: ['quality-report.mjs', 'validate-official-history.mjs', 'audit-data-continuity.mjs'].includes(path.basename(args[0])) ? 2 : 0 };
    } };
  vm.runInNewContext(source, context);
  assert.deepEqual([...calls.find(c => path.basename(c.args[0]) === 'backfill-taifex.mjs').args].slice(1), ['--defer-derived-to-daily-stages']);
  assert.equal(calls.find(c => path.basename(c.args[0]) === 'backfill-taifex.mjs').timeout, 300000);
  assert.equal(calls.find(c => path.basename(c.args[0]) === 'validate-official-history.mjs').timeout, 300000);
  assert.equal(calls.find(c => path.basename(c.args[0]) === 'status-report.mjs').timeout, 300000);
  const final = reports.at(-1);
  assert.equal(final.state, 'failed'); assert.equal(proc.exitCode, 1);
  assert.equal(final.gateSummary.quality, 'FAIL');
  assert.equal(final.failures.find(f => f.key === 'official_validation').error, 'exit_2');
  assert.notEqual(final.gateSummary.overall, 'PASS');
});

test('historical cache checksums are still checked and never become PASS after corruption', t => {
  const f = fixture(t), base = path.resolve('data'); fs.mkdirSync(base, { recursive: true });
  const cache = fs.mkdtempSync(path.join(base, 'official-validation-fixture-'));
  t.after(() => { assert.ok(cache.startsWith(base + path.sep)); fs.rmSync(cache, { recursive: true, force: true }); });
  const bytes = Buffer.from('synthetic historical cache payload');
  const file = path.join(cache, 'futures-2026-10-01-2026-10-12.csv.gz');
  fs.writeFileSync(file, zlib.gzipSync(bytes));
  f.db.prepare('INSERT INTO official_backfill_files VALUES(?,?,?,?,?,?,?,?)').run('futures', '2026-10-01', '2026-10-12',
    'https://synthetic.invalid/fixture', crypto.createHash('sha256').update(bytes).digest('hex'), bytes.length, '2026-10-13', 12);
  assert.equal(validateOfficialBackfill(f.db, cache).checks.find(c => c.name.startsWith('checksum ')).passed, true);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from('changed fixture payload')));
  assert.equal(validateOfficialBackfill(f.db, cache).checks.find(c => c.name.startsWith('checksum ')).passed, false);
});
