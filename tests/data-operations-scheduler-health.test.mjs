import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadSchedulerPolicy, readSchedulerHealth, recordAutomaticCheckpoint } from '../src/data-operations-scheduler-health.mjs';
import { sha256 } from '../src/daily-data-operations-files.mjs';
import { readDataOperations } from '../src/dashboard-data-operations.mjs';
import { runDailyDataOperations } from '../scripts/build-daily-data-operations.mjs';

const policy = loadSchedulerPolicy(), date = '2026-09-14';
const root = fileURLToPath(new URL('..', import.meta.url));
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
  assert.deepEqual(h.checkpoints.map(c => c.state), ['SUCCEEDED','SUCCEEDED','OVERDUE_NO_RECEIPT']);
  assert.equal(h.checkpoints[0].receipt.runId, day.receipt.runId);
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
