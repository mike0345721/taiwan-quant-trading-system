import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { acquireCru34WorkerLockSync as acquire, releaseCru34WorkerLockSync as release } from '../src/cru34-worker-lock.mjs';

for (const partial of ['', '{"pid":']) {
  test(`R1 initialization ${partial ? 'partial' : 'empty'} record cannot admit a second writer`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-'));
    const lockPath = path.join(root, 'worker.lock');
    let second;
    let paused = false;
    const first = acquire({ lockPath,
      record: { pid: process.pid, workerInstanceId: 'candidate-a' },
      fsApi: { ...fs, openSync(target, flags, ...rest) {
        const fd = fs.openSync(target, flags, ...rest);
        if (target === lockPath && flags === 'wx' && !paused) {
          paused = true;
          if (partial) fs.writeFileSync(lockPath, partial);
          second = acquire({ lockPath,
            record: { pid: process.pid, workerInstanceId: 'candidate-b' } });
          // Reset only our disposable test descriptor after the controlled pause.
          fs.ftruncateSync(fd, 0);
        }
        return fd;
      } },
    });
    console.log(JSON.stringify({ scenario: partial ? 'partial' : 'empty', first, second }));
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
  });
}

for (const raw of ['', '{"pid":', 'null', '123', '{"pid":123}', '{"pid":"123","workerInstanceId":"a"}']) {
  test(`unknown owner is preserved byte-for-byte: ${JSON.stringify(raw)}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-'));
    const lockPath = path.join(root, 'worker.lock');
    fs.writeFileSync(lockPath, raw);
    const result = acquire({ lockPath, record: { pid: process.pid, workerInstanceId: 'new' },
      signalProcess: () => assert.fail('must not probe an unknown owner') });
    assert.equal(result.reason, 'INCUMBENT_UNVERIFIED');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), raw);
  });
}

for (const code of ['EPERM', 'EACCES', 'EINVAL', undefined]) {
  test(`only ESRCH proves owner death; ${code} refuses takeover`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-'));
    const lockPath = path.join(root, 'worker.lock');
    const raw = JSON.stringify({ pid: 123, workerInstanceId: 'incumbent' });
    fs.writeFileSync(lockPath, raw);
    assert.equal(acquire({ lockPath, record: { pid: process.pid, workerInstanceId: 'new' },
      signalProcess: () => { throw Object.assign(new Error('unverified'), { code }); } }).acquired, false);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), raw);
  });
}

test('fresh creation and release both refuse an incomplete mutation guard', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-'));
  const lockPath = path.join(root, 'worker.lock');
  fs.writeFileSync(`${lockPath}.takeover`, '');
  const record = { pid: process.pid, workerInstanceId: 'owner' };
  assert.equal(acquire({ lockPath, record }).acquired, false);
  assert.equal(fs.existsSync(lockPath), false);
  fs.writeFileSync(lockPath, JSON.stringify(record));
  assert.equal(release({ lockPath, ...record }), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath)), record);
});

test('release holds the mutation guard through unlink; replacement survives late release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-'));
  const lockPath = path.join(root, 'worker.lock');
  const record = { pid: process.pid, workerInstanceId: 'owner' };
  const next = { pid: process.pid, workerInstanceId: 'next' };
  assert.equal(acquire({ lockPath, record }).acquired, true);
  let during;
  assert.equal(release({ lockPath, ...record, fsApi: { ...fs, unlinkSync(target) {
    fs.unlinkSync(target);
    if (target === lockPath) during = acquire({ lockPath, record: next });
  } } }), true);
  assert.equal(during.acquired, false);
  assert.equal(acquire({ lockPath, record: next }).acquired, true);
  assert.equal(release({ lockPath, ...record }), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath)), next);
});

async function waitFor(predicate, label) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const partial of ['', '{"pid":']) {
  test(`two real processes: paused ${partial ? 'partial' : 'empty'} initialization admits one writer`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-r1-child-'));
    const lockPath = path.join(root, 'worker.lock');
    const ready = path.join(root, 'ready');
    const resume = path.join(root, 'resume');
    const moduleUrl = pathToFileURL(path.resolve('src/cru34-worker-lock.mjs')).href;
    const code = `
      import fs from 'node:fs';
      import { acquireCru34WorkerLockSync as acquire } from ${JSON.stringify(moduleUrl)};
      const [lockPath, ready, resume, resultPath, id, partial] = process.argv.slice(1);
      const result = acquire({lockPath, record:{pid:process.pid,workerInstanceId:id}, fsApi:{...fs,
        openSync(target, flags, ...rest) {
          const fd=fs.openSync(target,flags,...rest);
          if(id==='a' && target===lockPath && flags==='wx') {
            if(partial) fs.writeFileSync(lockPath,partial);
            fs.writeFileSync(ready,'ready');
            const end=Date.now()+8000;
            while(!fs.existsSync(resume)) {
              if(Date.now()>end) throw Error('bounded pause expired');
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
            }
            fs.ftruncateSync(fd,0);
          }
          return fd;
        }
      }});
      fs.writeFileSync(resultPath,JSON.stringify({...result,pid:process.pid}));
      setInterval(()=>{},1000);
    `;
    const children = [];
    const start = id => {
      const resultPath = path.join(root, `${id}.json`);
      const child = spawn(process.execPath, ['--input-type=module', '-e', code,
        lockPath, ready, resume, resultPath, id, partial], { windowsHide: true });
      children.push(child);
      return resultPath;
    };
    try {
      const a = start('a');
      await waitFor(() => fs.existsSync(ready), 'A created lock');
      assert.equal(fs.readFileSync(lockPath, 'utf8'), partial);
      const b = start('b');
      await waitFor(() => fs.existsSync(b), 'B returned');
      fs.writeFileSync(resume, 'go');
      await waitFor(() => fs.existsSync(a), 'A returned');
      const results = [a, b].map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
      assert.equal(results.filter(r => r.acquired).length, 1);
      assert.equal(results[0].acquired, true);
      assert.equal(results[1].acquired, false);
      assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, results[0].pid);
      console.log(JSON.stringify({ platform: process.platform, controlledSchedule: partial ? 'partial' : 'empty', results }));
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      await Promise.all(children.map(child => child.exitCode !== null ? null : new Promise(resolve => child.once('exit', resolve))));
    }
  });
}
