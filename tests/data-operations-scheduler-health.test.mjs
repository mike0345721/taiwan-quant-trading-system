import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSchedulerPolicy, readSchedulerHealth, recordAutomaticCheckpoint, captureSchedulerStart, scheduledTiming, resolveScheduledCheckpointRequest } from '../src/data-operations-scheduler-health.mjs';
import { buildDailyCollectionAcceptance } from '../src/daily-collection-acceptance.mjs';
import { sha256 } from '../src/daily-data-operations-files.mjs';
import { readDataOperations } from '../src/dashboard-data-operations.mjs';
import { runDailyDataOperations } from '../scripts/build-daily-data-operations.mjs';

const policy = loadSchedulerPolicy(), date = '2026-09-14';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const c of policy.checkpoints) test(`same-trade-date-only admission: ${c.label} rejects before own time; exact/grace/late allowed`, () => {
  const expected=Date.parse(`2026-09-15T${c.checkTime}:00+08:00`);
  for(const time of [Date.parse('2026-09-15T09:00:00+08:00'),expected-1]) {
    assert.throws(()=>resolveScheduledCheckpointRequest(c.checkpointType,new Date(time)),/OPERATIONS_SCHEDULED_CHECKPOINT_NOT_DUE/);
  }
  for(const offset of [0,15*60000,32*60000]) {
    assert.deepEqual(resolveScheduledCheckpointRequest(c.checkpointType,new Date(expected+offset)),{
      tradeDate:'2026-09-15',policySha256:policy.sha256});
  }
});
test('scheduled admission resolves Taipei rather than UTC date and fails closed on invalid request', () => {
  assert.throws(()=>resolveScheduledCheckpointRequest('FINAL_TRADEDATE_CHECKPOINT',new Date('2026-09-14T16:01:00Z')),/CHECKPOINT_NOT_DUE/);
  assert.throws(()=>resolveScheduledCheckpointRequest('FINAL_TRADEDATE_CHECKPOINT',new Date('invalid')),/SCHEDULER_DATE_INVALID/);
  assert.throws(()=>resolveScheduledCheckpointRequest('other',new Date('2026-09-15T12:00:00Z')),/SCHEDULER_CHECKPOINT_INVALID/);
});
const browser = { setTimeout, clearTimeout, AbortController };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/data-operations.js'), 'utf8'), browser);
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cru52-scheduler-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data'), outputRoot = path.join(dataRoot, 'quality/daily-data-operations');
  fs.mkdirSync(path.join(outputRoot, 'runs'), { recursive: true });
  const materialize = (base, file, value) => { const target = path.join(base, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); };
  function receipt({ checkpoint = 'DAY_CHECKPOINT', day = date, time = '13:56', state = 'SUCCEEDED', mode = 'SCHEDULED', ...extra } = {}) {
    const h = { schemaVersion: 'acceptance-job-health-v1', runId: crypto.randomUUID(), jobState: state, runMode: mode,
      requestedTradeDate: day, inputTradeDate: day, checkpointType: checkpoint, lastAttemptAt: `${day}T${time}:00+08:00`,
      lastSuccessAt: state === 'SUCCEEDED' ? `${day}T${time}:01+08:00` : null, runtimeCommit: 'a'.repeat(40),
      schedulerPolicySha256: policy.sha256, triggerIdentity: `${policy.taskPrefix}-${policy.checkpoints.find(c => c.checkpointType === checkpoint).label}`, ...extra };
    const bytes = JSON.stringify(h), file = path.join(outputRoot, 'runs', `${h.runId}${state === 'FAILED' ? '.failed' : ''}.json`);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    return { receipt: h, identity: { sha256: sha256(bytes) }, file };
  }
  const record = value => recordAutomaticCheckpoint({ outputRoot, ...value, materialize });
  const view = time => readDataOperations({ dataRoot, outputRoot, now: new Date(time.includes('T') ? time : `${date}T${time}+08:00`) });
  const health = time => view(time).schedulerHealth;
  return { temp, dataRoot, outputRoot, receipt, record, health, view };
}
for (const [time, expected] of [['13:54:59','NOT_DUE'],['13:55:00','WAITING_FOR_RUN'],['14:09:59','WAITING_FOR_RUN'],['14:10:00','WAITING_FOR_RUN'],['14:10:01','OVERDUE_NO_RECEIPT']]) {
  test(`DAY ${time} without receipt = ${expected}`, t => assert.equal(fixture(t).health(time).checkpoints[0].state, expected));
}
test('yesterday success and single latest job-health cannot satisfy today', t => {
  const f = fixture(t), previous = f.receipt({ day: '2026-09-11' }); f.record(previous);
  fs.writeFileSync(path.join(f.outputRoot, 'job-health.json'), JSON.stringify(previous.receipt));
  assert.equal(f.health('14:11:00').checkpoints[0].state, 'OVERDUE_NO_RECEIPT');
});
test('today correct checkpoint success; later checkpoint preserves DAY and EOD cannot satisfy FINAL', t => {
  const f = fixture(t), day = f.receipt(), eod = f.receipt({ checkpoint:'EOD_CHECKPOINT',time:'16:11' });
  f.record(day); f.record(eod);
  const h = f.health('18:26:00');
  assert.deepEqual(h.checkpoints.map(c => c.state), ['ON_TIME_SUCCEEDED','ON_TIME_SUCCEEDED','OVERDUE_NO_RECEIPT']);
  assert.equal(h.checkpoints[0].receipt.runId, day.receipt.runId);
});
for (const [time, timeliness, delay] of [['13:55','ON_TIME',0], ['14:10','ON_TIME',15], ['14:27','LATE',32]]) {
  test(`scheduled success at ${time}: exact lateness from expected time`, t => {
    const f=fixture(t), r=f.receipt({time}); f.record(r);
    const c=f.health('14:30:00').checkpoints[0];
    assert.equal(c.state, `${timeliness}_SUCCEEDED`); assert.equal(c.timeliness,timeliness);
    assert.equal(c.latenessMs,delay*60000); assert.equal(c.latenessMinutes,delay);
    assert.equal(c.actualAttemptAt,r.receipt.lastAttemptAt);assert.equal(c.actualSuccessAt,r.receipt.lastSuccessAt);
    const html=browser.DataOperations.render(f.view('14:30:00'));
    assert.ok(html.includes(`延遲：${delay} 分鐘`));assert.ok(html.includes(timeliness === 'LATE' ? '補跑成功 ⚠' : '準時完成'));
  });
}
test('late failure exposes timing separately and does not reuse previous success as this run success', t => {
  const f=fixture(t), good=f.receipt(); f.record(good);
  f.record(f.receipt({time:'14:27',state:'FAILED',lastSuccessAt:good.receipt.lastSuccessAt}));
  const c=f.health('14:30:00').checkpoints[0];
  assert.equal(c.state,'ACCEPTANCE_JOB_FAILED');assert.equal(c.timeliness,'LATE');assert.equal(c.latenessMinutes,32);
  assert.equal(c.actualSuccessAt,null);assert.equal(c.lastSuccessAt,good.receipt.lastSuccessAt);
});
test('catch-up preserves immutable overdue-at-start chronology and bounded reads', t => {
  const f=fixture(t), runId=crypto.randomUUID();
  assert.equal(f.health('14:26:59').checkpoints[0].state,'OVERDUE_NO_RECEIPT');
  const health={...f.receipt().receipt,runId,jobState:'RUNNING',lastAttemptAt:`${date}T14:27:00+08:00`};
  const immutable=(base,file,value)=>{ const bytes=JSON.stringify(value);fs.writeFileSync(path.join(base,file),bytes,{flag:'wx'});return {sha256:sha256(bytes)}; };
  const identity=captureSchedulerStart({ ...f, health, immutable });
  const eventPath=path.join(f.outputRoot,`runs/${runId}.scheduler-start.json`), before=fs.readFileSync(eventPath);
  assert.equal(JSON.parse(before).stateBeforeAttempt,'OVERDUE_NO_RECEIPT');
  const late=f.receipt({runId,time:'14:27',schedulerStartIdentity:identity}); f.record(late);
  const enumerate=fs.readdirSync; fs.readdirSync=()=>{throw new Error('UNBOUNDED_SCAN');};
  let c;try { c=f.health('14:30:00').checkpoints[0]; } finally {fs.readdirSync=enumerate;}
  assert.equal(c.state,'LATE_SUCCEEDED');assert.equal(c.startObservation.stateBeforeAttempt,'OVERDUE_NO_RECEIPT');
  assert.equal(c.startObservation.sha256,sha256(before));assert.deepEqual(fs.readFileSync(eventPath),before);
  f.record(f.receipt({time:'14:20'}));assert.equal(f.health('14:30:00').checkpoints[0].receipt.runId,runId);
  assert.deepEqual(fs.readFileSync(eventPath),before);assert.throws(()=>captureSchedulerStart({...f,health,immutable}),/EEXIST/);
  fs.writeFileSync(eventPath,'{}');assert.equal(f.health('14:30:00').checkpoints[0].evidenceState,'UNVERIFIED');
});
test('completion with late recovery and punctuality remain separate', t => {
  const f=fixture(t);f.record(f.receipt({time:'14:27'}));
  f.record(f.receipt({checkpoint:'EOD_CHECKPOINT',time:'16:11'}));
  f.record(f.receipt({checkpoint:'FINAL_TRADEDATE_CHECKPOINT',time:'18:11'}));
  const h=f.health('18:30:00');assert.equal(h.completion,'COMPLETE_WITH_LATE_RECOVERY');assert.equal(h.punctuality,'DEGRADED');
  assert.ok(f.health('2026-09-13T19:00:00+08:00').checkpoints.every(c=>c.timeliness==='NOT_APPLICABLE'));
});
test('receipt success clock reversal and invented timing fail closed; equivalent UTC ordering is numeric', t => {
  const f=fixture(t);
  assert.throws(()=>f.record(f.receipt({lastSuccessAt:`${date}T13:54:00+08:00`})),/RECEIPT_INVALID/);
  const good=f.receipt({time:'14:27'}); f.record(good);
  assert.throws(()=>f.record(f.receipt({time:'14:28',schedulerTiming:{...scheduledTiming(good.receipt),latenessMs:0}})),/TIMING_INVALID/);
  f.record(f.receipt({lastAttemptAt:`${date}T06:20:00Z`,lastSuccessAt:`${date}T06:20:01Z`}));
  assert.equal(f.health('14:30:00').checkpoints[0].receipt.runId,good.receipt.runId);
});
test('late scheduled result never changes canonical historical PARTIAL data or API/UI parity', t => {
  const f=fixture(t), input={calendarDate:'2026-09-11',tradeDate:'2026-09-11',generatedAt:'2026-09-11T10:00:00Z',
    marketDayState:'TRADING_DAY',sessions:['DAY','NIGHT'],registry:{datasets:[]},liveEvidence:{ledgerFound:false,feeds:{},
      sessions:{DAY:{missingFiles:['2026-09-11.ndjson']}},
      sessionWindows:{DAY:{sessionStart:'2026-09-11T00:45:00Z',sessionEnd:'2026-09-11T05:45:00Z'}},
      sourceArtifactIdentity:{type:'append-only-ledger-fixed-byte-cutoff',files:[],missingFiles:['2026-09-11.ndjson']}}};
  const report={...buildDailyCollectionAcceptance(input),evidenceInputs:{calendar:{sha256:sha256(fs.readFileSync(path.join(root,'config/taifex-official-calendar-2026.json')))}}};
  const inputPath=path.join(f.temp,'a1.json');fs.writeFileSync(inputPath,JSON.stringify(report));
  const acceptanceInputsPath=path.join(f.temp,'inputs.json');fs.writeFileSync(acceptanceInputsPath,JSON.stringify(input));
  runDailyDataOperations({...f,inputPath,acceptanceInputsPath,checkpointType:'DAY_CHECKPOINT',generatedAt:'2026-09-11T10:01:00Z'});
  const before=f.view('14:26:00'), bytes=fs.readFileSync(path.join(f.outputRoot,'latest.json'));
  f.record(f.receipt({time:'14:27'}));const after=f.view('14:30:00'), html=browser.DataOperations.render(after);
  assert.equal(after.schedulerHealth.checkpoints[0].state,'LATE_SUCCEEDED');assert.equal(after.tradeDate,'2026-09-11');
  assert.equal(after.overallState,'PARTIAL');assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.counts,before.counts);
  assert.deepEqual(fs.readFileSync(path.join(f.outputRoot,'latest.json')),bytes);
  assert.ok(html.includes('尚無今天有效資料評估'));assert.ok(html.includes('不代表離線期間的即時資料已補齊'));
  assert.ok(html.includes('data-state="PARTIAL"'));assert.ok(html.includes('data-state="UNKNOWN"'));
});
test('Windows settings contract and persisted readback rejects disabled catch-up/wake/settings drift', {skip:process.platform!=='win32'}, t => {
  const f=fixture(t), source=fs.readFileSync(path.join(root,'scripts/install-daily-data-operations-automation.ps1'),'utf8');
  assert.match(source,/New-ScheduledTaskSettingsSet -StartWhenAvailable/);assert.doesNotMatch(source,/-WakeToRun/);
  assert.match(source,/if \(\$VerifyPersisted\)[\s\S]*Assert-OwnedTask \$persisted \$definition[\s\S]*Assert-TaskSettings \$persisted/);
  const check=source.slice(source.indexOf('function Assert-TaskSettings'),source.indexOf("if ($Mode -eq 'Validate')"));
  const script=path.join(f.temp,'settings.ps1');
  fs.writeFileSync(script,check+`
$task=[pscustomobject]@{Settings=[pscustomobject]@{StartWhenAvailable=$true;WakeToRun=$false;MultipleInstances='IgnoreNew';ExecutionTimeLimit='PT15M'}}
Assert-TaskSettings $task
foreach($key in @('StartWhenAvailable','WakeToRun','MultipleInstances','ExecutionTimeLimit')) {
  $saved=$task.Settings.$key
  $task.Settings.$key=if($key -eq 'StartWhenAvailable'){$false}elseif($key -eq 'WakeToRun'){$true}else{'wrong'}
  $rejected=$false
  try {Assert-TaskSettings $task} catch {$rejected=$_.Exception.Message -eq 'OPERATIONS_TASK_SETTINGS_MISMATCH'}
  if(-not $rejected){throw 'INVALID_SETTING_ACCEPTED'}
  $task.Settings.$key=$saved
}`);
  const r=spawnSync('powershell.exe',['-NoProfile','-File',script],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
});
test('failure preserves success receipt and older run cannot regress latest failure', t => {
  const f = fixture(t), good = f.receipt(), bad = f.receipt({ state:'FAILED',time:'14:00' });
  f.record(good); f.record(bad); f.record(f.receipt({ time:'13:58' }));
  const c = f.health('14:11:00').checkpoints[0];
  assert.equal(c.state, 'ACCEPTANCE_JOB_FAILED'); assert.equal(c.receipt.runId, bad.receipt.runId);
  assert.equal(c.lastSuccessRunId, good.receipt.runId); assert.equal(c.lastSuccessAt, good.receipt.lastSuccessAt);
});
for (const mode of ['MANUAL_REPLAY','CANDIDATE_SCHEDULER_TEST']) test(`${mode} never counts as automatic`, t => {
  const f = fixture(t); f.record(f.receipt({ mode }));
  assert.equal(f.health('14:11:00').checkpoints[0].state,'OVERDUE_NO_RECEIPT');
});
test('weekend and governed holiday are not false operational failures; uncovered calendar UNKNOWN', t => {
  const f = fixture(t);
  for (const day of ['2026-09-13','2026-10-09']) {
    const h = f.health(`${day}T19:00:00+08:00`);
    assert.equal(h.applicability,'NOT_EXPECTED'); assert.ok(h.checkpoints.every(c => c.state === 'NOT_DUE'));
  }
  assert.ok(f.health('2027-01-04T19:00:00+08:00').checkpoints.every(c => c.state === 'UNKNOWN'));
});
test('tampered/missing referenced receipt never becomes healthy and no unrelated run scan', t => {
  const f = fixture(t), r=f.receipt(); f.record(r);
  fs.writeFileSync(r.file,'{}');
  fs.writeFileSync(path.join(f.outputRoot,'runs','unrelated.json'),'not json');
  const c=f.health('14:11:00').checkpoints[0];
  assert.equal(c.state,'OVERDUE_NO_RECEIPT'); assert.equal(c.evidenceState,'UNVERIFIED'); assert.equal(c.receipt,null);
});
test('receipt pointer cannot substitute another checkpoint, mode, policy or date', t => {
  const f=fixture(t);
  for(const extra of [{triggerIdentity:'wrong'},{schedulerPolicySha256:'b'.repeat(64)},{requestedTradeDate:'2026-09-11'}]) {
    assert.throws(()=>f.record(f.receipt(extra)),/RECEIPT_INVALID/);
  }
});

function persistedPolicyFixture(t, policyBytes) {
  const f = fixture(t), policyHash = sha256(policyBytes), runId = crypto.randomUUID();
  const health = { ...f.receipt().receipt, runId, schedulerPolicySha256: policyHash };
  const start = { schemaVersion: 'automatic-checkpoint-start-v1', runId,
    observedAt: health.lastAttemptAt, requestedTradeDate: date, checkpointType: health.checkpointType,
    policySha256: policyHash, runtimeCommit: health.runtimeCommit, triggerIdentity: health.triggerIdentity,
    timing: scheduledTiming({ ...health, jobState: 'RUNNING' }), applicability: 'TRADING_DAY',
    stateBeforeAttempt: 'WAITING_FOR_RUN', evidenceState: 'NO_INDEX', previousReceipt: null };
  const startFile = path.join(f.outputRoot, 'runs', `${runId}.scheduler-start.json`);
  const startBytes = JSON.stringify(start); fs.writeFileSync(startFile, startBytes);
  const r = f.receipt({ runId, schedulerPolicySha256: policyHash,
    schedulerStartIdentity: { sha256: sha256(startBytes) } });
  const indexFile = path.join(f.outputRoot, 'automatic-checkpoints', date, 'day.json');
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  const pointer = { runId, jobState: 'SUCCEEDED', sha256: r.identity.sha256 };
  fs.writeFileSync(indexFile, JSON.stringify({ schemaVersion: 'automatic-checkpoint-index-v1',
    tradeDate: date, checkpointType: 'DAY_CHECKPOINT', policySha256: policyHash,
    latest: pointer, lastSuccess: pointer }));
  return { ...f, r, startFile, indexFile, policyHash };
}

test('reader accepts exact LF/CRLF policy equivalence without rewriting historical receipts', t => {
  const bytes = fs.readFileSync(path.join(root, 'config/data-operations-scheduler-policy-v1.json'));
  const lf = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const alternate = bytes.includes(Buffer.from('\r\n')) ? lf : lf.replace(/\n/g, '\r\n');
  assert.notEqual(sha256(alternate), policy.sha256);
  const f = persistedPolicyFixture(t, alternate);
  const before = [f.r.file, f.startFile, f.indexFile].map(file => fs.readFileSync(file));
  const c = f.health('14:11:00').checkpoints[0];
  assert.equal(c.state, 'ON_TIME_SUCCEEDED'); assert.equal(c.evidenceState, 'VERIFIED');
  assert.equal(c.receipt.policySha256, f.policyHash); assert.equal(c.startObservation.policySha256, f.policyHash);
  assert.equal(c.receipt.sha256, f.r.identity.sha256);
  [f.r.file, f.startFile, f.indexFile].forEach((file, i) => assert.deepEqual(fs.readFileSync(file), before[i]));
  // Compatibility belongs to the reader; new writers keep their exact local policy pin.
  assert.throws(() => f.record(f.r), /RECEIPT_INVALID/);
});

test('reader rejects policy content changes, other reformatting, and mismatched receipt/start policy pins', t => {
  const bytes = fs.readFileSync(path.join(root, 'config/data-operations-scheduler-policy-v1.json'), 'utf8');
  const lf = bytes.replace(/\r\n/g, '\n');
  for (const changed of [bytes.replace('13:55', '13:56'), bytes.replace('"graceMinutes": 15', '"graceMinutes": 16'),
    bytes.replace('"timezone": "Asia/Taipei"', '"timezone": "UTC"'), JSON.stringify(JSON.parse(bytes)), bytes + ' ',
    lf.replace('\n', '\r\n'), lf.replace('\n', '\r')]) {
    const f = persistedPolicyFixture(t, changed), c = f.health('14:11:00').checkpoints[0];
    assert.equal(c.evidenceState, 'UNVERIFIED'); assert.equal(c.receipt, null);
  }
  const alternate = bytes.includes('\r\n') ? lf : lf.replace(/\n/g, '\r\n');
  const f = persistedPolicyFixture(t, alternate);
  const start = JSON.parse(fs.readFileSync(f.startFile)); start.policySha256 = policy.sha256;
  const startBytes = JSON.stringify(start); fs.writeFileSync(f.startFile, startBytes);
  const receipt = JSON.parse(fs.readFileSync(f.r.file)); receipt.schedulerStartIdentity.sha256 = sha256(startBytes);
  const receiptBytes = JSON.stringify(receipt); fs.writeFileSync(f.r.file, receiptBytes);
  const index = JSON.parse(fs.readFileSync(f.indexFile)); index.latest.sha256 = index.lastSuccess.sha256 = sha256(receiptBytes);
  fs.writeFileSync(f.indexFile, JSON.stringify(index));
  assert.equal(f.health('14:11:00').checkpoints[0].evidenceState, 'UNVERIFIED');
});
test('early or future-dated receipt cannot claim current expected execution', t => {
  const f=fixture(t); f.record(f.receipt({time:'13:00'}));
  assert.equal(f.health('14:11:00').checkpoints[0].state,'OVERDUE_NO_RECEIPT');
  f.record(f.receipt({time:'14:30'}));
  assert.equal(f.health('14:11:00').checkpoints[0].state,'OVERDUE_NO_RECEIPT');
});
test('guarded A2a missing-input failure records requested date even before A1 resolves', t => {
  const f=fixture(t), now=new Date(), today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const options={dataRoot:f.dataRoot,outputRoot:f.outputRoot,checkpointType:'DAY_CHECKPOINT',generatedAt:now.toISOString(),
    runContext:{runMode:'SCHEDULED',requestedTradeDate:today,triggerIdentity:policy.taskPrefix+'-DAY',runtimeCommit:'a'.repeat(40),schedulerPolicySha256:policy.sha256},
    resolveInput:()=>{throw new Error('OPERATIONS_A1_INPUT_MISSING');}};
  assert.throws(()=>runDailyDataOperations(options),/A1_INPUT_MISSING/);
  const index=JSON.parse(fs.readFileSync(path.join(f.outputRoot,'automatic-checkpoints',today,'day.json')));
  const receipt=JSON.parse(fs.readFileSync(path.join(f.outputRoot,'runs',index.latest.runId+'.failed.json')));
  assert.equal(receipt.inputTradeDate,null);assert.equal(receipt.requestedTradeDate,today);assert.equal(receipt.jobState,'FAILED');
});
test('API/UI parity, human explanation, null data counts and stale scheduler ordering', t => {
  const f=fixture(t); f.record(f.receipt());
  const v=f.view('16:15:00'), html=browser.DataOperations.render(v);
  for(const c of v.schedulerHealth.checkpoints) {
    assert.ok(html.includes(`data-scheduler-state="${c.state}"`)); assert.ok(html.includes(c.reasonZh)); assert.ok(html.includes(c.checkTime));
  }
  assert.equal(v.overallState,'UNKNOWN');assert.equal(v.counts,null);assert.equal(v.requiredAndDueCount,null);
  assert.ok(html.includes('今天資料驗收：尚無今天有效資料評估'));assert.ok(!html.includes('Neutral'));
  assert.equal(browser.DataOperations.isOlder(f.view('14:11:00'),v),true);
});
