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
