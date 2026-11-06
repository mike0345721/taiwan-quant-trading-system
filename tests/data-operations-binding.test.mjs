import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readOperationsBinding, resolveOperationsReader, assertOperationsBindingLaunch } from '../src/data-operations-binding.mjs';
import { prepareOperationsBinding } from '../scripts/prepare-data-operations-binding.mjs';
import { inspectDailyMarket } from '../src/daily-market-applicability.mjs';
import { buildDailyUpdateGateSummary } from '../src/daily-update-gates.mjs';
import { loadOperatingCalendar } from '../src/operating-calendar.mjs';
import { readSchedulerHealth } from '../src/data-operations-scheduler-health.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const calendarPath = path.join(source, 'config/taifex-official-calendar-2026.json');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'acceptance-data');
  const sourceManifestPath = path.join(root, 'old.json');
  fs.writeFileSync(sourceManifestPath, JSON.stringify({ schemaVersion: 'data-operations-input-index-v1',
    governanceState: 'GOVERNED', selection: 'BUILD_A1', sourceBindings: {
      databasePath: path.join(root, 'stale.sqlite'), dailyStatusPath: path.join(root, 'stale.json') } }));
  const args = { sourceManifestPath, targetPath: path.join(root, 'r1.json'), activeAppRoot: path.join(root, 'active'),
    dataRoot, outputRoot: path.join(dataRoot, 'quality/daily-data-operations'),
    evidenceRoot: path.join(dataRoot, 'quality/daily-collection-acceptance/a2b'), calendarPath,
    governanceReference: 'SYNTHETIC_R1_TEST' };
  return { root, args };
}

