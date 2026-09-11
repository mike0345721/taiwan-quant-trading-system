import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
