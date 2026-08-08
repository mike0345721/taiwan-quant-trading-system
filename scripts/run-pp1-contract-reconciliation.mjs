import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildDailyTargets } from '../src/phase-a-univariate.mjs';
import {
  CONTRACT_SENSITIVE_FACTORS,
  buildReconciledSourceSeries,
  diffRows,
  factorQuality,
  patchCanonicalFeatures,
  pp1DaySelections,
  reconcileDownstream,
  rerunSensitiveRound1,
  stableHash,
  summarizeStudy,
} from '../src/pp1-contract-reconciliation.mjs';
import { atomicWriteFile, sha256File } from '../src/restartable-research-runner.mjs';

const root = path.resolve(import.meta.dirname, '..');
const phaseARun = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
const pp1Run = path.join(root, 'data', 'pp1-market-semantics', 'run-2026-08-01-v3');
const outputDir = path.join(root, 'data', 'research', 'pp1-contract-reconciliation-v1', 'run-2026-08-01');
const reconciliationRunId = 'pp1-contract-reconciliation-v1-2026-08-01';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function deterministicWrite(file, content) {
  const buffer = Buffer.from(content, 'utf8');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (!existing.equals(buffer)) throw new Error(`immutable_reconciliation_output_mismatch:${file}`);
    return false;
  }
  atomicWriteFile(file, buffer, { overwrite: false });
  return true;
}
function writeJson(file, value) { return deterministicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }

function verifyFile(file, expected, label) {
  if (!fs.existsSync(file)) throw new Error(`${label}_missing:${file}`);
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`${label}_hash_mismatch:${actual}:${expected}`);
  return actual;
}

function verifyPhaseA() {
  const statusFile = path.join(phaseARun, 'RUN_STATUS.json');
  const status = readJson(statusFile);
  if (status.runId !== 'full-historical-phase-a-v1-2026-07-30') throw new Error('phase_a_run_id_mismatch');
  if (status.jobs.length !== 2020 || status.jobs.some((job) => job.status !== 'COMPLETED')) throw new Error('phase_a_not_closed_2020');
  verifyFile(status.immutable.snapshotPath, status.immutable.snapshotHash, 'snapshot');
  verifyFile(status.immutable.specPath, status.immutable.specHash, 'research_spec');
  verifyFile(status.immutable.targetSpecPath, status.immutable.targetSpecHash, 'target_spec');
  verifyFile(status.immutable.featureSpecPath, status.immutable.featureSpecHash, 'feature_spec');
  const rows = [];
  for (const job of status.jobs) {
    verifyFile(job.outputPath, job.outputHash, `phase_a_output_${job.key}`);
    rows.push({ key: job.key, outputHash: job.outputHash });
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));
  return {
    status,
    fingerprint: {
      runId: status.runId,
      snapshotHash: status.immutable.snapshotHash,
      researchSpecHash: status.immutable.specHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureSpecHash: status.immutable.featureSpecHash,
      featureVersion: status.immutable.featureVersion,
      targetVersion: status.immutable.targetVersion,
      randomSeed: status.immutable.randomSeed,
      completedJobs: status.jobs.length,
      completedOutputAggregateHash: stableHash(rows),
      phaseAEvidenceHash: sha256File(path.join(phaseARun, 'reports', 'PHASE_A_EVIDENCE.json')),
    },
  };
}

