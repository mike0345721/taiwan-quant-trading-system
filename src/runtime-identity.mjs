import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function readRuntimeIdentity(projectRoot, { exec = execFileSync, ref = 'HEAD' } = {}) {
  const canonicalRoot = path.resolve(projectRoot);
  try {
    const commit = String(exec('git', [
      '-c', `safe.directory=${canonicalRoot}`,
      'rev-parse', ref,
    ], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })).trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('INVALID_GIT_COMMIT');
    return Object.freeze({ status: 'VERIFIED', commit: commit.toLowerCase() });
  } catch {
    return Object.freeze({ status: 'UNAVAILABLE', commit: null });
  }
}

export function buildRuntimeVersionStatus({
  productVersion = 'DW V1.1',
  runtimeIdentity,
  approvedMainIdentity,
  runtimeStartedAt = null,
} = {}) {
  const runtimeCommit = runtimeIdentity?.status === 'VERIFIED' ? runtimeIdentity.commit : null;
  const approvedMainCommit = approvedMainIdentity?.status === 'VERIFIED' ? approvedMainIdentity.commit : null;
  const syncState = runtimeCommit && approvedMainCommit
    ? runtimeCommit === approvedMainCommit ? 'SYNCED' : 'MISMATCH'
    : 'UNKNOWN';
  return Object.freeze({
    productVersion,
    approvedMainCommit,
    runtimeCommit,
    runtimeStartedAt: typeof runtimeStartedAt === 'string' && Number.isFinite(Date.parse(runtimeStartedAt))
      ? new Date(runtimeStartedAt).toISOString() : null,
    syncState,
  });
}
