import fs from 'node:fs';
import path from 'node:path';

// Select read-only source products without redirecting sessions, receipts or caches.
// Runtime identity and product-readiness gates remain the caller's responsibility.
export function resolveDashboardReadDataRoot({
  dataDir,
  host,
  port,
  actualDataMode,
  previewType = null,
  inlineEnabled = false,
  candidateReadRoot = null,
  formalReadRoot = null,
  isolatedMode = false,
} = {}) {
  if (candidateReadRoot && formalReadRoot) throw Error('DASHBOARD_READ_ROOT_CONFLICT');

  if (formalReadRoot) {
    if (host !== '127.0.0.1' || port !== 8787 || actualDataMode !== 'LIVE' || previewType || isolatedMode) {
      throw Error('FORMAL_READ_ROOT_REJECTED');
    }
    let root;
    try {
      if (typeof formalReadRoot !== 'string' || !formalReadRoot.trim()) throw Error('INVALID_PATH');
      root = path.resolve(formalReadRoot);
      if (!fs.statSync(root).isDirectory()) throw Error('NOT_DIRECTORY');
    } catch {
      throw Error('FORMAL_READ_ROOT_DIRECTORY_REQUIRED');
    }
    return root;
  }

  if (candidateReadRoot) {
    if (!inlineEnabled || host !== '127.0.0.1' || [8787, 8790, 8791].includes(port)) {
      throw Error('INLINE_CANDIDATE_READ_ROOT_REJECTED');
    }
    return path.resolve(candidateReadRoot);
  }

  return dataDir;
}
