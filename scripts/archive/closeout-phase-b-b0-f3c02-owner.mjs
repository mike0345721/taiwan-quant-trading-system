import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const outDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'owner-closeout-2026-08-02-v1');
const t0Dir = path.join(root, 'data', 'research', 't0-h0-formal-v1', 'run-2026-08-02-v1');
const preregDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'preregistration-v4');
fs.mkdirSync(outDir, { recursive: true });

const hashFile = (file) => sha256Hex(fs.readFileSync(file));
const digest = (value) => sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeOnce(name, payload) {
  const file = path.join(outDir, name);
  const bytes = Buffer.from(jcsNfc(payload), 'utf8');
  const expected = sha256Hex(bytes);
  if (fs.existsSync(file)) {
    if (hashFile(file) !== expected) throw new Error(`immutable_output_mismatch:${name}`);
    return expected;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
  return expected;
}

const outputManifest = read(path.join(runDir, 'OUTPUT_MANIFEST.json'));
const protected19 = outputManifest.files.map((item) => {
  const actual = hashFile(path.join(runDir, item.name));
  if (actual !== item.sha256) throw new Error(`v4_protected_hash_mismatch:${item.name}`);
  return { name: item.name, expectedHash: item.sha256, actualHash: actual, pass: true };
});
if (protected19.length !== 19) throw new Error(`protected_file_count_mismatch:${protected19.length}`);

const artifactHashes = {
  preregistrationFreezeHash: hashFile(path.join(runDir, 'B0_F3C02_PREREGISTRATION_FREEZE_MANIFEST_V4.json')),
  contractBundleHash: hashFile(path.join(preregDir, 'B0_F3C02_EXECUTION_CONTRACT_V4.json')),
  a22ReproductionHash: hashFile(path.join(runDir, 'A22_REPRODUCTION_REPORT.json')),
  thresholdArtifactHash: hashFile(path.join(runDir, 'FOLD_THRESHOLD_ARTIFACT.json')),
  thresholdHashList: read(path.join(runDir, 'FOLD_THRESHOLD_ARTIFACT.json')).thresholds.map((row) => ({ foldId: row.foldId, thresholdHash: row.thresholdHash })),
  pairedUniverseHash: hashFile(path.join(runDir, 'PAIRED_UNIVERSE_MANIFEST.json')),
  s0s1LedgerHash: hashFile(path.join(runDir, 'VETO_LEDGER.json')),
  primaryEndpointHash: hashFile(path.join(runDir, 'PRIMARY_ENDPOINTS.json')),
  bootstrapHash: hashFile(path.join(runDir, 'BOOTSTRAP_PRIMARY_ENDPOINTS.json')),
  scorePermutationHash: hashFile(path.join(runDir, 'NEGATIVE_CONTROL_SCORE_PERMUTATION.json')),
  randomFeatureHash: hashFile(path.join(runDir, 'NEGATIVE_CONTROL_RANDOM_FEATURE.json')),
  finalDecisionHash: hashFile(path.join(runDir, 'FINAL_B0_DECISION.json')),
  outputManifestHash: hashFile(path.join(runDir, 'OUTPUT_MANIFEST.json')),
};

const ownerDecision = {
  schemaVersion: 'b0-f3c02-owner-closeout-decision-v1',
  candidateId: 'F3C02',
  b0EngineeringExecution: 'PASS',
  riskVetoEvaluation: 'REJECTED',
  evaluationStatus: 'FAIL',
  activeValidationStatus: 'CLOSED_REJECTED',
  researchOutcome: 'NEGATIVE_EVIDENCE',
  workPackage: 'CLOSED',
  negativeEvidenceRegistered: true,
  promotionEligible: false,
  signalEligible: false,
  paperEligible: false,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const ownerDecisionHash = writeOnce('PRODUCT_OWNER_CLOSEOUT_DECISION.json', ownerDecision);

const evaluation = {
  schemaVersion: 'f3c02-phase-b-evaluation-record-v1',
  candidateId: 'F3C02',
  promotionStage: 'F3_PREREGISTERED_CANDIDATE',
  testedRole: 'RISK_VETO',
  interventionType: 'NO_TRADE_VETO',
  thresholdQuantile: 0.8,
  evaluationStatus: 'FAIL',
  activeValidationStatus: 'CLOSED_REJECTED',
  researchOutcome: 'NEGATIVE_EVIDENCE',
  promotionEligible: false,
  roleRescueAuthorized: false,
  thresholdRetestAuthorized: false,
  formulaRevisionAuthorized: false,
  artifactHashes,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const evaluationHash = writeOnce('F3C02_PHASE_B_EVALUATION_RECORD.json', evaluation);

const primary = read(path.join(runDir, 'PRIMARY_ENDPOINTS.json'));
const bootstrap = read(path.join(runDir, 'BOOTSTRAP_PRIMARY_ENDPOINTS.json'));
const finalDecision = read(path.join(runDir, 'FINAL_B0_DECISION.json'));
const negativeEvidence = {
  schemaVersion: 'f3c02-negative-evidence-record-v1',
  candidateId: 'F3C02',
  evidenceRole: 'RISK_VETO',
  status: 'REJECTED',
  evaluationStatus: 'FAIL',
  sampleState: 'SUFFICIENT_SAMPLE',
  pairedSessionCount: primary.pairedSessions,
  s0PairedOriginalTrades: primary.s0PairedOriginalTrades,
  s1RetainedTrades: primary.observed.s1TradeCount,
  observed: primary.observed,
  bootstrapResults: bootstrap.results.map((row) => ({ endpointId: row.endpointId, thetaHat: row.thetaHat, gateLowerBound: row.gateLowerBound, holmAdjustedP: row.holmAdjustedP, pass: row.pass })),
  rejectionReasons: finalDecision.failures,
  rescueForbidden: true,
  promotionEligible: false,
  artifactHashes,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const negativeEvidenceHash = writeOnce('F3C02_NEGATIVE_EVIDENCE_RECORD.json', negativeEvidence);

const alignment = read(path.join(runDir, 'SESSION_ALIGNMENT_AVAILABLE_AT_AUDIT.json'));
const foldRanges = [
  { foldId: 'WF04', start: '2025-11-10', end: '2026-02-06' },
  { foldId: 'WF05', start: '2026-02-09', end: '2026-05-22' },
  { foldId: 'WF06', start: '2026-05-25', end: '2026-07-30' },
];
const unavailable = alignment.unavailable.map((row) => {
  const session = read(path.join(t0Dir, 'jobs', `${row.tradeDate}-DAY.json`));
  const foldId = foldRanges.find((fold) => row.tradeDate >= fold.start && row.tradeDate <= fold.end)?.foldId ?? null;
  const core = {
    tradeDate: row.tradeDate,
    sessionId: row.sessionId,
    settlementClass: session.settlementClass,
    rollSession: session.rollSession,
    candidateState: 'CANDIDATE_UNAVAILABLE',
    unavailableReason: 'MISSING_OOS_SCORE_AND_THRESHOLD_PAIR',
    sourceAuditReason: row.reasonCode,
    missingFeatureIds: [],
    oosScoreState: 'UNAVAILABLE',
    availableAtState: 'PASS',
    foldId,
  };
  return { ...core, evidenceHash: digest(core) };
});
if (unavailable.length !== 7) throw new Error(`candidate_unavailable_count_mismatch:${unavailable.length}`);
const allSettlement = unavailable.every((row) => row.settlementClass === 'SETTLEMENT_FINAL_CONTRACT');
const coverageAudit = {
  schemaVersion: 'b0-f3c02-paired-coverage-audit-v1',
  manifestSessionCount: 137,
  pairedSessionCount: 130,
  candidateUnavailableSessionCount: unavailable.length,
  coverageBiasWarning: allSettlement ? 'ALL_SETTLEMENT_SESSIONS_UNAVAILABLE' : 'MIXED_SESSION_UNAVAILABLE',
  unavailable,
  pairedUniverseRebuilt: false,
  imputationApplied: false,
  researchRerun: false,
};
const coverageHash = writeOnce('PAIRED_COVERAGE_AUDIT.json', coverageAudit);
writeOnce('CANDIDATE_UNAVAILABLE_SESSIONS.json', { schemaVersion: 'b0-f3c02-unavailable-sessions-v1', sessions: unavailable, logicalHash: digest(unavailable) });

const regression = {
  schemaVersion: 'b0-full-project-regression-v1',
  command: 'npm.cmd test',
  total: 256,
  passed: 256,
  failed: 0,
  cancelled: 0,
  skipped: 0,
  durationMs: 20610.4926,
  status: 'PASS',
  researchRerun: false,
  v4ProtectedFileCount: 19,
  v4HashMismatchCount: 0,
  t0ResumeStatus: 'COMPLETED_ALREADY_ZERO_WRITES',
  t0SkippedJobs: 137,
  frozenArtifactCombinedHashBefore: '9612be137be6752f995c1f777238003645d5021427370b8f5906a269ed5a93a2',
  frozenArtifactCombinedHashAfter: '9612be137be6752f995c1f777238003645d5021427370b8f5906a269ed5a93a2',
  protected19,
};
const regressionHash = writeOnce('FULL_PROJECT_REGRESSION_TEST.json', regression);

const idempotency = read(path.join(runDir, 'RESUME_IDEMPOTENCY_EVIDENCE.json'));
const frozen = read(path.join(runDir, 'FROZEN_ARTIFACT_PROTECTION_EVIDENCE.json'));
writeOnce('V4_IDEMPOTENCY_CONFIRMATION.json', { schemaVersion: 'b0-v4-idempotency-confirmation-v1', ...idempotency, sourceHash: hashFile(path.join(runDir, 'RESUME_IDEMPOTENCY_EVIDENCE.json')) });
writeOnce('FROZEN_ARTIFACT_PROTECTION_CONFIRMATION.json', { schemaVersion: 'b0-frozen-protection-confirmation-v1', ...frozen, sourceHash: hashFile(path.join(runDir, 'FROZEN_ARTIFACT_PROTECTION_EVIDENCE.json')) });

const scope = {
  schemaVersion: 'b0-owner-closeout-scope-diff-v1',
  added: ['Owner closeout decision', 'F3C02 evaluation sidecar', 'negative evidence sidecar', '7-session coverage audit', 'full regression evidence', 'final closeout manifest'],
  modifiedFrozenCandidateDefinition: false,
  modifiedPairedUniverse: false,
  reranResearch: false,
  modifiedRoadmap: false,
  startedNextCandidate: false,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const scopeHash = writeOnce('SCOPE_DIFF.json', scope);

const files = fs.readdirSync(outDir)
  .filter((name) => name !== 'FINAL_CLOSEOUT_MANIFEST.json')
  .sort()
  .map((name) => ({ name, sha256: hashFile(path.join(outDir, name)), bytes: fs.statSync(path.join(outDir, name)).size }));
const manifest = {
  schemaVersion: 'b0-f3c02-final-owner-closeout-manifest-v1',
  candidateId: 'F3C02',
  status: 'PHASE_B_B0_F3C02_FINAL_OWNER_CLOSEOUT_COMPLETE',
  engineeringStatus: 'PASS',
  researchStatus: 'REJECTED',
  negativeEvidenceRegistered: true,
  ownerDecisionHash,
  evaluationHash,
  negativeEvidenceHash,
  coverageHash,
  regressionHash,
  scopeHash,
  artifactHashes,
  files,
  aggregateLogicalHash: digest(files),
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const manifestHash = writeOnce('FINAL_CLOSEOUT_MANIFEST.json', manifest);
process.stdout.write(`${JSON.stringify({ status: manifest.status, manifestHash, regression: regression.status, unavailable: unavailable.length, coverageBiasWarning: coverageAudit.coverageBiasWarning }, null, 2)}\n`);
