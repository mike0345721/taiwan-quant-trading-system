import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildDailyTargets } from '../src/phase-a-univariate.mjs';
import { runTransparentWalkForward } from '../src/phase-a-round2-3.mjs';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';
import { MINIMUM_COMMON_PAIRED_SESSIONS, MINIMUM_INCREMENTAL_IMPROVEMENT, concentrationCheck, digest, evaluatePurgedWalkForward, movingBlockBootstrap, withinFoldScorePermutation } from '../src/phase-b-f3c05-uniqueness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-f3c05', 'final-incremental-uniqueness-v2');
const phaseDir = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
const statusPath = path.join(phaseDir, 'RUN_STATUS.json');
const a22Path = path.join(phaseDir, 'jobs', 'A22-transparent_walk_forward.json');
const a21Path = path.join(phaseDir, 'jobs', 'A21-evidence_blocks.json');
const registryPath = path.join(root, 'data', 'research', 'f3-governance-v2', 'owner-review-2026-08-02', 'F3_ELIGIBLE_REGISTRY.json');
const contractPath = path.join(root, 'research', 'phase-b-f3c05-final-uniqueness-v1.json');
const stageAManifestPath = path.join(root, 'data', 'research', 'phase-b-f3c05', 'owner-brief-v1', 'F3C05_STAGE_A_MANIFEST.json');
const f3c01AuditPath = path.join(root, 'data', 'research', 'phase-b-f3c01', 'regime-state-distribution-audit-v1', 'FINAL_AUDIT_MANIFEST.json');
const A22_FILE_HASH = '15fe9ef86b14a057e8ba16d29910508a1e20050933c73d04925d4a03bb607cb3';

function assert(condition, message) { if (!condition) throw new Error(message); }
function fileHash(file) { return sha256Hex(fs.readFileSync(file)); }
function atomic(name, payload) {
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, name); const bytes = Buffer.from(jcsNfc(payload), 'utf8'); const expected = sha256Hex(bytes);
  if (fs.existsSync(file)) { assert(fileHash(file) === expected, `COMPLETED_OUTPUT_MISMATCH:${name}`); return { hash: expected, reused: true }; }
  const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); return { hash: expected, reused: false };
}
function frozenPaths(status) {
  return [statusPath, a22Path, a21Path, registryPath, contractPath, stageAManifestPath, f3c01AuditPath, status.immutable.snapshotPath, status.immutable.targetSpecPath, status.immutable.featureSpecPath];
}
function frozenSnapshot(status) { return frozenPaths(status).map((file) => ({ path: file, hash: fileHash(file) })); }

function loadPhaseInputs(status) {
  const a11 = status.jobs.find((job) => job.stage === 'A11' && job.factorId === '__MANIFEST__');
  assert(a11?.status === 'COMPLETED' && fileHash(a11.outputPath) === a11.outputHash, 'A11_FROZEN_INPUT_INVALID');
  const db = new DatabaseSync(a11.outputPath, { readOnly: true }); let featureRows;
  try { featureRows = db.prepare('SELECT decision_trade_date AS decisionTradeDate, factor_id AS factorId, value, quality_state AS qualityState, available_at AS availableAt FROM canonical_features ORDER BY decision_trade_date, factor_id').all(); } finally { db.close(); }
  const snapshot = new DatabaseSync(status.immutable.snapshotPath, { readOnly: true }); let marketRows; let futuresContractRows; let futuresOiRows;
  try {
    marketRows = snapshot.prepare('SELECT * FROM market_daily ORDER BY trade_date').all();
    futuresContractRows = snapshot.prepare('SELECT * FROM futures_contract_daily WHERE product=? AND session=? ORDER BY trade_date, contract').all('TX', '\u4e00\u822c');
    futuresOiRows = snapshot.prepare('SELECT * FROM futures_oi_daily ORDER BY trade_date').all();
  } finally { snapshot.close(); }
  return { featureRows, targetRows: buildDailyTargets({ marketRows, futuresContractRows, futuresOiRows }), targetSpec: JSON.parse(fs.readFileSync(status.immutable.targetSpecPath, 'utf8')) };
}

function reproduceF3C05(inputs, block, status) {
  const thresholdJob = status.jobs.find((job) => job.stage === 'A12' && job.targetId === 'next_day_range');
  assert(thresholdJob?.status === 'COMPLETED' && fileHash(thresholdJob.outputPath) === thresholdJob.outputHash, 'TARGET_THRESHOLD_INPUT_INVALID');
  const thresholds = JSON.parse(fs.readFileSync(thresholdJob.outputPath, 'utf8')).thresholdsFromDevelopmentOnly;
  const reproduced = runTransparentWalkForward({ featureRows: inputs.featureRows, targetRows: inputs.targetRows, targetSpec: inputs.targetSpec, evidenceBlocks: { blocks: [block] }, thresholdsByTarget: { next_day_range: thresholds } });
  const study = reproduced.studies.find((item) => item.blockId === block.blockId && item.modelId === 'HUBER_REGRESSION');
  assert(study, 'F3C05_HUBER_REPRODUCTION_MISSING');
  return study;
}

