import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  CRU34_STATUS_RETRY_POLICY,
  publishCru34Status,
} from '../src/cru34-status-publisher.mjs';

test('Windows sharing lock causes bounded exhaustion or recovery after release', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-windows-lock-'));
  const targetPath = path.join(root, 'status.json');
  const tempPath = path.join(root, 'status.tmp');
  const readyPath = path.join(root, 'ready.txt');
  const old = { schemaVersion: 'cru34-live-worker-status-v1', status: 'AVAILABLE' };
  const next = { schemaVersion: 'cru34-live-worker-status-v1', status: 'UNAVAILABLE' };
  fs.writeFileSync(targetPath, `${JSON.stringify(old)}\n`);
  const escapedTarget = targetPath.replaceAll("'", "''");
  const escapedReady = readyPath.replaceAll("'", "''");
  const command = `$stream=[IO.File]::Open('${escapedTarget}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);`
    + `[IO.File]::WriteAllText('${escapedReady}','ready');Start-Sleep -Milliseconds 350;$stream.Dispose()`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
  for (let attempt = 0; attempt < 500 && !fs.existsSync(readyPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(readyPath), true);
  let observedDenial = false;
  const io = {
    mkdir: fsPromises.mkdir,
    writeFile: fsPromises.writeFile,
    rename: async (...args) => {
      try { return await fsPromises.rename(...args); }
      catch (error) { if (['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) observedDenial = true; throw error; }
    },
  };
  let firstResult = null;
  let firstError = null;
  try { firstResult = await publishCru34Status({ targetPath, tempPath, document: next, io }); }
  catch (error) { firstError = error; }
  if (child.exitCode === null) {
    await new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`locker exited ${code}`))));
  } else assert.equal(child.exitCode, 0);
  assert.equal(observedDenial, true);
  if (firstError) {
    assert.equal(firstError.code, 'EPERM');
    assert.equal(firstError.attempts, CRU34_STATUS_RETRY_POLICY.maxAttempts);
    assert.equal(firstError.operation, 'RENAME_STATUS_TEMP');
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), old);
    const recovered = await publishCru34Status({ targetPath, tempPath, document: next, io });
    assert.equal(recovered.attempts, 1);
  } else {
    assert.ok(firstResult.attempts > 1 && firstResult.attempts <= CRU34_STATUS_RETRY_POLICY.maxAttempts);
  }
  assert.equal(JSON.parse(fs.readFileSync(targetPath, 'utf8')).status, 'UNAVAILABLE');
});

