import fs from 'node:fs';
import path from 'node:path';
import { loadDashboardObservedFlow } from './dashboard-observed-flow.mjs';
import { validateProducerHeartbeat } from './dashboard-runtime-readiness.mjs';

function readSmall(filePath) {
  try {
    if (!filePath || fs.statSync(filePath).size > 64 * 1024) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

// Same bounded adapter as the workspace. No chart, research, ledger or collector work.
export function loadFlowRefresh({ runtimeCommit, dataRoot, projectionRoot, now = new Date(), ...options }) {
  const flow = loadDashboardObservedFlow({ ...options, now });
  const status = readSmall(options.liveStatusPath);
  const lock = readSmall(path.join(projectionRoot, 'worker.lock'));
  const heartbeat = validateProducerHeartbeat(status, lock, {
    snapshotPath: options.liveSnapshotPath, statusPath: options.liveStatusPath, dataRoot, projectionRoot, now,
  });
  const unsafe = status && (status.formalWeight !== 0 || status.researchOnly !== true
    || status.executionAuthorized !== false || status.orderRoutesEnabled !== false);
  const reasons = unsafe ? [...heartbeat.reasons, 'LIVE_PRODUCER_SAFETY_INVALID'] : heartbeat.reasons;
  const data = options.liveSnapshotPath && reasons.length
    ? { ...flow, sourceState: 'UNAVAILABLE', unavailableReason: reasons.join('|'), windows: null }
    : flow;
  return { ...data, delivery: { runtimeCommit, servedAt: now.toISOString(),
    workerInstanceId: status?.workerInstanceId || null } };
}
