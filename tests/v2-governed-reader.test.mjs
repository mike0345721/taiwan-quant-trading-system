import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { loadOperatingCalendar } from '../src/operating-calendar.mjs';
import { createGovernedV2Reader, V2_READER_PIN as pin, V2_READER_ROLES, V2_READER_MODE, newV2ReadBudget } from '../src/dashboard-v2-reader-binding.mjs';
import * as research from '../src/v2-research.mjs';
import { assertOwnerSelected, ownerAdmission, OWNER_SCOPE } from '../src/owner-local-acceptance.mjs';

function fixture(changes = {}) {
  const reads = [], links = [], files = new Map();
  for (const [role, relative] of Object.entries(V2_READER_ROLES)) if (role !== 'forwardLedger') files.set(pin.activeRoot + '/' + relative, Buffer.from('{}'));
  const normalize = file => file.replaceAll('\\', '/');
  const binding = { manifestSha256: pin.manifestSha256,
    calendar: changes.bindingCalendar || { fileHash: 'c'.repeat(64), physicalFileHash: pin.calendarSha256 }, manifest: {
    calendarSha256: pin.calendarSha256, sourceBindings: { activeAppRoot: pin.activeRoot,
      databasePath: pin.activeRoot + '/v2/data/research-v2.sqlite', dailyStatusPath: pin.activeRoot + '/v2/reports/v3-daily-update-status.json' } } };
  const dependencies = {
    noLinks(file) { links.push(normalize(file)); },
    sha256: () => pin.manifestSha256,
    validateOperationsBinding: () => binding,
    statSync(file) { const bytes = files.get(normalize(file)); if (!bytes) throw Object.assign(Error('private-path'), { code: 'ENOENT' }); return { isFile: () => true, size: bytes.length, mtimeMs: 1 }; },
    readBoundedFile(file, limit) { reads.push(normalize(file)); if (normalize(file) === pin.manifestPath) return Buffer.from('synthetic-manifest');
      const bytes = files.get(normalize(file)); if (!bytes || bytes.length > limit) throw Error('private-limit'); return bytes; },
    ...changes.dependencies,
  };
  const options = { mode: V2_READER_MODE, candidateReadOnly: true, manifestPath: pin.manifestPath,
    calendar: { fileHash: 'c'.repeat(64), physicalFileHash: pin.calendarSha256 }, ...changes.options };
  const reader = createGovernedV2Reader(options, dependencies);
  return { reader, files, reads, links, binding, dependencies };
}

test('governed reader validates exact pin before following references and health reads metadata only', () => {
  const f = fixture(), before = f.reads.length;
  const identity = f.reader.identity();
  assert.equal(f.reader.validated, true);
  assert.equal(identity.bindingIdentity.manifestSha256, pin.manifestSha256);
  assert.equal(identity.artifacts.forwardLedger.state, 'MISSING');
  assert.equal(f.reads.length, before);
  assert.equal(Object.keys(identity.artifacts).length, 15);
  assert.doesNotMatch(JSON.stringify(identity), /Taiwan|sqlite|reports|private-path/);
  let followed = false;
  const bad = fixture({ dependencies: { sha256: () => '0'.repeat(64), validateOperationsBinding() { followed = true; throw Error('NO_FOLLOW'); } } });
  assert.equal(bad.reader.validated, false); assert.equal(followed, false);
});

test('binding is opt-in and rejects non-reader mode, wrong paths, overrides and physical aliases', () => {
  let calls = 0;
  assert.equal(createGovernedV2Reader({ mode: '' }, { readBoundedFile() { calls++; } }), null);
  assert.equal(calls, 0);
  for (const options of [{ candidateReadOnly: false }, { mode: 'other' }, { manifestPath: 'relative.json' },
    { manifestPath: pin.manifestPath.replace('/data/', '/data/../data/') }, { calendar: { fileHash: '0'.repeat(64) } },
    { overrides: { V2_DATABASE_PATH: 'elsewhere' } }, { overrides: { V2_BACKTEST_REPORT_PATH: 'elsewhere' } }]) {
    const f = fixture({ options }); assert.equal(f.reader.validated, false);
    assert.equal(f.reader.read('primaryReport').value, null);
    assert.deepEqual(f.reader.identity().reasonCodes, ['V2_READER_BINDING_UNVERIFIED']);
  }
  assert.equal(fixture({ dependencies: { noLinks() { throw Error('ALIAS'); } } }).reader.validated, false);
});

