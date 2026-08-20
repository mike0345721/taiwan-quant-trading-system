import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function readRuntimeIdentity(projectRoot, { exec = execFileSync } = {}) {
  const canonicalRoot = path.resolve(projectRoot);
  try {
    const commit = String(exec('git', [
      '-c', `safe.directory=${canonicalRoot}`,
      'rev-parse', 'HEAD',
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
