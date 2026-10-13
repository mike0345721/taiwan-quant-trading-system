import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { cru34LiveHash } from '../src/cru34-live-checkpoint.mjs';
import { publishCru34Snapshot, CRU34_SNAPSHOT_RETRY_POLICY as policy } from '../src/cru34-snapshot-publisher.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-snapshot-'));
  const targetPath = path.join(root, 'latest.json');
  fs.writeFileSync(targetPath, '{"generation":0}\n');
  return { root, targetPath, document: { generation: 1 } };
}
function denied(code) { return Object.assign(new Error(`synthetic ${code}`), { code }); }
function temps(root) { return fs.readdirSync(root).filter(name => name.endsWith('.tmp')); }

test('snapshot replacement retries only the closed complete temporary file', () => {
  const f = fixture();
  const delays = [];
  const sources = [];
  let calls = 0;
  const result = publishCru34Snapshot({ ...f, sleep: ms => delays.push(ms), io: { ...fs,
    renameSync(from, to) {
      sources.push(from);
      assert.deepEqual(JSON.parse(fs.readFileSync(from)), f.document);
      if (++calls < 3) throw denied('EPERM');
      return fs.renameSync(from, to);
    },
  } });
  assert.equal(result.attempts, 3);
  assert.equal(result.recoveredCode, 'EPERM');
  assert.deepEqual(delays, [25, 50]);
  assert.equal(new Set(sources).size, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.targetPath)), f.document);
  assert.deepEqual(temps(f.root), []);
});

test('permanent denial exhausts bounded retries and preserves old bytes', () => {
  const f = fixture();
  const old = fs.readFileSync(f.targetPath);
  const delays = [];
  let calls = 0;
  assert.throws(() => publishCru34Snapshot({ ...f, sleep: ms => delays.push(ms), io: { ...fs,
    renameSync() { calls += 1; throw denied('EPERM'); },
  } }), error => {
    assert.equal(error.code, 'EPERM');
    assert.equal(error.operation, 'RENAME_SNAPSHOT_TEMP');
    assert.equal(error.attempts, policy.maxAttempts);
    assert.equal(error.tempCleanup.removed, true);
    return true;
  });
  assert.equal(calls, 6);
  assert.deepEqual(delays, policy.delaysMs);
  assert.equal(delays.reduce((a, b) => a + b, 0), 775);
  assert.deepEqual(fs.readFileSync(f.targetPath), old);
  assert.deepEqual(temps(f.root), []);
});

test('non-retryable rename failure and failed cleanup retain the primary error', () => {
  const f = fixture();
  const old = fs.readFileSync(f.targetPath);
  let failedTemp;
  assert.throws(() => publishCru34Snapshot({ ...f, sleep() { assert.fail('must not retry'); }, io: { ...fs,
    renameSync() { throw denied('ENOSPC'); },
    unlinkSync(file) { failedTemp = file; throw denied('EACCES'); },
  } }), error => {
    assert.equal(error.code, 'ENOSPC');
    assert.equal(error.attempts, 1);
    assert.equal(error.tempCleanup.code, 'EACCES');
    assert.equal(error.tempCleanup.removed, false);
    return true;
  });
  assert.deepEqual(fs.readFileSync(f.targetPath), old);
  fs.unlinkSync(failedTemp);
});

test('failed temporary write never replaces or deletes the old snapshot', () => {
  const f = fixture();
  const old = fs.readFileSync(f.targetPath);
  assert.throws(() => publishCru34Snapshot({ ...f, io: { ...fs,
    writeFileSync() { throw denied('ENOSPC'); },
    renameSync() { assert.fail('incomplete temp must not publish'); },
  } }), error => error.code === 'ENOSPC' && error.operation === 'WRITE_SNAPSHOT_TEMP');
  assert.deepEqual(fs.readFileSync(f.targetPath), old);
  assert.deepEqual(temps(f.root), []);
});

