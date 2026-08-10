import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createOwnerLaunchApprovalArtifact, createReadyForLaunchManifest } from '../src/market-state-forward-shadow.mjs';
import {
  ensureRuntimeLayout,
  readForwardShadowLedger,
  runDailyOutcomePhase,
  runDailyStatePhase,
  runtimePaths,
  verifyRuntimeEvidence,
} from '../src/market-state-forward-shadow-runtime.mjs';

const HASH = 'b'.repeat(64);
const root = path.resolve('data/market-state/forward-shadow/cru22-test-fixtures');
const auth = { formalWeight: 0, researchOnly: true, executionAuthorized: false };

function remove(runId) {
  fs.rmSync(path.join(root, runId), { recursive: true, force: true });
}

function stateInput(runId, overrides = {}) {
  return {
    mode: 'TEST_FIXTURE',
    runtimeRoot: root,
    runId,
    tradeDate: '2026-08-11',
    sessionId: '2026-08-11-DAY',
    scheduledAt: '2026-08-11T08:25:00+08:00',
    now: '2026-08-11T08:25:10+08:00',
    outcomeObservationStartAt: '2026-08-11T08:45:00+08:00',
    officialTradingDay: true,
    availableAt: '2026-08-11T08:25:05+08:00',
    evaluator: { version: 'market-state-v1-premarket-evaluator-v0', sha256: HASH },
    evidenceLineage: [{ source: 'fixture', availableAt: '2026-08-11T08:25:05+08:00', sourceHash: HASH }],
    sourceTimestamps: { fixture: '2026-08-11T08:25:05+08:00' },
    sourceHashes: { fixture: HASH },
    qualityStatus: 'CLEAN',
    marketStateInput: {
      tradeDate: '2026-08-11',
      decisionAt: '2026-08-11T08:25:06+08:00',
      researchOnly: true,
      executionAuthorized: false,
      evidence: [
        { key: 'price', block: 'localPrice', availableAt: '2026-08-11T08:25:05+08:00', qualityStatus: 'VALID', direction: 'BULLISH', trend: 'TREND_UP' },
        { key: 'breadth', block: 'breadth', availableAt: '2026-08-11T08:25:05+08:00', qualityStatus: 'VALID', direction: 'BULLISH' },
      ],
    },
    ...auth,
    ...overrides,
  };
}

function officialInput(runId, overrides = {}) {
  const runtimePath = path.join(root, runId);
  const launchManifest = createReadyForLaunchManifest({
    finalMainCommit: '1e8211a5a5ea2dcfdda77b57342226700c204345',
    officialStartTradeDate: '2026-08-11',
    schedulerTime: '08:25 Asia/Taipei',
    runtimeRoot: runtimePath,
    runId,
    evaluator: { version: 'evaluator-v1', sha256: HASH },
    outcomeContract: { version: 'outcome-v1', sha256: HASH },
    linkageContract: { version: 'linkage-v1', sha256: HASH },
    frozenForwardGate: { version: 'gate-v1', sha256: HASH },
    selectedAxes: ['direction', 'globalAlignment'],
    ...auth,
  });
  const ownerApprovalArtifact = createOwnerLaunchApprovalArtifact({
    ownerDecisionReference: 'CRU22-OFFICIAL-MODE-TEST-FIXTURE',
    approvedAt: '2026-08-10T20:00:00+08:00',
    manifestHash: launchManifest.manifestHash,
    finalMainCommit: launchManifest.finalMainCommit,
    officialStartTradeDate: launchManifest.officialStartTradeDate,
    schedulerTime: launchManifest.schedulerTime,
    ...auth,
  });
  return stateInput(runId, {
    mode: 'FORWARD_SHADOW',
    launchManifest,
    ownerApprovalArtifact,
    currentMainCommit: launchManifest.finalMainCommit,
    actualArtifactHashes: {
      evaluator: HASH,
      outcomeContract: HASH,
      linkageContract: HASH,
      frozenForwardGate: HASH,
    },
    ...overrides,
  });
}

test('runtime layout stays on governed D storage and never accepts C drive', () => {
  const runId = 'layout-test';
  remove(runId);
  const paths = ensureRuntimeLayout(root, runId);
  for (const name of ['officialRecords', 'outcomes', 'checksums', 'dailyStatus', 'logs']) {
    assert.equal(fs.statSync(paths[name]).isDirectory(), true);
  }
  assert.throws(() => runtimePaths('C:\\runtime', runId), /C_DRIVE_RUNTIME_FORBIDDEN/);
  remove(runId);
});

