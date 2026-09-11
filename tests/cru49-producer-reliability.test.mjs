import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import {
  appendCru34Incident,
  CRU34_STATUS_RETRY_POLICY,
  Cru34StatusPublicationError,
  handleCru34RunFailure,
  isCru34ControlledFatal,
  isCru34IntegrityFailure,
  publishCru34Status,
} from '../src/cru34-status-publisher.mjs';
import { acquireCru34WorkerLockSync } from '../src/cru34-worker-lock.mjs';

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-producer-'));
}

function document(status = 'AVAILABLE') {
  return { schemaVersion: 'cru34-live-worker-status-v1', status,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
}

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));

test('isolated DAY to off-session to NIGHT replay preserves governed boundaries', () => {
  const day = classifyTxChartSession('2026-09-11T13:44:59+08:00', calendar);
  assert.equal(day.session, 'DAY');
  assert.equal(day.sessionTradeDate, '2026-09-11');
  assert.throws(() => classifyTxChartSession('2026-09-11T13:45:01+08:00', calendar),
    /TX_CHART_EVENT_OUTSIDE_GOVERNED_SESSION/);
  assert.throws(() => classifyTxChartSession('2026-09-11T14:59:59+08:00', calendar),
    /TX_CHART_EVENT_OUTSIDE_GOVERNED_SESSION/);
  const night = classifyTxChartSession('2026-09-11T15:00:00+08:00', calendar);
  assert.equal(night.session, 'NIGHT');
  assert.equal(night.sessionTradeDate, '2026-09-14');
});

test('status publication retries one allowlisted denial and atomically succeeds', async () => {
  const root = temporaryDirectory();
  const targetPath = path.join(root, 'status.json');
  const tempPath = path.join(root, 'status.tmp');
  let renames = 0;
  const delays = [];
  const io = {
    mkdir: fsPromises.mkdir,
    writeFile: fsPromises.writeFile,
    rename: async (...args) => {
      renames += 1;
      if (renames === 1) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return fsPromises.rename(...args);
    },
  };
  const result = await publishCru34Status({ targetPath, tempPath, document: document(), io,
    sleep: async (milliseconds) => { delays.push(milliseconds); } });
  assert.equal(result.attempts, 2);
  assert.deepEqual(delays, [25]);
  assert.equal(result.recoveredCode, 'EPERM');
  assert.equal(result.recoveredOperation, 'RENAME_STATUS_TEMP');
  assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), document());
});

test('baseline double-fault shape rejects when fallback reuses the failed writer', async () => {
  let attempts = 0;
  const legacyRun = async (writer) => {
    try { await writer('AVAILABLE'); }
    catch { await writer('UNAVAILABLE'); }
  };
  await assert.rejects(legacyRun(async () => {
    attempts += 1;
    throw Object.assign(new Error('rename denied'), { code: 'EPERM' });
  }), /rename denied/);
  assert.equal(attempts, 2);
});

test('status publication exhausts a frozen bounded retry budget and preserves old status', async () => {
  const root = temporaryDirectory();
  const targetPath = path.join(root, 'status.json');
  const tempPath = path.join(root, 'status.tmp');
  const old = document('AVAILABLE');
  fs.writeFileSync(targetPath, `${JSON.stringify(old)}\n`);
  const delays = [];
  const io = {
    mkdir: fsPromises.mkdir,
    writeFile: fsPromises.writeFile,
    rename: async () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); },
  };
  await assert.rejects(
    publishCru34Status({ targetPath, tempPath, document: document('UNAVAILABLE'), io,
      sleep: async (milliseconds) => { delays.push(milliseconds); } }),
    (error) => error instanceof Cru34StatusPublicationError
      && error.attempts === CRU34_STATUS_RETRY_POLICY.maxAttempts
      && error.operation === 'RENAME_STATUS_TEMP',
  );
  assert.deepEqual(delays, [25, 50, 100, 200, 400]);
  assert.equal(delays.reduce((sum, value) => sum + value, 0), CRU34_STATUS_RETRY_POLICY.maxTotalDelayMs);
  assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), old);
  assert.equal(fs.existsSync(tempPath), false);
});

test('status temp cleanup failure never masks the original publication error', async () => {
  const root = temporaryDirectory();
  const targetPath = path.join(root, 'status.json');
  const tempPath = path.join(root, 'status.instance.tmp');
  await assert.rejects(publishCru34Status({ targetPath, tempPath, document: document(), io: {
    mkdir: fsPromises.mkdir,
    writeFile: fsPromises.writeFile,
    rename: async () => { throw Object.assign(new Error('locked target'), { code: 'EBUSY' }); },
    unlink: async () => { throw Object.assign(new Error('locked temp'), { code: 'EACCES' }); },
  }, sleep: async () => {} }), (error) => error.code === 'EBUSY'
    && error.operation === 'RENAME_STATUS_TEMP'
    && error.tempCleanup?.removed === false
    && error.tempCleanup?.code === 'EACCES');
});

