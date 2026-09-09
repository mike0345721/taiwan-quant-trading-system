import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';

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
const workerInstanceId = crypto.randomUUID();
const workerStartedAt = new Date().toISOString();
let ownsLock = false;
function parseLock(raw) {
  try { return JSON.parse(raw); } catch { return { pid: Number.parseInt(raw.trim(), 10), workerInstanceId: null }; }
}
try {
  const lockFd = fs.openSync(lockPath, 'wx');
  try { fs.writeFileSync(lockFd, `${JSON.stringify({ pid: process.pid, workerInstanceId,
    workerStartedAt, dataRoot, projectionRoot })}\n`, 'utf8'); } finally { fs.closeSync(lockFd); }
  ownsLock = true;
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
  const incumbentPid = Number(parseLock(fs.readFileSync(lockPath, 'utf8')).pid);
  let incumbentAlive = Number.isInteger(incumbentPid) && incumbentPid > 0;
  if (incumbentAlive) {
    try { process.kill(incumbentPid, 0); } catch { incumbentAlive = false; }
  }
  if (incumbentAlive) process.exit(0);
  fs.unlinkSync(lockPath);
  const lockFd = fs.openSync(lockPath, 'wx');
  try { fs.writeFileSync(lockFd, `${JSON.stringify({ pid: process.pid, workerInstanceId,
    workerStartedAt, dataRoot, projectionRoot })}\n`, 'utf8'); } finally { fs.closeSync(lockFd); }
  ownsLock = true;
}

function releaseLock() {
  if (!ownsLock) return;
  try {
    const lock = parseLock(fs.readFileSync(lockPath, 'utf8'));
    if (Number(lock.pid) === process.pid && lock.workerInstanceId === workerInstanceId) fs.unlinkSync(lockPath);
  } catch { /* already removed */ }
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

function writeStatus(status, fields = {}) {
  fs.mkdirSync(projectionRoot, { recursive: true });
  const target = path.join(projectionRoot, 'status.json');
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({
    schemaVersion: 'cru34-live-worker-status-v1', status, pid: process.pid,
    workerInstanceId, workerStartedAt,
    dataRoot, projectionRoot, snapshotPath: path.join(projectionRoot, 'latest.json'), statusPath: target,
    observedAt: new Date().toISOString(), formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
    ...fields,
  })}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function unavailable(reason) { writeStatus('UNAVAILABLE', { reason }); }

function run() {
  const paths = pathsForToday();
  if (!fs.existsSync(paths.ledgerPath)) {
    unavailable('CURRENT_LEDGER_MISSING');
    return;
  }
  try {
    const result = projectCru34LiveBatch({
      ...paths,
      resolveSessionTradeDate: sessionTradeDate,
      staleAfterMs,
      maxBatchBytes,
      maxBatchRecords,
    });
    writeStatus('AVAILABLE', {
      reason: null, truthState: result.status,
      checkpointOrdinal: result.checkpoint?.lastVerifiedLedgerOrdinal || 0,
      checkpointRecordHash: result.checkpoint?.lastVerifiedRecordHash || null,
      snapshotHash: result.snapshot?.snapshotHash || null,
    });
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), status: result.status,
      ordinal: result.checkpoint?.lastVerifiedLedgerOrdinal || 0 })}\n`);
  } catch (error) {
    unavailable(String(error?.message || 'LIVE_PROJECTION_FAILED'));
    process.stderr.write(`${String(error?.stack || error)}\n`);
  }
}

if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) {
  throw new Error('CRU43_POLL_INTERVAL_INVALID');
}
run();
setInterval(run, pollMs);