test('bound API preserves frozen identity while operating exception suppresses false missing day',t=>{
  const {args}=fixture(t);prepareOperationsBinding(args);
  const original=fs.readFileSync(args.targetPath);
  const calendar=loadOperatingCalendar(calendarPath,{allowCandidate:true});
  const reader=resolveOperationsReader({manifestPath:args.targetPath,calendar});
  const result=readSchedulerHealth({...reader,now:new Date('2026-10-23T16:00:00+08:00')});
  assert.equal(result.applicability,'NOT_EXPECTED');
  assert.match(result.calendarIdentity.exceptionHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readFileSync(args.targetPath),original);
  assert.throws(()=>resolveOperationsReader({manifestPath:args.targetPath,calendar:{...calendar,fileHash:'x'}}),/BASE_MISMATCH/);
});
test('new binding replaces stale DB/status together; API and writer share output despite different app roots', t => {
  const { root, args } = fixture(t), original = fs.readFileSync(args.sourceManifestPath);
  const binding = prepareOperationsBinding(args);
  assert.equal(binding.manifest.sourceBindings.databasePath, path.join(args.activeAppRoot, 'v2/data/research-v2.sqlite'));
  assert.equal(binding.manifest.sourceBindings.dailyStatusPath, path.join(args.activeAppRoot, 'v2/reports/v3-daily-update-status.json'));
  const reader = resolveOperationsReader({ manifestPath: args.targetPath, dataRoot: path.join(root, 'different-api-root') });
  assert.equal(reader.outputRoot, args.outputRoot);
  assert.equal(reader.dataRoot, args.dataRoot);
  assert.equal(reader.bindingIdentity.manifestSha256, binding.manifestSha256);
  assert.equal(assertOperationsBindingLaunch({ ...args, manifestPath: args.targetPath }).manifestSha256, binding.manifestSha256);
  assert.deepEqual(fs.readFileSync(args.sourceManifestPath), original);
  assert.throws(() => prepareOperationsBinding(args), /EEXIST/);
});
test('conflicting writer/API roots, stale active sources and changed calendar fail closed', t => {
  const { root, args } = fixture(t); prepareOperationsBinding(args);
  assert.throws(() => resolveOperationsReader({ manifestPath: args.targetPath, outputRoot: path.join(root, 'wrong') }), /READER_OVERRIDE_MISMATCH/);
  for (const key of ['dataRoot', 'outputRoot', 'evidenceRoot', 'calendarPath']) {
    assert.throws(() => assertOperationsBindingLaunch({ ...args, manifestPath: args.targetPath, [key]: path.join(root, 'wrong') }), /LAUNCH_MISMATCH/);
  }
  const original = JSON.parse(fs.readFileSync(args.targetPath));
  for (const key of ['databasePath', 'dailyStatusPath']) {
    const changed = structuredClone(original); changed.sourceBindings[key] = path.join(root, 'stale');
    fs.writeFileSync(args.targetPath, JSON.stringify(changed));
    assert.throws(() => readOperationsBinding(args.targetPath), /ACTIVE_SOURCE_MISMATCH/);
  }
  original.calendarSha256 = '0'.repeat(64); fs.writeFileSync(args.targetPath, JSON.stringify(original));
  assert.throws(() => readOperationsBinding(args.targetPath), /CALENDAR_MISMATCH/);
});
test('morning DAY-final absence retains missing rows and proves only that the session has not ended', t => {
  const { root } = fixture(t), databasePath = path.join(root, 'morning.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE market_daily(trade_date TEXT); INSERT INTO market_daily VALUES ('2026-11-05')"); db.close();
  const market = inspectDailyMarket({ tradeDate: '2026-11-06', databasePath, calendarPath,
    observedAt: '2026-11-06T00:30:01.028Z' });
  assert.equal(market.tradeDate, '2026-11-06'); assert.equal(market.status, 'MISSING');
  assert.equal(market.dueState, 'NOT_DUE'); assert.equal(market.reasonCode, 'DAY_SESSION_NOT_ENDED');
  assert.equal(market.expectedCompletedTradeDate, '2026-11-05');
  assert.equal(market.officialPublishedAt, null);
  const summary = buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: true }], marketDaily: market });
  assert.equal(market.completedDateRow.status, 'PRESENT');
  // Timing explains the absence; it must not silently loosen the release gate.
  assert.equal(summary.requiredSource, 'BLOCKED'); assert.equal(summary.overall, 'FAILED');
  assert.ok(summary.reasons.includes('MARKET_DAILY_MISSING'));
  const failed = buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: true }, { key: 'quality', ok: false }],
    failures: [{ key: 'data_continuity_audit', critical: true }], marketDaily: market });
  assert.equal(failed.overall, 'FAILED'); assert.ok(failed.reasons.includes('QUALITY_DEBT'));
  const after = inspectDailyMarket({ tradeDate: '2026-11-06', databasePath, calendarPath, observedAt: '2026-11-06T05:45:00Z' });
  assert.equal(after.status, 'MISSING'); assert.equal(after.dueState, 'UNKNOWN');
  assert.equal(buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: true }], marketDaily: after }).requiredSource, 'BLOCKED');
  const unknownTime = inspectDailyMarket({ tradeDate: '2026-11-06', databasePath, calendarPath, observedAt: '2026-11-06 08:30' });
  assert.equal(unknownTime.dueState, 'UNKNOWN'); assert.equal(unknownTime.expectedCompletedTradeDate, null);
  const futureDay = inspectDailyMarket({ tradeDate: '2026-11-06', databasePath, calendarPath, observedAt: '2026-11-05T00:30:00Z' });
  assert.equal(futureDay.dueState, 'UNKNOWN'); assert.equal(futureDay.expectedCompletedTradeDate, null);
  assert.notEqual(buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: false }], marketDaily: market }).requiredSource, 'NOT_DUE');
});

