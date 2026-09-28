import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDailyCollectionAcceptance } from '../src/daily-collection-acceptance.mjs';
import { buildDailyDataOperations, CHECKPOINT_TYPES } from '../src/daily-data-operations.mjs';
import { runAcceptance, resolveAcceptanceInput, sha256, taipeiDate } from '../scripts/run-daily-data-operations-acceptance.mjs';
import { runDailyDataOperations } from '../scripts/build-daily-data-operations.mjs';
import { projectDataOperations, readDataOperations } from '../src/dashboard-data-operations.mjs';
import { hashPassword } from '../src/security.mjs';
import { resolveOperationsReader } from '../src/data-operations-binding.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const calendarPath = path.join(source, 'config/taifex-official-calendar-2026.json');
const calendarBytes = fs.readFileSync(calendarPath);
const browserContext = { setTimeout, clearTimeout, AbortController };
vm.runInNewContext(fs.readFileSync(path.join(source, 'public/data-operations.js'), 'utf8'), browserContext);
const ui = browserContext.DataOperations;
function fixture(t, { cutoff = '2026-09-09T10:00:00.000Z', date = '2026-09-09', nonTrading = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2b-test-'));
  const lifecycle = { child: null };
  t.after(async () => {
    if (lifecycle.child && lifecycle.child.exitCode == null && lifecycle.child.signalCode == null) {
      const exited = once(lifecycle.child, 'exit'); lifecycle.child.kill(); await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const evidenceRoot = path.join(root, 'inputs'); fs.mkdirSync(evidenceRoot);
  const input = { calendarDate: date, tradeDate: date, generatedAt: cutoff,
    marketDayState: nonTrading ? 'NON_TRADING_DAY' : 'TRADING_DAY', sessions: ['DAY','NIGHT'], registry: { datasets: [] },
    liveEvidence: { ledgerFound: false, feeds: {}, sessionWindows: {
      DAY: { sessionStart: `${date}T00:45:00Z`, sessionEnd: `${date}T05:45:00Z` },
      NIGHT: { sessionStart: '2026-09-08T07:00:00Z', sessionEnd: '2026-09-08T21:00:00Z' } },
    sourceArtifactIdentity: { type: 'append-only-ledger-fixed-byte-cutoff', files: [], missingFiles: [`${date}.ndjson`] } } };
  const report = { ...buildDailyCollectionAcceptance(input), evidenceInputs: { calendar: { sha256: sha256(calendarBytes) } } };
  function write(file, value) { const bytes = JSON.stringify(value); fs.writeFileSync(path.join(evidenceRoot, file), bytes); return { file, sha256: sha256(bytes) }; }
  const reportRef = write('report.json', report), inputsRef = write('inputs.json', { inputs: input });
  const manifest = { schemaVersion: 'data-operations-input-index-v1', governanceState: 'GOVERNED', governanceReference: 'SYNTHETIC_TEST_ONLY',
    evidenceRoot, calendarSha256: sha256(calendarBytes), requests: CHECKPOINT_TYPES.map(checkpointType => ({
      tradeDate: date, checkpointType, inputGeneratedAt: cutoff, report: reportRef, acceptanceInputs: inputsRef })) };
  const manifestPath = path.join(root, 'index.json');
  const save = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest)); save();
  const dataRoot = path.join(root, 'data'), outputRoot = path.join(dataRoot, 'quality/daily-data-operations/test');
  return { root, lifecycle, input, report, manifest, save, write,
    options: { dataRoot, outputRoot, manifestPath, evidenceRoot, calendarPath, tradeDate: date, checkpointType: 'EOD_CHECKPOINT', runMode: 'MANUAL_REPLAY' } };
}
for (const checkpointType of CHECKPOINT_TYPES) test(`runner ${checkpointType}: A.1 → A.2a → immutable read/API/UI parity`, t => {
  const f = fixture(t), result = runAcceptance({ ...f.options, checkpointType });
  const expected = buildDailyDataOperations({ acceptanceReport: f.report, acceptanceInputs: f.input, calendarJson: calendarBytes.toString(),
    checkpointType, generatedAt: result.assessment.generatedAt, inputArtifactIdentity: result.assessment.inputArtifactIdentity });
  assert.deepEqual(result.assessment, expected);
  const view = readDataOperations(f.options);
  assert.equal(view.tradeDate, expected.tradeDate); assert.equal(view.checkpointType, checkpointType);
  assert.equal(view.overallState, expected.overallState); assert.equal(view.requiredAndDueCount, expected.requiredAndDueCount);
  assert.equal(view.finalized, expected.finalizationEligible); assert.equal(view.acceptanceJobHealth.runId, result.jobHealth.runId);
  assert.equal(view.acceptanceJobHealth.lastSuccessAt, result.jobHealth.lastSuccessAt);
  assert.equal(view.acceptanceJobHealth.lastFinalizedTradeDate, result.jobHealth.lastFinalizedTradeDate);
  assert.equal(view.acceptanceJobHealth.lastAutomaticAttemptAt, null);
  assert.equal(view.counts.UNKNOWN, view.rows.filter(r => r.inCheckpointScope && r.operationalState === 'UNKNOWN').length);
  const row = view.gaps[0], raw = expected.remediationActions.filter(a => a.feedIdentity === row.feedIdentity && a.session === row.session);
  assert.deepEqual(row.remediation, raw); assert.ok(ui.render(view).includes(row.reasonsZh[0]));
  assert.ok(ui.render(view).includes(row.reasonCodes[0])); assert.ok(ui.render(view).includes(row.minimumNextAction));
  assert.equal(/(?:[A-Z]:\\|\.sqlite|prefixSha256)/.test(JSON.stringify(view)), false);
});
test('lawful pending remains pending and cannot FINAL just because runner executes later', t => {
  const f = fixture(t, { cutoff: '2026-09-09T02:00:00.000Z' });
  const { assessment } = runAcceptance({ ...f.options, checkpointType: CHECKPOINT_TYPES[2] });
  assert.ok(assessment.coreLive.rows.filter(r => r.session === 'DAY').every(r => r.operationalState === 'PENDING'));
  assert.equal(assessment.finalizationEligible, false);
});
test('lawful unknown EOD due remains UNKNOWN outside due denominator', t => {
  const f = fixture(t), { assessment } = runAcceptance(f.options);
  assert.equal(assessment.coreEodState, 'UNKNOWN'); assert.equal(assessment.coreEod.requiredAndDueCount, 0);
  assert.ok(assessment.reasonCodes.includes('DUE_SEMANTICS_UNGOVERNED'));
});
test('governed dated A1 pair resolves existing CLI outputs and rejects conflicting modes/replay metadata', t => {
  const f = fixture(t);
  f.write(`${f.options.tradeDate}.json`, f.report);
  f.write(`${f.options.tradeDate}.inputs.json`, { inputs: f.input });
  f.manifest.selection = 'DATED_A1_PAIR'; delete f.manifest.requests; f.save();
  const result = runAcceptance(f.options);
  assert.equal(result.jobHealth.inputResolutionIdentity.selection, 'DATED_A1_PAIR');
  f.manifest.requests = []; f.save(); assert.throws(() => runAcceptance(f.options), /AMBIGUOUS/);
  delete f.manifest.requests; f.save();
  f.write(`${f.options.tradeDate}.inputs.json`, { inputs: { ...f.input, sessions: ['NIGHT'] } });
  assert.throws(() => runAcceptance(f.options), /A1_REPLAY_MISMATCH/);
});
test('candidate scheduler mode cannot target another runtime data root', t => {
  const f = fixture(t);
  assert.throws(() => runAcceptance({ ...f.options, runMode: 'CANDIDATE_SCHEDULER_TEST', triggerIdentity: 'TWQuant-CRU52-A2B-Test-unit' }), /CANDIDATE_DATA_ROOT/);
});

function buildFixture(t, candidate = false) {
  const f = fixture(t);
  if (candidate) f.options.dataRoot = path.join(source, 'data');
  const id = `b1-test-${crypto.randomUUID()}`;
  f.options.outputRoot = path.join(f.options.dataRoot, 'quality/daily-data-operations', id);
  f.options.evidenceRoot = path.join(f.options.dataRoot, 'quality/daily-collection-acceptance', id);
  if (candidate) t.after(() => {
    for (const dir of [f.options.outputRoot, f.options.evidenceRoot]) {
      assert.ok(dir.startsWith(path.join(source, 'data', 'quality') + path.sep));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const registryPath = path.join(source, 'config/data-requirements-v1.json');
  f.manifest = { schemaVersion: 'data-operations-input-index-v1', governanceState: 'GOVERNED',
    governanceReference: 'SYNTHETIC_B1_TEST_ONLY', evidenceRoot: f.options.evidenceRoot,
    calendarSha256: sha256(calendarBytes), selection: 'BUILD_A1', sourceBindings: {
      ledgerDataRoot: f.options.dataRoot, registryPath, registrySha256: sha256(fs.readFileSync(registryPath)),
      dailyStatusPath: path.join(f.root, 'missing-status.json'), derivedArtifactPaths: [],
      sessionsByCheckpoint: Object.fromEntries(CHECKPOINT_TYPES.map(type => [type, ['DAY', 'NIGHT']])) } };
  f.save = () => fs.writeFileSync(f.options.manifestPath, JSON.stringify(f.manifest)); f.save();
  return f;
}

test('Windows simultaneous catch-up launchers wait for owned guard then complete three distinct checkpoints', {skip:process.platform!=='win32'}, async t => {
  const f=buildFixture(t,true), guard=path.join(f.options.outputRoot,'.manual-run.guard'), owner=crypto.randomUUID();
  fs.mkdirSync(f.options.outputRoot,{recursive:true});fs.writeFileSync(guard,owner,{flag:'wx'});
  const children=CHECKPOINT_TYPES.map(checkpoint=>{
    const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'scripts/run-daily-data-operations-hidden.ps1'),
      '-DataRoot',f.options.dataRoot,'-OutputRoot',f.options.outputRoot,'-ManifestPath',f.options.manifestPath,
      '-EvidenceRoot',f.options.evidenceRoot,'-CalendarPath',calendarPath,'-Checkpoint',checkpoint,
      '-RunMode','CANDIDATE_SCHEDULER_TEST','-TriggerIdentity',`TWQuant-CRU52-A2B-Test-${crypto.randomUUID()}`,'-TradeDate',f.options.tradeDate];
    const child=spawn('powershell.exe',args,{cwd:source,windowsHide:true});
    const entry={child,stderr:'',stdout:''};child.stderr.on('data',b=>entry.stderr+=b);child.stdout.on('data',b=>entry.stdout+=b);
    entry.done=new Promise(resolve=>child.on('close',code=>resolve(code)));return entry;
  });
  t.after(()=>{for(const c of children)if(c.child.exitCode===null)c.child.kill();});
  const deadline=Date.now()+25000;
  while(!children.every(c=>c.stderr.includes('OPERATIONS_OUTPUT_BUSY_OR_ABANDONED_GUARD')) && Date.now()<deadline) {
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(children.every(c=>c.stderr.includes('OPERATIONS_OUTPUT_BUSY_OR_ABANDONED_GUARD')),'all runners must encounter contention');
  assert.equal(fs.readFileSync(guard,'utf8'),owner);fs.unlinkSync(guard); // release only our test-owned guard
  const codes=await Promise.all(children.map(c=>c.done));assert.deepEqual(codes,[0,0,0],children.map(c=>c.stderr).join('\n'));
  const receipts=fs.readdirSync(path.join(f.options.outputRoot,'runs')).map(file=>JSON.parse(fs.readFileSync(path.join(f.options.outputRoot,'runs',file))));
  assert.deepEqual(receipts.map(r=>r.checkpointType).sort(),[...CHECKPOINT_TYPES].sort());
  assert.ok(receipts.every(r=>r.jobState==='SUCCEEDED'&&r.runMode==='CANDIDATE_SCHEDULER_TEST'));
  assert.equal(fs.existsSync(path.join(f.options.outputRoot,'automatic-checkpoints')),false);
});

for(const checkpointType of ['EOD_CHECKPOINT','FINAL_TRADEDATE_CHECKPOINT']) {
  test(`cross-day wake: ${checkpointType} next morning is rejected before any A1/A2a write, including CLI`, t => {
    const now='2026-09-15T01:00:00Z'; t.mock.timers.enable({apis:['Date'],now:new Date(now)});
    const f=buildFixture(t), label=checkpointType==='EOD_CHECKPOINT'?'EOD':'FINAL';
    const options={...f.options,tradeDate:undefined,checkpointType,runMode:'SCHEDULED',triggerIdentity:`TWQuant-DataOperations-${label}`};
    const previous=readDataOperations({...options,now:new Date('2026-09-14T15:00:00Z')}).schedulerHealth;
    assert.equal(previous.checkpoints.find(c=>c.checkpointType===checkpointType).state,'OVERDUE_NO_RECEIPT');
    assert.throws(()=>runAcceptance(options),/OPERATIONS_SCHEDULED_CHECKPOINT_NOT_DUE/);
    const clock=path.join(f.root,'controlled-clock.mjs');
    fs.writeFileSync(clock,`const RealDate=Date;globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['${now}']));}static now(){return RealDate.parse('${now}');}};`);
    const cli=spawnSync(process.execPath,['--import',pathToFileURL(clock).href,path.join(source,'scripts/run-daily-data-operations-acceptance.mjs'),
      `--data-root=${options.dataRoot}`,`--output-root=${options.outputRoot}`,`--manifest=${options.manifestPath}`,
      `--evidence-root=${options.evidenceRoot}`,`--calendar=${calendarPath}`,`--checkpoint=${checkpointType}`,
      '--run-mode=SCHEDULED',`--trigger-identity=${options.triggerIdentity}`],{cwd:source,windowsHide:true,encoding:'utf8'});
    assert.equal(cli.status,1,cli.stderr);assert.match(cli.stderr,/OPERATIONS_SCHEDULED_CHECKPOINT_NOT_DUE/);assert.equal(cli.stdout,'');
    assert.equal(fs.existsSync(options.evidenceRoot),false,'no current-date A1 build');
    assert.equal(fs.existsSync(options.outputRoot),false,'no assessment, latest, guard, health or automatic receipt/index');
    assert.deepEqual(readDataOperations({...options,now:new Date('2026-09-14T15:00:00Z')}).schedulerHealth,previous,'prior missed day remains unchanged');
  });
}
test('rejected morning EOD/FINAL preserves prior history; legitimate current DAY -> EOD -> FINAL advances latest', t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-14T05:55:00Z')});
  const f=buildFixture(t), options={...f.options,tradeDate:undefined,runMode:'SCHEDULED'};
  const run=(checkpointType,label)=>runAcceptance({...options,checkpointType,triggerIdentity:`TWQuant-DataOperations-${label}`});
  const prior=run('DAY_CHECKPOINT','DAY');
  const snapshot=base=>{
    const files={};const walk=relative=>{for(const entry of fs.readdirSync(path.join(base,relative),{withFileTypes:true})){
      const file=path.join(relative,entry.name);if(entry.isDirectory())walk(file);else files[file]=sha256(fs.readFileSync(path.join(base,file)));
    }};walk('');return files;
  };
  const outputBefore=snapshot(options.outputRoot), a1Before=snapshot(options.evidenceRoot);
  t.mock.timers.setTime(new Date('2026-09-15T01:00:00Z').getTime());
  for(const [kind,label] of [['EOD_CHECKPOINT','EOD'],['FINAL_TRADEDATE_CHECKPOINT','FINAL']]) {
    assert.throws(()=>run(kind,label),/OPERATIONS_SCHEDULED_CHECKPOINT_NOT_DUE/);
  }
  assert.deepEqual(snapshot(options.outputRoot),outputBefore);assert.deepEqual(snapshot(options.evidenceRoot),a1Before);
  for(const [kind,label,time] of [['DAY_CHECKPOINT','DAY','13:55'],['EOD_CHECKPOINT','EOD','16:10'],['FINAL_TRADEDATE_CHECKPOINT','FINAL','18:10']]) {
    t.mock.timers.setTime(new Date(`2026-09-15T${time}:00+08:00`).getTime());
    const result=run(kind,label), latest=JSON.parse(fs.readFileSync(path.join(options.outputRoot,'latest.json')));
    assert.equal(result.assessment.tradeDate,'2026-09-15');assert.equal(latest.checkpointType,kind);
    assert.equal(latest.reportHash,result.assessment.reportHash);assert.notEqual(latest.overallState,'PASS');
    const view=readDataOperations(options), c=view.schedulerHealth.checkpoints.find(c=>c.checkpointType===kind);
    assert.equal(c.state,'ON_TIME_SUCCEEDED');assert.equal(view.checkpointType,kind);
    assert.equal(view.overallState,result.assessment.overallState);
  }
  for(const file of Object.keys(outputBefore).filter(f=>f.startsWith('runs'+path.sep)||f.startsWith('2026-09-14'+path.sep))) {
    assert.equal(sha256(fs.readFileSync(path.join(options.outputRoot,file))),outputBefore[file],'prior immutable bytes preserved');
  }
  for(const kind of ['eod','final']) assert.equal(fs.existsSync(path.join(options.outputRoot,'automatic-checkpoints/2026-09-14',kind+'.json')),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.outputRoot,'runs',prior.jobHealth.runId+'.json'))).requestedTradeDate,'2026-09-14');
});
test('same-day 14:27 scheduled runner remains late with immutable overdue start and canonical PARTIAL', t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-15T06:27:00Z')});
  const f=buildFixture(t), result=runAcceptance({...f.options,tradeDate:undefined,runMode:'SCHEDULED',checkpointType:'DAY_CHECKPOINT',triggerIdentity:'TWQuant-DataOperations-DAY'});
  const h=result.jobHealth, startBytes=fs.readFileSync(path.join(f.options.outputRoot,`runs/${h.runId}.scheduler-start.json`));
  assert.equal(sha256(startBytes),h.schedulerStartIdentity.sha256);assert.equal(JSON.parse(startBytes).stateBeforeAttempt,'OVERDUE_NO_RECEIPT');
  assert.equal(h.schedulerTiming.timeliness,'LATE');assert.equal(h.schedulerTiming.latenessMs,32*60000);
  const view=readDataOperations(f.options);assert.equal(view.schedulerHealth.checkpoints[0].state,'LATE_SUCCEEDED');
  assert.equal(view.overallState,result.assessment.overallState);assert.equal(view.overallState,'PARTIAL');
  assert.ok(ui.render(view).includes('延遲：32 分鐘'));assert.ok(ui.render(view).includes('data-state="PARTIAL"'));
});

