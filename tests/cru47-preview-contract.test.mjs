import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCru47PreviewVersion,
  validateCru47PreviewVersionTruth,
  CRU47_APPROVED_BASE_MAIN,
} from '../src/dashboard-integration-contract.mjs';

const head = 'b'.repeat(40);

test('CRU-47 preview identity is additive and anchored to the accepted main', () => {
  const version = buildCru47PreviewVersion({
    enabled: true,
    runtimeVersion: { runtimeCommit: head, runtimeStartedAt: new Date(0).toISOString() },
    branch: 'codex/cru-47-localhost-owner-preview-auto-auth-v1',
    dataMode: 'GOVERNED_LOCAL_DATA',
  });
  assert.equal(version.previewType, 'CRU47_OWNER_PREVIEW');
  assert.equal(version.baseMainCommit, CRU47_APPROVED_BASE_MAIN);
  assert.equal(version.approvedMainCommit, CRU47_APPROVED_BASE_MAIN);
  assert.equal(version.exactHead, head);
  assert.equal(version.syncState, 'CANDIDATE');
  assert.equal(validateCru47PreviewVersionTruth(version, head).ready, true);
  assert.equal(validateCru47PreviewVersionTruth({ ...version, baseMainCommit: 'c'.repeat(40) }, head).ready, false);
});

test('CRU-47 launcher is governed, direct, redacted, and never manages formal services', () => {
  const source = fs.readFileSync('scripts/start-cru47-owner-preview.ps1', 'utf8');
  assert.match(source, /8756efabe3a54e49154ed2fe6a705a354607c69b/);
  assert.match(source, /CRU47_WORKTREE_NOT_CLEAN/);
  assert.match(source, /merge-base HEAD \$approvedMain/);
  assert.match(source, /-ArgumentList 'server\.mjs'/);
  assert.match(source, /DASHBOARD_PREVIEW_AUTO_AUTH = '1'/);
  assert.match(source, /DASHBOARD_STATE_DIR = \$stateRoot/);
  assert.match(source, /BootstrapUrl = '\[REDACTED_SINGLE_USE_FRAGMENT\]'/);
  assert.doesNotMatch(source, /launcher\.mjs/);
  assert.doesNotMatch(source, /start-cru34-live-projection/);
  assert.match(source, /CRU47_BROWSER_OPEN_FAILED_CANDIDATE_STOPPED/);
  assert.match(source, /Stop-Process -Id \$process\.Id -Force/);
  assert.doesNotMatch(source, /LocalPort 8787|LocalPort 8790/);
  assert.doesNotMatch(source, /MOCK_DATA = 'true'/);
});