function loadPhaseAData(status) {
  const manifest = status.jobs.find((job) => job.stage === 'A11' && job.factorId === '__MANIFEST__');
  const featureDb = new DatabaseSync(manifest.outputPath, { readOnly: true });
  let featureRows;
  try {
    featureRows = featureDb.prepare(`SELECT decision_trade_date AS decisionTradeDate,
      decision_at AS decisionAt, factor_id AS factorId, base_factor_id AS baseFactorId,
      factor_group AS factorGroup, transform, value, source_trade_date AS sourceTradeDate,
      available_at AS availableAt, source_table AS sourceTable, source_contract AS sourceContract,
      quality_state AS qualityState, quality_reason AS qualityReason, formula,
      transform_formula AS transformFormula, feature_version AS featureVersion
      FROM canonical_features ORDER BY decision_trade_date,factor_id`).all();
  } finally { featureDb.close(); }
  const db = new DatabaseSync(status.immutable.snapshotPath, { readOnly: true });
  try {
    const marketRows = db.prepare('SELECT * FROM market_daily ORDER BY trade_date').all();
    const contractRows = db.prepare("SELECT * FROM futures_contract_daily WHERE product='TX' ORDER BY trade_date,contract").all();
    const oldOiRows = db.prepare('SELECT * FROM futures_oi_daily ORDER BY trade_date').all();
    const oldBasisRows = db.prepare('SELECT * FROM basis_term_structure_daily ORDER BY trade_date').all();
    return {
      featureRows,
      marketRows,
      contractRows,
      oldOiRows,
      oldBasisRows,
      spotRows: marketRows,
      targetRows: buildDailyTargets({ marketRows, futuresContractRows: contractRows, futuresOiRows: oldOiRows }),
    };
  } finally { db.close(); }
}

function stagePayload(status, stage) {
  const job = status.jobs.find((item) => item.stage === stage);
  if (!job) throw new Error(`phase_a_stage_missing:${stage}`);
  return readJson(job.outputPath);
}

function originalRound1(status) {
  const a12ByKey = new Map();
  const thresholdsByTarget = {};
  for (const job of status.jobs.filter((item) => item.stage === 'A12' && item.factorId !== '__SUMMARY__')) {
    const payload = readJson(job.outputPath);
    a12ByKey.set(`${payload.factorId}::${payload.targetId}`, payload);
    if (!thresholdsByTarget[payload.targetId]) thresholdsByTarget[payload.targetId] = payload.thresholdsFromDevelopmentOnly;
  }
  const summary = readJson(status.jobs.find((item) => item.stage === 'A13' && item.factorId === '__SUMMARY__').outputPath);
  return {
    a12ByKey,
    thresholdsByTarget,
    eligible: summary.provisionalRound2Candidates.map((row) => ({ ...row, computeAllocationEligible: true })),
  };
}

function mapsBy(rows, keyFn) { return new Map(rows.map((row) => [keyFn(row), row])); }
function diffList(oldRows, newRows, keyFn) {
  const oldMap = mapsBy(oldRows, keyFn); const newMap = mapsBy(newRows, keyFn);
  const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  return keys.filter((key) => stableHash(oldMap.get(key) || null) !== stableHash(newMap.get(key) || null))
    .map((key) => ({ key, old: oldMap.get(key) || null, reconciled: newMap.get(key) || null }));
}

