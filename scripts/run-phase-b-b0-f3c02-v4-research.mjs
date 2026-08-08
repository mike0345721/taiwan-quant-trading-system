import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildDailyTargets, quantile } from '../src/phase-a-univariate.mjs';
import { fitRidgeLogisticAudit, reproduceTransparentCandidateDetails } from '../src/phase-a-round2-3.mjs';
import { fisherYates, jcsNfc, makeSeedMaterial, rngFromSeedMaterial, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const phaseDir = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
const t0Dir = path.join(root, 'data', 'research', 't0-h0-formal-v1', 'run-2026-08-02-v1');
const freezePath = path.join(runDir, 'B0_F3C02_PREREGISTRATION_FREEZE_MANIFEST_V4.json');
const gatePath = path.join(runDir, 'CONTRACT_COMPLETENESS_GATE_V4.json');
const a22Path = path.join(phaseDir, 'jobs', 'A22-transparent_walk_forward.json');
const a21Path = path.join(phaseDir, 'jobs', 'A21-evidence_blocks.json');
const statusPath = path.join(phaseDir, 'RUN_STATUS.json');
const targetSpecPath = path.join(root, 'research', 'phase-a-v1', 'target-spec.json');
const freezeHash = sha256Hex(fs.readFileSync(freezePath));

const finite = (value) => Number.isFinite(Number(value));
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function assert(condition, message) { if (!condition) throw new Error(message); }
function hashFile(file) { return sha256Hex(fs.readFileSync(file)); }
function atomic(file, payload) {
  const bytes = Buffer.from(jcsNfc(payload), 'utf8');
  if (fs.existsSync(file)) {
    assert(hashFile(file) === sha256Hex(bytes), `existing_output_hash_mismatch:${path.basename(file)}`);
    return hashFile(file);
  }
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
  return hashFile(file);
}
function digest(value) { return sha256Hex(Buffer.from(jcsNfc(value), 'utf8')); }

function loadInputs() {
  const phaseStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const a11 = phaseStatus.jobs.find((job) => job.stage === 'A11' && job.factorId === '__MANIFEST__');
  assert(a11?.status === 'COMPLETED' && hashFile(a11.outputPath) === a11.outputHash, 'a11_frozen_input_invalid');
  const db = new DatabaseSync(a11.outputPath, { readOnly: true });
  let featureRows;
  try {
    featureRows = db.prepare(`SELECT decision_trade_date AS decisionTradeDate, factor_id AS factorId,
      base_factor_id AS baseFactorId, factor_group AS factorGroup, value, quality_state AS qualityState,
      available_at AS availableAt FROM canonical_features ORDER BY decision_trade_date, factor_id`).all();
  } finally { db.close(); }
  const snapshot = new DatabaseSync(phaseStatus.immutable.snapshotPath, { readOnly: true });
  let marketRows; let futuresContractRows; let futuresOiRows;
  try {
    marketRows = snapshot.prepare('SELECT * FROM market_daily ORDER BY trade_date').all();
    futuresContractRows = snapshot.prepare("SELECT * FROM futures_contract_daily WHERE product='TX' AND session='一般' ORDER BY trade_date, contract").all();
    futuresOiRows = snapshot.prepare('SELECT * FROM futures_oi_daily ORDER BY trade_date').all();
  } finally { snapshot.close(); }
  const targetRows = buildDailyTargets({ marketRows, futuresContractRows, futuresOiRows });
  const targetSpec = JSON.parse(fs.readFileSync(targetSpecPath, 'utf8'));
  const a21 = JSON.parse(fs.readFileSync(a21Path, 'utf8'));
  const block = a21.evidenceBlocks.blocks.find((item) => item.blockId === 'CASH__next_day_large_move');
  assert(block?.status === 'READY', 'f3c02_evidence_block_missing');
  const a12 = JSON.parse(fs.readFileSync(path.join(phaseDir, 'jobs', 'A12-cash_foreign_net-next_day_large_move.json'), 'utf8'));
  return { phaseStatus, featureRows, targetRows, targetSpec, block, thresholds: a12.thresholdsFromDevelopmentOnly };
}

function a22Reproduce(inputs) {
  assert(hashFile(a22Path) === '15fe9ef86b14a057e8ba16d29910508a1e20050933c73d04925d4a03bb607cb3', 'a22_file_hash_mismatch');
  const original = JSON.parse(fs.readFileSync(a22Path, 'utf8'));
  const originalStudy = original.walkForward.studies.find((study) => study.blockId === 'CASH__next_day_large_move' && study.modelId === 'RIDGE_LOGISTIC');
  assert(originalStudy, 'a22_candidate_study_missing');
  const details = reproduceTransparentCandidateDetails(inputs);
  const reproduced = details.folds.flatMap((fold) => fold.oosScores.map((row) => ({ date: row.date, prediction: row.score, foldId: fold.foldId })));
  const originalCore = originalStudy.predictions.map((row) => ({ date: row.date, prediction: row.prediction, foldId: row.foldId }));
  const scoreExact = jcsNfc(reproduced) === jcsNfc(originalCore);
  const foldCore = details.folds.map((fold) => ({ foldId: fold.foldId, trainingRange: fold.trainingRange, testRange: fold.testRange, purgeRows: fold.purgeRows }));
  const originalFoldCore = originalStudy.foldResults.map((fold) => ({ foldId: fold.foldId, trainingRange: { start: fold.trainStartDate, end: fold.trainEndDate }, testRange: { start: fold.testStartDate, end: fold.testEndDate }, purgeRows: 1 }));
  const foldExact = jcsNfc(foldCore) === jcsNfc(originalFoldCore);
  const report = {
    schemaVersion: 'b0-a22-reproduction-v1', status: scoreExact && foldExact ? 'PASS' : 'FAIL',
    fileByteHash: hashFile(a22Path), originalOosLogicalHash: digest(originalCore), reproducedOosLogicalHash: digest(reproduced),
    foldLogicalHash: digest(foldCore), originalFoldLogicalHash: digest(originalFoldCore),
    semanticEquality: { foldAssignment: foldExact, trainTestRange: foldExact, purge: foldExact, oosScoresByTradeDate: scoreExact },
    reconstructedParameterLogicalHash: digest(details.folds.map((fold) => ({ foldId: fold.foldId, scaler: fold.scaler, intercept: fold.intercept, coefficients: fold.coefficients }))),
    reconstructionBasis: 'FROZEN_A11_FEATURES_TARGET_SPEC_AND_EXACT_A22_CODE_PATH',
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  atomic(path.join(runDir, 'A22_REPRODUCTION_REPORT.json'), report);
  assert(report.status === 'PASS', 'A22_REPRODUCTION_GATE_FAIL');
  return { details, report, originalStudy };
}

function thresholds(details) {
  const output = details.folds.map((fold) => {
    const scores = fold.trainScores.map((row) => row.score).filter(Number.isFinite);
    const thresholdValue = quantile(scores, 0.8);
    const modelHash = digest({ intercept: fold.intercept, coefficients: fold.coefficients });
    const scalerHash = digest(fold.scaler);
    const core = { foldId: fold.foldId, trainingDateRange: fold.trainingRange, trainingScoreCount: fold.trainScores.length, finiteScoreCount: scores.length,
      quantileMethod: 'LINEAR_INTERPOLATION_N_MINUS_1', thresholdValue, tieMethod: 'GREATER_THAN_OR_EQUAL_HIGH_RISK', modelHash, scalerHash };
    return { ...core, thresholdHash: digest(core) };
  });
  atomic(path.join(runDir, 'FOLD_THRESHOLD_ARTIFACT.json'), { schemaVersion: 'b0-fold-threshold-v1', thresholds: output, logicalHash: digest(output) });
  return new Map(output.map((row) => [row.foldId, row]));
}

function loadT0() {
  return fs.readdirSync(path.join(t0Dir, 'jobs')).filter((name) => name.endsWith('-DAY.json')).sort().map((name) => JSON.parse(fs.readFileSync(path.join(t0Dir, 'jobs', name), 'utf8')));
}
function basePnl(session, viewId = 'BASE_2_TICKS_PER_SIDE') {
  if (session.tradeState !== 'TRADE') return 0;
  const view = session.costViews.find((item) => item.viewId === viewId);
  assert(view && Number.isInteger(view.netPnl), `cost_view_missing:${session.tradeDate}:${viewId}`);
  return view.netPnl;
}
function pairedLedger(details, thresholdMap, featureRows) {
  const scoreMap = new Map(details.folds.flatMap((fold) => fold.oosScores.map((row) => [`${row.date}:${fold.foldId}`, { score: row.score, foldId: fold.foldId }])));
  const foldByDate = new Map(details.folds.flatMap((fold) => fold.oosScores.map((row) => [row.date, fold.foldId])));
  const availableMap = new Map();
  const factors = new Set(['cash_dealer_hedge_net', 'cash_dealer_hedge_net__sum_or_change_5d', 'cash_trust_net', 'cash_trust_net__sum_or_change_3d']);
  for (const row of featureRows.filter((item) => factors.has(item.factorId))) {
    if (!availableMap.has(row.decisionTradeDate)) availableMap.set(row.decisionTradeDate, []);
    availableMap.get(row.decisionTradeDate).push(row.availableAt);
  }
  const operational = [];
  const paired = [];
  for (const session of loadT0()) {
    const foldId = foldByDate.get(session.tradeDate);
    const score = foldId ? scoreMap.get(`${session.tradeDate}:${foldId}`)?.score : null;
    const threshold = foldId ? thresholdMap.get(foldId) : null;
    const availableAt = (availableMap.get(session.tradeDate) || []).sort().at(-1) || null;
    const legallyAvailable = Boolean(availableAt && session.orAvailableAt && Date.parse(availableAt) <= Date.parse(session.orAvailableAt));
    if (!finite(score) || !threshold || !legallyAvailable) {
      operational.push({ tradeDate: session.tradeDate, sessionId: session.sessionId, pairedState: 'CANDIDATE_UNAVAILABLE', reasonCode: !finite(score) ? 'MISSING_OOS_SCORE' : !threshold ? 'MISSING_THRESHOLD' : 'AVAILABLE_AT_VIOLATION' });
      continue;
    }
    const riskState = score >= threshold.thresholdValue ? 'HIGH_RISK' : 'NOT_HIGH_RISK';
    const vetoEligible = session.tradeState === 'TRADE';
    const vetoApplied = riskState === 'HIGH_RISK' && vetoEligible;
    const costs = Object.fromEntries(['GROSS', 'OPTIMISTIC_1_TICK_PER_SIDE', 'BASE_2_TICKS_PER_SIDE', 'CONSERVATIVE_3_TICKS_PER_SIDE', 'SEVERE_STRESS_5_TICKS_PER_SIDE'].map((view) => {
      const s0 = basePnl(session, view); return [view, { s0DailyPnl: s0, s1DailyPnl: vetoApplied ? 0 : s0, incrementalDailyPnl: vetoApplied ? -s0 : 0 }];
    }));
    const base = costs.BASE_2_TICKS_PER_SIDE;
    paired.push({ tradeDate: session.tradeDate, sessionId: session.sessionId, foldId, candidateScore: score, trainFoldThreshold: threshold.thresholdValue,
      riskState, vetoEligible, vetoApplied, originalT0TradeState: session.tradeState, originalT0Direction: session.breakoutDirection ?? null,
      originalNoTradeReason: session.noTradeReason ?? null, noTradeReason: vetoApplied ? 'NO_TRADE_RISK_VETO_F3C02' : (session.noTradeReason ?? null),
      originalT0BasePnl: base.s0DailyPnl, s0TradeState: session.tradeState, s1TradeState: vetoApplied ? 'NO_TRADE' : session.tradeState,
      s0TradePnl: session.tradeState === 'TRADE' ? base.s0DailyPnl : null, s1TradePnl: session.tradeState === 'TRADE' && !vetoApplied ? base.s1DailyPnl : null,
      ...base, availableAt, evidenceHash: digest({ score, thresholdHash: threshold.thresholdHash, availableAt }), settlementClass: session.settlementClass ?? null, rollSession: session.rollSession ?? false,
      falseBreakout: session.falseBreakout?.falseBreakout ?? null,
      maePoints: session.maePoints ?? null,
      mfePoints: session.mfePoints ?? null,
      costViews: costs });
  }
  assert(paired.every((row) => row.incrementalDailyPnl === row.s1DailyPnl - row.s0DailyPnl), 'daily_accounting_invariant_fail');
  assert(paired.reduce((s, r) => s + r.incrementalDailyPnl, 0) === paired.reduce((s, r) => s + r.s1DailyPnl, 0) - paired.reduce((s, r) => s + r.s0DailyPnl, 0), 'aggregate_accounting_invariant_fail');
  atomic(path.join(runDir, 'SESSION_ALIGNMENT_AVAILABLE_AT_AUDIT.json'), { schemaVersion: 'b0-alignment-audit-v1', pairedCount: paired.length, unavailableCount: operational.length, unavailable: operational, availableAtViolations: operational.filter((r) => r.reasonCode === 'AVAILABLE_AT_VIOLATION').length });
  atomic(path.join(runDir, 'PAIRED_UNIVERSE_MANIFEST.json'), { schemaVersion: 'b0-paired-universe-v1', paired, operationalMissingView: operational, logicalHash: digest(paired) });
  return paired;
}

function metric(records) {
  const daily0 = records.map((r) => r.s0DailyPnl); const daily1 = records.map((r) => r.s1DailyPnl);
  const trades0 = records.filter((r) => r.s0TradeState === 'TRADE').map((r) => r.s0TradePnl);
  const trades1 = records.filter((r) => r.s1TradeState === 'TRADE').map((r) => r.s1TradePnl);
  const maxDd = (values) => { let equity = 0; let peak = 0; let dd = 0; for (const v of values) { equity += v; peak = Math.max(peak, equity); dd = Math.min(dd, equity - peak); } return dd; };
  const es = (values, p) => { if (!values.length) return null; const k = Math.max(1, Math.ceil(values.length * p)); return avg([...values].sort((a, b) => a - b).slice(0, k)); };
  const pf = (values) => { const pos = values.filter((v) => v > 0).reduce((s, v) => s + v, 0); const neg = -values.filter((v) => v < 0).reduce((s, v) => s + v, 0); return neg ? pos / neg : null; };
  const dd0 = maxDd(daily0); const dd1 = maxDd(daily1); const es0 = es(trades0, .1); const es1 = es(trades1, .1); const ex0 = avg(trades0); const ex1 = avg(trades1);
  return { s0MaxDrawdown: dd0, s1MaxDrawdown: dd1, ddImprovement: dd0 === 0 ? null : (Math.abs(dd0) - Math.abs(dd1)) / Math.abs(dd0),
    s0ES10: es0, s1ES10: es1, es10Improvement: es0 === null || Math.max(0, -es0) === 0 ? null : (Math.max(0, -es0) - Math.max(0, -es1)) / Math.max(0, -es0),
    s0Worst5: es(trades0, .05), s1Worst5: es(trades1, .05), s0TradeCount: trades0.length, s1TradeCount: trades1.length,
    tradeRetention: trades0.length ? trades1.length / trades0.length : null, s0Expectancy: ex0, s1Expectancy: ex1,
    expectancyChange: ex0 === null || Math.abs(ex0) < 1 ? null : (ex1 - ex0) / Math.abs(ex0), s0PF: pf(trades0), s1PF: pf(trades1) };
}

function blockSample(records, blockLength, rng) {
  const output = []; const starts = Math.max(1, records.length - blockLength + 1);
  while (output.length < records.length) { const start = rng.drawIndex(starts); for (let i = 0; i < blockLength && output.length < records.length; i += 1) output.push(records[start + i]); }
  return output;
}
function bootstrap(records) {
  const observed = metric(records); const endpointDefs = [
    ['DD_IMPROVEMENT', 'ddImprovement', .1], ['ES10_IMPROVEMENT', 'es10Improvement', .1], ['EXPECTANCY_NONINFERIORITY', 'expectancyChange', -.05],
  ];
  const results = [];
  for (const [endpointId, key, margin] of endpointDefs) {
    const thetaHat = observed[key]; assert(finite(thetaHat), `endpoint_unavailable:${endpointId}`); const blocks = [];
    for (const blockLength of [5, 10]) {
      const stars = [];
      for (let replicateIndex = 0; replicateIndex < 2000; replicateIndex += 1) {
        const seedMaterial = makeSeedMaterial({ freezeHash, purpose: 'MOVING_BLOCK_BOOTSTRAP', endpointId, blockLength, replicateIndex, streamId: 'PAIRED_BLOCK_START_SELECTION' });
        const { rng, seedHash } = rngFromSeedMaterial(seedMaterial); const value = metric(blockSample(records, blockLength, rng))[key]; assert(finite(value), `bootstrap_endpoint_unavailable:${endpointId}`);
        stars.push({ value, seedHash });
      }
      const errors = stars.map((row) => row.value - thetaHat); const lowerBound = thetaHat - quantile(errors, .95);
      const rawP = (1 + errors.filter((value) => value >= thetaHat - margin).length) / 2001;
      blocks.push({ blockLength, lowerBound, rawP, seedHashDigest: digest(stars.map((row) => row.seedHash)), replicateValueDigest: digest(stars.map((row) => row.value)) });
    }
    results.push({ endpointId, key, margin, thetaHat, blocks, gateLowerBound: Math.min(...blocks.map((b) => b.lowerBound)), gateRawP: Math.max(...blocks.map((b) => b.rawP)) });
  }
  const sorted = [...results].sort((a, b) => a.gateRawP - b.gateRawP); let prior = 0;
  sorted.forEach((row, index) => { row.holmRank = index + 1; row.holmAdjustedP = Math.max(prior, Math.min(1, row.gateRawP * (sorted.length - index))); prior = row.holmAdjustedP; });
  for (const row of results) row.pass = row.thetaHat >= row.margin && row.gateLowerBound >= row.margin && row.holmAdjustedP < .05;
  const payload = { schemaVersion: 'b0-bootstrap-v1', observed, results, logicalHash: digest(results) };
  atomic(path.join(runDir, 'BOOTSTRAP_PRIMARY_ENDPOINTS.json'), payload); return payload;
}

function main() {
  const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8')); assert(gate.status === 'PASS', 'contract_gate_not_pass');
  const inputs = loadInputs(); const reproduction = a22Reproduce(inputs); const thresholdMap = thresholds(reproduction.details);
  const paired = pairedLedger(reproduction.details, thresholdMap, inputs.featureRows);
  const observed = metric(paired); const s0Trades = paired.filter((r) => r.s0TradeState === 'TRADE').length;
  const samplePass = paired.length >= 100 && s0Trades >= 80;
  atomic(path.join(runDir, 'PRIMARY_ENDPOINTS.json'), { schemaVersion: 'b0-primary-endpoints-v1', pairedSessions: paired.length, s0PairedOriginalTrades: s0Trades, samplePass, observed });
  if (!samplePass) {
    atomic(path.join(runDir, 'FINAL_STATUS.json'), { status: 'INSUFFICIENT_SAMPLE', pairedSessions: paired.length, s0PairedOriginalTrades: s0Trades, formalWeight: 0, researchOnly: true, executionAuthorized: false });
    return { status: 'INSUFFICIENT_SAMPLE', pairedSessions: paired.length, s0PairedOriginalTrades: s0Trades };
  }
  const bootstrapResult = bootstrap(paired);
  const status = { status: 'BOOTSTRAP_COMPLETE_NEGATIVE_CONTROLS_PENDING', pairedSessions: paired.length, s0PairedOriginalTrades: s0Trades, bootstrapPrimaryPass: bootstrapResult.results.every((r) => r.pass), formalWeight: 0, researchOnly: true, executionAuthorized: false };
  atomic(path.join(runDir, 'RUN_STATUS_RESEARCH.json'), status); return status;
}

try { const result = main(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); } catch (error) {
  const fail = { status: 'HARD_FAIL', stage: 'A22_OR_LATER', error: error.message, formalWeight: 0, researchOnly: true, executionAuthorized: false };
  try { atomic(path.join(runDir, 'RESEARCH_HARD_FAIL.json'), fail); } catch {}
  process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2;
}