test('daily batch target stays fixed across midnight while each row observation keeps its actual later time', () => {
  const scriptUrl = new URL('../v2/scripts/run-v3-daily-update.mjs', import.meta.url).href;
  const script = fs.readFileSync(fileURLToPath(scriptUrl), 'utf8').replace(/^import .*\r?\n/gm, '').replaceAll('import.meta.url', 'scriptUrl');
  let clock = Date.parse('2026-11-06T15:59:50Z'); const files = new Map(), inspections = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  vm.runInNewContext(script, { scriptUrl, path, fileURLToPath, Date: Clock, Intl,
    process: { argv: [], env: {}, pid: 123, execPath: 'synthetic-node' }, console: { log() {}, error() {} },
    fs: { mkdirSync() {}, openSync() { return 42; }, closeSync() {}, appendFileSync() {},
      writeFileSync(k, v) { files.set(k, v); }, renameSync(a, b) { files.set(b, files.get(a)); files.delete(a); }, unlinkSync(k) { files.delete(k); } },
    spawnSync() { clock += 60_000; return { status: 0 }; }, buildDailyUpdateGateSummary,
    inspectDailyMarket(args) { inspections.push(args); return { status: 'MISSING', tradeDate: args.tradeDate }; } });
  assert.ok(inspections.length > 2);
  assert.ok(inspections.every(x => x.tradeDate === '2026-11-06'));
  assert.ok(Date.parse(inspections.at(-1).observedAt) > Date.parse('2026-11-06T16:00:00Z'));
  const final = JSON.parse([...files.entries()].find(([k]) => String(k).endsWith('v3-daily-update-status.json'))[1]);
  assert.equal(final.targetTradeDate, '2026-11-06');
  assert.equal(final.gateSummary.overall, 'FAILED');
});
test('governed 9/25–9/28 closure requires no DB; open missing, uncovered and unavailable remain distinct', t => {
  const { root } = fixture(t), databasePath = path.join(root, 'market.sqlite');
  for (const tradeDate of ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']) {
    const market = inspectDailyMarket({ tradeDate, databasePath, calendarPath });
    assert.equal(market.status, 'NOT_EXPECTED'); assert.equal(market.reasonCode, 'MARKET_CLOSED');
    const summary = buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: true }], marketDaily: market });
    assert.equal(summary.requiredSource, 'NOT_EXPECTED'); assert.equal(summary.overall, 'NOT_EXPECTED');
    assert.deepEqual(summary.reasons, ['MARKET_CLOSED']);
  }
  assert.equal(fs.existsSync(databasePath), false);
  assert.equal(inspectDailyMarket({ tradeDate: '2026-09-24', databasePath, calendarPath }).status, 'UNKNOWN');
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE market_daily(trade_date TEXT); INSERT INTO market_daily VALUES ('2026-09-24')"); db.close();
  assert.equal(inspectDailyMarket({ tradeDate: '2026-09-24', databasePath, calendarPath }).status, 'VALID');
  assert.equal(inspectDailyMarket({ tradeDate: '2026-09-29', databasePath, calendarPath }).status, 'MISSING');
  assert.equal(inspectDailyMarket({ tradeDate: '2027-01-01', databasePath, calendarPath }).status, 'UNKNOWN');
  assert.equal(inspectDailyMarket({ tradeDate: '2026-09-26', databasePath, calendarPath: path.join(root, 'missing.json') }).status, 'UNKNOWN');
  assert.equal(buildDailyUpdateGateSummary().overall, 'UNKNOWN');
});
test('MARKET_CLOSED does not erase quality debt, incomplete continuity or real failed jobs', t => {
  const { root } = fixture(t);
  const marketDaily = inspectDailyMarket({ tradeDate: '2026-09-26', databasePath: path.join(root, 'absent'), calendarPath });
  const summary = buildDailyUpdateGateSummary({ marketDaily,
    stages: [{ key: 'taifex', ok: true }, { key: 'quality', ok: false }, { key: 'data_continuity_audit', ok: false }],
    failures: [{ key: 'data_continuity_audit', critical: true }] });
  assert.equal(summary.overall, 'FAILED'); assert.equal(summary.requiredSource, 'NOT_EXPECTED');
  assert.deepEqual(summary.reasons, ['QUALITY_DEBT', 'DATA_CONTINUITY_AUDIT_FAIL', 'MARKET_CLOSED']);
  assert.equal(buildDailyUpdateGateSummary({ marketDaily, stages: [{ key: 'taifex', ok: false }] }).overall, 'FAILED');
});
