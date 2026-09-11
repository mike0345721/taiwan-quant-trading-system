import fs from 'node:fs';

function parseRecord(raw) {
  try { return JSON.parse(raw); }
  catch { return { pid: Number.parseInt(String(raw).trim(), 10), workerInstanceId: null }; }
}

function processIsAlive(pid, signalProcess = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { signalProcess(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function createExclusiveRecord(fsApi, targetPath, record) {
  const fd = fsApi.openSync(targetPath, 'wx');
  try { fsApi.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8'); }
  finally { fsApi.closeSync(fd); }
}

function removeOwnedTakeover(fsApi, takeoverPath, claimId) {
  try {
    const current = parseRecord(fsApi.readFileSync(takeoverPath, 'utf8'));
    if (current.claimId === claimId) fsApi.unlinkSync(takeoverPath);
  } catch { /* takeover was already removed or cannot be safely removed */ }
}

export function acquireCru34WorkerLockSync({
  lockPath,
  record,
  fsApi = fs,
  signalProcess = process.kill,
} = {}) {
  if (!lockPath || !record?.workerInstanceId || !Number.isInteger(record?.pid)) {
    throw new Error('CRU34_WORKER_LOCK_CONFIG_INVALID');
  }
  try {
    createExclusiveRecord(fsApi, lockPath, record);
    return Object.freeze({ acquired: true, reason: 'LOCK_CREATED', incumbent: null });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const initialRaw = fsApi.readFileSync(lockPath, 'utf8');
  const initial = parseRecord(initialRaw);
  if (processIsAlive(Number(initial.pid), signalProcess)) {
    return Object.freeze({ acquired: false, reason: 'INCUMBENT_ALIVE', incumbent: initial });
  }

  const takeoverPath = `${lockPath}.takeover`;
  const claimId = `${record.pid}:${record.workerInstanceId}`;
  try {
    createExclusiveRecord(fsApi, takeoverPath, { claimId, pid: record.pid,
      workerInstanceId: record.workerInstanceId, claimedAt: new Date().toISOString() });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return Object.freeze({ acquired: false, reason: 'STALE_TAKEOVER_BUSY', incumbent: initial });
    }
    throw error;
  }

  try {
    let currentRaw = null;
    try { currentRaw = fsApi.readFileSync(lockPath, 'utf8'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (currentRaw !== null) {
      const current = parseRecord(currentRaw);
      if (processIsAlive(Number(current.pid), signalProcess)) {
        return Object.freeze({ acquired: false, reason: 'INCUMBENT_BECAME_ALIVE', incumbent: current });
      }
      if (currentRaw !== initialRaw) {
        return Object.freeze({ acquired: false, reason: 'INCUMBENT_CHANGED', incumbent: current });
      }
      fsApi.unlinkSync(lockPath);
    }
    try {
      createExclusiveRecord(fsApi, lockPath, record);
      return Object.freeze({ acquired: true, reason: 'STALE_LOCK_REPLACED', incumbent: initial });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return Object.freeze({ acquired: false, reason: 'LOCK_RECREATED_DURING_TAKEOVER',
          incumbent: parseRecord(fsApi.readFileSync(lockPath, 'utf8')) });
      }
      throw error;
    }
  } finally {
    removeOwnedTakeover(fsApi, takeoverPath, claimId);
  }
}

export function releaseCru34WorkerLockSync({ lockPath, pid, workerInstanceId, fsApi = fs } = {}) {
  try {
    const lock = parseRecord(fsApi.readFileSync(lockPath, 'utf8'));
    if (Number(lock.pid) === pid && lock.workerInstanceId === workerInstanceId) {
      fsApi.unlinkSync(lockPath);
      return true;
    }
  } catch { /* already removed or no longer owned */ }
  return false;
}