test('B1 scheduled chain builds and pins current A1 before A2a without a pre-created pair', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-14T08:10:00Z') });
  const f = buildFixture(t);
  assert.equal(fs.existsSync(f.options.evidenceRoot), false);
  const result = runAcceptance({ ...f.options, tradeDate: undefined, runMode: 'SCHEDULED', triggerIdentity: 'TWQuant-DataOperations-EOD' });
  assert.equal(result.assessment.tradeDate, '2026-09-14');
  assert.equal(result.jobHealth.jobState, 'SUCCEEDED');
  const identity = result.jobHealth.inputResolutionIdentity;
  assert.equal(identity.selection, 'BUILD_A1');
  const pairRoot = path.join(f.options.evidenceRoot, identity.a1Build.buildId);
  const reportBytes = fs.readFileSync(path.join(pairRoot, '2026-09-14.json'));
  assert.equal(sha256(reportBytes), identity.reportSha256);
  const inputs = JSON.parse(fs.readFileSync(path.join(pairRoot, '2026-09-14.inputs.json'))).inputs;
  const expected = buildDailyDataOperations({ acceptanceReport: JSON.parse(reportBytes), acceptanceInputs: inputs,
    checkpointType: result.assessment.checkpointType, generatedAt: result.assessment.generatedAt,
    calendarJson: calendarBytes.toString(), inputArtifactIdentity: result.assessment.inputArtifactIdentity });
  assert.deepEqual(result.assessment, expected);
  assert.notEqual(expected.overallState, 'PASS'); // absent source data is not update/acceptance success
  assert.equal(readDataOperations(f.options).artifactIdentity.reportHash, expected.reportHash);
  assert.ok(ui.render(readDataOperations(f.options)).includes(expected.tradeDate));
});