function featureAvailability(featureRows, candidates) {
  const required = new Set([...candidates.f3c01.fixedFactors, ...candidates.f3c05.fixedFactors, 'contract_changed']);
  const byDate = new Map();
  for (const row of featureRows.filter((item) => required.has(item.factorId))) {
    if (!byDate.has(row.decisionTradeDate)) byDate.set(row.decisionTradeDate, new Map());
    byDate.get(row.decisionTradeDate).set(row.factorId, row);
  }
  return byDate;
}

function buildCommonUniverse({ f3c01Study, f3c05Study, featureRows, candidates }) {
  const map1 = new Map(f3c01Study.predictions.map((row) => [row.date, row]));
  const map5 = new Map(f3c05Study.predictions.map((row) => [row.date, row]));
  const dates = [...new Set([...map1.keys(), ...map5.keys()])].sort(); const featureMap = featureAvailability(featureRows, candidates);
  const audit = []; const common = [];
  for (const tradeDate of dates) {
    const one = map1.get(tradeDate); const five = map5.get(tradeDate); const rows = featureMap.get(tradeDate) ?? new Map();
    const requiredFactors = new Set([...candidates.f3c01.fixedFactors, ...candidates.f3c05.fixedFactors]);
    const requiredRows = [...requiredFactors].map((id) => rows.get(id));
    const decisionAvailableAt = `${tradeDate}T00:45:00.000Z`;
    const featureAvailable = requiredRows.every((row) => row && Number.isFinite(row.value) && row.qualityState === 'PASS');
    const availableAtLegal = featureAvailable && requiredRows.every((row) => row.availableAt && Date.parse(row.availableAt) <= Date.parse(decisionAvailableAt));
    const foldAssignmentClear = Boolean(one?.foldId && five?.foldId);
    const targetAvailable = Boolean(five && Number.isFinite(five.outcome));
    let exclusionReason = null;
    if (!one) exclusionReason = 'F3C01_OOS_SCORE_UNAVAILABLE';
    else if (!five) exclusionReason = 'F3C05_OOS_SCORE_UNAVAILABLE';
    else if (!foldAssignmentClear) exclusionReason = 'FOLD_ASSIGNMENT_UNAVAILABLE';
    else if (!targetAvailable) exclusionReason = 'F3C05_FROZEN_TARGET_UNAVAILABLE';
    else if (!featureAvailable) exclusionReason = 'REQUIRED_FEATURE_UNAVAILABLE';
    else if (!availableAtLegal) exclusionReason = 'AVAILABLE_AT_VIOLATION';
    const contractChanged = rows.get('contract_changed');
    const record = { tradeDate, f3c05Available: Boolean(five), f3c01Available: Boolean(one), targetAvailable, comparisonFoldId: five?.foldId ?? null, f3c01SourceFoldId: one?.foldId ?? null, foldIdsDiffer: Boolean(one && five && one.foldId !== five.foldId), availableAtState: availableAtLegal ? 'PASS' : featureAvailable ? 'FAIL' : 'UNAVAILABLE', exclusionReason, settlementClass: five?.settlementRegime ?? one?.settlementRegime ?? 'UNAVAILABLE', rollState: Number.isFinite(contractChanged?.value) ? (contractChanged.value ? 'ROLL_SESSION' : 'NON_ROLL') : 'UNAVAILABLE' };
    audit.push(record);
    if (!exclusionReason) common.push({ tradeDate, foldId: five.foldId, f3c01SourceFoldId: one.foldId, f3c01Score: one.prediction, f3c05Score: five.prediction, target: five.outcome, settlementClass: record.settlementClass, rollState: record.rollState });
  }
  assert(!audit.some((row) => row.exclusionReason === 'FOLD_ASSIGNMENT_UNAVAILABLE'), 'FOLD_ASSIGNMENT_UNAVAILABLE');
  assert(!audit.some((row) => row.exclusionReason === 'AVAILABLE_AT_VIOLATION'), 'AVAILABLE_AT_VIOLATION');
  return { audit, common };
}