function factorStates({ oldBoard, newQuality, combinedStrong, candidates }) {
  const oldMap = mapsBy(oldBoard, (row) => row.factorId);
  const qualityMap = mapsBy(newQuality, (row) => row.factorId);
  const candidateMap = new Map();
  for (const candidate of candidates.candidates) for (const factor of candidate.factors) candidateMap.set(factor, candidate);
  const strongMap = new Map();
  for (const study of combinedStrong.studies) for (const factor of study.factors) {
    if (!strongMap.has(factor)) strongMap.set(factor, []);
    strongMap.get(factor).push(study);
  }
  return CONTRACT_SENSITIVE_FACTORS.map((factorId) => {
    const old = oldMap.get(factorId);
    const quality = qualityMap.get(factorId);
    const candidate = candidateMap.get(factorId) || null;
    const strong = strongMap.get(factorId) || [];
    const recalculatedF2Status = strong.some((study) => study.strongControlPass) ? 'PASS' : 'FAIL';
    const wasCandidate = old?.promotionStage === 'F3';
    const remainsCandidate = wasCandidate && Boolean(candidate);
    const effectiveEvaluationStatus = remainsCandidate ? 'PENDING'
      : old?.evaluationStatus === 'PASS' && recalculatedF2Status === 'FAIL' ? 'FAIL'
        : old?.evaluationStatus === 'FAIL' && recalculatedF2Status === 'PASS' ? 'FAIL'
          : recalculatedF2Status;
    const effectivePromotionStage = remainsCandidate ? 'F3' : 'F2';
    const revised = {
      promotionStage: effectivePromotionStage,
      evaluationStatus: effectiveEvaluationStatus,
      recalculatedF2Status,
      recalculatedCandidate: Boolean(candidate),
      promotionUpgradeBlocked: !wasCandidate && Boolean(candidate),
      historicalEvidence: remainsCandidate ? 'MIXED_REQUIRES_PREREGISTRATION' : effectiveEvaluationStatus === 'PASS' ? 'POSITIVE' : 'NEGATIVE',
      evidenceRole: remainsCandidate ? 'Preregistration Candidate' : old?.evidenceRole || 'Direction_or_Regime',
      promotionEligible: false,
      contractPolicyStatus: 'RECONCILED',
      requiresPP1Reconciliation: false,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
    return { factorId, old, quality, reconciled: revised };
  });
}

function reportMarkdown(evidence) {
  const counts = evidence.perFactorResults.reduce((result, row) => {
    result[row.reconciliationStatus] = (result[row.reconciliationStatus] || 0) + 1; return result;
  }, {});
  const lines = [
    '# PP-1 Contract-Sensitive Reconciliation v1', '',
    `- Reconciliation Run：${evidence.reconciliationRunId}`,
    `- Phase A Run：${evidence.phaseARunId}`,
    `- PP-1 Policy Hash：${evidence.pp1PolicySpecHash}`,
    `- 受影響契約選擇日期：${evidence.affectedTradeDates.length}`,
    `- 實際變動因子列：${evidence.changedFactorValues.length}`,
    `- 下游受影響 Evidence Blocks：${evidence.changedEvidenceBlockInputs.length}`,
    `- 安全邊界：formalWeight=0、researchOnly=true、executionAuthorized=false`, '',
    '## 因子判定', '',
    '| 因子 | Reconciliation 狀態 | F1變動 | F2變動 | F3候選變動 |',
    '|---|---|---|---|---|',
    ...evidence.perFactorResults.map((row) => `| ${row.factorId} | ${row.reconciliationStatus} | ${row.changedF1 ? 'YES' : 'NO'} | ${row.changedF2 ? 'YES' : 'NO'} | ${row.changedF3 ? 'YES' : 'NO'} |`), '',
    '## 狀態統計', '',
    ...Object.entries(counts).sort().map(([key, value]) => `- ${key}: ${value}`), '',
    '## 解讀限制', '',
    '- 本 Sidecar 不覆寫 Phase A 原始證據，只提供 PP-1 契約政策下的校正版視圖。',
    '- 本結果不得升級任何 Promotion Stage，也不得解讀為已證明 Edge。',
    '- 只重算契約敏感因子及其真正受影響的下游分析；Target、視窗、模型、門檻與 Seed 均未改變。',
    '- 所有正式權重維持 0，且 executionAuthorized=false。', '',
  ];
  return lines.join('\n');
}

function main() {
  const before = verifyPhaseA();
  const pp1Policy = path.join(root, 'research', 'pp1-v1', 'policy-spec.json');
  const pp1PolicySpecHash = sha256File(pp1Policy);
  const p09 = readJson(path.join(pp1Run, 'artifacts', 'P09.json'));
  if (p09.phaseARunId !== before.status.runId) throw new Error('pp1_sidecar_phase_a_run_mismatch');
  if (p09.factorArtifacts.map((row) => row.factorId).sort().join('|') !== [...CONTRACT_SENSITIVE_FACTORS].sort().join('|')) throw new Error('contract_sensitive_factor_scope_mismatch');
  for (const item of p09.factorArtifacts) verifyFile(item.originalArtifactPath, item.originalArtifactHash, `original_factor_${item.factorId}`);
  const p05 = readJson(path.join(pp1Run, 'artifacts', 'P05.json'));
  const dates = p09.affectedTradeDates.map((row) => row.tradeDate);
  const selections = pp1DaySelections(p05.sets, dates);
  if (selections.length !== dates.length || selections.some((row) => row.policySpecHash !== pp1PolicySpecHash)) throw new Error('pp1_selection_coverage_or_policy_hash_mismatch');
  const data = loadPhaseAData(before.status);
  const sourceSeries = buildReconciledSourceSeries({
    contractRows: data.contractRows,
    spotRows: data.spotRows,
    oldBasisRows: data.oldBasisRows,
    oldOiRows: data.oldOiRows,
    selections,
  });
  const newFeatureRows = patchCanonicalFeatures(data.featureRows, sourceSeries);
  const changes = diffRows(data.featureRows, newFeatureRows);
  const oldQuality = CONTRACT_SENSITIVE_FACTORS.map((factorId) => readJson(path.join(phaseARun, 'jobs', `A10-${factorId}.json`)));
  const newQuality = factorQuality(newFeatureRows);
  const round1 = originalRound1(before.status);
  const rerunRound1 = rerunSensitiveRound1({
    featureRows: newFeatureRows,
    targetRows: data.targetRows,
    oldA12ByKey: round1.a12ByKey,
    randomSeed: before.status.immutable.randomSeed,
  });
  const oldA20 = stagePayload(before.status, 'A20').redundancy;
  const oldA21 = stagePayload(before.status, 'A21').evidenceBlocks;
  const oldA22 = stagePayload(before.status, 'A22').walkForward;
  const oldA23 = stagePayload(before.status, 'A23').strongControls;
  const oldA30 = stagePayload(before.status, 'A30').f3Candidates;
  const downstream = reconcileDownstream({
    oldFeatureRows: data.featureRows,
    newFeatureRows,
    targetRows: data.targetRows,
    targetSpec: readJson(before.status.immutable.targetSpecPath),
    thresholdsByTarget: round1.thresholdsByTarget,
    oldA13Eligible: round1.eligible,
    newSensitiveA13: rerunRound1.a13,
    oldRedundancy: oldA20,
    oldEvidenceBlocks: oldA21,
    oldWalkForward: oldA22,
    oldStrongControls: oldA23,
    oldCandidates: oldA30,
    randomSeed: before.status.immutable.randomSeed,
  });
  const oldBoard = stagePayload(before.status, 'A33').promotionBoard.board;
  const states = factorStates({ oldBoard, newQuality, combinedStrong: downstream.combinedStrong, candidates: downstream.candidates });
  const oldQualityMap = mapsBy(oldQuality, (row) => row.factorId);
  const newQualityMap = mapsBy(newQuality, (row) => row.factorId);
  const changesByFactor = new Map(CONTRACT_SENSITIVE_FACTORS.map((factorId) => [factorId, changes.filter((row) => row.factorId === factorId)]));
  const oldCandidateFactors = new Set(oldA30.candidates.flatMap((row) => row.factors));
  const newCandidateFactors = new Set(downstream.candidates.candidates.flatMap((row) => row.factors));
  const perFactorResults = states.map((state) => {
    const changedF1 = oldQualityMap.get(state.factorId)?.qualityState !== newQualityMap.get(state.factorId)?.qualityState;
    const changedF2 = state.old?.evaluationStatus !== state.reconciled.evaluationStatus || state.old?.promotionStage !== state.reconciled.promotionStage;
    const recalculatedF2Changed = state.old?.evaluationStatus !== state.reconciled.recalculatedF2Status;
    const changedF3 = oldCandidateFactors.has(state.factorId) !== newCandidateFactors.has(state.factorId);
    const factorChanges = changesByFactor.get(state.factorId);
    const unavailable = newQualityMap.get(state.factorId)?.validObservations === 0;
    const materialDowngrade = changedF1 || changedF2 || (oldCandidateFactors.has(state.factorId) && !newCandidateFactors.has(state.factorId));
    return {
      factorId: state.factorId,
      reconciliationStatus: unavailable ? 'UNAVAILABLE'
        : materialDowngrade ? 'MATERIAL_CHANGE_REQUIRES_DOWNGRADE'
          : factorChanges.length ? 'PASS_WITH_NON_MATERIAL_CHANGES'
            : 'PASS_NO_MATERIAL_CHANGE',
      changedValueCount: factorChanges.length,
      changedF1,
      changedF2,
      recalculatedF2Changed,
      changedF3,
      originalPromotionStage: state.old?.promotionStage || null,
      reconciledPromotionStage: state.reconciled.promotionStage,
      originalEvaluationStatus: state.old?.evaluationStatus || null,
      reconciledEvaluationStatus: state.reconciled.evaluationStatus,
      recalculatedF2Status: state.reconciled.recalculatedF2Status,
      promotionUpgradeBlocked: state.reconciled.promotionUpgradeBlocked,
      promotionEligible: false,
    };
  });
  const oldSelections = p09.affectedTradeDates.map((row) => ({ tradeDate: row.tradeDate, contractCode: row.phaseAContractCode }));
  const newSelections = selections.map((row) => ({ ...row }));
  const oldClusters = oldA20.clusters;
  const newClusters = downstream.redundancy.clusters;
  const clusterDiffs = diffList(oldClusters, newClusters, (row) => row.members.join('|'))
    .filter((row) => [...(row.old?.members || []), ...(row.reconciled?.members || [])].some((factor) => CONTRACT_SENSITIVE_FACTORS.includes(factor)));
  const blockDiffs = diffList(oldA21.blocks, downstream.evidenceBlocks.blocks, (row) => row.blockId)
    .filter((row) => downstream.affectedBlockIds.includes(row.key));
  const oldStudies = mapsBy(oldA22.studies, (row) => `${row.blockId}::${row.modelId}`);
  const newStudies = mapsBy(downstream.combinedWalkForward.studies, (row) => `${row.blockId}::${row.modelId}`);
  const walkDiffs = [...new Set([...oldStudies.keys(), ...newStudies.keys()])].sort()
    .filter((key) => downstream.affectedBlockIds.includes((newStudies.get(key) || oldStudies.get(key)).blockId))
    .map((key) => ({ key, old: summarizeStudy(oldStudies.get(key)), reconciled: summarizeStudy(newStudies.get(key)) }))
    .filter((row) => row.old?.digest !== row.reconciled?.digest);
  const stateDiffs = states.filter((row) => row.old?.evaluationStatus !== row.reconciled.evaluationStatus || row.old?.promotionStage !== row.reconciled.promotionStage);
  const oldCandidateSummary = oldA30.candidates.map((row) => ({ candidateId: row.candidateId, studyId: row.studyId, factors: row.factors, evaluationStatus: row.evaluationStatus, promotionEligible: row.promotionEligible }));
  const newCandidateSummary = downstream.candidates.candidates.map((row) => ({ candidateId: row.candidateId, studyId: row.studyId, factors: row.factors, evaluationStatus: row.evaluationStatus, promotionEligible: row.promotionEligible }));
  const recalculatedCandidateStudyIds = new Set(newCandidateSummary.map((row) => row.studyId));
  const effectiveCandidateSummary = oldCandidateSummary.filter((row) => recalculatedCandidateStudyIds.has(row.studyId));
  const evidence = {
    schemaVersion: 'pp1-contract-sensitive-reconciliation-evidence-v1',
    reconciliationRunId,
    phaseARunId: before.status.runId,
    originalEvidenceHash: before.fingerprint.phaseAEvidenceHash,
    pp1PolicySpecHash,
    immutableResearchFingerprint: before.fingerprint,
    affectedTradeDates: dates,
    minimalCalculationScope: {
      directlyChangedSelectionDates: dates,
      actuallyChangedSourceDates: sourceSeries.changedSourceDates,
      rule: 'Only 12 contract-sensitive factors; 1d/5d/60d effects propagate only where the frozen formulas actually change values.',
    },
    oldContractSelections: oldSelections,
    pp1ContractSelections: newSelections,
    changedContractSelections: dates.map((tradeDate) => ({
      tradeDate,
      oldContractCode: oldSelections.find((row) => row.tradeDate === tradeDate)?.contractCode || null,
      pp1ContractCode: newSelections.find((row) => row.tradeDate === tradeDate)?.selectedResearchContract || null,
    })),
    changedFactorValues: changes,
    changedCoverage: CONTRACT_SENSITIVE_FACTORS.map((factorId) => ({ factorId, old: oldQualityMap.get(factorId), reconciled: newQualityMap.get(factorId) }))
      .filter((row) => row.old.validObservations !== row.reconciled.validObservations || row.old.coveragePct !== row.reconciled.coveragePct),
    changedMissingState: changes.filter((row) => (row.oldValue === null) !== (row.newValue === null)),
    changedAvailableAt: changes.filter((row) => row.oldAvailableAt !== row.newAvailableAt),
    changedF1Status: stateDiffs.filter((row) => oldQualityMap.get(row.factorId)?.qualityState !== newQualityMap.get(row.factorId)?.qualityState)
      .map((row) => ({ factorId: row.factorId, old: oldQualityMap.get(row.factorId)?.qualityState, reconciled: newQualityMap.get(row.factorId)?.qualityState })),
    changedF2Status: states.filter((row) => row.old?.evaluationStatus !== row.reconciled.recalculatedF2Status)
      .map((row) => ({
        factorId: row.factorId,
        old: row.old?.evaluationStatus,
        recalculated: row.reconciled.recalculatedF2Status,
        effectiveReconciledStatus: row.reconciled.evaluationStatus,
        promotionUpgradeBlocked: row.old?.evaluationStatus === 'FAIL' && row.reconciled.recalculatedF2Status === 'PASS',
      })),
    changedRedundancyCluster: clusterDiffs,
    changedEvidenceBlockInputs: blockDiffs,
    changedWalkForwardResults: walkDiffs,
    changedRoleClassification: states
      .filter((row) => row.old?.evidenceRole !== row.reconciled.evidenceRole)
      .map((row) => ({ factorId: row.factorId, old: row.old?.evidenceRole, reconciled: row.reconciled.evidenceRole })),
    changedF3CandidateStatus: stableHash(oldCandidateSummary) === stableHash(newCandidateSummary) ? [] : [{
      old: oldCandidateSummary,
      recalculated: newCandidateSummary,
      effectiveReconciled: effectiveCandidateSummary,
      promotionUpgradeBlocked: true,
    }],
    perFactorResults,
    originalTargetsChanged: false,
    originalMethodsChanged: false,
    originalRandomSeedChanged: false,
    originalPhaseAArtifactsModified: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const evidenceFile = path.join(outputDir, 'PP1_CONTRACT_RECONCILIATION_EVIDENCE.json');
  writeJson(evidenceFile, evidence);
  const reconciliationOutputHash = sha256File(evidenceFile);
  const view = {
    schemaVersion: 'phase-a-reconciled-view-v1',
    reconciliationRunId,
    phaseARunId: before.status.runId,
    originalEvidenceHash: before.fingerprint.phaseAEvidenceHash,
    pp1PolicySpecHash,
    reconciliationOutputHash,
    factorResults: perFactorResults,
    f3Candidates: effectiveCandidateSummary,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  const viewFile = path.join(outputDir, 'PHASE_A_RECONCILED_VIEW.json');
  writeJson(viewFile, view);
  const reportFile = path.join(outputDir, 'PP1_CONTRACT_RECONCILIATION_REPORT.md');
  deterministicWrite(reportFile, `${reportMarkdown(evidence)}\n`);
  const after = verifyPhaseA();
  if (stableHash(before.fingerprint) !== stableHash(after.fingerprint)) throw new Error('phase_a_fingerprint_changed_during_reconciliation');
  const runStatus = {
    schemaVersion: 'pp1-contract-reconciliation-run-status-v1',
    reconciliationRunId,
    status: 'COMPLETED_PENDING_OWNER_CLOSEOUT',
    acceptance: 'PASS',
    artifacts: [evidenceFile, viewFile, reportFile].map((file) => ({ path: file, sha256: sha256File(file) })),
    phaseAProtectionBefore: before.fingerprint,
    phaseAProtectionAfter: after.fingerprint,
    pp1PolicySpecHash,
    perFactorStatusCounts: perFactorResults.reduce((result, row) => {
      result[row.reconciliationStatus] = (result[row.reconciliationStatus] || 0) + 1; return result;
    }, {}),
    scope: CONTRACT_SENSITIVE_FACTORS,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  writeJson(path.join(outputDir, 'RUN_STATUS.json'), runStatus);
  console.log(JSON.stringify({
    reconciliationRunId,
    acceptance: runStatus.acceptance,
    outputDir,
    affectedTradeDates: dates.length,
    changedFactorRows: changes.length,
    affectedBlocks: downstream.affectedBlockIds.length,
    perFactorStatusCounts: runStatus.perFactorStatusCounts,
    phaseAArtifactsUnchanged: true,
  }, null, 2));
}

await main();
