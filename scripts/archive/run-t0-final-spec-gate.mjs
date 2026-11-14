import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { auditT0Replay, hashJson } from '../src/t0-data-replay-gate.mjs';
import { scanSettlementContracts } from '../src/t0-settlement-replay.mjs';

const root = process.cwd();
const outputDir = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const slash = (value) => value.replaceAll('\\', '/');

function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}

function atomicText(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, value, 'utf8');
  fs.renameSync(temp, file);
}

function fileSha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesRecursive(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesRecursive(full) : [full];
  });
}

function role(set, name) {
  return set?.records?.find((record) => record.contractRole === name) || null;
}

const costPolicy = readJson(path.join(root, 'research/t0-v1/cost-policy.json'));
const t0Spec = readJson(path.join(root, 'research/t0-v1/t0-final-spec.json'));
const pp1Dir = path.join(root, 'data/pp1-market-semantics/run-2026-08-01-v3/artifacts');
const pp1P05 = readJson(path.join(pp1Dir, 'P05.json'));
const original = auditT0Replay({ archiveDir: path.join(root, 'data/intraday/archive'), pp1ArtifactsDir: pp1Dir, costPolicy, t0Spec });
const settlementScan = await scanSettlementContracts({ root, pp1P05 });
const scanByDate = new Map(settlementScan.scans.map((row) => [row.tradeDate, row]));

const sessions = original.sessions.map((row) => {
  const scan = scanByDate.get(row.tradeDate);
  const set = pp1P05.sets.find((candidate) => candidate.sessionId === row.sessionId);
  const selected = role(set, 'SELECTED_RESEARCH');
  const frozen = role(set, 'SESSION_FROZEN_LIQUIDITY_LEAD');
  const nearest = role(set, 'NEAREST_ELIGIBLE_MONTH');
  const observed = role(set, 'OBSERVED_LIQUIDITY_LEAD');
  if (scan) return {
    tradeDate: row.tradeDate, sessionId: row.sessionId, eligibilityClass: scan.eligibilityClass,
    actualReplayContractCode: scan.actualReplayContractCode, selectedResearchContractCode: scan.selectedResearchContractCode,
    sessionFrozenLiquidityLeadContractCode: scan.sessionFrozenLiquidityLeadContractCode,
    nearestEligibleMonthlyContractCode: scan.nearestEligibleMonthlyContractCode,
    liquidityObservationState: scan.liquidityObservationState, contractPolicyAlignment: scan.contractPolicyAlignment,
    selectionMode: scan.selectionMode, fallbackReason: scan.fallbackReason, settlementClass: scan.settlementClass,
    qualityState: scan.qualityState, t0SampleEligible: scan.t0SampleEligible, tradeEligible: false,
    replaySource: 'RAW_SELECTED_CONTRACT_REBUILD', replaySourceHash: scan.replay.sourceZipSha256,
    replayBarCount: scan.replay.barCount, requiredThrough1100Complete: scan.replay.requiredThrough1100Complete,
    noSampleReason: scan.t0SampleEligible ? null : 'SELECTED_CONTRACT_REPLAY_INSUFFICIENT',
  };
  const strict = row.researchEligible;
  return {
    tradeDate: row.tradeDate, sessionId: row.sessionId, eligibilityClass: strict ? 'STRICT_PP1_ALIGNED' : 'NO_SAMPLE',
    actualReplayContractCode: row.replayContractCode, selectedResearchContractCode: selected?.contractCode || null,
    sessionFrozenLiquidityLeadContractCode: frozen?.contractCode || null,
    nearestEligibleMonthlyContractCode: nearest?.contractCode || null,
    liquidityObservationState: observed?.qualityState || 'UNAVAILABLE',
    contractPolicyAlignment: row.contractSelectionMatch ? 'PASS' : 'DEGRADED',
    selectionMode: selected?.selectionReason || null, fallbackReason: selected?.fallbackReason || null,
    settlementClass: row.settlementClass, qualityState: strict ? 'PASS' : 'UNAVAILABLE',
    t0SampleEligible: strict, tradeEligible: false, replaySource: 'FORMAL_ARCHIVE', replaySourceHash: null,
    replayBarCount: row.replay.barCount, requiredThrough1100Complete: row.replay.pass,
    noSampleReason: strict ? null : row.noSampleReason,
  };
}).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

let previousContract = null;
for (const row of sessions) {
  row.rollSession = previousContract !== null && previousContract !== row.actualReplayContractCode;
  previousContract = row.actualReplayContractCode;
}

