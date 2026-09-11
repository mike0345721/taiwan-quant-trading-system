import fs from 'node:fs';
import crypto from 'node:crypto';

function parseRecord(raw) {
  try { return JSON.parse(raw); }
  catch { return null; }
}

function verifiedOwner(record) {
  return Number.isSafeInteger(record?.pid) && record.pid > 0
    && typeof record.workerInstanceId === 'string' && record.workerInstanceId.trim().length > 0;
}

function ownerState(record, signalProcess) {
  if (!verifiedOwner(record)) return 'UNKNOWN';
  try { signalProcess(record.pid, 0); return 'ALIVE'; }
  catch (error) { return error?.code === 'ESRCH' ? 'DEAD' : 'UNKNOWN'; }
}

function createExclusiveRecord(fsApi, targetPath, record) {
  const fd = fsApi.openSync(targetPath, 'wx');
  try { fsApi.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8'); }
  finally { fsApi.closeSync(fd); }
}

// Every mutation takes this guard, including initial creation and release.
// An incomplete/abandoned guard is deliberately NOT reclaimed automatically.
function withMutationGuard(fsApi, lockPath, record, busyResult, action) {
  const takeoverPath = `${lockPath}.takeover`;
  const claimId = crypto.randomUUID();
  try {
    createExclusiveRecord(fsApi, takeoverPath, { claimId, pid: record.pid,
      workerInstanceId: record.workerInstanceId, claimedAt: new Date().toISOString() });
  } catch (error) {
    if (error?.code === 'EEXIST') return busyResult;
    throw error;
  }
  try { return action(); }
  finally {
    try {
      const current = parseRecord(fsApi.readFileSync(takeoverPath, 'utf8'));
      if (current?.claimId === claimId) fsApi.unlinkSync(takeoverPath);
    } catch { /* Preserve an unverifiable guard; never remove another claim. */ }
  }
}

export function acquireCru34WorkerLockSync({
  lockPath, record, fsApi = fs, signalProcess = process.kill,
} = {}) {
  if (!lockPath || !verifiedOwner(record)) throw new Error('CRU34_WORKER_LOCK_CONFIG_INVALID');
  return withMutationGuard(fsApi, lockPath, record,
    Object.freeze({ acquired: false, reason: 'STALE_TAKEOVER_BUSY', incumbent: null }), () => {
      let initialRaw;
      try { initialRaw = fsApi.readFileSync(lockPath, 'utf8'); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      const initial = initialRaw === undefined ? null : parseRecord(initialRaw);
      if (initialRaw !== undefined) {
        const state = ownerState(initial, signalProcess);
        if (state !== 'DEAD') return Object.freeze({ acquired: false,
          reason: state === 'ALIVE' ? 'INCUMBENT_ALIVE' : 'INCUMBENT_UNVERIFIED', incumbent: initial });
        // Reject changes by legacy/nonparticipating writers as well.
        if (fsApi.readFileSync(lockPath, 'utf8') !== initialRaw) {
          return Object.freeze({ acquired: false, reason: 'INCUMBENT_CHANGED', incumbent: initial });
        }
        fsApi.unlinkSync(lockPath);
      }
      try {
        createExclusiveRecord(fsApi, lockPath, record);
        return Object.freeze({ acquired: true,
          reason: initialRaw === undefined ? 'LOCK_CREATED' : 'STALE_LOCK_REPLACED', incumbent: initial });
      } catch (error) {
        if (error?.code === 'EEXIST') return Object.freeze({ acquired: false,
          reason: 'LOCK_RECREATED_DURING_TAKEOVER', incumbent: null });
        throw error;
      }
    });
}

export function releaseCru34WorkerLockSync({ lockPath, pid, workerInstanceId, fsApi = fs } = {}) {
  if (!lockPath || !verifiedOwner({ pid, workerInstanceId })) return false;
  try {
    return withMutationGuard(fsApi, lockPath, { pid, workerInstanceId }, false, () => {
      const lock = parseRecord(fsApi.readFileSync(lockPath, 'utf8'));
      if (lock?.pid === pid && lock.workerInstanceId === workerInstanceId) {
        fsApi.unlinkSync(lockPath);
        return true;
      }
      return false;
    });
  } catch { return false; /* Missing, unverifiable, or no longer owned. */ }
}