test('legal pre-08:45 state freezes once and restart is idempotent', () => {
  const runId = 'legal-freeze';
  remove(runId);
  const first = runDailyStatePhase(stateInput(runId));
  const second = runDailyStatePhase(stateInput(runId));
  assert.equal(first.record.recordType, 'STATE');
  assert.equal(first.record.qualityStatus, 'CLEAN');
  assert.equal(first.writeStatus, 'APPENDED');
  assert.equal(second.status, 'UNCHANGED');
  assert.equal(second.record.recordHash, first.record.recordHash);
  assert.equal(readForwardShadowLedger(first.paths.candidateLedger).length, 1);
  assert.equal(fs.readdirSync(first.paths.checksums).length, 1);
  assert.equal(first.officialEvidenceWritten, false);
  remove(runId);
});

test('late start becomes MISSED without fabricated snapshot and cannot be backfilled', () => {
  const runId = 'late-start';
  remove(runId);
  const late = runDailyStatePhase(stateInput(runId, { now: '2026-08-11T08:45:01+08:00' }));
  assert.equal(late.record.recordType, 'SESSION_STATUS');
  assert.equal(late.record.qualityStatus, 'MISSED');
  assert.equal(late.record.axisStateSnapshot, undefined);
  assert.equal(late.record.decisionAt, undefined);
  const retry = runDailyStatePhase(stateInput(runId));
  assert.equal(retry.status, 'UNCHANGED');
  assert.equal(retry.record.recordType, 'SESSION_STATUS');
  assert.throws(() => runDailyOutcomePhase({
    mode: 'TEST_FIXTURE', runtimeRoot: root, runId, tradeDate: '2026-08-11', outcome: {}, ...auth,
  }), /STATE_RECORD_NOT_FOUND/);
  remove(runId);
});

test('stale and unavailable state keep legal snapshot but never become clean', () => {
  for (const [qualityStatus, unavailableReason] of [['STALE', 'SOURCE_STALE'], ['UNAVAILABLE', 'SOURCE_MISSING']]) {
    const runId = `quality-${qualityStatus.toLowerCase()}`;
    remove(runId);
    const result = runDailyStatePhase(stateInput(runId, { qualityStatus, unavailableReason }));
    assert.equal(result.record.recordType, 'STATE');
    assert.equal(result.record.qualityStatus, qualityStatus);
    assert.equal(verifyRuntimeEvidence(root, runId).cleanStateRecordCount, 0);
    remove(runId);
  }
});

test('outcome is append-later only and deterministic on restart', () => {
  const runId = 'outcome-append';
  remove(runId);
  const state = runDailyStatePhase(stateInput(runId));
  const input = {
    mode: 'TEST_FIXTURE', runtimeRoot: root, runId, tradeDate: '2026-08-11',
    outcome: {
      outcomeContract: { version: 'outcome-v1', sha256: HASH },
      outcomeAvailableAt: '2026-08-11T14:00:00+08:00',
      actualContract: '202608',
      sessionReturnBps: 12.5,
      outcomeSourceLineage: { source: 'fixture' },
      outcomeSourceHash: HASH,
    },
    ...auth,
  };
  const first = runDailyOutcomePhase(input);
  const second = runDailyOutcomePhase(input);
  assert.equal(first.writeStatus, 'APPENDED');
  assert.equal(second.status, 'UNCHANGED');
  assert.equal(first.record.stateRecordHash, state.record.recordHash);
  const audit = verifyRuntimeEvidence(root, runId);
  assert.equal(audit.ok, true);
  assert.equal(audit.recordCount, 2);
  assert.equal(audit.outcomeRecordCount, 1);
  assert.equal(fs.readdirSync(first.paths.checksums).length, 2);
  remove(runId);
});

test('future evidence and unauthorized execution fail closed', () => {
  remove('future');
  assert.throws(() => runDailyStatePhase(stateInput('future', {
    availableAt: '2026-08-11T08:30:00+08:00',
    marketStateInput: { ...stateInput('unused').marketStateInput, decisionAt: '2026-08-11T08:25:06+08:00' },
  })), /FUTURE_DATA_VIOLATION/);
  assert.throws(() => runDailyStatePhase(stateInput('unauthorized', { executionAuthorized: true })), /AUTHORIZATION_BOUNDARY/);
  remove('future');
  remove('unauthorized');
});

test('duplicate-start lock fails closed', () => {
  const runId = 'duplicate-lock';
  remove(runId);
  const paths = ensureRuntimeLayout(root, runId);
  fs.writeFileSync(paths.lock, 'held', { flag: 'wx' });
  assert.throws(() => runDailyStatePhase(stateInput(runId)), /DUPLICATE_START/);
  remove(runId);
});