test('stale lock takeover is serialized and a second claimant fails closed', () => {
  const root = temporaryDirectory();
  const lockPath = path.join(root, 'worker.lock');
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 91, workerInstanceId: 'stale' })}\n`);
  const takeoverPath = `${lockPath}.takeover`;
  fs.writeFileSync(takeoverPath, `${JSON.stringify({ claimId: 'other', pid: 92 })}\n`);
  const blocked = acquireCru34WorkerLockSync({ lockPath,
    record: { pid: 93, workerInstanceId: 'candidate-a' }, signalProcess: () => { throw new Error('dead'); } });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.reason, 'STALE_TAKEOVER_BUSY');
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).workerInstanceId, 'stale');

  fs.unlinkSync(takeoverPath);
  const winner = acquireCru34WorkerLockSync({ lockPath,
    record: { pid: 94, workerInstanceId: 'candidate-b' }, signalProcess: () => { throw new Error('dead'); } });
  assert.equal(winner.acquired, true);
  assert.equal(winner.reason, 'STALE_LOCK_REPLACED');
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).workerInstanceId, 'candidate-b');
  assert.equal(fs.existsSync(takeoverPath), false);
});

test('competing processes cannot both acquire one stale worker lock', async () => {
  const root = temporaryDirectory();
  const lockPath = path.join(root, 'worker.lock');
  const gatePath = path.join(root, 'go');
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 99999999, workerInstanceId: 'stale' })}\n`);
  const moduleUrl = pathToFileURL(path.resolve('src/cru34-worker-lock.mjs')).href;
  const code = `
    import fs from 'node:fs';
    import { acquireCru34WorkerLockSync } from ${JSON.stringify(moduleUrl)};
    const [lockPath, gatePath, resultPath, workerInstanceId] = process.argv.slice(1);
    while (!fs.existsSync(gatePath)) await new Promise((resolve) => setTimeout(resolve, 5));
    const result = acquireCru34WorkerLockSync({ lockPath,
      record: { pid: process.pid, workerInstanceId } });
    fs.writeFileSync(resultPath, JSON.stringify(result));
    if (result.acquired) setInterval(() => {}, 1000);
  `;
  const children = ['candidate-a', 'candidate-b'].map((workerInstanceId) => {
    const resultPath = path.join(root, `${workerInstanceId}.json`);
    const child = spawn(process.execPath, ['--input-type=module', '-e', code,
      lockPath, gatePath, resultPath, workerInstanceId], { windowsHide: true });
    return { child, resultPath };
  });
  fs.writeFileSync(gatePath, 'go');
  try {
    for (let attempt = 0; attempt < 500
      && !children.every(({ resultPath }) => fs.existsSync(resultPath)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(children.every(({ resultPath }) => fs.existsSync(resultPath)), true);
    const results = children.map(({ resultPath }) => JSON.parse(fs.readFileSync(resultPath, 'utf8')));
    assert.equal(results.filter((result) => result.acquired).length, 1);
    assert.equal(results.filter((result) => !result.acquired).length, 1);
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(({ child }) => child.exitCode !== null ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve))));
  }
});

test('non-allowlisted publication errors fail immediately', async () => {
  const root = temporaryDirectory();
  let attempts = 0;
  await assert.rejects(publishCru34Status({
    targetPath: path.join(root, 'status.json'), tempPath: path.join(root, 'status.tmp'), document: document(),
    io: { mkdir: fsPromises.mkdir, writeFile: fsPromises.writeFile,
      rename: async () => { attempts += 1; throw Object.assign(new Error('bad path'), { code: 'ENOENT' }); } },
    sleep: async () => assert.fail('must not retry ENOENT'),
  }), (error) => error.code === 'ENOENT' && error.attempts === 1);
  assert.equal(attempts, 1);
});

