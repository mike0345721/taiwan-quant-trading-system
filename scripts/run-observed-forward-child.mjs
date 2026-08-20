import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HEARTBEAT_MS,
  classifyChildExit,
  createLifecycleStatus,
  writeLifecycleStatus,
} from '../src/forward-lifecycle-observability.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const required = (name) => {
  const result = value(name);
  if (!result) throw new Error(`MISSING_REQUIRED_ARGUMENT:${name}`);
  return result;
};
const taipeiDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const name = required('--name');
const script = path.resolve(root, required('--script'));
const afterScriptValue = value('--after-script');
const afterScript = afterScriptValue ? path.resolve(root, afterScriptValue) : null;
const logPath = path.resolve(required('--log'));
const statusPath = path.resolve(required('--status'));
const expectedTradeDate = value('--expected-trade-date', taipeiDate());
const heartbeatMs = Number(value('--heartbeat-ms', String(DEFAULT_HEARTBEAT_MS)));
if (!Number.isFinite(heartbeatMs) || heartbeatMs < 20) throw new Error('INVALID_HEARTBEAT_MS');
if (!fs.existsSync(script)) throw new Error(`OBSERVER_SCRIPT_NOT_FOUND:${script}`);
if (afterScript && !fs.existsSync(afterScript)) throw new Error(`AFTER_SCRIPT_NOT_FOUND:${afterScript}`);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
const log = fs.createWriteStream(logPath, { flags: 'a' });
const status = createLifecycleStatus({ name, expectedTradeDate, script: path.relative(root, script), logPath: path.relative(root, logPath) });
writeLifecycleStatus(statusPath, status);

let child = null;
let shutdownSignal = null;
const update = (patch) => {
  Object.assign(status, patch, { lastHeartbeatAt: new Date().toISOString() });
  writeLifecycleStatus(statusPath, status);
};
const heartbeat = setInterval(() => update({}), heartbeatMs);
heartbeat.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (status.shutdownRequested) return;
    shutdownSignal = signal;
    update({ shutdownRequested: true, signalReason: signal, lastLifecycleStage: 'SHUTDOWN_REQUESTED' });
    if (child && !child.killed) child.kill(signal);
  });
}

function runNode(target, stage) {
  return new Promise((resolve) => {
    update({ lastLifecycleStage: `${stage}_STARTING` });
    child = spawn(process.execPath, [target], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (stage === 'OBSERVER') update({ observerStartedAt: new Date().toISOString(), observerPid: child.pid, lastLifecycleStage: 'OBSERVER_RUNNING' });
    else update({ lastLifecycleStage: `${stage}_RUNNING` });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('error', (error) => resolve({ code: null, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal, error: null }));
  });
}

let finalCode = 1;
try {
  const observer = await runNode(script, 'OBSERVER');
  status.observerExitCode = Number.isInteger(observer.code) ? observer.code : null;
  status.observerSignal = observer.signal ?? null;
  status.observerError = observer.error ?? null;
  const observerReason = classifyChildExit({ code: observer.code, signal: observer.signal, shutdownRequested: status.shutdownRequested });
  update({ lastLifecycleStage: 'OBSERVER_EXITED', exitReason: observer.error ? 'UNKNOWN_INSUFFICIENT_EVIDENCE' : observerReason });
  finalCode = Number.isInteger(observer.code) ? observer.code : 1;

  if (finalCode === 0 && afterScript && !status.shutdownRequested) {
    const audit = await runNode(afterScript, 'AUDIT');
    status.auditExitCode = Number.isInteger(audit.code) ? audit.code : null;
    status.auditSignal = audit.signal ?? null;
    status.auditError = audit.error ?? null;
    finalCode = Number.isInteger(audit.code) ? audit.code : 1;
    update({ lastLifecycleStage: 'AUDIT_EXITED', exitReason: audit.error ? 'UNKNOWN_INSUFFICIENT_EVIDENCE' : classifyChildExit({ code: audit.code, signal: audit.signal, shutdownRequested: status.shutdownRequested }) });
  }
} finally {
  clearInterval(heartbeat);
  status.processExitCode = finalCode;
  status.signalReason = shutdownSignal ?? status.signalReason;
  status.wrapperExitAt = new Date().toISOString();
  status.lastLifecycleStage = 'WRAPPER_EXITED';
  writeLifecycleStatus(statusPath, status);
  await new Promise((resolve) => log.end(resolve));
}

process.exitCode = finalCode;
