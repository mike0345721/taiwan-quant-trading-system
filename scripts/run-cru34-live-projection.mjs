import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import {
  appendCru34Incident,
  cru34ErrorEvidence,
  handleCru34RunFailure,
  publishCru34Status,
} from '../src/cru34-status-publisher.mjs';
import {
  acquireCru34WorkerLockSync,
  releaseCru34WorkerLockSync,
} from '../src/cru34-worker-lock.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = path.resolve(process.env.CRU34_LIVE_DATA_ROOT || path.join(root, 'data'));
const projectionRoot = path.resolve(process.env.CRU34_LIVE_PROJECTION_ROOT
  || path.join(root, 'data', 'runtime', 'cru34-live'));
const calendar = loadGovernedTradingCalendar(path.join(root, 'config', 'taifex-official-calendar-2026.json'));
const pollMs = Number.parseInt(process.env.CRU34_LIVE_POLL_MS || '1000', 10);
const staleAfterMs = Number.parseInt(process.env.CRU34_LIVE_STALE_AFTER_MS || '30000', 10);
const maxBatchBytes = Number.parseInt(process.env.CRU34_LIVE_MAX_BATCH_BYTES || String(8 * 1024 * 1024), 10);
const maxBatchRecords = Number.parseInt(process.env.CRU34_LIVE_MAX_BATCH_RECORDS || '25000', 10);
fs.mkdirSync(projectionRoot, { recursive: true });
const lockPath = path.join(projectionRoot, 'worker.lock');
const configuredWorkerInstanceId = process.env.CRU34_LIVE_WORKER_INSTANCE_ID;
const workerInstanceId = /^[0-9a-f-]{36}$/i.test(configuredWorkerInstanceId || '')
  ? configuredWorkerInstanceId : crypto.randomUUID();
const workerStartedAt = new Date().toISOString();
const incidentPath = path.resolve(process.env.CRU34_LIVE_INCIDENT_PATH
  || path.join(projectionRoot, 'incidents', `${workerStartedAt.replaceAll(':', '-')}-${workerInstanceId}.ndjson`));
const stdoutPath = process.env.CRU34_LIVE_STDOUT_PATH || null;
const stderrPath = process.env.CRU34_LIVE_STDERR_PATH || null;
let ownsLock = false;
let runInFlight = false;
let stopping = false;
let pollHandle = null;
let stderrAvailable = true;
process.stderr.on('error', () => { stderrAvailable = false; });
const lockResult = acquireCru34WorkerLockSync({ lockPath, record: { pid: process.pid, workerInstanceId,
  workerStartedAt, dataRoot, projectionRoot } });
if (!lockResult.acquired) process.exit(0);
ownsLock = true;

function releaseLock() {
  if (!ownsLock) return;
  releaseCru34WorkerLockSync({ lockPath, pid: process.pid, workerInstanceId });
  ownsLock = false;
}
process.on('exit', releaseLock);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

function taipeiDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sessionTradeDate(eventTime) {
  const classified = classifyTxChartSession(eventTime, calendar);
  return { tradeDate: classified.sessionTradeDate, session: classified.session };
}

function pathsForToday() {
  const date = taipeiDate();
  return {
    ledgerPath: path.join(dataRoot, 'live-events', `${date}.ndjson`),
    checkpointPath: path.join(projectionRoot, `${date}.checkpoint.json`),
    snapshotPath: path.join(projectionRoot, 'latest.json'),
  };
}

async function writeStatus(status, fields = {}) {
  const target = path.join(projectionRoot, 'status.json');
  const temp = `${target}.${process.pid}.${workerInstanceId}.tmp`;
  const published = await publishCru34Status({ targetPath: target, tempPath: temp, document: {
    schemaVersion: 'cru34-live-worker-status-v1', status, pid: process.pid,
    workerInstanceId, workerStartedAt,
    dataRoot, projectionRoot, snapshotPath: path.join(projectionRoot, 'latest.json'), statusPath: target,
    logs: { stdoutPath, stderrPath, incidentPath },
    observedAt: new Date().toISOString(), formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
    ...fields,
  } });
  if (published.attempts > 1) {
    await recordIncident({
      message: 'CRU34_STATUS_PUBLICATION_RETRY_RECOVERED',
      operation: published.recoveredOperation,
      code: published.recoveredCode,
      attempts: published.attempts,
      retryDelaysMs: published.retryDelaysMs,
    }, { result: 'STATUS_PUBLICATION_RECOVERED' });
  }
  return published;
}

function writeStderr(value) {
  if (!stderrAvailable) return;
  try { process.stderr.write(`${value}\n`); } catch { stderrAvailable = false; }
}

async function recordIncident(error, { result, originalCode = null } = {}) {
  const evidence = cru34ErrorEvidence(error);
  writeStderr(JSON.stringify({ at: new Date().toISOString(), workerInstanceId, pid: process.pid,
    ...evidence, result, originalCode }));
  const incident = {
    schemaVersion: 'cru34-live-incident-v1', incidentAt: new Date().toISOString(),
    workerInstanceId, pid: process.pid, ...evidence, result, originalCode,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
  };
  const appended = await appendCru34Incident({ incidentPath, record: incident });
  if (!appended.written) writeStderr(JSON.stringify({ at: new Date().toISOString(), workerInstanceId,
    pid: process.pid, ...appended.error, result: 'INCIDENT_SINK_FAILED', originalCode: evidence.code }));
}

function controlledStop() {
  stopping = true;
  if (pollHandle) clearInterval(pollHandle);
  process.exitCode = 1;
  releaseLock();
}

async function run() {
  const paths = pathsForToday();
  try {
    if (!fs.existsSync(paths.ledgerPath)) {
      await writeStatus('UNAVAILABLE', { reason: 'CURRENT_LEDGER_MISSING' });
      return;
    }
    const result = projectCru34LiveBatch({
      ...paths,
      resolveSessionTradeDate: sessionTradeDate,
      staleAfterMs,
      maxBatchBytes,
      maxBatchRecords,
    });
    await writeStatus('AVAILABLE', {
      reason: null, truthState: result.status,
      checkpointOrdinal: result.checkpoint?.lastVerifiedLedgerOrdinal || 0,
      checkpointRecordHash: result.checkpoint?.lastVerifiedRecordHash || null,
      snapshotHash: result.snapshot?.snapshotHash || null,
    });
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), status: result.status,
      ordinal: result.checkpoint?.lastVerifiedLedgerOrdinal || 0 })}\n`);
  } catch (error) {
    const handled = await handleCru34RunFailure({
      error,
      recordIncident,
      writeUnavailable: (reason) => writeStatus('UNAVAILABLE', { reason }),
    });
    if (handled.fatal) controlledStop();
  }
}

async function runSingleFlight() {
  if (runInFlight || stopping) return;
  runInFlight = true;
  try { await run(); } finally { runInFlight = false; }
}

if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) {
  throw new Error('CRU43_POLL_INTERVAL_INVALID');
}
await runSingleFlight();
if (!stopping) {
  pollHandle = setInterval(() => { void runSingleFlight(); }, pollMs);
}
