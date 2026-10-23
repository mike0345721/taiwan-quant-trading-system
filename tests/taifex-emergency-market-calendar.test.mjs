import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/market-state-forward-shadow.mjs';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from '../src/market-state-forward-shadow-calendar.mjs';
import { assessTaifexMarketSession } from '../src/taifex-market-operation.mjs';
import { loadOperatingCalendar } from '../src/operating-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { runContinuitySupervisor, governedMarketSession } from '../scripts/run-shioaji-market-data-continuity.mjs';
import { readSchedulerHealth } from '../src/data-operations-scheduler-health.mjs';
import { inspectDailyMarket } from '../src/daily-market-applicability.mjs';
import { CONTINUITY_SAFETY, buildContinuityStatus } from '../src/shioaji-market-data-continuity.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mainPath = path.join(root, 'config/taifex-official-calendar-2026.json');
const evidencePath = path.join(root, 'config/taifex-emergency-closure-20261023.json');
const base = loadGovernedTradingCalendar(mainPath);
const closed = loadGovernedTradingCalendar(mainPath, evidencePath);
const now = (text) => new Date(text);

test('2026/10/23 exchange emergency closure is verifiable and 2026/10/26 stays scheduled holiday', () => {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.approvalScope, 'ISOLATED_RESEARCH_CANDIDATE_ONLY');
  assert.equal(evidence.ownerApproved, true);
  assert.equal(evidence.formalWeight, 0);
  assert.equal(evidence.researchOnly, true);
  assert.equal(evidence.executionAuthorized, false);
  assert.equal(evidence.orderRoutesEnabled, false);
  assert.equal(evidence.sourceHash, digest(evidence.sourceEvidence));
  assert.equal(evidence.sourceEvidence.publicNotices.length, 2);
  assert.ok(evidence.sourceEvidence.publicNotices.every((item) => item.url.startsWith('https://')));
  assert.equal(resolveGovernedTradingDay(base, '2026-10-23').officialTradingDay, true);
  const special = resolveGovernedTradingDay(closed, '2026-10-23');
  assert.equal(special.officialTradingDay, false);
  assert.equal(special.state, 'NON_TRADING_DAY_EXCEPTION');
  assert.equal(special.exceptionEvidence.reason, 'OFFICIAL_TYPHOON_EMERGENCY_CLOSURE');
  assert.equal(special.exceptionEvidence.evidenceFileHash, evidence.fileHash);
  assert.equal(closed.fileHash, base.fileHash);
  assert.equal(resolveGovernedTradingDay(closed, '2026-10-26').officialTradingDay, false);
  assert.equal(resolveGovernedTradingDay(closed, '2026-10-27').officialTradingDay, true);
});

test('operate on civil date without altering 10/22 historical NIGHT trade-date lineage', () => {
  const prior = assessTaifexMarketSession(now('2026-10-22T11:28:23Z'), closed);
  assert.deepEqual(prior, { state: 'NIGHT', marketShouldBeActive: true });
  const historical = classifyTxChartSession('2026-10-22T19:28:23+08:00', base);
  assert.equal(historical.session, 'NIGHT');
  assert.equal(historical.sessionId, '2026-10-22-NIGHT');
  assert.equal(historical.sessionTradeDate, '2026-10-23');
  // Although the Friday civil day is closed, 00:00-04:59 Taipei still
  // belongs to Thursday's already-running NIGHT session.
  assert.deepEqual(assessTaifexMarketSession(now('2026-10-22T16:30:00Z'), closed),
    { state: 'NIGHT', marketShouldBeActive: true });
  assert.deepEqual(assessTaifexMarketSession(now('2026-10-22T20:59:00Z'), closed),
    { state: 'NIGHT', marketShouldBeActive: true });
  assert.equal(assessTaifexMarketSession(now('2026-10-22T21:00:00Z'), closed).state, 'MARKET_CLOSED');
  const todayDay = assessTaifexMarketSession(now('2026-10-23T01:00:00Z'), closed);
  assert.equal(todayDay.state, 'MARKET_CLOSED');
  assert.equal(todayDay.marketShouldBeActive, false);
  assert.equal(todayDay.reasonCode, 'EXCHANGE_EMERGENCY_CLOSURE');
  assert.match(todayDay.evidenceFileHash, /^[a-f0-9]{64}$/);
  const todayNight = assessTaifexMarketSession(now('2026-10-23T07:30:00Z'), closed);
  assert.equal(todayNight.reasonCode, 'EXCHANGE_EMERGENCY_CLOSURE');
  assert.equal(todayNight.marketShouldBeActive, false);
  const monday = governedMarketSession(now('2026-10-26T01:00:00Z'), closed);
  assert.equal(monday.state, 'MARKET_CLOSED');
  assert.equal(monday.reasonCode, 'SCHEDULED_MARKET_HOLIDAY');
  assert.equal(monday.evidenceFileHash, null);
  assert.deepEqual(assessTaifexMarketSession(now('2026-10-27T17:30:00Z'), closed),
    { state: 'NIGHT', marketShouldBeActive: true });
  assert.deepEqual(assessTaifexMarketSession(now('2026-10-26T17:30:00Z'), closed),
    { state: 'SESSION_CLOSED', marketShouldBeActive: false });
  assert.deepEqual(assessTaifexMarketSession(now('2026-10-27T00:45:00Z'), closed),
    { state: 'DAY', marketShouldBeActive: true });
  assert.equal(assessTaifexMarketSession(now('2027-01-05T01:00:00Z'), closed).reasonCode, 'CALENDAR_UNVERIFIED');
});