test('Windows real starters and runner contend through the same lock protocol', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-starter-race-'));
  const projection = path.join(root, 'projection');
  const dataRoot = path.join(root, 'data');
  fs.mkdirSync(projection);
  fs.mkdirSync(path.join(root, 'scripts'));
  const lockPath = path.join(projection, 'worker.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, workerInstanceId: 'stale' }));
  const moduleUrl = pathToFileURL(path.resolve('src/cru34-worker-lock.mjs')).href;
  // Disposable runner publishes only synthetic status, never reads a ledger.
  // The launcher and imported ownership implementation are the production files.
  const fixture = `
    import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
    import {acquireCru34WorkerLockSync as acquire} from ${JSON.stringify(moduleUrl)};
    const root=${JSON.stringify(root)}, projection=${JSON.stringify(projection)}, dataRoot=${JSON.stringify(dataRoot)};
    const id=process.env.CRU34_LIVE_WORKER_INSTANCE_ID||crypto.randomUUID();
    fs.writeFileSync(path.join(root,'ready-'+process.pid),JSON.stringify({pid:process.pid,id}));
    const end=Date.now()+12000;
    while(!fs.existsSync(path.join(root,'go'))) {
      if(Date.now()>end) process.exit(2);
      await new Promise(r=>setTimeout(r,10));
    }
    const record={pid:process.pid,workerInstanceId:id,workerStartedAt:new Date().toISOString(),dataRoot,projectionRoot:projection};
    const result=acquire({lockPath:path.join(projection,'worker.lock'),record});
    fs.writeFileSync(path.join(root,'result-'+process.pid),JSON.stringify({...result,...record}));
    if(!result.acquired) process.exit(0);
    const publish=()=>fs.writeFileSync(path.join(projection,'status.json'),JSON.stringify({
      ...record,schemaVersion:'cru34-live-worker-status-v1',status:'AVAILABLE',observedAt:new Date().toISOString(),
      snapshotPath:path.join(projection,'latest.json'),statusPath:path.join(projection,'status.json'),
      formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}));
    publish(); setInterval(publish,100);
    setTimeout(()=>process.exit(0),15000);
  `;
  fs.writeFileSync(path.join(root, 'scripts', 'run-cru34-live-projection.mjs'), fixture);
  const launcher = path.resolve('scripts/start-cru34-live-projection-hidden.ps1');
  const children = [];
  const outputs = [];
  const starterArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
    '-WorkingRoot', root, '-DataRoot', dataRoot, '-ProjectionRoot', projection];
  const waitFor = async predicate => {
    const deadline = Date.now() + 12000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'bounded starter race deadline');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    for (let i = 0; i < 2; i += 1) {
      const child = spawn('powershell.exe', starterArgs, { windowsHide: true });
      children.push(child);
      let output = '';
      child.stderr.on('data', data => { output += data; });
      outputs.push(() => output);
    }
    children.push(spawn(process.execPath, [path.join(root, 'scripts', 'run-cru34-live-projection.mjs')], { windowsHide: true }));
    await waitFor(() => fs.readdirSync(root).filter(x => x.startsWith('ready-')).length === 3);
    fs.writeFileSync(path.join(root, 'go'), 'go');
    await waitFor(() => fs.readdirSync(root).filter(x => x.startsWith('result-')).length === 3);
    const results = fs.readdirSync(root).filter(x => x.startsWith('result-')).map(x => JSON.parse(fs.readFileSync(path.join(root, x))));
    assert.equal(results.filter(x => x.acquired).length, 1);
    await waitFor(() => children.slice(0, 2).every(x => x.exitCode !== null));
    assert.deepEqual(children.slice(0, 2).map(x => x.exitCode), [0, 0], outputs.map(x => x()).join('\n'));
    const winner = results.find(x => x.acquired);
    assert.equal(JSON.parse(fs.readFileSync(lockPath)).pid, winner.pid);
    process.kill(winner.pid, 0);
    console.log(JSON.stringify({ platform: process.platform, realPowerShellStarters: 2, directRunner: 1,
      isolatedSyntheticStatus: true, acquiredCount: 1, winnerPid: winner.pid }));
  } finally {
    // Kill only PIDs generated by our disposable fixture and held child handles.
    for (const file of fs.readdirSync(root).filter(x => x.startsWith('ready-'))) {
      const { pid } = JSON.parse(fs.readFileSync(path.join(root, file)));
      try { process.kill(pid); } catch { /* already exited */ }
    }
    for (const child of children) if (child.exitCode === null) child.kill();
  }
});

test('Windows launcher refuses unknown owner without deleting lock or starting a writer', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-starter-unknown-'));
  const projection = path.join(root, 'projection');
  fs.mkdirSync(projection);
  const lockPath = path.join(projection, 'worker.lock');
  for (const raw of ['', '{"pid":', 'null', '123', '{"pid":123}']) {
    fs.writeFileSync(lockPath, raw);
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve('scripts/start-cru34-live-projection-hidden.ps1'), '-WorkingRoot', root,
      '-ProjectionRoot', projection], { windowsHide: true });
    let output = '';
    child.stderr.on('data', value => { output += value; });
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.notEqual(code, 0);
    assert.match(output, /CRU34_LIVE_PRODUCER_INCUMBENT_UNVERIFIED/);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), raw);
    assert.equal(fs.existsSync(`${lockPath}.takeover`), false);
  }
});
