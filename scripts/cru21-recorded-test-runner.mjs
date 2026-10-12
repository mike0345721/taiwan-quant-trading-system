/**
 * CRU-21: detached, receipt-backed execution for allowlisted, non-production tests.
 * Remote callers launch once and later use `status`/`list`; lost connections do not
 * silently turn unknown runs into PASS or trigger retries.
 *
 * Examples:
 *   node scripts/cru21-recorded-test-runner.mjs start ci <exact-40-char-SHA>
 *   node scripts/cru21-recorded-test-runner.mjs status <run-UUID>
 *   node scripts/cru21-recorded-test-runner.mjs list
 *
 * Never invokes the market bridge, collector, trading, or formal deployment.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const receiptsRoot = path.join(projectRoot, 'data', 'cru21-recorded-test-runs');
const activeLockPath = path.join(receiptsRoot, 'active-run.lock');
const lanes = Object.freeze({
  ci: ['scripts/run-test-lane.mjs', 'ci'],
  windows: ['scripts/run-test-lane.mjs', 'windows'],
});
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shaPattern = /^[0-9a-f]{40}$/;
const finalPhases = new Set(['PASSED', 'FAILED', 'WORKER_ERROR', 'SOURCE_CHANGED']);
const now = () => new Date().toISOString();

function fail(reason) {
  const error = new Error(reason);
  error.code = reason;
  throw error;
}
function assertRunId(id) {
  if (!runIdPattern.test(id ?? '')) fail('INVALID_RUN_ID');
}
function repoOutput(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
}
function repoIdentity() {
  const top = fs.realpathSync(repoOutput(['rev-parse', '--show-toplevel']));
  const root = fs.realpathSync(projectRoot);
  if ((process.platform === 'win32' ? top.toLowerCase() : top) !== (process.platform === 'win32' ? root.toLowerCase() : root)) fail('GIT_ROOT_MISMATCH');
  return repoOutput(['rev-parse', 'HEAD']);
}
function assertRunnable(expectedSha) {
  if (!shaPattern.test(expectedSha ?? '')) fail('INVALID_EXPECTED_SHA');
  if (repoIdentity() !== expectedSha) fail('EXACT_SHA_MISMATCH');
  if (repoOutput(['branch', '--show-current']) === 'main') fail('MAIN_WORKTREE_FORBIDDEN');
  if (repoOutput(['status', '--porcelain', '--untracked-files=all'])) fail('DIRTY_WORKTREE');
}
function ensurePrivateRoot() {
  fs.mkdirSync(receiptsRoot, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(receiptsRoot).isSymbolicLink()) fail('RECEIPT_ROOT_SYMLINK');
  const rel = path.relative(projectRoot, fs.realpathSync(receiptsRoot));
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('RECEIPT_ROOT_OUTSIDE_REPO');
}
// A persistent exclusive lease prevents duplicate remote starts and two test
// suites racing over Windows fixture branches. Unknown/stale leases are never
// silently reclaimed: an operator must verify the associated run/process first.
function reserveRun(record) {
  const lease = { schema: 'cru21-active-test-run-v1', runId: record.runId, expectedSha: record.expectedSha };
  try { fs.writeFileSync(activeLockPath, JSON.stringify(lease) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error?.code === 'EEXIST') fail('ACTIVE_RUN_EXISTS');
    throw error;
  }
}
function activeLeaseMatches(id) {
  try {
    if (fs.lstatSync(activeLockPath).isSymbolicLink()) return false;
    const lease = JSON.parse(fs.readFileSync(activeLockPath, 'utf8'));
    return lease.schema === 'cru21-active-test-run-v1' && lease.runId === id;
  } catch { return false; }
}
function releaseRun(id) {
  if (!activeLeaseMatches(id)) return false;
  try {
    if (!activeLeaseMatches(id)) return false;
    fs.unlinkSync(activeLockPath);
    return true;
  } catch { return false; }
}
function recordPath(id) {
  assertRunId(id);
  return path.join(receiptsRoot, `${id}.json`);
}
function load(id) {
  const filename = recordPath(id);
  if (!fs.existsSync(filename)) fail('RUN_NOT_FOUND');
  if (fs.lstatSync(filename).isSymbolicLink() || fs.statSync(filename).size > 16384) fail('RECEIPT_INVALID');
  const record = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (record.schema !== 'cru21-test-run-receipt-v1' || record.runId !== id || !Object.hasOwn(lanes, record.lane)) fail('RECEIPT_INVALID');
  return record;
}
function save(record, exclusive = false) {
  const filename = recordPath(record.runId);
  if (exclusive) {
    fs.writeFileSync(filename, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    return;
  }
  // Same worker is the only writer after creation. A temporary file keeps any
  // interrupted write from destroying the previous known state.
  const tmp = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, filename);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
function publicStatus(record) {
  const age = Date.now() - Date.parse(record.heartbeatAt ?? record.createdAt);
  const stale = !finalPhases.has(record.phase) && (!Number.isFinite(age) || age > 30000);
  return {
    runId: record.runId,
    lane: record.lane,
    expectedSha: record.expectedSha,
    phase: stale ? 'STALE_UNVERIFIED' : record.phase,
    recordedPhase: record.phase,
    createdAt: record.createdAt,
    heartbeatAt: record.heartbeatAt,
    finishedAt: record.finishedAt,
    workerPid: record.workerPid,
    exitCode: record.exitCode,
    signal: record.signal,
    reason: record.reason,
    log: record.log,
    // Stale/unknown is never mapped to PASS and never retried automatically.
    needsManualReview: stale || record.phase === 'SOURCE_CHANGED' || record.phase === 'WORKER_ERROR',
  };
}
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|SHIOAJI|BROKER|OPENAI|GITHUB_TOKEN|GH_TOKEN|AUTH_COOKIE)/i.test(key)) delete env[key];
  }
  return env;
}
function start(lane, expectedSha) {
  if (!Object.hasOwn(lanes, lane ?? '')) fail('LANE_NOT_ALLOWLISTED');
  assertRunnable(expectedSha);
  ensurePrivateRoot();
  const id = randomUUID();
  const record = {
    schema: 'cru21-test-run-receipt-v1', runId: id, lane,
    expectedSha, phase: 'STARTING', createdAt: now(), heartbeatAt: null,
    finishedAt: null, workerPid: null, exitCode: null, signal: null,
    reason: null, log: `data/cru21-recorded-test-runs/${id}.log`,
  };
  reserveRun(record);
  try { save(record, true); } catch (error) { releaseRun(id); throw error; }
  try {
    const subprocess = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', id], {
      cwd: projectRoot, env: childEnv(), stdio: 'ignore', detached: true, windowsHide: true,
    });
    subprocess.on('error', () => { // A failed launch remains visible in the receipt.
      save({ ...record, phase: 'WORKER_ERROR', reason: 'WORKER_SPAWN_FAILED', finishedAt: now() });
      releaseRun(id);
    });
    subprocess.unref();
  } catch {
    save({ ...record, phase: 'WORKER_ERROR', reason: 'WORKER_SPAWN_FAILED', finishedAt: now() });
    releaseRun(id);
    fail('WORKER_SPAWN_FAILED');
  }
  return publicStatus(record);
}
async function worker(id) {
  const record = load(id);
  if (record.phase !== 'STARTING') fail('WORKER_ALREADY_STARTED');
  if (!activeLeaseMatches(id)) fail('ACTIVE_RUN_LEASE_MISMATCH');
  let heartbeatTimer;
  const update = changes => { Object.assign(record, changes); record.heartbeatAt = now(); save(record); };
  try {
    assertRunnable(record.expectedSha);
    update({ phase: 'RUNNING', workerPid: process.pid });
    const output = fs.openSync(path.join(receiptsRoot, `${id}.log`), 'a', 0o600);
    const args = lanes[record.lane];
    const child = spawn(process.execPath, args, {
      cwd: projectRoot, env: childEnv(), stdio: ['ignore', output, output], windowsHide: true,
    });
    fs.closeSync(output);
    heartbeatTimer = setInterval(() => update({ phase: 'RUNNING' }), 5000);
    let settled = false;
    const finish = (code, signal, reason = null) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      let phase = code === 0 && signal === null ? 'PASSED' : 'FAILED';
      try {
        assertRunnable(record.expectedSha);
      } catch {
        phase = 'SOURCE_CHANGED';
        reason = 'WORKTREE_CHANGED_DURING_RUN';
      }
      update({ phase, exitCode: Number.isInteger(code) ? code : null, signal: signal ?? null, reason, finishedAt: now() });
      releaseRun(id);
    };
    child.once('error', () => finish(null, null, 'TEST_PROCESS_SPAWN_FAILED'));
    child.once('close', (code, signal) => finish(code, signal, code === 0 ? null : 'TEST_EXIT_NONZERO'));
    // Process exits after the child closes. The detached worker is independent
    // of the short-lived caller/Remote Desktop Commander connection.
  } catch {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    update({ phase: 'WORKER_ERROR', reason: 'WORKER_SETUP_FAILED', finishedAt: now() });
    releaseRun(id);
  }
}
function list() {
  if (!fs.existsSync(receiptsRoot)) return [];
  return fs.readdirSync(receiptsRoot).filter(f => f.endsWith('.json') && runIdPattern.test(f.slice(0, -5)))
    .map(f => ({ filename: f, modified: fs.statSync(path.join(receiptsRoot, f)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified).slice(0, 15)
    .map(({ filename }) => { try { return publicStatus(load(filename.slice(0, -5))); } catch { return { runId: filename.slice(0, -5), phase: 'RECEIPT_INVALID' }; } });
}

try {
  const [command, arg1, arg2] = process.argv.slice(2);
  if (command === 'start') console.log(JSON.stringify(start(arg1, arg2)));
  else if (command === 'status') console.log(JSON.stringify(publicStatus(load(arg1))));
  else if (command === 'list') console.log(JSON.stringify(list()));
  else if (command === 'worker') await worker(arg1);
  else fail('USAGE_START_STATUS_LIST');
} catch (error) {
  console.error(JSON.stringify({ ok: false, reason: error?.code ?? 'RECORDED_RUNNER_FAILED' }));
  process.exitCode = 2;
}