test('concurrent independent reader sees only whole hash-valid generations during sustained publication', { timeout: 15000 }, async () => {
  const f = fixture();
  const document = generation => {
    const body = { generation, payload: String(generation).repeat(4096) };
    return { ...body, snapshotHash: cru34LiveHash(body) };
  };
  publishCru34Snapshot({ ...f, document: document(0) });
  const state = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs');
    (async()=>{
      const {cru34LiveHash}=await import(workerData.hashModule);
      const state=new Int32Array(workerData.state), generations=new Set();
      let reads=0;parentPort.postMessage({ready:true});
      while(Atomics.load(state,0)===0){
        const {snapshotHash,...body}=JSON.parse(fs.readFileSync(workerData.file,'utf8'));
        if(cru34LiveHash(body)!==snapshotHash)throw Error('partial or corrupt snapshot');
        generations.add(body.generation);reads++;
      }
      parentPort.postMessage({reads,generations:generations.size});
    })().catch(error=>{throw error;});
  `, { eval: true, workerData: { file: f.targetPath, state: state.buffer,
    hashModule: new URL('../src/cru34-live-checkpoint.mjs', import.meta.url).href } });
  try {
    await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    const completed = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    for (let generation = 1; generation <= 150; generation += 1) {
      publishCru34Snapshot({ ...f, document: document(generation) });
      Atomics.wait(state, 0, 0, 2);
    }
    Atomics.store(state, 0, 1);
    const result = await completed;
    assert.ok(result.reads > 0);
    assert.ok(result.generations > 1);
    assert.equal(JSON.parse(fs.readFileSync(f.targetPath)).generation, 150);
    console.log(JSON.stringify({ evidence: 'snapshot-concurrent-reader', platform: process.platform,
      node: process.version, publications: 150, ...result, partialOrHashFailures: 0 }));
  } finally { Atomics.store(state, 0, 1); await worker.terminate(); }
});

test('Windows held ordinary Node reader reproduces baseline EPERM while native publication progresses', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  const baselineTemp = path.join(f.root, 'baseline.tmp');
  fs.writeFileSync(baselineTemp, 'baseline');
  const fd = fs.openSync(f.targetPath, 'r');
  const old = fs.readFileSync(f.targetPath);
  try {
    assert.throws(() => fs.renameSync(baselineTemp, f.targetPath), error => error.code === 'EPERM');
    for (let generation = 1; generation <= 25; generation += 1) {
      publishCru34Snapshot({ ...f, document: { generation } });
      assert.equal(JSON.parse(fs.readFileSync(f.targetPath)).generation, generation);
    }
    assert.deepEqual(fs.readFileSync(fd), old);
    console.log(JSON.stringify({ evidence: 'windows-held-node-reader', node: process.version,
      baseline: 'EPERM', successfulPublicationsWithHandleOpen: 25, oldReaderPreserved: true }));
  } finally { fs.closeSync(fd); fs.unlinkSync(baselineTemp); }
});

test('Windows readonly snapshot cannot be replaced by POSIX flags', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  const old = fs.readFileSync(f.targetPath);
  fs.chmodSync(f.targetPath, 0o444);
  try {
    assert.throws(() => publishCru34Snapshot({ ...f, sleep() {} }), error => ['EPERM', 'EACCES'].includes(error.code));
    assert.deepEqual(fs.readFileSync(f.targetPath), old);
    assert.deepEqual(temps(f.root), []);
  } finally { fs.chmodSync(f.targetPath, 0o666); }
});

async function locker(f) {
  const ready = path.join(f.root, 'ready');
  const release = path.join(f.root, 'release');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = `$s=[IO.File]::Open(${quote(f.targetPath)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);`
    + `try{[IO.File]::WriteAllText(${quote(ready)},'ready');$end=[DateTime]::UtcNow.AddSeconds(15);`
    + `while(-not [IO.File]::Exists(${quote(release)}) -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 10}}finally{$s.Dispose()}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const deadline = Date.now() + 7000;
  while (!fs.existsSync(ready)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill(); throw new Error(`locker did not start: ${stderr}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return async () => { fs.writeFileSync(release, 'release'); assert.equal(await exited, 0, stderr); };
}

test('Windows no-delete-sharing lock exhausts bounded retries without damaging old snapshot then recovers', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const f = fixture();
  const old = fs.readFileSync(f.targetPath);
  const release = await locker(f);
  let failure;
  try {
    assert.throws(() => publishCru34Snapshot(f), error => {
      failure = error;
      return ['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && error.attempts === 6;
    });
    assert.deepEqual(fs.readFileSync(f.targetPath), old);
    assert.deepEqual(temps(f.root), []);
  } finally { await release(); }
  publishCru34Snapshot(f);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.targetPath)), f.document);
  console.log(JSON.stringify({ evidence: 'windows-no-delete-sharing', code: failure.code,
    attempts: failure.attempts, delaysMs: failure.retryDelaysMs, oldPreserved: true, recoveredAfterRelease: true }));
});
