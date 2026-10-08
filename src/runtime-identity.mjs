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

// Formal identity only. Caller inputs must come from actual Git/config startup evidence,
// never from the version declaration itself. Producer, browser and safety gates remain separate.
export function validateFormalRuntimeVersionTruth(version, {
  expectedRuntimeCommit, expectedApprovedMainCommit, actualDataMode, sourceClean,
  host, port, previewType, now = new Date(),
} = {}) {
  const reasons = [];
  const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
  if (previewType || version?.previewType) reasons.push('FORMAL_PREVIEW_NOT_ALLOWED');
  if (host !== '127.0.0.1' || port !== 8787) reasons.push('FORMAL_RUNTIME_BOUNDARY_REJECTED');
  if (!sha(expectedRuntimeCommit) || !sha(expectedApprovedMainCommit)
      || expectedRuntimeCommit !== expectedApprovedMainCommit
      || version?.runtimeCommit !== expectedRuntimeCommit
      || version?.approvedMainCommit !== expectedApprovedMainCommit
      || version?.syncState !== 'SYNCED') reasons.push('FORMAL_APPROVED_MAIN_MISMATCH');
  const startedMs = typeof version?.runtimeStartedAt === 'string' ? Date.parse(version.runtimeStartedAt) : NaN;
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(startedMs) || !Number.isFinite(nowMs) || startedMs > nowMs + 5_000)
    reasons.push('FORMAL_RUNTIME_START_TIME_INVALID');
  if (actualDataMode !== 'LIVE') reasons.push('FORMAL_LIVE_DATA_REQUIRED');
  if (sourceClean !== true) reasons.push('FORMAL_SOURCE_NOT_CLEAN');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}