test('B1 candidate scheduled non-trading date builds lawful NOT_EXPECTED without existing A1', t => {
  const f = buildFixture(t, true);
  const result = runAcceptance({ ...f.options, tradeDate: '2026-09-13', runMode: 'CANDIDATE_SCHEDULER_TEST',
    triggerIdentity: 'SYNTHETIC_B1', checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' });
  assert.equal(result.assessment.overallState, 'NOT_EXPECTED');
  assert.equal(result.assessment.requiredAndDueCount, 0);
  assert.equal(result.jobHealth.lastAutomaticSuccessAt, null);
});

test('B1 fresh builds retain prior A1 pairs; child failure preserves prior A2a success/final history', t => {
  const f = buildFixture(t);
  const first = runAcceptance({ ...f.options, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' });
  const id = first.jobHealth.inputResolutionIdentity;
  const reportPath = path.join(f.options.evidenceRoot, id.a1Build.buildId, `${f.options.tradeDate}.json`);
  const next = runAcceptance(f.options);
  assert.notEqual(next.jobHealth.inputResolutionIdentity.a1Build.buildId, id.a1Build.buildId);
  assert.equal(sha256(fs.readFileSync(reportPath)), id.reportSha256);
  f.manifest.sourceBindings.batchEvidencePath = path.join(f.root, 'missing-batch.json'); f.save();
  assert.throws(() => runAcceptance(f.options), /OPERATIONS_A1_BUILD_FAILED/);
  const view = readDataOperations(f.options);
  assert.equal(view.acceptanceJobHealth.jobState, 'FAILED');
  assert.equal(view.acceptanceJobHealth.lastSuccessAt, next.jobHealth.lastSuccessAt);
  assert.equal(view.acceptanceJobHealth.lastFinalizedTradeDate, first.jobHealth.lastFinalizedTradeDate);
  assert.equal(view.artifactIdentity.reportHash, first.assessment.reportHash);
  assert.equal(sha256(fs.readFileSync(reportPath)), id.reportSha256);
});

test('B1 scheduled mode cannot silently consume a dated or pinned historical pair', t => {
  const f = fixture(t);
  assert.throws(() => resolveAcceptanceInput({ ...f.options, now: new Date(), runMode: 'SCHEDULED' }), /SCHEDULED_A1_BUILD_REQUIRED/);
  f.manifest.selection = 'DATED_A1_PAIR'; delete f.manifest.requests; f.save();
  assert.throws(() => resolveAcceptanceInput({ ...f.options, now: new Date(), runMode: 'CANDIDATE_SCHEDULER_TEST' }), /SCHEDULED_A1_BUILD_REQUIRED/);
});

test('B1 source bindings fail closed on registry drift or source/output collision', t => {
  const f = buildFixture(t);
  f.manifest.sourceBindings.registrySha256 = '0'.repeat(64); f.save();
  assert.throws(() => runAcceptance(f.options), /A1_REGISTRY_IDENTITY_MISMATCH/);
  f.manifest.sourceBindings.dailyStatusPath = path.join(f.options.evidenceRoot, 'status.json'); f.save();
  assert.throws(() => runAcceptance(f.options), /A1_OUTPUT_SOURCE_COLLISION/);
});
test('Windows installer dry validation requires explicit schedules and exact candidate actions', { skip: process.platform !== 'win32' }, () => {
  const installer = path.join(source, 'scripts/install-daily-data-operations-automation.ps1');
  const common = ['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-CandidateTest','-TaskPrefix','TWQuant-CRU52-A2B-Test-unit',
    '-DataRoot',path.join(source,'data'),'-OutputRoot',path.join(source,'data/quality/daily-data-operations/unit'),
    '-ManifestPath',path.join(source,'data/inputs/index.json'),'-EvidenceRoot',path.join(source,'data/inputs'),
    '-CalendarPath',calendarPath,'-TradeDate','2026-09-09'];
  const missing = spawnSync('powershell.exe',common,{encoding:'utf8',windowsHide:true});
  assert.notEqual(missing.status,0); assert.match(missing.stderr,/EXPLICIT_SCHEDULE_TIME_REQUIRED/);
  const valid = spawnSync('powershell.exe',[...common,'-DayCheckpointTime','14:00','-EodCheckpointTime','18:00','-FinalCheckpointTime','23:00'],{encoding:'utf8',windowsHide:true});
  assert.equal(valid.status,0,valid.stderr); const body=JSON.parse(valid.stdout);
  assert.equal(body.status,'VALIDATED_ONLY'); assert.equal(body.formalSchedulerMutation,false);
  assert.equal(body.definitions.length,3);
  for(const definition of body.definitions) { assert.equal(definition.workingDirectory,source.replace(/[\\/]$/,'')); assert.ok(definition.arguments.includes('run-daily-data-operations-hidden.ps1')); assert.ok(definition.userSid); }
});
for (const [name, mutate, reason] of [
  ['missing A1', f => fs.unlinkSync(path.join(f.options.evidenceRoot, 'report.json')), /ENOENT/],
  ['hash mismatch', f => fs.appendFileSync(path.join(f.options.evidenceRoot, 'report.json'), ' '), /HASH_MISMATCH/],
  ['ambiguous checkpoint', f => { f.manifest.requests.push(f.manifest.requests[1]); f.save(); }, /AMBIGUOUS/],
  ['wrong evidence root', f => { f.manifest.evidenceRoot = f.root; f.save(); }, /ROOT_OR_INDEX/],
  ['wrong tradeDate', f => { f.options.tradeDate = '2026-09-10'; }, /NOT_REGISTERED/],
  ['unknown path', f => { f.manifest.requests[1].report.file = '../report.json'; f.save(); }, /REFERENCE_INVALID/],
  ['calendar mismatch', f => { f.manifest.calendarSha256 = '0'.repeat(64); f.save(); }, /CALENDAR_IDENTITY/],
  ['identity mismatch', f => { f.manifest.requests[1].inputGeneratedAt = '2026-09-08T00:00:00Z'; f.save(); }, /IDENTITY_MISMATCH/],
]) test(`resolver ${name} fails closed and preserves lastSuccess/FINAL`, t => {
  const f = fixture(t); const first = runAcceptance({ ...f.options, checkpointType: CHECKPOINT_TYPES[2] });
  mutate(f); assert.throws(() => runAcceptance(f.options), reason);
  const view = readDataOperations(f.options);
  assert.equal(view.acceptanceJobHealth.jobState, 'FAILED');
  assert.equal(view.acceptanceJobHealth.lastSuccessAt, first.jobHealth.lastSuccessAt);
  assert.equal(view.acceptanceJobHealth.lastFinalizedTradeDate, first.jobHealth.lastFinalizedTradeDate);
  assert.equal(view.artifactIdentity.reportHash, first.assessment.reportHash);
  assert.ok(ui.render(view).includes('驗收工作失敗')); assert.ok(ui.render(view).includes(first.jobHealth.lastSuccessAt));
});
test('single run guard rejects concurrent/abandoned owner without deleting it', t => {
  const f = fixture(t); fs.mkdirSync(f.options.outputRoot, { recursive: true });
  const guard = path.join(f.options.outputRoot, '.manual-run.guard'); fs.writeFileSync(guard, 'other-owner');
  assert.throws(() => runAcceptance(f.options), /BUSY_OR_ABANDONED/); assert.equal(fs.readFileSync(guard, 'utf8'), 'other-owner');
});
test('outside governed output rejected and no sink created', t => {
  const f = fixture(t); const outside = path.join(f.root, 'outside');
  assert.throws(() => runAcceptance({ ...f.options, outputRoot: outside }), /OUTPUT_ROOT_NOT_GOVERNED/); assert.equal(fs.existsSync(outside), false);
});
test('older checkpoint replay does not regress latest/finalized', t => {
  const f = fixture(t), first = runAcceptance({ ...f.options, checkpointType: CHECKPOINT_TYPES[2] });
  runAcceptance({ ...f.options, checkpointType: CHECKPOINT_TYPES[0] });
  const current = readDataOperations(f.options);
  assert.equal(current.artifactIdentity.reportHash, first.assessment.reportHash); assert.equal(current.finalized, true);
});
test('same-checkpoint older input cannot replace a newer evidence cutoff', t => {
  const f = fixture(t), first = runAcceptance(f.options);
  const older = fixture(t, { cutoff: '2026-09-09T02:00:00.000Z' });
  runAcceptance({ ...older.options, dataRoot: f.options.dataRoot, outputRoot: f.options.outputRoot });
  assert.equal(readDataOperations(f.options).artifactIdentity.reportHash, first.assessment.reportHash);
});
test('immutable receipt collision fails without overwriting existing receipt', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.options.outputRoot, 'runs'), { recursive: true });
  // UUID sequence: guard owner, runId, subsequent temporary-file IDs.
  const original = crypto.randomUUID; let n = 0; const fixed = original();
  crypto.randomUUID = () => ++n === 2 ? fixed : original();
  const receipt = path.join(f.options.outputRoot, 'runs', `${fixed}.json`); fs.writeFileSync(receipt, 'preserved');
  try { assert.throws(() => runAcceptance(f.options), /IMMUTABLE_HISTORY_CONFLICT/); }
  finally { crypto.randomUUID = original; }
  assert.equal(fs.readFileSync(receipt, 'utf8'), 'preserved');
  assert.equal(readDataOperations(f.options).acceptanceJobHealth.jobState, 'FAILED');
});
test('legacy manual writer preserves automatic history after scheduled invocation', t => {
  const f = fixture(t);
  const options = { dataRoot: f.options.dataRoot, outputRoot: f.options.outputRoot, calendarPath,
    inputPath: path.join(f.options.evidenceRoot,'report.json'), checkpointType: 'EOD_CHECKPOINT', generatedAt: new Date().toISOString() };
  const scheduled = runDailyDataOperations({ ...options,
    runContext: { runMode:'SCHEDULED', triggerIdentity:'SYNTHETIC_TEST', runtimeCommit:'a'.repeat(40) } });
  const manual = runDailyDataOperations(options);
  assert.equal(manual.jobHealth.runMode,'MANUAL_OFFLINE');
  assert.equal(manual.jobHealth.lastAutomaticAttemptAt,scheduled.jobHealth.lastAutomaticAttemptAt);
  assert.equal(manual.jobHealth.lastAutomaticSuccessAt,scheduled.jobHealth.lastAutomaticSuccessAt);
});
test('missing/tampered canonical artifact returns unavailable UNKNOWN and null counts', t => {
  const f = fixture(t); let v = readDataOperations(f.options);
  assert.equal(v.availability, 'UNAVAILABLE'); assert.equal(v.overallState, 'UNKNOWN'); assert.equal(v.counts, null);
  assert.equal(v.requiredAndDueCount, null); assert.equal(v.acceptanceJobHealth.jobState, 'NOT_RUN');
  runAcceptance(f.options); fs.writeFileSync(path.join(f.options.outputRoot, 'latest.json'), '{"overallState":"PASS"}');
  v = readDataOperations(f.options); assert.equal(v.availability, 'UNAVAILABLE'); assert.equal(v.overallState, 'UNKNOWN');
});
test('scheduled invocation rejects historical override; Taipei request date does not use UTC date', t => {
  const f = fixture(t); assert.throws(() => runAcceptance({ ...f.options, runMode: 'SCHEDULED', triggerIdentity: 'test' }), /SCHEDULED_REPLAY/);
  assert.equal(taipeiDate(new Date('2026-09-08T18:00:00Z')), '2026-09-09');
});
for (const state of ['PASS','PARTIAL','UNKNOWN','PENDING','FAIL','NOT_EXPECTED']) test(`UI faithfully renders ${state} without null → zero or unknown → neutral`, () => {
  // Presentation fixtures only; no claim that synthetic PASS is real evidence.
  const html = ui.render({ overallState: state, availability: 'UNAVAILABLE', requiredAndDueCount: null });
  assert.ok(html.includes(`data-state="${state}"`)); assert.ok(html.includes('核心必需且已到期：<b>—</b>'));
  assert.ok(!html.includes('Neutral')); assert.ok(!html.includes('undefined'));
});
test('UI escapes artifact reason/label text and rejects regressive artifact or job response', t => {
  const f = fixture(t), result = runAcceptance(f.options), v = projectDataOperations(result.assessment, result.jobHealth);
  const older = structuredClone(v); older.generatedAt = '2026-09-08T00:00:00Z'; assert.equal(ui.isOlder(older, v), true);
  const conflict = structuredClone(v); conflict.artifactIdentity.reportHash = 'b'.repeat(64); assert.equal(ui.isOlder(conflict, v), true);
  v.gaps[0].ownerLabelZh = '<script>unsafe</script>'; assert.equal(ui.render(v).includes('<script>unsafe'), false);
});
test('UI channel is single-flight, bounded, and preserves current view on stale response', async () => {
  const displays = []; let resolve, calls = 0;
  const first = { schemaVersion: 'dashboard-data-operations-v1', availability: 'AVAILABLE', tradeDate: '2026-09-09',
    checkpointType: 'EOD_CHECKPOINT', generatedAt: '2026-09-09T10:00:00Z', artifactIdentity: { reportHash: 'a' } };
  const channel = ui.createChannel({ request: () => { calls++; return new Promise(r => { resolve = r; }); }, display: v => displays.push(v), status: () => {}, unauthorized: () => {} });
  const pending = channel.refresh(); await channel.refresh(); assert.equal(calls, 1); resolve({ data: first }); await pending;
  const second = channel.refresh(); resolve({ data: { ...first, generatedAt: '2026-09-08T10:00:00Z' } }); await second;
  assert.equal(displays.length, 1);
});
test('unavailable display does not erase last valid artifact watermark', async () => {
  const newer = { schemaVersion:'dashboard-data-operations-v1',availability:'AVAILABLE',tradeDate:'2026-09-14',checkpointType:'FINAL_TRADEDATE_CHECKPOINT',generatedAt:'2026-09-14T10:00:00Z',artifactIdentity:{reportHash:'new'} };
  const queue = [newer,{schemaVersion:newer.schemaVersion,availability:'UNAVAILABLE'}, {...newer,tradeDate:'2026-09-09',artifactIdentity:{reportHash:'old'}}];
  const displayed=[];
  const channel=ui.createChannel({request:async()=>({data:queue.shift()}),display:v=>displayed.push(v),status:()=>{},unauthorized:()=>{}});
  await channel.refresh(); await channel.refresh(); await channel.refresh();
  assert.equal(displayed.length,2); assert.equal(displayed[1].availability,'UNAVAILABLE');
});
for (const oldResult of ['success','401']) test(`session reset ignores delayed old ${oldResult} and allows new session refresh`, async () => {
  let settle; const displayed=[], statuses=[]; let unauthorized=0, count=0;
  const channel=ui.createChannel({ request:()=> ++count === 1 ? new Promise((resolve,reject)=>{settle=oldResult==='success'?resolve:reject;})
    : Promise.resolve({data:{schemaVersion:'dashboard-data-operations-v1',availability:'UNAVAILABLE'}}),
    display:v=>displayed.push(v),status:v=>statuses.push(v),unauthorized:()=>{unauthorized++;} });
  const old=channel.refresh(); channel.reset(); await channel.refresh();
  const before=statuses.length;
  settle(oldResult==='success'?{data:{schemaVersion:'dashboard-data-operations-v1',availability:'AVAILABLE'}}:{status:401});
  await old; assert.equal(displayed.length,1); assert.equal(unauthorized,0); assert.equal(statuses.length,before);
});
for (const bound of [false, true]) test(`actual protected HTTP (shared binding=${bound}): 401, login, canonical parity, no write route, preserved CSRF`, { timeout: 25000 }, async t => {
  const f = fixture(t), runtime = path.join(f.root, 'runtime');
  for (const item of ['server.mjs','src','v2/src','config']) fs.cpSync(path.join(source,item), path.join(runtime,item), { recursive:true });
  const dataRoot = path.join(bound ? f.root : runtime, 'data'), outputRoot = path.join(dataRoot, 'quality/daily-data-operations');
  let evidenceRoot = f.options.evidenceRoot;
  if (bound) {
    evidenceRoot = path.join(dataRoot, 'quality/daily-collection-acceptance/pinned');
    fs.cpSync(f.options.evidenceRoot, evidenceRoot, { recursive: true });
    f.manifest.evidenceRoot = evidenceRoot;
    f.manifest.operationsBinding = { schemaVersion: 'data-operations-binding-v1', dataRoot, outputRoot, calendarPath };
    f.save();
  }
  const canonical = runAcceptance({ ...f.options, dataRoot, outputRoot, evidenceRoot });
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket,'listening');
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const passphrase = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['server.mjs'], { cwd:runtime, windowsHide:true, stdio:'ignore', env:{ ...process.env,
    NODE_ENV:'production', HOST:'127.0.0.1', PORT:String(port), MOCK_DATA:'true', COOKIE_SECURE:'false', REFRESH_INTERVAL_SECONDS:'0',
    DASHBOARD_PASSWORD_HASH:hashPassword(passphrase), DATA_OPERATIONS_OUTPUT_ROOT:bound ? '' : outputRoot,
    DATA_OPERATIONS_MANIFEST_PATH:bound ? f.options.manifestPath : '',
    CRU34_LIVE_SNAPSHOT_PATH:'', CRU34_LIVE_STATUS_PATH:'', CRU34_SNAPSHOT_ARTIFACT_PATH:'',
    V2_RESEARCH_DATABASE_PATH:path.join(runtime,'missing.sqlite'), V2_BACKTEST_REPORT_PATH:path.join(runtime,'missing.json') } });
  f.lifecycle.child = child;
  const base = `http://127.0.0.1:${port}`;
  for (let attempt=0;;attempt++) { try { await fetch(base+'/api/session'); break; } catch (err) { if(attempt>80 || child.exitCode != null) throw err; await new Promise(r=>setTimeout(r,50)); } }
  assert.equal((await fetch(base+'/api/v1/data-operations')).status,401);
  const login = await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:passphrase})});
  assert.equal(login.status,200); const session = await login.json(); const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'content-type':'application/json'};
  const response=await fetch(base+'/api/v1/data-operations',{headers}); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  const readerOptions = bound ? resolveOperationsReader({manifestPath:f.options.manifestPath}) : {dataRoot,outputRoot};
  const body=await response.json(); assert.deepEqual(body.data,readDataOperations({...readerOptions,now:new Date(body.data.schedulerHealth.observedAt)}));
  assert.equal(body.data.artifactIdentity.reportHash,canonical.assessment.reportHash);
  assert.ok(!JSON.stringify(body).includes(f.root));
  const before=fs.readdirSync(path.join(outputRoot,'runs'));
  assert.equal((await fetch(base+'/api/v1/data-operations',{method:'POST',headers:{...headers,'x-csrf-token':session.csrfToken},body:'{}'})).status,404);
  assert.deepEqual(fs.readdirSync(path.join(outputRoot,'runs')),before);
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers,body:'{}'})).status,403);
  if (bound) {
    f.manifest.operationsBinding.outputRoot = path.join(f.root, 'wrong'); f.save();
    const invalid = await fetch(base+'/api/v1/data-operations', {headers});
    assert.equal(invalid.status, 503); assert.equal(invalid.headers.get('cache-control'), 'no-store');
    assert.equal((await invalid.json()).error, 'OPERATIONS_BINDING_UNVERIFIED');
    assert.deepEqual(fs.readdirSync(path.join(outputRoot,'runs')),before);
  }
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,'x-csrf-token':session.csrfToken},body:'{}'})).status,200);
});
