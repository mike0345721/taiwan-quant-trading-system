// Candidate identity only. This does not grant acceptance or replace runtime gates.
const allowedPreviewBranches = new Set([
  'codex/cru21-chatgpt-plan-preflight-v1',
  'codex/cru21-unified-release-20261014',
  'codex/cru21-decision-quality-p0-20261016',
  'codex/cru21-ui-auth-acceptance-20261023',
  'codex/cru21-emergency-market-calendar-qa-20261023',
  'codex/cru21-preopen-integrated-candidate-20261023',
]);

export function buildCru21PreviewVersion({ runtimeVersion, branch, dataMode } = {}) {
  return Object.freeze({ ...runtimeVersion,
    productVersion: 'CRU-21 Scenario Watch', previewType: 'CRU21_OWNER_PREVIEW',
    previewLabel: '候選審查 · 尚未批准交付', branch,
    exactHead: runtimeVersion?.runtimeCommit, buildCommit: runtimeVersion?.runtimeCommit,
    baseMainCommit: runtimeVersion?.approvedMainCommit, dataMode,
    pendingCapabilities: Object.freeze(['Owner acceptance', 'Merge / formal rollout']), complete: false,
  });
}

export function validateCru21PreviewVersionTruth(version, { expectedHead, expectedBaseMain,
  actualBranch, sourceClean, host, port, inlineEnabled, candidateReadRoot, actualDataMode } = {}) {
  const reasons = [];
  const sha = value => /^[0-9a-f]{40}$/.test(value || '');
  if (version?.previewType !== 'CRU21_OWNER_PREVIEW') reasons.push('CRU21_PREVIEW_TYPE_MISMATCH');
  if (host !== '127.0.0.1' || port !== 18722 || !inlineEnabled || !candidateReadRoot) reasons.push('CRU21_CANDIDATE_BOUNDARY_REJECTED');
  if (!sha(expectedHead) || [version?.exactHead, version?.buildCommit, version?.runtimeCommit].some(value => value !== expectedHead)) reasons.push('CRU21_EXACT_HEAD_MISMATCH');
  if (!sha(expectedBaseMain) || version?.baseMainCommit !== expectedBaseMain || version?.approvedMainCommit !== expectedBaseMain) reasons.push('CRU21_BASE_MAIN_MISMATCH');
  if (!allowedPreviewBranches.has(actualBranch) || version?.branch !== actualBranch) reasons.push('CRU21_BRANCH_MISMATCH');
  if (sourceClean !== true) reasons.push('CRU21_SOURCE_NOT_CLEAN');
  if (actualDataMode !== 'LIVE' || version?.dataMode !== actualDataMode || version?.complete !== false) reasons.push('CRU21_PREVIEW_TRUTH_INVALID');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}