test('tampered emergency source, bad owner governance and duplicate dates fail closed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-typhoon-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'evidence.json');
  const initial = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  function save(value) {
    const { fileHash: removed, ...rest } = value;
    fs.writeFileSync(p, JSON.stringify({ ...rest, fileHash: digest(rest) }));
  }
  save({ ...initial, sourceEvidence: { ...initial.sourceEvidence, observedDate: '2026-10-22' } });
  assert.throws(() => loadGovernedTradingCalendar(mainPath, p), /EXCEPTION_SOURCE_HASH_INVALID/);
  save({ ...initial, ownerApproved: false });
  assert.throws(() => loadGovernedTradingCalendar(mainPath, p), /EXCEPTION_GOVERNANCE_INVALID/);
  save({ ...initial, exceptions: [...initial.exceptions, ...initial.exceptions] });
  assert.throws(() => loadGovernedTradingCalendar(mainPath, p), /EXCEPTION_SET_INVALID/);
  save({ ...initial, exceptions: [{ ...initial.exceptions[0], tradeDate: '2027-01-01' }] });
  assert.throws(() => loadGovernedTradingCalendar(mainPath, p), /EXCEPTION_SET_INVALID/);
});

test('market-closed supervisor does not probe port, login, restart or claim data healthy', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-closed-supervisor-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  let spawns = 0;
  let portProbes = 0;
  const statuses = [];
  await runContinuitySupervisor({
    root: temp, calendar: closed,
    now: () => now('2026-10-23T01:00:00Z'),
    healthProbe: async () => ({
      ok: true, mode: 'market_data_only', formalWeight: 0,
      researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      bridgeState: 'DEGRADED', reasonCode: 'MISSING_REQUIRED_QUOTE_TYPE',
      writerState: 'PASS', writerErrors: 0, requiredSubscriptions: [],
    }),
    occupiedProbe: async () => { portProbes += 1; return false; },
    bridgeSpawner: () => { spawns += 1; return new EventEmitter(); },
    wait: async () => {},
    onStatus: (status) => statuses.push(status),
    maxCycles: 3,
  });
  assert.equal(spawns, 0);
  assert.equal(portProbes, 0);
  assert.equal(statuses.length, 3);
  for (const item of statuses) {
    assert.equal(item.state, 'MARKET_CLOSED');
    assert.equal(item.reasonCode, 'MARKET_CLOSED_EXPECTED');
    assert.equal(item.operatingSession.reasonCode, 'EXCHANGE_EMERGENCY_CLOSURE');
    assert.equal(item.dataTrust, 'UNAVAILABLE');
    assert.equal(item.executionAuthorized, false);
    assert.equal(item.orderRoutesEnabled, false);
    assert.equal(item.recoveryAttempt, 0);
  }
});

test('uncovered calendar fails closed and cannot cause a login storm', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-uncovered-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let spawns = 0;
  let portProbes = 0;
  const statuses = [];
  await runContinuitySupervisor({
    root: dir, calendar: closed, now: () => now('2027-01-05T01:00:00Z'),
    healthProbe: async () => null,
    occupiedProbe: async () => { portProbes += 1; return false; },
    bridgeSpawner: () => { spawns += 1; return new EventEmitter(); },
    wait: async () => {},
    onStatus: (status) => statuses.push(status),
    maxCycles: 2,
  });
  assert.equal(spawns, 0);
  assert.equal(portProbes, 0);
  assert.equal(statuses.length, 2);
  assert.ok(statuses.every((x) => x.state === 'UNAVAILABLE' && x.reasonCode === 'CALENDAR_UNVERIFIED'));
});

test('recovery gates stay default off and recover only when market can trade', () => {
  const holiday = assessTaifexMarketSession(now('2026-10-26T01:00:00Z'), closed);
  assert.equal(holiday.marketShouldBeActive, false);
  const day = assessTaifexMarketSession(now('2026-10-27T01:00:00Z'), closed);
  assert.equal(day.marketShouldBeActive, true);
  assert.equal(day.state, 'DAY');
  assert.deepEqual({
    formalWeight: CONTINUITY_SAFETY.formalWeight,
    researchOnly: CONTINUITY_SAFETY.researchOnly,
    executionAuthorized: CONTINUITY_SAFETY.executionAuthorized,
    orderRoutesEnabled: CONTINUITY_SAFETY.orderRoutesEnabled,
  }, { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false });
  const closedState = buildContinuityStatus({
    state: 'MARKET_CLOSED', reasonCode: 'MARKET_CLOSED_EXPECTED',
    operatingSession: holiday,
    recoveryResult: 'NO_RETRY_EXCHANGE_CALENDAR',
  });
  assert.equal(closedState.state, 'MARKET_CLOSED');
  assert.equal(closedState.operatingSession.calendarDate, '2026-10-26');
  assert.equal(closedState.dataTrust, 'UNAVAILABLE');
});