test('incident sink failure is contained and cannot create a second throw', async () => {
  const result = await appendCru34Incident({
    incidentPath: path.join(temporaryDirectory(), 'incident.ndjson'),
    record: { result: 'PRIMARY_FAILURE_CAPTURED' },
    io: { mkdir: fsPromises.mkdir,
      appendFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
  });
  assert.equal(result.written, false);
  assert.equal(result.error.operation, 'APPEND_INCIDENT');
  assert.equal(result.error.code, 'EACCES');
});

test('incident records append without overwriting earlier evidence', async () => {
  const incidentPath = path.join(temporaryDirectory(), 'incident.ndjson');
  await appendCru34Incident({ incidentPath, record: { sequence: 1 } });
  await appendCru34Incident({ incidentPath, record: { sequence: 2 } });
  const rows = fs.readFileSync(incidentPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, [{ sequence: 1 }, { sequence: 2 }]);
});

test('concurrent readers see only complete old or new status documents', async () => {
  const root = temporaryDirectory();
  const targetPath = path.join(root, 'status.json');
  const old = document('AVAILABLE');
  const next = document('UNAVAILABLE');
  fs.writeFileSync(targetPath, `${JSON.stringify(old)}\n`);
  const readers = Array.from({ length: 100 }, async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20)));
    return JSON.parse(await fsPromises.readFile(targetPath, 'utf8')).status;
  });
  await publishCru34Status({
    targetPath,
    tempPath: path.join(root, 'status.tmp'),
    document: next,
  });
  const states = await Promise.all(readers);
  assert.ok(states.every((state) => state === 'AVAILABLE' || state === 'UNAVAILABLE'));
});

test('double fault preserves the original incident and never escapes the callback', async () => {
  const order = [];
  const original = Object.assign(new Error('CRU34_STATUS_PUBLICATION_FAILED'), { code: 'EPERM' });
  const fallback = Object.assign(new Error('CRU34_STATUS_PUBLICATION_FAILED'), { code: 'EPERM' });
  const result = await handleCru34RunFailure({
    error: original,
    recordIncident: async (error, context) => { order.push([error, context.result, context.originalCode]); },
    writeUnavailable: async () => { order.push(['fallback-attempt']); throw fallback; },
  });
  assert.equal(result.fallbackPublished, false);
  assert.equal(result.fatal, false);
  assert.deepEqual(order, [
    [original, 'PRIMARY_FAILURE_CAPTURED', null],
    ['fallback-attempt'],
    [fallback, 'STATUS_FALLBACK_FAILED_OLD_STATUS_PRESERVED', 'EPERM'],
  ]);
});

test('failure handling contains stderr or incident adapter failure too', async () => {
  const result = await handleCru34RunFailure({
    error: Object.assign(new Error('temporary'), { code: 'EBUSY' }),
    recordIncident: async () => { throw new Error('sink failed'); },
    writeUnavailable: async () => { throw new Error('fallback failed'); },
  });
  assert.equal(result.fallbackPublished, false);
  assert.equal(result.fatal, false);
});

test('integrity failures remain fatal while transient publication failures do not', () => {
  assert.equal(isCru34IntegrityFailure(new Error('CRU43_LEDGER_HASH_CHAIN_INVALID')), true);
  assert.equal(isCru34IntegrityFailure(new Error('CRU43_CHECKPOINT_ANCHOR_MISMATCH')), true);
  assert.equal(isCru34IntegrityFailure(new Error('CRU34_STATUS_PUBLICATION_FAILED')), false);
  const transient = new Cru34StatusPublicationError(Object.assign(new Error('locked'),
    { code: 'EPERM', cru34Operation: 'RENAME_STATUS_TEMP' }), {
    attempts: 6, targetPath: 'status.json', tempPath: 'status.tmp', retryDelaysMs: [25, 50, 100, 200, 400],
  });
  const permanent = new Cru34StatusPublicationError(Object.assign(new Error('denied'),
    { code: 'EACCES', cru34Operation: 'RENAME_STATUS_TEMP' }), {
    attempts: 6, targetPath: 'status.json', tempPath: 'status.tmp', retryDelaysMs: [25, 50, 100, 200, 400],
  });
  assert.equal(isCru34ControlledFatal(transient), false);
  assert.equal(isCru34ControlledFatal(permanent), true);
});

test('governed launcher uses per-instance stdout stderr and incident paths', () => {
  const launcher = fs.readFileSync(new URL('../scripts/start-cru34-live-projection-hidden.ps1', import.meta.url), 'utf8');
  assert.match(launcher, /\$launchId = \[guid\]::NewGuid\(\)\.ToString\(\)/);
  assert.match(launcher, /CRU34_LIVE_WORKER_INSTANCE_ID/);
  assert.match(launcher, /CRU34_LIVE_INCIDENT_PATH/);
  assert.doesNotMatch(launcher, /Join-Path \$logDir 'cru34-live-projection\.log'/);
});
