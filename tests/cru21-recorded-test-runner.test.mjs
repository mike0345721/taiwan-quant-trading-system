import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const scriptSource = fileURLToPath(new URL('../scripts/cru21-recorded-test-runner.mjs', import.meta.url));
const repoCall = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-recorded-run-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(scriptSource, path.join(root, 'scripts', 'cru21-recorded-test-runner.mjs'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'data/\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(root, 'scripts', 'run-test-lane.mjs'), `
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
await sleep(process.argv[2] === 'ci' ? 600 : 250);
if (process.argv[2] === 'ci') { console.log('synthetic ci pass'); process.exit(0); }
console.error('synthetic windows fail'); process.exit(7);
`);
  repoCall(root, ['init', '-q', '-b', 'feature']);
  repoCall(root, ['add', '.']);
  repoCall(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'init']);
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  return {
    root,
    sha: repoCall(root, ['rev-parse', 'HEAD']),
    invoke: (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, 'scripts', 'cru21-recorded-test-runner.mjs'), ...args], {
      cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    })),
    receiptDir: path.join(root, 'data', 'cru21-recorded-test-runs'),
  };
}
async function until(f, desired, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const r = f();
    if (desired(r)) return r;
    await sleep(90);
  }
  assert.fail('Timed out waiting for persisted receipt state');
}

test('detached allowlisted CI test persists a truthful PASS, log and exact SHA', async t => {
  const f = makeFixture(t);
  const started = f.invoke('start', 'ci', f.sha);
  assert.match(started.runId, /^[0-9a-f-]{36}$/);
  assert.equal(started.expectedSha, f.sha);
  const done = await until(() => f.invoke('status', started.runId), r => r.phase === 'PASSED');
  assert.equal(done.exitCode, 0);
  assert.equal(done.needsManualReview, false);
  assert.match(fs.readFileSync(path.join(f.receiptDir, `${started.runId}.log`), 'utf8'), /synthetic ci pass/);
  assert.equal(f.invoke('status', started.runId).phase, 'PASSED');
  assert.equal(repoCall(f.root, ['status', '--porcelain']), '');
});

test('nonzero test exit persists FAILED with exit code, never relabelled PASS', async t => {
  const f = makeFixture(t);
  const started = f.invoke('start', 'windows', f.sha);
  const done = await until(() => f.invoke('status', started.runId), r => r.phase === 'FAILED');
  assert.equal(done.exitCode, 7);
  assert.equal(done.reason, 'TEST_EXIT_NONZERO');
  assert.equal(f.invoke('list').find(r => r.runId === started.runId).phase, 'FAILED');
});

test('expected SHA mismatch, unknown lane, and dirty tracked files refuse to start', t => {
  const f = makeFixture(t);
  const exe = path.join(f.root, 'scripts', 'cru21-recorded-test-runner.mjs');
  const bad = args => {
    assert.throws(() => execFileSync(process.execPath, [exe, ...args], {
      cwd: f.root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
    }));
  };
  bad(['start', 'unknown', f.sha]);
  bad(['start', 'ci', 'b'.repeat(40)]);
  assert.equal(fs.existsSync(f.receiptDir), false);
  fs.appendFileSync(path.join(f.root, 'README.md'), 'dirty\n');
  bad(['start', 'ci', f.sha]);
  assert.equal(fs.existsSync(f.receiptDir), false);
});

test('formal/main checkout cannot start recorded test jobs', t => {
  const f = makeFixture(t);
  repoCall(f.root, ['branch', '-m', 'main']);
  const exe = path.join(f.root, 'scripts', 'cru21-recorded-test-runner.mjs');
  assert.throws(() => execFileSync(process.execPath, [exe, 'start', 'ci', f.sha], {
    cwd: f.root, stdio: 'pipe', timeout: 10000,
  }), /MAIN_WORKTREE_FORBIDDEN/);
});

test('terminated/lost worker heartbeat remains STALE_UNVERIFIED without relaunch', t => {
  const f = makeFixture(t);
  fs.mkdirSync(f.receiptDir, { recursive: true });
  const id = '00000000-0000-4000-8000-000000000001';
  const t0 = new Date(Date.now() - 120000).toISOString();
  fs.writeFileSync(path.join(f.receiptDir, `${id}.json`), JSON.stringify({
    schema: 'cru21-test-run-receipt-v1', runId: id, lane: 'ci', expectedSha: f.sha,
    phase: 'RUNNING', createdAt: t0, heartbeatAt: t0, finishedAt: null,
    workerPid: 123, exitCode: null, signal: null, reason: null, log: 'private-file',
  }));
  const read = f.invoke('status', id);
  assert.equal(read.phase, 'STALE_UNVERIFIED');
  assert.equal(read.recordedPhase, 'RUNNING');
  assert.equal(read.needsManualReview, true);
  assert.equal(f.invoke('list')[0].phase, 'STALE_UNVERIFIED');
});

test('run-id path traversal and missing receipt cannot read arbitrary files', t => {
  const f = makeFixture(t);
  const exe = path.join(f.root, 'scripts', 'cru21-recorded-test-runner.mjs');
  for (const id of ['../README.md', 'not-a-uuid', '00000000-0000-4000-8000-000000000001']) {
    assert.throws(() => execFileSync(process.execPath, [exe, 'status', id], {
      cwd: f.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
    }));
  }
});

test('if checked-out code changes during execution, a zero test exit is not accepted as PASS', async t => {
  const f = makeFixture(t);
  const started = f.invoke('start', 'ci', f.sha);
  await until(() => f.invoke('status', started.runId), r => r.phase === 'RUNNING');
  fs.appendFileSync(path.join(f.root, 'README.md'), 'changed during run\n');
  const done = await until(() => f.invoke('status', started.runId), r => r.phase === 'SOURCE_CHANGED');
  assert.equal(done.needsManualReview, true);
  assert.equal(done.reason, 'WORKTREE_CHANGED_DURING_RUN');
});