function main() {
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')); const before = frozenSnapshot(status);
  assert(fileHash(a22Path) === A22_FILE_HASH, 'A22_ARTIFACT_HASH_MISMATCH');
  assert(fileHash(status.immutable.targetSpecPath) === status.immutable.targetSpecHash, 'TARGET_SPEC_HASH_MISMATCH');
  assert(fileHash(status.immutable.featureSpecPath) === status.immutable.featureSpecHash, 'FEATURE_SPEC_HASH_MISMATCH');
  assert(status.immutable.randomSeed === 20260730, 'RANDOM_SEED_MISMATCH');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); const f3c01 = registry.candidates.find((item) => item.candidateId === 'F3C01'); const f3c05 = registry.candidates.find((item) => item.candidateId === 'F3C05');
  assert(f3c01?.evidenceHash === '1b9adecc38bd48a84a0f1c7d0c5b79e1b1754b30b17bf3457f5570bf589638f6', 'F3C01_IDENTITY_MISMATCH');
  assert(f3c05?.evidenceHash === 'e2003270e79d8480e3272eeb0b9dd613b19b23bb20f3c5184a124ea5cebccd35', 'F3C05_IDENTITY_MISMATCH');
  const targetSpec = JSON.parse(fs.readFileSync(status.immutable.targetSpecPath, 'utf8')); const target = targetSpec.targets.find((item) => item.targetId === f3c05.fixedTarget);
  assert(target?.kind === 'continuous', target ? 'TARGET_MODEL_OWNER_REVIEW_REQUIRED' : 'TARGET_NOT_UNIQUELY_RESOLVED');
  const a22 = JSON.parse(fs.readFileSync(a22Path, 'utf8')); const original1 = a22.walkForward.studies.find((item) => item.blockId === f3c01.evidenceBlock && item.modelId === 'RIDGE_LOGISTIC'); const original5 = a22.walkForward.studies.find((item) => item.blockId === f3c05.evidenceBlock && item.modelId === 'HUBER_REGRESSION');
  assert(original1 && original5, 'FROZEN_OOS_STUDY_MISSING');
  const inputs = loadPhaseInputs(status); const a21 = JSON.parse(fs.readFileSync(a21Path, 'utf8')); const block = a21.evidenceBlocks.blocks.find((item) => item.blockId === f3c05.evidenceBlock); assert(block?.status === 'READY', 'F3C05_EVIDENCE_BLOCK_INVALID');
  const reproduced5 = reproduceF3C05(inputs, block, status);
  const originalCore = original5.predictions.map(({ date, outcome, prediction, foldId }) => ({ date, outcome, prediction, foldId })); const reproducedCore = reproduced5.predictions.map(({ date, outcome, prediction, foldId }) => ({ date, outcome, prediction, foldId }));
  assert(jcsNfc(originalCore) === jcsNfc(reproducedCore), 'F3C05_OOS_SCORE_REPRODUCTION_MISMATCH');
  const frozenValidation = { status: 'PASS', candidateId: 'F3C05', candidateEvidenceHash: f3c05.evidenceHash, featureIds: f3c05.fixedFactors, featureSpecHash: status.immutable.featureSpecHash, targetId: target.targetId, targetSpecHash: status.immutable.targetSpecHash, targetType: target.kind, frozenModel: 'HUBER_REGRESSION_DELTA_1_345', metaComparisonModel: 'RIDGE_REGRESSION_LAMBDA_1', foldAssignmentHash: digest(original5.foldResults.map(({ foldId, trainStartDate, trainEndDate, testStartDate, testEndDate }) => ({ foldId, trainStartDate, trainEndDate, testStartDate, testEndDate }))), a22ArtifactHash: fileHash(a22Path), f3c01OosScoreHash: digest(original1.predictions), f3c05OosScoreHash: digest(originalCore), reproducedF3c05OosScoreHash: digest(reproducedCore), availableAtPolicy: f3c05.availableAt, randomSeed: status.immutable.randomSeed, comparisonContractHash: fileHash(contractPath) };
  atomic('FROZEN_EVIDENCE_VALIDATION.json', frozenValidation);
  const universe = buildCommonUniverse({ f3c01Study: original1, f3c05Study: original5, featureRows: inputs.featureRows, candidates: { f3c01, f3c05 } });
  atomic('COMMON_PAIRED_UNIVERSE.json', { minimumCommonPairedSessions: MINIMUM_COMMON_PAIRED_SESSIONS, commonPairedSessionCount: universe.common.length, status: universe.common.length >= MINIMUM_COMMON_PAIRED_SESSIONS ? 'PASS' : 'INSUFFICIENT_SAMPLE', rows: universe.audit, commonLogicalHash: digest(universe.common) });
  if (universe.common.length < MINIMUM_COMMON_PAIRED_SESSIONS) {
    atomic('EVALUATION_RECORD.json', { status: 'INSUFFICIENT_SAMPLE', evaluationStatus: 'PAUSED', promotionEligible: false, formalWeight: 0, researchOnly: true, executionAuthorized: false });
    return { status: 'INSUFFICIENT_SAMPLE', commonPairedSessionCount: universe.common.length };
  }
  const foldOrder = original5.foldResults.map((fold) => fold.foldId); const comparison = evaluatePurgedWalkForward(universe.common, foldOrder);
  assert(comparison.predictions.length >= MINIMUM_COMMON_PAIRED_SESSIONS, 'EVALUATED_OOS_SAMPLE_BELOW_MINIMUM');
  atomic('M0_M1_COMPARISON_CONTRACT.json', { contractHash: fileHash(contractPath), modelType: 'RIDGE_REGRESSION', lambda: 1, standardization: 'TRAIN_ONLY', m0Features: ['f3c01Score'], m1Features: ['f3c01Score', 'f3c05Score'], foldOrder, purgeRows: 1, firstFoldWithoutPriorMetaOosHistory: comparison.foldResults.find((row) => row.status !== 'EVALUATED')?.foldId ?? null });
  atomic('FOLD_RESULTS.json', { foldResults: comparison.foldResults, evaluatedPredictionCount: comparison.predictions.length, predictionLogicalHash: digest(comparison.predictions) });
  atomic('PRIMARY_LOSS_RESULT.json', { endpoint: 'F3C05_INCREMENTAL_OOS_LOSS_IMPROVEMENT', primaryLoss: 'RMSE', minimumIncrementalImprovement: MINIMUM_INCREMENTAL_IMPROVEMENT, ...comparison.aggregate });
  const bootstrap = movingBlockBootstrap(comparison.predictions, fileHash(contractPath), 2000); atomic('MOVING_BLOCK_BOOTSTRAP.json', { blocks: bootstrap, conservativeLower95: Math.min(...bootstrap.map((row) => row.lower95)), pass: Math.min(...bootstrap.map((row) => row.lower95)) > 0 });
  const permutation = withinFoldScorePermutation(universe.common, foldOrder, fileHash(contractPath), 2000); atomic('F3C05_SCORE_PERMUTATION.json', { ...permutation, requiredPValueBelow: 0.05, pass: permutation.pValue < 0.05 });
  const concentration = concentrationCheck(comparison.predictions); atomic('CONCENTRATION_CHECK.json', concentration);
  const evaluatedFolds = comparison.foldResults.filter((row) => row.status === 'EVALUATED'); const positiveFoldShare = evaluatedFolds.filter((row) => row.incrementalImprovement > 0).length / evaluatedFolds.length;
  const gates = { fullSampleFivePercent: comparison.aggregate.incrementalImprovement >= 0.05, positiveFoldShare: positiveFoldShare >= 0.60, bootstrapLowerBound: Math.min(...bootstrap.map((row) => row.lower95)) > 0, scorePermutation: permutation.pValue < 0.05, concentration: concentration.conclusionDoesNotReverse };
  const allPass = Object.values(gates).every(Boolean); const evaluation = allPass ? { status: 'F4_HISTORICAL_CONTINUOUS_RANGE_CANDIDATE', evaluationStatus: 'PENDING', incrementalInformationStatus: 'HISTORICAL_INCREMENT_ESTABLISHED', requiresNewFrozenForward: true, boundaryStatus: 'NOT_DEFINED' } : { status: 'CLOSED_REDUNDANT_DESCRIPTIVE_ONLY', evaluationStatus: 'FAIL', activeValidationStatus: 'CLOSED_REDUNDANT', incrementalInformationStatus: 'NOT_ESTABLISHED', usageState: 'DESCRIPTIVE_CONTINUOUS_SCORE_ONLY' };
  atomic('EVALUATION_RECORD.json', { candidateId: 'F3C05', ...evaluation, gates, positiveFoldShare, promotionEligible: false, signalEligible: false, paperEligible: false, positionSizingAuthorized: false, formalWeight: 0, researchOnly: true, executionAuthorized: false });
  const after = frozenSnapshot(status); assert(jcsNfc(before) === jcsNfc(after), 'FROZEN_ARTIFACT_CHANGED'); atomic('FROZEN_ARTIFACT_PROTECTION.json', { status: 'PASS', before, after, combinedHash: digest(after) });
  atomic('SCOPE_DIFF.json', { phaseBPrimaryCandidateResearchStatus: 'CLOSED', boundaryCreated: false, positionSizingCreated: false, t0PnlRead: false, signalCreated: false, strategyCreated: false, paperCreated: false, executionCreated: false, formalWeight: 0, researchOnly: true, executionAuthorized: false });
  return { status: evaluation.status, commonPairedSessionCount: universe.common.length, evaluatedPredictionCount: comparison.predictions.length, incrementalImprovement: comparison.aggregate.incrementalImprovement, gates };
}

try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); } catch (error) {
  try { atomic('HARD_FAIL.json', { runStatus: 'HARD_FAIL', error: error.message, formalWeight: 0, researchOnly: true, executionAuthorized: false }); } catch {}
  process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2;
}
