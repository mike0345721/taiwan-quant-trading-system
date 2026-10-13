import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cru34LiveCanonicalJson } from './cru34-live-checkpoint.mjs';
import { renameCru34SnapshotSync } from './cru34-snapshot-rename.mjs';

export const CRU34_SNAPSHOT_RETRY_POLICY = Object.freeze({
  maxAttempts: 6,
  delaysMs: Object.freeze([25, 50, 100, 200, 400]),
  maxTotalDelayMs: 775,
  retryableCodes: Object.freeze(['EPERM', 'EBUSY', 'EACCES']),
});

const waitCell = new Int32Array(new SharedArrayBuffer(4));
function wait(milliseconds) { Atomics.wait(waitCell, 0, 0, milliseconds); }
const snapshotIo = { ...fs, renameSync: renameCru34SnapshotSync };

// Keep the synchronous batch API and single-writer protocol. Only the completed,
// closed temporary file is retried; never remove or truncate the last snapshot.
export function publishCru34Snapshot({ targetPath, document, io = snapshotIo, sleep = wait } = {}) {
  if (!targetPath || !document) throw new Error('CRU34_SNAPSHOT_PUBLISH_CONFIG_INVALID');
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const retryDelaysMs = [];
  let attempts = 0;
  let recoveredCode = null;
  let operation = 'MKDIR_SNAPSHOT_PARENT';
  let ownsTemp = false;
  try {
    io.mkdirSync(path.dirname(targetPath), { recursive: true });
    operation = 'WRITE_SNAPSHOT_TEMP';
    const bytes = `${cru34LiveCanonicalJson(document)}\n`;
    const fd = io.openSync(tempPath, 'wx');
    ownsTemp = true;
    try {
      io.writeFileSync(fd, bytes, 'utf8');
      io.fsyncSync(fd);
    } finally { io.closeSync(fd); }
    operation = 'RENAME_SNAPSHOT_TEMP';
    for (attempts = 1; attempts <= CRU34_SNAPSHOT_RETRY_POLICY.maxAttempts; attempts += 1) {
      try {
        io.renameSync(tempPath, targetPath);
        ownsTemp = false;
        break;
      } catch (error) {
        if (!CRU34_SNAPSHOT_RETRY_POLICY.retryableCodes.includes(error?.code)
            || attempts === CRU34_SNAPSHOT_RETRY_POLICY.maxAttempts) throw error;
        recoveredCode = error.code;
        const delay = CRU34_SNAPSHOT_RETRY_POLICY.delaysMs[attempts - 1];
        retryDelaysMs.push(delay);
        sleep(delay);
      }
    }
    operation = 'SYNC_SNAPSHOT_DIRECTORY';
    try {
      const fd = io.openSync(path.dirname(targetPath), 'r');
      try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    } catch (error) {
      // Windows does not support opening/fsyncing a directory this way.
      if (!['EINVAL', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
    }
    return Object.freeze({ attempts, retryDelaysMs: Object.freeze(retryDelaysMs), recoveredCode });
  } catch (cause) {
    const tempCleanup = { attempted: ownsTemp, removed: !ownsTemp, code: null };
    if (ownsTemp) {
      try { io.unlinkSync(tempPath); tempCleanup.removed = true; }
      catch (error) {
        tempCleanup.code = error?.code || 'UNKNOWN';
        tempCleanup.removed = error?.code === 'ENOENT';
      }
    }
    const error = new Error('CRU34_SNAPSHOT_PUBLICATION_FAILED', { cause });
    Object.assign(error, { code: cause?.code || 'UNKNOWN', operation, attempts: Math.max(1, attempts),
      targetPath, tempPath, retryDelaysMs: Object.freeze(retryDelaysMs), tempCleanup: Object.freeze(tempCleanup) });
    throw error;
  }
}