test('actual governed and operating calendar loaders validate physical bytes independently of semantic payload hashes', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cru61-calendar-identity-'));
  try {
    const calendarPath = path.join(folder, 'calendar.json');
    fs.copyFileSync(new URL('../config/taifex-official-calendar-2026.json', import.meta.url), calendarPath);
    const governed = loadGovernedTradingCalendar(calendarPath);
    const operating = loadOperatingCalendar(calendarPath, { dataRoot: path.join(folder, 'private-data') });
    assert.equal(governed.physicalFileHash, pin.calendarSha256);
    assert.notEqual(governed.fileHash, governed.physicalFileHash);
    assert.equal(operating.physicalFileHash, governed.physicalFileHash);
    assert.equal(operating.fileHash, governed.fileHash);
    assert.equal(fixture({ bindingCalendar: governed, options: { calendar: operating } }).reader.validated, true);
    for (const physicalFileHash of [undefined, '0'.repeat(64)]) {
      const changed = { ...governed, physicalFileHash };
      assert.equal(changed.fileHash, governed.fileHash, 'semantic payload identity is still unchanged');
      assert.equal(fixture({ bindingCalendar: changed, options: { calendar: operating } }).reader.validated, false);
      assert.equal(fixture({ bindingCalendar: governed, options: { calendar: { ...operating, physicalFileHash } } }).reader.validated, false);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('report budget rejects oversize before allocation, cumulative overflow, malformed and changed artifacts', () => {
  let opened = 0;
  const huge = fixture({ dependencies: { statSync: () => ({ isFile: () => true, size: 8 * 1024 * 1024 + 1, mtimeMs: 1 }),
    readBoundedFile(file) { if (file === pin.manifestPath) return Buffer.from('manifest'); opened++; throw Error('NO_ALLOC'); } } });
  assert.deepEqual(huge.reader.read('primaryReport').reasonCodes, ['V2_READER_ARTIFACT_OVERSIZE']); assert.equal(opened, 0);
  const f = fixture(), budget = { remainingBytes: 1 };
  assert.deepEqual(f.reader.read('primaryReport', budget).reasonCodes, ['V2_READER_PAYLOAD_BUDGET_EXCEEDED']);
  f.files.set(pin.activeRoot + '/' + V2_READER_ROLES.primaryReport, Buffer.from('{broken'));
  assert.equal(f.reader.read('primaryReport').state, 'UNKNOWN');
  f.dependencies.readBoundedFile = () => { throw Error('private changed'); };
  const changed = fixture({ dependencies: { readBoundedFile(file) { if (file === pin.manifestPath) return Buffer.from('manifest'); throw Error('private changed'); } } });
  assert.deepEqual(changed.reader.read('primaryReport').reasonCodes, ['V2_READER_ARTIFACT_UNREADABLE']);
  assert.equal(newV2ReadBudget().remainingBytes, 16 * 1024 * 1024);
  let reportReads = 0;
  const virtual = fixture({ dependencies: {
    statSync: () => ({ isFile: () => true, size: 6 * 1024 * 1024, mtimeMs: 1 }),
    readBoundedFile(file) { if (file === pin.manifestPath) return Buffer.from('manifest'); reportReads++; return { length: 6 * 1024 * 1024, toString: () => '{}' }; },
  } });
  const cumulative = newV2ReadBudget();
  assert.equal(virtual.reader.read('noTrade', cumulative).state, 'READ');
  assert.equal(virtual.reader.read('holding', cumulative).state, 'READ');
  assert.deepEqual(virtual.reader.read('paired', cumulative).reasonCodes, ['V2_READER_PAYLOAD_BUDGET_EXCEEDED']);
  assert.equal(reportReads, 2, 'budget rejection precedes read/allocation');
});

test('reader DB open races and query errors degrade without exposing paths or failing the whole decision payload', () => {
  const f = fixture();
  const reader = { ...f.reader, databaseAvailable: () => true,
    paths: { ...f.reader.paths, database: 'missing-synthetic-parent-cru61/database.sqlite' } };
  const service = new research.V2ResearchService(undefined, undefined, { readerBinding: reader });
  const decision = service.decisionSupport();
  assert.equal(decision.v3.reason, 'V2_READER_DATABASE_UNAVAILABLE');
  assert.equal(decision.v362Risk.reason, 'V2_READER_DATABASE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(decision), /missing-synthetic|database.sqlite|unable to open/i);
  assert.throws(() => service.query(), error => error.message === 'V2_READER_DATABASE_UNAVAILABLE' && error.statusCode === 503);
});

test('V2 binding flag requires explicit reader mode and preserves private cache/journal roots', () => {
  const source = fs.readFileSync(new URL('../src/config.mjs', import.meta.url), 'utf8');
  const run = env => {
    const context = { path, fileURLToPath, process: { env }, assertOwnerSelected, ownerAdmission,
      readManagedConfig() { throw Error('NO_MANAGED_READ'); } };
    const code = source.replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///C:/synthetic/src/config.mjs')).replace(/^export /gm, '');
    vm.runInNewContext(`${code}\nglobalThis.result=config;`, context); return context.result;
  };
  assert.throws(() => run({ DASHBOARD_RELEASE_SCOPE: OWNER_SCOPE }), /OWNER_INTERACTIVE_ADMISSION_REQUIRED/);
  const original = run({});
  const enabled = run({ DASHBOARD_CANDIDATE_READ_ONLY: '1', DASHBOARD_CANDIDATE_V2_BINDING: V2_READER_MODE });
  assert.equal(original.candidateV2Binding, '');
  assert.equal(enabled.candidateV2Binding, V2_READER_MODE);
  assert.equal(enabled.dataDir, original.dataDir); assert.equal(enabled.historyDir, original.historyDir);
  assert.equal(enabled.v2DatabasePath, original.v2DatabasePath, 'explicit reader does not mutate global writer/config roots');
  for (const env of [{ DASHBOARD_CANDIDATE_V2_BINDING: V2_READER_MODE },
    { DASHBOARD_CANDIDATE_READ_ONLY: '0', DASHBOARD_CANDIDATE_V2_BINDING: V2_READER_MODE },
    { DASHBOARD_CANDIDATE_READ_ONLY: '1', DASHBOARD_CANDIDATE_V2_BINDING: 'other' }]) assert.throws(() => run(env), /CANDIDATE_V2_BINDING_INVALID/);
});

test('V2 service consumes explicit governed reports and keeps absent forward count unknown', () => {
  const f = fixture();
  f.files.set(pin.activeRoot + '/' + V2_READER_ROLES.primaryReport, Buffer.from('{"source":"governed"}'));
  f.files.set(pin.activeRoot + '/' + V2_READER_ROLES.dailyUpdateStatus, Buffer.from('{"state":"completed","completedAt":"synthetic-time"}'));
  const service = new research.V2ResearchService('synthetic-missing.sqlite', 'synthetic-missing.json', { readerBinding: f.reader });
  assert.equal(service.backtestReport().source, 'governed');
  assert.equal(service.dailyUpdateStatus().state, 'completed');
  const decision = service.decisionSupport();
  assert.equal(decision.forward.records, null); assert.equal(decision.forward.status, 'UNKNOWN');
  assert.deepEqual(decision.readerArtifacts.forwardLedger.reasonCodes, ['V2_READER_ARTIFACT_MISSING']);
  assert.equal(service.readerIdentity().bindingKind, V2_READER_MODE);
});

test('failed post-read artifacts still consume the aggregate budget and growth cannot enlarge a reserved read', () => {
  let attempts = 0;
  const f = fixture({ dependencies: {
    statSync: () => ({ isFile: () => true, size: 6 * 1024 * 1024, mtimeMs: 1 }),
    readBoundedFile(file, limit) {
      if (file === pin.manifestPath) return Buffer.from('manifest');
      attempts++; assert.equal(limit, 6 * 1024 * 1024);
      throw Error('SYNTHETIC_CHANGED_AFTER_READ');
    },
  } });
  const budget = newV2ReadBudget();
  assert.equal(f.reader.read('noTrade', budget).state, 'UNKNOWN');
  assert.equal(budget.remainingBytes, 10 * 1024 * 1024);
  assert.equal(f.reader.read('holding', budget).state, 'UNKNOWN');
  assert.equal(budget.remainingBytes, 4 * 1024 * 1024);
  assert.deepEqual(f.reader.read('paired', budget).reasonCodes, ['V2_READER_PAYLOAD_BUDGET_EXCEEDED']);
  assert.equal(attempts, 2);
});

test('indexed per-strike history preserves 21-row then 20-prior semantics with finite materialization', () => {
  assert.equal(typeof research.readBoundedStrikeHistory, 'function');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE options_strike_daily(contract TEXT,strike INTEGER,trade_date TEXT,call_volume REAL,put_volume REAL,call_close REAL,put_close REAL); CREATE INDEX idx_options_strike ON options_strike_daily(contract,strike,trade_date);');
    const add = db.prepare('INSERT INTO options_strike_daily VALUES (?,?,?,?,?,?,?)');
    for (const strike of [100, 200, 300]) for (let day = 1; day <= 30; day++) add.run('202611', strike, `2026-10-${String(day).padStart(2, '0')}`, day, day + 1, day + 2, day + 3);
    const old = db.prepare('SELECT trade_date AS tradeDate,strike,call_volume AS callVolume,put_volume AS putVolume,call_close AS callClose,put_close AS putClose FROM options_strike_daily WHERE contract=? AND trade_date<=? ORDER BY strike,trade_date DESC').all('202611', '2026-10-30');
    const current = [{ strike: 100 }, { strike: 300 }];
    const rows = research.readBoundedStrikeHistory(db, { contract: '202611', latestDate: '2026-10-30', strikes: current, hasCallClose: true, hasPutClose: true });
    assert.equal(rows.length, 42);
    for (const strike of [100, 300]) assert.deepEqual(rows.filter(row => row.strike === strike), old.filter(row => row.strike === strike).slice(0, 21));
    assert.throws(() => research.readBoundedStrikeHistory(db, { contract: '202611', latestDate: '2026-10-30', strikes: Array.from({ length: 2001 }, (_, strike) => ({ strike })) }), /V2_STRIKE_BUDGET_EXCEEDED/);
    const queryPlan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM options_strike_daily INDEXED BY idx_options_strike WHERE contract=? AND strike=? AND trade_date<=? ORDER BY trade_date DESC LIMIT 21').all('202611', 100, '2026-10-30');
    assert.match(JSON.stringify(queryPlan), /SEARCH.*idx_options_strike/);
  } finally { db.close(); }
});

test('a missing existing strike index degrades the governed query without a full-scan fallback or migration', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cru61-v2-index-'));
  const database = path.join(folder, 'synthetic.sqlite');
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE market_daily(trade_date TEXT, twii_close REAL, tx_close REAL, tx_open_interest INTEGER, basis REAL);
    CREATE TABLE futures_positions_daily(trade_date TEXT, foreign_net INTEGER, market_open_interest INTEGER);
    CREATE TABLE futures_contract_daily(trade_date TEXT, product TEXT, session TEXT, open REAL, high REAL, low REAL, close REAL, is_active INTEGER);
    CREATE TABLE options_contract_daily(trade_date TEXT, contract TEXT, contract_type TEXT, expiry_date TEXT, days_to_expiry INTEGER, is_active INTEGER, call_volume INTEGER, put_volume INTEGER, volume_pc_ratio REAL, call_oi INTEGER, put_oi INTEGER, oi_pc_ratio REAL, call_wall_strike REAL, call_wall_oi INTEGER, put_wall_strike REAL, put_wall_oi INTEGER, max_pain REAL);
    CREATE TABLE options_strike_daily(trade_date TEXT, contract TEXT, strike REAL, call_oi INTEGER, put_oi INTEGER, call_volume INTEGER, put_volume INTEGER);
    CREATE TABLE option_oi_changes(trade_date TEXT, contract TEXT, strike REAL, call_oi_delta_1d INTEGER, put_oi_delta_1d INTEGER, call_oi_delta_3d INTEGER, put_oi_delta_3d INTEGER, call_oi_delta_5d INTEGER, put_oi_delta_5d INTEGER);
    CREATE TABLE quality_issues(severity TEXT);
    INSERT INTO market_daily VALUES('2026-11-03',100,102,900,2);
    INSERT INTO futures_positions_daily VALUES('2026-11-03',-50,900);
    INSERT INTO options_contract_daily VALUES('2026-11-03','202611','monthly','2026-11-18',15,1,10,12,1.2,20,30,1.5,110,8,90,9,100);
    INSERT INTO options_strike_daily VALUES('2026-11-03','202611',100,5,7,2,3);
  `);
  db.close();
  try {
    const f = fixture();
    const reader = { ...f.reader, databaseAvailable: () => true, paths: { ...f.reader.paths, database } };
    const service = new research.V2ResearchService(undefined, undefined, { readerBinding: reader });
    assert.throws(() => service.query(), error => error.message === 'V2_READER_DATABASE_UNAVAILABLE' && error.statusCode === 503);
    const inspect = new DatabaseSync(database, { readOnly: true });
    try { assert.equal(inspect.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index'").get().n, 0); }
    finally { inspect.close(); }
    // Only the isolated fixture supplies the pre-existing production index.
    const setup = new DatabaseSync(database);
    setup.exec('CREATE INDEX idx_options_strike ON options_strike_daily(contract,strike,trade_date)'); setup.close();
    assert.equal(service.query().options.strikes.length, 1, 'the same fixture succeeds when its required index exists');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
