import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  auditForwardShadowLedger,
  createLaunchManifestCandidate,
  createOwnerLaunchApprovalArtifact,
  createReadyForLaunchManifest,
  createMissedSessionRecord,
  createOutcomeRecord,
  createStateRecord,
  digest,
  stableJson,
  validateCollectorMode,
  validateOwnerLaunchApprovalArtifact,
  validateReadyForLaunchManifest,
} from '../src/market-state-forward-shadow.mjs';

const HASH = 'a'.repeat(64);
const authorization = { formalWeight: 0, researchOnly: true, executionAuthorized: false };
const launchInput = {
  baselineMainCommit: '83666f12daaedc771d49058ce04f8612e948e8cd',
  evaluator: { version: 'evaluator-v1', sha256: HASH },
  outcomeContract: { version: 'outcome-v1', sha256: HASH },
  linkageContract: { version: 'linkage-v1', sha256: HASH },
  frozenForwardGate: { version: 'gate-v1', sha256: HASH },
  selectedAxes: ['direction', 'globalAlignment'],
  launchStatus: 'NOT_ACTIVE',
  candidateStartTradeDate: null,
  ...authorization,
};

const stateInput = (overrides = {}) => ({
  tradeDate: '2026-08-11',
  sessionId: '2026-08-11-DAY',
  decisionAt: '2026-08-11T08:40:00+08:00',
  availableAt: '2026-08-11T08:39:59+08:00',
  recordedAt: '2026-08-11T08:40:01+08:00',
  outcomeObservationStartAt: '2026-08-11T08:45:00+08:00',
  evaluator: { version: 'evaluator-v1', sha256: HASH },
  axisStateSnapshot: { direction: 'BULLISH', globalAlignment: 'TAILWIND' },
  selectedShadowAxes: ['direction', 'globalAlignment'],
  evidenceLineage: [{ source: 'daily', availableAt: '2026-08-11T08:39:00+08:00', sourceHash: HASH }],
  sourceTimestamps: { daily: '2026-08-11T08:39:00+08:00' },
  sourceHashes: { daily: HASH },
  qualityStatus: 'CLEAN',
  unavailableReason: null,
  ...authorization,
  ...overrides,
});

test('launch manifest candidate is byte deterministic and cannot activate', () => {
  const first = createLaunchManifestCandidate(launchInput);
  const second = createLaunchManifestCandidate(launchInput);
  assert.equal(stableJson(first), stableJson(second));
  assert.equal(first.launchStatus, 'NOT_ACTIVE');
  assert.equal(first.finalMainCommit, null);
  assert.equal(first.candidateStartTradeDate, null);
  assert.throws(() => createLaunchManifestCandidate({ ...launchInput, launchStatus: 'ACTIVE' }), /MUST_BE_NOT_ACTIVE/);
});

test('final launch builder is deterministic and can only produce READY_FOR_LAUNCH', () => {
  const input = {
    finalMainCommit: '1e8211a5a5ea2dcfdda77b57342226700c204345',
    officialStartTradeDate: '2026-08-12',
    schedulerTime: '08:25 Asia/Taipei',
    runtimeRoot: 'D:\\Taiwan stock\\standalone-v1\\data\\market-state\\forward-shadow\\run-20260812',
    runId: 'run-20260812',
    evaluator: { version: 'evaluator-v1', sha256: HASH },
    outcomeContract: { version: 'outcome-v1', sha256: HASH },
    linkageContract: { version: 'linkage-v1', sha256: HASH },
    frozenForwardGate: { version: 'gate-v1', sha256: HASH },
    selectedAxes: ['direction', 'globalAlignment'],
    ...authorization,
  };
  const first = createReadyForLaunchManifest(input);
  const second = createReadyForLaunchManifest(input);
  assert.equal(stableJson(first), stableJson(second));
  assert.equal(first.launchStatus, 'READY_FOR_LAUNCH');
  assert.equal(first.collectorActive, false);
  assert.equal(first.formalSchedulerEnabled, false);
  assert.equal(first.officialEvidenceWritten, false);
  assert.throws(() => createReadyForLaunchManifest({ ...input, runtimeRoot: 'C:\\runtime' }), /C_DRIVE_RUNTIME_FORBIDDEN/);
  assert.equal(validateReadyForLaunchManifest(first).valid, true);
  const approval = createOwnerLaunchApprovalArtifact({
    ownerDecisionReference: 'OWNER-LAUNCH-TEST',
    approvedAt: '2026-08-10T20:00:00+08:00',
    manifestHash: first.manifestHash,
    finalMainCommit: first.finalMainCommit,
    officialStartTradeDate: first.officialStartTradeDate,
    schedulerTime: first.schedulerTime,
    ...authorization,
  });
  assert.equal(validateOwnerLaunchApprovalArtifact(approval, first).valid, true);
  assert.throws(() => validateOwnerLaunchApprovalArtifact({ ...approval, manifestHash: HASH }, first), /APPROVAL_HASH_MISMATCH|APPROVAL_MANIFEST_HASH_MISMATCH/);
  const wrongManifestApproval = createOwnerLaunchApprovalArtifact({
    ...approval,
    manifestHash: HASH,
  });
  assert.throws(() => validateOwnerLaunchApprovalArtifact(wrongManifestApproval, first), /APPROVAL_MANIFEST_HASH_MISMATCH/);
  const wrongStartApproval = createOwnerLaunchApprovalArtifact({
    ...approval,
    officialStartTradeDate: '2026-08-13',
  });
  assert.throws(() => validateOwnerLaunchApprovalArtifact(wrongStartApproval, first), /APPROVAL_START_DATE_MISMATCH/);
});