test('daily market applicability and scheduler suppress false missing-data alerts on typhoon day', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-emergency-scheduler-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'not-present.sqlite');
  const candidate = inspectDailyMarket({
    tradeDate: '2026-10-23', databasePath, calendarPath: mainPath, allowCandidate: true,
  });
  assert.equal(candidate.status, 'NOT_EXPECTED');
  assert.equal(candidate.reasonCode, 'MARKET_CLOSED');
  assert.equal(candidate.closureReasonCode, 'EXCHANGE_EMERGENCY_CLOSURE');
  assert.match(candidate.calendarExceptionHash, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(databasePath), false);
  const schedule = readSchedulerHealth({
    calendar: closed,
    dataRoot: dir, outputRoot: path.join(dir, 'quality/daily-data-operations'),
    now: now('2026-10-23T07:00:00Z'),
  });
  assert.equal(schedule.applicability, 'NOT_EXPECTED');
  assert.equal(schedule.completion, 'NOT_APPLICABLE');
  assert.ok(schedule.checkpoints.every((row) => row.state === 'NOT_DUE'));
  assert.equal(schedule.calendarIdentity.exceptionHash, candidate.calendarExceptionHash);
  const monday = readSchedulerHealth({
    dataRoot: dir, outputRoot: path.join(dir, 'quality/daily-data-operations'),
    now: now('2026-10-26T07:00:00Z'),
  });
  assert.equal(monday.applicability, 'NOT_EXPECTED');
  const tuesday = inspectDailyMarket({
    tradeDate: '2026-10-27', databasePath, calendarPath: mainPath, allowCandidate: true,
  });
  assert.equal(tuesday.applicability, 'EXPECTED');
  assert.equal(tuesday.status, 'UNKNOWN');
  assert.equal(tuesday.calendarExceptionHash, null);
});

test('Python Bridge emergency-closure guard passes independent offline validation when Python is available', (t) => {
  const python = process.platform === 'win32' ? 'python.exe' : 'python3';
  const candidate = spawnSync(python, ['--version'], { cwd: root, encoding: 'utf8' });
  if (candidate.error?.code === 'ENOENT') return t.skip('Python interpreter not installed in this CI lane');
  assert.equal(candidate.status, 0, candidate.stderr);
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests',
    '-p', 'test_taifex_emergency_market.py', '-v'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, [result.stdout, result.stderr].join('\n'));
  assert.match(result.stderr, /Ran \d+ tests/);
});

test('unactivated candidate stays unknown only on its dates; explicit overlay cannot be shadowed',()=>{
  const inactive=loadOperatingCalendar(mainPath);
  assert.throws(()=>resolveGovernedTradingDay(inactive,'2026-10-23'),/NOT_ACTIVATED/);
  assert.equal(resolveGovernedTradingDay(inactive,'2026-10-22').officialTradingDay,true);
  const combined=loadOperatingCalendar(mainPath,{exceptionPaths:[evidencePath],allowCandidate:true});
  assert.equal(resolveGovernedTradingDay(combined,'2026-10-23').officialTradingDay,false);
  assert.equal(combined.fileHash,base.fileHash);
});

test('backoff crossing closure boundary and absent calendar never spawn a broker',async t=>{
  for(const calendar of [closed,null]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'closure-race-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    let clock=Date.parse('2026-10-23T04:59:59+08:00'),spawns=0;
    await runContinuitySupervisor({root:dir,calendar,now:()=>new Date(clock),maxCycles:2,
      healthProbe:async()=>null,occupiedProbe:async()=>false,
      wait:async()=>{clock=Date.parse('2026-10-23T05:00:01+08:00')},
      bridgeSpawner:()=>{spawns++;return new EventEmitter()}});
    assert.equal(spawns,0);
  }
});


test('port probe crossing the session boundary cannot spawn after its awaited result',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'closure-probe-race-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=Date.parse('2026-10-23T04:59:59+08:00'), probes=0, spawns=0;
 await runContinuitySupervisor({root:dir,calendar:closed,now:()=>new Date(clock),maxCycles:1,
 healthProbe:async()=>null,wait:async()=>{},occupiedProbe:async()=>{if(++probes===2)clock+=2000;return false},
 bridgeSpawner:()=>{spawns++;return new EventEmitter()}});
 assert.equal(probes,2);assert.equal(spawns,0);
});