test('NOT_ACTIVE mode does not create runtime evidence', () => {
  const runId = 'not-active';
  remove(runId);
  const result = runDailyStatePhase(stateInput(runId, { mode: 'NOT_ACTIVE' }));
  assert.equal(result.status, 'NOT_ACTIVE');
  assert.equal(result.officialEvidenceWritten, false);
  assert.equal(fs.existsSync(path.join(root, runId)), false);
});

test('official mode hard fails without a bound Owner approval artifact', () => {
  const runId = 'official-no-approval';
  remove(runId);
  assert.throws(() => runDailyStatePhase(stateInput(runId, { mode: 'FORWARD_SHADOW' })), /OWNER_APPROVAL_REQUIRED/);
  remove(runId);
});

test('official mode rejects manifest hash, final commit, start date and frozen hash mismatches', () => {
  for (const [name, mutate, pattern] of [
    ['manifest', (input) => ({ ...input, launchManifest: { ...input.launchManifest, manifestHash: HASH } }), /READY_MANIFEST_HASH_MISMATCH/],
    ['commit', (input) => ({ ...input, currentMainCommit: '0'.repeat(40) }), /FINAL_MAIN_COMMIT_MISMATCH/],
    ['start', (input) => ({ ...input, tradeDate: '2026-08-10' }), /BEFORE_OFFICIAL_START_DATE/],
    ['artifact', (input) => ({ ...input, actualArtifactHashes: { ...input.actualArtifactHashes, evaluator: 'c'.repeat(64) } }), /EVALUATOR_HASH_MISMATCH/],
  ]) {
    const runId = `official-bad-${name}`;
    remove(runId);
    assert.throws(() => runDailyStatePhase(mutate(officialInput(runId))), pattern);
    remove(runId);
  }
});

test('candidate and official storage are isolated and only approved official writes the official flag', () => {
  const runId = 'storage-isolation';
  remove(runId);
  const candidate = runDailyStatePhase(stateInput(runId));
  const official = runDailyStatePhase(officialInput(runId));
  assert.equal(candidate.officialEvidenceWritten, false);
  assert.equal(official.officialEvidenceWritten, true);
  assert.equal(fs.existsSync(candidate.paths.candidateLedger), true);
  assert.equal(fs.existsSync(official.paths.officialLedger), true);
  assert.notEqual(candidate.paths.candidateLedger, official.paths.officialLedger);
  assert.equal(readForwardShadowLedger(candidate.paths.candidateLedger).length, 1);
  assert.equal(readForwardShadowLedger(official.paths.officialLedger).length, 1);
  assert.equal(fs.readdirSync(official.paths.officialRecords).length, 1);
  assert.equal(official.executionAuthorized, false);
  const replay = runDailyStatePhase(officialInput(runId));
  assert.equal(replay.status, 'UNCHANGED');
  assert.equal(replay.record.recordHash, official.record.recordHash);
  const conflicting = officialInput(runId);
  conflicting.marketStateInput = {
    ...conflicting.marketStateInput,
    evidence: conflicting.marketStateInput.evidence.map((item) => ({ ...item, direction: 'BEARISH' })),
  };
  assert.throws(() => runDailyStatePhase(conflicting), /DUPLICATE_OFFICIAL_TRADE_DATE_CONFLICT/);
  const outcome = runDailyOutcomePhase({
    ...officialInput(runId),
    outcome: {
      outcomeContract: { version: 'outcome-v1', sha256: HASH },
      outcomeAvailableAt: '2026-08-11T14:00:00+08:00',
      actualContract: '202608',
      sessionReturnBps: 3.5,
      outcomeSourceLineage: { source: 'OFFICIAL_TEST_FIXTURE' },
      outcomeSourceHash: HASH,
    },
  });
  assert.equal(outcome.officialEvidenceWritten, true);
  assert.equal(verifyRuntimeEvidence(root, runId, { official: true }).outcomeRecordCount, 1);
  remove(runId);
});

test('approved official late start remains MISSED and never fabricates clean evidence', () => {
  const runId = 'official-late';
  remove(runId);
  const result = runDailyStatePhase(officialInput(runId, { now: '2026-08-11T08:45:01+08:00' }));
  assert.equal(result.officialEvidenceWritten, true);
  assert.equal(result.record.recordType, 'SESSION_STATUS');
  assert.equal(result.record.qualityStatus, 'MISSED');
  assert.equal(result.record.axisStateSnapshot, undefined);
  assert.equal(verifyRuntimeEvidence(root, runId, { official: true }).cleanStateRecordCount, 0);
  remove(runId);
});