test('tracked launch manifest candidate matches the deterministic generator', () => {
  const expected = stableJson(createLaunchManifestCandidate({
    ...launchInput,
    evaluator: { version: 'market-state-v1-premarket-evaluator-v0', sha256: 'a7285f53006f49ae0cd1613e2798eaca730d83d03eb980d9f5d1e095d6b512b7' },
    outcomeContract: { version: 'market-state-outcome-contract-v1', sha256: 'b5cf8434636aec5a54fdfeaa63754213495aa563f315d09e39bd1dca34580f96' },
    linkageContract: { version: 'cru18-single-axis-linkage-v1', sha256: '884afd174e6d86d9c525629138c12ae5d67316b3f904013d69e2d813ea66a081' },
    frozenForwardGate: { version: 'cru19-owner-frozen-forward-shadow-gate-v1', sha256: '85061366fe0a010b38ed1adcf9946ce78438c750974a4af56db4c28818808419' },
  }));
  const actual = fs.readFileSync(path.resolve('docs/research/MARKET_STATE_V1_FORWARD_LAUNCH_MANIFEST_CANDIDATE.json'), 'utf8');
  assert.equal(actual, expected);
  assert.equal(Buffer.from(actual).includes(13), false);
});

test('file bytes are hashed as bytes rather than JSON Buffer metadata', () => {
  const bytes = Buffer.from('frozen-artifact\n', 'utf8');
  assert.equal(digest(bytes), crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('state ledger is append-only with one official state per trade date', () => {
  const state = createStateRecord(stateInput());
  assert.equal(auditForwardShadowLedger([state]).ok, true);
  assert.throws(() => createStateRecord(stateInput(), [state]), /DUPLICATE_OFFICIAL_TRADE_DATE/);
});

test('state rejects future evidence and temporal alignment violation', () => {
  assert.throws(() => createStateRecord(stateInput({ availableAt: '2026-08-11T08:41:00+08:00' })), /FUTURE_DATA_VIOLATION/);
  assert.throws(() => createStateRecord(stateInput({ decisionAt: '2026-08-11T08:46:00+08:00' })), /TEMPORAL_ALIGNMENT_VIOLATION/);
});

test('unavailable state requires reason and remains excluded from clean evidence', () => {
  const unavailable = createStateRecord(stateInput({ qualityStatus: 'UNAVAILABLE', unavailableReason: 'SOURCE_MISSING' }));
  const audit = auditForwardShadowLedger([unavailable]);
  assert.equal(audit.cleanStateRecordCount, 0);
  assert.throws(() => createStateRecord(stateInput({ qualityStatus: 'STALE' })), /UNAVAILABLE_REASON_REQUIRED/);
  assert.throws(() => createStateRecord(stateInput({ retroactiveBackfill: true })), /RETROACTIVE_BACKFILL_FORBIDDEN/);
});

test('outcome appends by immutable state hash and cannot duplicate or mutate state', () => {
  const state = createStateRecord(stateInput());
  const outcomeInput = {
    stateRecordHash: state.recordHash,
    outcomeContract: { version: 'outcome-v1', sha256: HASH },
    outcomeAvailableAt: '2026-08-11T14:00:00+08:00',
    actualContract: '202608',
    sessionReturnBps: 12.5,
    outcomeSourceLineage: { source: 'TX_ACTUAL_CONTRACT' },
    outcomeSourceHash: HASH,
    ...authorization,
  };
  const outcome = createOutcomeRecord(outcomeInput, [state]);
  assert.equal(outcome.stateRecordHash, state.recordHash);
  assert.equal(auditForwardShadowLedger([state, outcome]).ok, true);
  assert.throws(() => createOutcomeRecord(outcomeInput, [state, outcome]), /DUPLICATE_OUTCOME/);
  const mutated = { ...state, axisStateSnapshot: { direction: 'BEARISH', globalAlignment: 'TAILWIND' } };
  assert.equal(auditForwardShadowLedger([mutated]).ok, false);
});

test('hash-chain, replay and authorization boundaries hard fail', () => {
  const state = createStateRecord(stateInput());
  const tampered = { ...state, previousHash: HASH };
  assert.equal(auditForwardShadowLedger([tampered]).ok, false);
  assert.throws(() => createStateRecord(stateInput({ executionAuthorized: true })), /AUTHORIZATION_BOUNDARY/);
});

test('outcome and evidence lineage require auditable SHA-256 hashes', () => {
  assert.throws(() => createStateRecord(stateInput({ evidenceLineage: [{ source: 'daily', availableAt: '2026-08-11T08:39:00+08:00', sourceHash: 'not-a-hash' }] })), /SOURCE_HASH_REQUIRED/);
  const state = createStateRecord(stateInput());
  assert.throws(() => createOutcomeRecord({
    stateRecordHash: state.recordHash,
    outcomeContract: { version: 'outcome-v1', sha256: 'not-a-hash' },
    outcomeAvailableAt: '2026-08-11T14:00:00+08:00',
    actualContract: '202608',
    sessionReturnBps: 1,
    outcomeSourceLineage: { source: 'TX_ACTUAL_CONTRACT' },
    outcomeSourceHash: HASH,
    ...authorization,
  }, [state]), /OUTCOME_CONTRACT_HASH_REQUIRED/);
});

test('real missed day is an administrative record without fabricated state snapshot or timestamps', () => {
  const input = {
    tradeDate: '2026-08-11',
    sessionId: '2026-08-11-DAY',
    scheduledAt: '2026-08-11T08:35:00+08:00',
    recordedAt: '2026-08-11T13:47:00+08:00',
    missedReason: 'OBSERVER_NOT_STARTED',
    ...authorization,
  };
  const first = createMissedSessionRecord(input);
  const second = createMissedSessionRecord(input);
  assert.equal(first.recordType, 'SESSION_STATUS');
  assert.equal(first.qualityStatus, 'MISSED');
  assert.equal(first.axisStateSnapshot, undefined);
  assert.equal(first.decisionAt, undefined);
  assert.equal(first.availableAt, undefined);
  assert.equal(first.evidenceLineage, undefined);
  assert.equal(first.outcomeObservationStartAt, undefined);
  assert.equal(first.recordHash, second.recordHash);
  const audit = auditForwardShadowLedger([first]);
  assert.equal(audit.ok, true);
  assert.equal(audit.missedSessionRecordCount, 1);
  assert.equal(audit.cleanStateRecordCount, 0);
});

test('missed day cannot receive outcome or later same-date clean backfill', () => {
  const missed = createMissedSessionRecord({
    tradeDate: '2026-08-11',
    sessionId: '2026-08-11-DAY',
    scheduledAt: '2026-08-11T08:35:00+08:00',
    recordedAt: '2026-08-11T13:47:00+08:00',
    missedReason: 'PC_OFFLINE',
    ...authorization,
  });
  assert.throws(() => createOutcomeRecord({
    stateRecordHash: missed.recordHash,
    outcomeContract: { version: 'outcome-v1', sha256: HASH },
    outcomeAvailableAt: '2026-08-11T14:00:00+08:00',
    actualContract: '202608',
    sessionReturnBps: 1,
    outcomeSourceLineage: { source: 'TX_ACTUAL_CONTRACT' },
    outcomeSourceHash: HASH,
    ...authorization,
  }, [missed]), /RETROACTIVE_BACKFILL_FORBIDDEN/);
  assert.throws(() => createStateRecord(stateInput(), [missed]), /DUPLICATE_OFFICIAL_TRADE_DATE/);
  assert.throws(() => createStateRecord(stateInput({ qualityStatus: 'MISSED', unavailableReason: 'OBSERVER_NOT_STARTED' })), /MISSED_REQUIRES_SESSION_STATUS/);
});

test('collector accepts preparation modes only and never activates', () => {
  for (const mode of ['DRY_RUN', 'NOT_ACTIVE', 'MANUAL_TEST', 'TEST_FIXTURE']) {
    assert.deepEqual(validateCollectorMode(mode), { mode, active: false, officialEvidenceWritten: false, executionAuthorized: false });
  }
  assert.throws(() => validateCollectorMode('FORWARD_SHADOW'), /OWNER_APPROVAL_REQUIRED/);
  assert.deepEqual(validateCollectorMode('FORWARD_SHADOW', { ownerApprovalValidated: true }), {
    mode: 'FORWARD_SHADOW', active: true, officialEvidenceWritten: false, executionAuthorized: false,
  });
  assert.throws(() => validateCollectorMode('ACTIVE'), /MODE_FORBIDDEN/);
});
