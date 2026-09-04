import fs from 'node:fs';
import path from 'node:path';

export const LIFECYCLE_SCHEMA_VERSION = 1;
export const DEFAULT_HEARTBEAT_MS = 30_000;

export function classifyChildExit({ code, signal, shutdownRequested = false }) {
  if (shutdownRequested) return 'EXPECTED_SHUTDOWN_REQUESTED';
  if (signal) return 'UNEXPECTED_CHILD_SIGNAL';
  if (Number.isInteger(code) && code === 0) return 'EXPECTED_CHILD_EXIT';
  if (Number.isInteger(code)) return 'UNEXPECTED_CHILD_EXIT';
  return 'UNKNOWN_INSUFFICIENT_EVIDENCE';
}

export function createLifecycleStatus({ name, expectedTradeDate, script, logPath, now = new Date(), parentPid = process.ppid }) {
  const timestamp = now.toISOString();
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    evidenceClass: 'OPERATIONAL_TELEMETRY_NOT_FORWARD_EVIDENCE',
    name,
    taskWrapperStartedAt: timestamp,
    observerStartedAt: null,
    observerPid: null,
    parentPid,
    expectedTradeDate,
    script,
    logPath,
    lastHeartbeatAt: timestamp,
    lastLifecycleStage: 'WRAPPER_STARTING',
    shutdownRequested: false,
    processExitCode: null,
    exitReason: 'UNKNOWN_INSUFFICIENT_EVIDENCE',
    signalReason: null,
    wrapperExitAt: null,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
}

export function writeLifecycleStatus(filePath, status) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

export function finalizePendingDailyStatus({ filePath, expectedTradeDate, lifecycleStatus }) {
  if (!filePath || !fs.existsSync(filePath)) return { updated: false, reason: 'DAILY_STATUS_NOT_FOUND' };
  let current;
  try {
    current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { updated: false, reason: 'DAILY_STATUS_UNREADABLE' };
  }
  if (current?.tradeDate !== expectedTradeDate) return { updated: false, reason: 'DAILY_STATUS_TRADE_DATE_MISMATCH' };
  if (current?.attemptStatus !== 'OBSERVER_STARTED' || current?.readinessGate !== 'PENDING_SESSION_COMPLETION') {
    return { updated: false, reason: 'DAILY_STATUS_ALREADY_TERMINAL' };
  }
  const observerExitCode = Number.isInteger(lifecycleStatus?.observerExitCode) ? lifecycleStatus.observerExitCode : null;
  const reason = lifecycleStatus?.shutdownRequested === true
    ? 'OBSERVER_SHUTDOWN_REQUESTED'
    : observerExitCode === 0
      ? 'OBSERVER_EXITED_WITHOUT_TERMINAL_SESSION_EVIDENCE'
      : 'OBSERVER_EXITED_BEFORE_SESSION_TERMINAL_EVIDENCE';
  const status = {
    ...current,
    attemptStatus: 'OTHER_FAILURE',
    readinessGate: 'FAIL',
    sessionState: 'SESSION_FAILED',
    reconciliationStatus: 'NOT_VERIFIED',
    reason,
    hardFailCount: Number(current.hardFailCount || 0) + 1,
    lifecycle: {
      wrapperExitAt: lifecycleStatus?.wrapperExitAt || null,
      observerExitCode,
      observerSignal: lifecycleStatus?.observerSignal || null,
      exitReason: lifecycleStatus?.exitReason || 'UNKNOWN_INSUFFICIENT_EVIDENCE',
    },
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  writeLifecycleStatus(filePath, status);
  return { updated: true, reason };
}

export function parseScheduledTaskLifetime(raw = {}) {
  const settings = raw.settings ?? {};
  const action = raw.action ?? {};
  return {
    enabled: raw.enabled === true,
    state: typeof raw.state === 'string' ? raw.state : 'UNKNOWN',
    runAs: typeof raw.runAs === 'string' ? raw.runAs : null,
    executable: typeof action.executable === 'string' ? action.executable : null,
    arguments: typeof action.arguments === 'string' ? action.arguments : null,
    workingDirectory: typeof action.workingDirectory === 'string' ? action.workingDirectory : null,
    executionTimeLimit: typeof settings.executionTimeLimit === 'string' ? settings.executionTimeLimit : null,
    disallowStartIfOnBatteries: settings.disallowStartIfOnBatteries === true,
    stopIfGoingOnBatteries: settings.stopIfGoingOnBatteries === true,
    multipleInstances: typeof settings.multipleInstances === 'string' ? settings.multipleInstances : 'UNKNOWN',
    historyAvailable: raw.historyAvailable === true,
    lastResult: Number.isInteger(raw.lastResult) ? raw.lastResult : null,
    lastResultInterpretation: raw.historyAvailable === true ? 'RETAINED_HISTORY_REQUIRED' : 'UNKNOWN_INSUFFICIENT_EVIDENCE',
  };
}