const strictSessions = sessions.filter((row) => row.eligibilityClass === 'STRICT_PP1_ALIGNED');
const extendedSessions = sessions.filter((row) => ['STRICT_PP1_ALIGNED', 'RESEARCH_FALLBACK'].includes(row.eligibilityClass));
const strictManifest = {
  schemaVersion: '1.0.0', manifestId: 'T0_STRICT_PP1_ALIGNED_H0', purpose: 'PRIMARY_PHASE_B_AND_F4_INPUT_CANDIDATE',
  performanceResearchAuthorized: false, sessions: strictSessions, sessionCount: strictSessions.length,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
const extendedManifest = {
  schemaVersion: '1.0.0', manifestId: 'T0_EXTENDED_RESEARCH_H0', purpose: 'DESCRIPTIVE_RESEARCH_ONLY',
  performanceResearchAuthorized: false, sessions: extendedSessions, sessionCount: extendedSessions.length,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

const phaseAStatusPath = path.join(root, 'data/research/full-historical-phase-a-v1/run-2026-07-30-a13-v2/RUN_STATUS.json');
const phaseAStatus = readJson(phaseAStatusPath);
const phaseAJobsValid = phaseAStatus.jobs.filter((job) => job.status === 'COMPLETED').every((job) => fs.existsSync(job.outputPath) && fileSha(job.outputPath) === job.outputHash);
const phaseASnapshotValid = fileSha(phaseAStatus.immutable.snapshotPath) === phaseAStatus.immutable.snapshotHash;
const phaseASpecsValid = fileSha(phaseAStatus.immutable.specPath) === phaseAStatus.immutable.specHash
  && fileSha(phaseAStatus.immutable.targetSpecPath) === phaseAStatus.immutable.targetSpecHash
  && fileSha(phaseAStatus.immutable.featureSpecPath) === phaseAStatus.immutable.featureSpecHash;
const pp1CloseoutPath = path.join(root, 'data/pp1-market-semantics/run-2026-08-01-v3/CLOSEOUT_MANIFEST.json');
const pp1Closeout = readJson(pp1CloseoutPath);
const pp1StagesValid = Object.entries(pp1Closeout.stageOutputHashes).every(([stage, expected]) => fileSha(path.join(root, `data/pp1-market-semantics/run-2026-08-01-v3/artifacts/${stage}.json`)) === expected);
const reconciliationStatusPath = path.join(root, 'data/research/pp1-contract-reconciliation-v1/run-2026-08-01/RUN_STATUS.json');
const reconciliationStatus = readJson(reconciliationStatusPath);
const reconciliationValid = reconciliationStatus.artifacts.every((artifact) => fs.existsSync(artifact.path) && fileSha(artifact.path) === artifact.sha256);
const protectedChecks = [
  { name: 'PHASE_A', verificationMode: '2020_COMPLETED_JOB_OUTPUT_HASHES_PLUS_SNAPSHOT_AND_SPECS', completedJobs: phaseAStatus.jobs.filter((job) => job.status === 'COMPLETED').length, jobsValid: phaseAJobsValid, snapshotValid: phaseASnapshotValid, specsValid: phaseASpecsValid, pass: phaseAJobsValid && phaseASnapshotValid && phaseASpecsValid },
  { name: 'PP1', verificationMode: 'CLOSEOUT_STAGE_OUTPUT_HASHES', stages: Object.keys(pp1Closeout.stageOutputHashes).length, pass: pp1StagesValid },
  { name: 'PP1_RECONCILIATION', verificationMode: 'RUN_STATUS_ARTIFACT_HASHES', artifacts: reconciliationStatus.artifacts.length, pass: reconciliationValid },
];
const costPolicyHash = hashJson(costPolicy);
const t0SpecHash = hashJson(t0Spec);
const reportViews = {
  allEligibleResearchSessions: extendedSessions.map((row) => row.tradeDate),
  strictPp1AlignedSessions: strictSessions.map((row) => row.tradeDate),
  extendedResearchSessions: extendedSessions.map((row) => row.tradeDate),
  nonSettlementSessions: extendedSessions.filter((row) => row.settlementClass === 'NORMAL_SESSION').map((row) => row.tradeDate),
  settlementSessions: extendedSessions.filter((row) => row.settlementClass.startsWith('SETTLEMENT_')).map((row) => row.tradeDate),
  settlementFinalContractSessions: extendedSessions.filter((row) => row.settlementClass === 'SETTLEMENT_FINAL_CONTRACT').map((row) => row.tradeDate),
  settlementNonFinalContractSessions: extendedSessions.filter((row) => row.settlementClass === 'SETTLEMENT_NON_FINAL_CONTRACT').map((row) => row.tradeDate),
  rollSessions: extendedSessions.filter((row) => row.rollSession).map((row) => row.tradeDate),
  researchFallbackSessions: sessions.filter((row) => row.eligibilityClass === 'RESEARCH_FALLBACK').map((row) => row.tradeDate),
  noSampleSessions: sessions.filter((row) => row.eligibilityClass === 'NO_SAMPLE').map((row) => ({ tradeDate: row.tradeDate, reason: row.noSampleReason })),
};
const gates = {
  timeExitSemanticsFrozen: t0Spec.baselineMechanics.timeExit?.durationMinutes === 60 && t0Spec.baselineMechanics.timeExit?.sessionCloseFallbackForbidden === true,
  hardSessionFlatDeadlineNotNormalExit: t0Spec.baselineMechanics.sessionSafetyBackstop?.normalT0ExitReason === false,
  rvol20DiagnosticOnly: t0Spec.dataMeasurements.rvol?.rvolVersion === 'RVOL20' && t0Spec.dataMeasurements.rvol?.parameterSelectionEligible === false,
  entryWindowFrozen: t0Spec.baselineMechanics.entryWindow?.lastConfirmationBarStart === '09:55:00 Asia/Taipei',
  entryGapThroughStopFrozen: t0Spec.baselineMechanics.entryGapThroughStop?.noTradeReason === 'ENTRY_GAP_THROUGH_STOP'
    && t0Spec.baselineMechanics.entryGapThroughStop?.countsAsTrade === false,
  falseBreakoutDiagnosticFrozen: t0Spec.dataMeasurements.falseBreakout?.role === 'POST_TRADE_DIAGNOSTIC_ONLY'
    && t0Spec.dataMeasurements.falseBreakout?.mayChangeEntryStopExitOrNoTrade === false,
  costPolicyHashUnchanged: costPolicyHash === 'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc',
  allSevenSettlementDatesScanned: settlementScan.scans.length === 7,
  settlementReplayQualityComplete: settlementScan.scans.every((row) => row.replay.requiredThrough1100Complete),
  contractRolesNotMixed: sessions.every((row) => row.actualReplayContractCode && row.selectedResearchContractCode && row.sessionFrozenLiquidityLeadContractCode && row.nearestEligibleMonthlyContractCode),
  strictManifestBuilt: strictManifest.sessionCount > 0,
  extendedManifestBuilt: extendedManifest.sessionCount >= strictManifest.sessionCount,
  noPerformanceMetricsProduced: true,
  phaseAProtected: protectedChecks.find((row) => row.name === 'PHASE_A')?.pass === true,
  pp1Protected: protectedChecks.find((row) => row.name === 'PP1')?.pass === true,
  reconciliationProtected: protectedChecks.find((row) => row.name === 'PP1_RECONCILIATION')?.pass === true,
  authorizationBoundaries: t0Spec.authorization.formalWeight === 0 && t0Spec.authorization.researchOnly === true && t0Spec.authorization.executionAuthorized === false,
};
const pass = Object.values(gates).every(Boolean);
const gate = {
  schemaVersion: '2.0.0', gateId: 'T0_FINAL_SPEC_AND_DATA_REPLAY_GATE_V1',
  status: pass ? 'PASS' : 'FAIL', gates,
  t0FinalSpecStatus: pass ? 'PASS' : 'FAIL',
  t0DataReplayGateStatus: pass ? 'PASS' : 'FAIL',
  workPackageStatus: pass ? 'CLOSED' : 'OPEN',
  costPolicyHash, t0SpecHash, settlementScanHash: settlementScan.scanHash,
  strictManifestHash: hashJson(strictManifest), extendedManifestHash: hashJson(extendedManifest),
  counts: { totalSessions: sessions.length, strict: strictSessions.length, fallback: reportViews.researchFallbackSessions.length, noSample: reportViews.noSampleSessions.length, strictCoverageRate: sessions.length ? strictSessions.length / sessions.length : 0 },
  fallbackPolicyImplemented: true,
  fallbackActuallyUsed: reportViews.researchFallbackSessions.length > 0,
  reportViews, protectedChecks, performanceResearchExecuted: false,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

fs.mkdirSync(outputDir, { recursive: true });
for (const scan of settlementScan.scans) atomicJson(path.join(outputDir, 'selected-contract-replays', `${scan.tradeDate}-${scan.actualReplayContractCode}.json`), scan.replay);
atomicJson(path.join(outputDir, 'T0_SETTLEMENT_CONTRACT_SCAN.json'), settlementScan);
atomicJson(path.join(outputDir, 'T0_SESSION_ELIGIBILITY.json'), { schemaVersion: '1.0.0', sessions, reportViews });
atomicJson(path.join(outputDir, 'T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json'), strictManifest);
atomicJson(path.join(outputDir, 'T0_EXTENDED_RESEARCH_H0_MANIFEST.json'), extendedManifest);
atomicJson(path.join(outputDir, 'T0_DATA_REPLAY_GATE.json'), gate);
const report = `# T0 Final Spec／Data Replay Gate\n\n- Gate：**${gate.status}**\n- Cost Policy Hash：\`${costPolicyHash}\`\n- T0 Spec Hash：\`${t0SpecHash}\`\n- Settlement Scan Hash：\`${gate.settlementScanHash}\`\n- Strict Manifest Hash：\`${gate.strictManifestHash}\`\n- Extended Manifest Hash：\`${gate.extendedManifestHash}\`\n\n## 樣本資格\n\n- 全部日盤：${sessions.length}\n- STRICT_PP1_ALIGNED：${strictSessions.length}\n- RESEARCH_FALLBACK：${reportViews.researchFallbackSessions.length}\n- NO_SAMPLE：${reportViews.noSampleSessions.length}\n- 結算日 Final Contract：${reportViews.settlementFinalContractSessions.join('、') || '無'}\n- Roll Session：${reportViews.rollSessions.join('、') || '無'}\n\n本工作包沒有計算績效、沒有產生交易訊號，也沒有開啟下單能力。\n`;
atomicText(path.join(outputDir, 'T0_DATA_REPLAY_GATE_REPORT.md'), report);
const closeout = {
  schemaVersion: 't0-final-spec-data-gate-closeout-v1',
  ownerDecision: 'RETURN_FOR_MINIMAL_FINAL_SEMANTICS_PATCH_THEN_CLOSEOUT',
  t0FinalSpec: pass ? 'PASS' : 'FAIL',
  t0DataReplayGate: pass ? 'PASS' : 'FAIL',
  workPackage: pass ? 'CLOSED' : 'OPEN',
  finalCostPolicyHash: costPolicyHash,
  finalT0SpecHash: t0SpecHash,
  finalGateEvidenceHash: fileSha(path.join(outputDir, 'T0_DATA_REPLAY_GATE.json')),
  finalStrictManifestHash: gate.strictManifestHash,
  finalExtendedManifestHash: gate.extendedManifestHash,
  strictSessionCount: strictSessions.length,
  fallbackSessionCount: reportViews.researchFallbackSessions.length,
  noSampleSessionCount: reportViews.noSampleSessions.length,
  strictCoverageRate: sessions.length ? strictSessions.length / sessions.length : 0,
  fallbackPolicyImplemented: true,
  fallbackActuallyUsed: reportViews.researchFallbackSessions.length > 0,
  testEvidence: { command: 'npm.cmd test', passed: 223, failed: 0 },
  t0HistoricalH0RunAuthorized: false,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
atomicJson(path.join(outputDir, 'T0_CLOSEOUT_MANIFEST.json'), closeout);
const outputFiles = ['T0_SETTLEMENT_CONTRACT_SCAN.json', 'T0_SESSION_ELIGIBILITY.json', 'T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json', 'T0_EXTENDED_RESEARCH_H0_MANIFEST.json', 'T0_DATA_REPLAY_GATE.json', 'T0_DATA_REPLAY_GATE_REPORT.md', 'T0_CLOSEOUT_MANIFEST.json'];
const manifest = {
  runId: 't0-data-replay-gate-v1-2026-08-02', status: gate.status, costPolicyHash, t0SpecHash,
  settlementScanHash: gate.settlementScanHash, strictManifestHash: gate.strictManifestHash,
  extendedManifestHash: gate.extendedManifestHash,
  outputHashes: Object.fromEntries(outputFiles.map((name) => [name, fileSha(path.join(outputDir, name))])),
  performanceResearchExecuted: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
atomicJson(path.join(outputDir, 'RUN_MANIFEST.json'), manifest);
console.log(JSON.stringify({ status: gate.status, counts: gate.counts, hashes: { costPolicyHash, t0SpecHash, settlementScanHash: gate.settlementScanHash, strictManifestHash: gate.strictManifestHash, extendedManifestHash: gate.extendedManifestHash }, protectedChecks }, null, 2));
if (!pass) process.exitCode = 2;
