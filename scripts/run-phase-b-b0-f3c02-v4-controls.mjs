import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildDailyTargets, quantile } from '../src/phase-a-univariate.mjs';
import { fitRidgeLogisticAudit, reproduceTransparentCandidateDetails } from '../src/phase-a-round2-3.mjs';
import { fisherYates, jcsNfc, makeSeedMaterial, rngFromSeedMaterial, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const f3c03Mode = process.argv.includes('--f3c03-v2');
const runDir = f3c03Mode ? path.join(root, 'data', 'research', 'phase-b-f3c03', 'run-2026-08-03-v2') : path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const phaseDir = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
const freezeHash = sha256Hex(fs.readFileSync(path.join(runDir, f3c03Mode ? 'F3C03_PREREGISTRATION_FREEZE_MANIFEST.json' : 'B0_F3C02_PREREGISTRATION_FREEZE_MANIFEST_V4.json')));
const digest = (value) => sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
const avg = (v) => v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
function assert(c, m) { if (!c) throw new Error(m); }
function atomic(file, payload) { const bytes = Buffer.from(jcsNfc(payload), 'utf8'); if (fs.existsSync(file)) { assert(sha256Hex(fs.readFileSync(file)) === sha256Hex(bytes), `output_mismatch:${path.basename(file)}`); return; } const t = `${file}.${process.pid}.tmp`; fs.writeFileSync(t, bytes, { flag: 'wx' }); fs.renameSync(t, file); }

function metrics(records) {
  const t0 = records.filter((r) => r.s0TradeState === 'TRADE').map((r) => r.s0TradePnl);
  const t1 = records.filter((r) => r.s1TradeState === 'TRADE').map((r) => r.s1TradePnl);
  const dd = (key) => { let e = 0; let p = 0; let d = 0; for (const r of records) { e += r[key]; p = Math.max(p, e); d = Math.min(d, e - p); } return d; };
  const es = (v) => { if (!v.length) return null; const k = Math.max(1, Math.ceil(v.length * .1)); return avg([...v].sort((a, b) => a - b).slice(0, k)); };
  const d0 = dd('s0DailyPnl'); const d1 = dd('s1DailyPnl'); const e0 = es(t0); const e1 = es(t1); const x0 = avg(t0); const x1 = avg(t1);
  const l0 = records.filter((r) => r.s0TradeState === 'TRADE' && r.originalT0Direction === 'LONG').map((r) => r.s0TradePnl);
  const l1 = records.filter((r) => r.s1TradeState === 'TRADE' && r.originalT0Direction === 'LONG').map((r) => r.s1TradePnl);
  const le0 = es(l0); const le1 = es(l1);
  return { ddImprovement: d0 === 0 ? null : (Math.abs(d0) - Math.abs(d1)) / Math.abs(d0), es10Improvement: Math.max(0, -e0) === 0 ? null : (Math.max(0, -e0) - Math.max(0, -e1)) / Math.max(0, -e0), longEs10Improvement: Math.max(0, -le0) === 0 ? null : (Math.max(0, -le0) - Math.max(0, -le1)) / Math.max(0, -le0), expectancyDifferenceTwdPerTrade: x1 - x0, tradeRetention: t1.length / t0.length };
}
function applyScores(paired, scores, thresholds) {
  return paired.map((row) => { const score = scores.get(`${row.tradeDate}:${row.foldId}`); const high = score >= thresholds.get(row.foldId); const veto = high && row.originalT0TradeState === 'TRADE' && (!f3c03Mode || row.originalT0Direction === 'LONG'); return { ...row, candidateScore: score, riskState: high ? 'HIGH_RISK' : 'NOT_HIGH_RISK', vetoApplied: veto, s1TradeState: veto ? 'NO_TRADE' : row.s0TradeState, s1TradePnl: row.s0TradeState === 'TRADE' && !veto ? row.s0TradePnl : null, s1DailyPnl: veto ? 0 : row.s0DailyPnl, incrementalDailyPnl: veto ? -row.s0DailyPnl : 0 }; });
}
function percentileVectorPass(observed, nullRows) {
  const esKey = f3c03Mode ? 'longEs10Improvement' : 'es10Improvement';
  const p95 = { ddImprovement: quantile(nullRows.map((r) => r.ddImprovement).filter(Number.isFinite), .95), [esKey]: quantile(nullRows.map((r) => r[esKey]).filter(Number.isFinite), .95) };
  const margin = f3c03Mode ? JSON.parse(fs.readFileSync(path.join(runDir, 'F3C03_EXPECTANCY_NONINFERIORITY_MARGIN_ARTIFACT.json'), 'utf8')).nonInferiorityBoundaryTwd : -.05;
  const expectancy = f3c03Mode ? observed.expectancyDifferenceTwdPerTrade : observed.expectancyChange;
  return { p95, pass: observed.ddImprovement > p95.ddImprovement && observed[esKey] > p95[esKey] && expectancy >= margin };
}
function permutation(paired, thresholds) {
  const observed = metrics(paired); const nullRows = []; const audit = [];
  const folds = [...new Set(paired.map((r) => r.foldId))].sort();
  for (let replicateIndex = 0; replicateIndex < 2000; replicateIndex += 1) {
    const scoreMap = new Map(); const foldAudit = [];
    for (const foldId of folds) {
      const rows = paired.filter((r) => r.foldId === foldId).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.sessionId.localeCompare(b.sessionId));
      const seedMaterial = makeSeedMaterial({ freezeHash, purpose: 'SCORE_PERMUTATION', foldId, replicateIndex, streamId: 'FINITE_OOS_SCORE_VECTOR' });
      const { rng, seedHash } = rngFromSeedMaterial(seedMaterial); const shuffled = fisherYates(rows.map((r) => r.candidateScore), rng);
      rows.forEach((r, i) => scoreMap.set(`${r.tradeDate}:${foldId}`, shuffled[i]));
      foldAudit.push({ foldId, seedHash, permutationMappingHash: digest(shuffled) });
    }
    const value = metrics(applyScores(paired, scoreMap, thresholds)); nullRows.push(value); audit.push({ replicateIndex, foldAudit, resultLogicalHash: digest(value) });
  }
  return { observed, ...percentileVectorPass(observed, nullRows), iterations: 2000, nullDigest: digest(nullRows), replicateAudit: audit };
}

function loadDetails() {
  const status = JSON.parse(fs.readFileSync(path.join(phaseDir, 'RUN_STATUS.json'), 'utf8'));
  const a11 = status.jobs.find((j) => j.stage === 'A11' && j.factorId === '__MANIFEST__'); const db = new DatabaseSync(a11.outputPath, { readOnly: true }); let featureRows;
  try { featureRows = db.prepare('SELECT decision_trade_date AS decisionTradeDate, factor_id AS factorId, base_factor_id AS baseFactorId, factor_group AS factorGroup, value, quality_state AS qualityState FROM canonical_features ORDER BY decision_trade_date, factor_id').all(); } finally { db.close(); }
  const snap = new DatabaseSync(status.immutable.snapshotPath, { readOnly: true }); let marketRows; let futuresContractRows; let futuresOiRows;
  try { marketRows = snap.prepare('SELECT * FROM market_daily ORDER BY trade_date').all(); futuresContractRows = snap.prepare("SELECT * FROM futures_contract_daily WHERE product='TX' AND session='一般' ORDER BY trade_date, contract").all(); futuresOiRows = snap.prepare('SELECT * FROM futures_oi_daily ORDER BY trade_date').all(); } finally { snap.close(); }
  const targetRows = buildDailyTargets({ marketRows, futuresContractRows, futuresOiRows }); const targetSpec = JSON.parse(fs.readFileSync(path.join(root, 'research', 'phase-a-v1', 'target-spec.json'), 'utf8'));
  const target = f3c03Mode ? 'next_day_downside_tail' : 'next_day_large_move';
  const a21 = JSON.parse(fs.readFileSync(path.join(phaseDir, 'jobs', 'A21-evidence_blocks.json'), 'utf8')); const block = a21.evidenceBlocks.blocks.find((b) => b.blockId === `CASH__${target}`);
  const a12 = JSON.parse(fs.readFileSync(path.join(phaseDir, 'jobs', `A12-cash_foreign_net-${target}.json`), 'utf8'));
  return reproduceTransparentCandidateDetails({ featureRows, targetRows, targetSpec, block, thresholds: a12.thresholdsFromDevelopmentOnly });
}
function randomFeature(paired) {
  const details = loadDetails(); const observed = metrics(paired); const nullRows = []; const audit = []; const pairedDates = new Set(paired.map((r) => r.tradeDate));
  for (let replicateIndex = 0; replicateIndex < 2000; replicateIndex += 1) {
    const scoreMap = new Map(); const foldAudit = [];
    for (const fold of details.folds) {
      const train = details.rows.filter((r) => r.date >= fold.trainingRange.start && r.date <= fold.trainingRange.end); const test = details.rows.filter((r) => r.date >= fold.testRange.start && r.date <= fold.testRange.end);
      const width = details.rows[0].x.length; const trainX = train.map(() => Array(width)); const testX = test.map(() => Array(width)); const featureAudit = [];
      for (let j = 0; j < width; j += 1) {
        const featureId = `F${j + 1}`; const pool = train.map((r) => r.x[j]).filter(Number.isFinite); assert(pool.length, 'RANDOM_FEATURE_POOL_EMPTY_HARD_FAIL');
        const trainSeed = makeSeedMaterial({ freezeHash, purpose: 'RANDOM_FEATURE', foldId: fold.foldId, replicateIndex, featureId, streamId: 'TRAIN_EMPIRICAL_RESAMPLE' }); const testSeed = makeSeedMaterial({ freezeHash, purpose: 'RANDOM_FEATURE', foldId: fold.foldId, replicateIndex, featureId, streamId: 'TEST_EMPIRICAL_RESAMPLE' });
        const tr = rngFromSeedMaterial(trainSeed); const te = rngFromSeedMaterial(testSeed); train.forEach((r, i) => { trainX[i][j] = pool[tr.rng.drawIndex(pool.length)]; }); test.forEach((r, i) => { testX[i][j] = pool[te.rng.drawIndex(pool.length)]; });
        featureAudit.push({ featureId, trainSeedHash: tr.seedHash, testSeedHash: te.seedHash, donorPoolHash: digest(pool) });
      }
      const model = fitRidgeLogisticAudit(trainX, train.map((r) => r.y)); const trainScores = trainX.map(model.predict); const threshold = quantile(trainScores, f3c03Mode ? .9 : .8); test.forEach((r, i) => { if (pairedDates.has(r.date)) scoreMap.set(`${r.date}:${fold.foldId}`, model.predict(testX[i])); });
      foldAudit.push({ foldId: fold.foldId, featureAudit, modelHash: digest({ scaler: { means: model.scaler.means, sds: model.scaler.sds }, coefficients: model.coefficients }), thresholdHash: digest({ foldId: fold.foldId, threshold }) });
    }
    const thresholds = new Map(details.folds.map((fold) => { const train = details.rows.filter((r) => r.date >= fold.trainingRange.start && r.date <= fold.trainingRange.end); return [fold.foldId, null]; }));
    // Random thresholds are embedded per-fold in score classification below.
    const randomized = paired.map((row) => { const score = scoreMap.get(`${row.tradeDate}:${row.foldId}`); const fa = foldAudit.find((f) => f.foldId === row.foldId); const thresholdRecord = fa; return { ...row, _randomScore: score, _foldAudit: thresholdRecord }; });
    const thresholdByFold = new Map();
    for (const foldRecord of foldAudit) {
      // threshold hash contains the value; recompute deterministically from the same replicate to avoid parsing a hash.
      const fold = details.folds.find((f) => f.foldId === foldRecord.foldId); const train = details.rows.filter((r) => r.date >= fold.trainingRange.start && r.date <= fold.trainingRange.end);
      const width = details.rows[0].x.length; const trainX = train.map(() => Array(width));
      for (let j = 0; j < width; j += 1) { const pool = train.map((r) => r.x[j]); const seed = makeSeedMaterial({ freezeHash, purpose: 'RANDOM_FEATURE', foldId: fold.foldId, replicateIndex, featureId: `F${j + 1}`, streamId: 'TRAIN_EMPIRICAL_RESAMPLE' }); const rr = rngFromSeedMaterial(seed).rng; train.forEach((r, i) => { trainX[i][j] = pool[rr.drawIndex(pool.length)]; }); }
      const model = fitRidgeLogisticAudit(trainX, train.map((r) => r.y)); thresholdByFold.set(fold.foldId, quantile(trainX.map(model.predict), f3c03Mode ? .9 : .8));
    }
    const records = randomized.map((row) => { const high = row._randomScore >= thresholdByFold.get(row.foldId); const veto = high && row.originalT0TradeState === 'TRADE' && (!f3c03Mode || row.originalT0Direction === 'LONG'); const copy = { ...row, candidateScore: row._randomScore, riskState: high ? 'HIGH_RISK' : 'NOT_HIGH_RISK', vetoApplied: veto, s1TradeState: veto ? 'NO_TRADE' : row.s0TradeState, s1TradePnl: row.s0TradeState === 'TRADE' && !veto ? row.s0TradePnl : null, s1DailyPnl: veto ? 0 : row.s0DailyPnl, incrementalDailyPnl: veto ? -row.s0DailyPnl : 0 }; delete copy._randomScore; delete copy._foldAudit; return copy; });
    const value = metrics(records); nullRows.push(value); audit.push({ replicateIndex, foldAudit, outputLogicalHash: digest(value) });
  }
  return { observed, ...percentileVectorPass(observed, nullRows), iterations: 2000, nullDigest: digest(nullRows), replicateAudit: audit, controlOnly: true };
}

try {
  const paired = JSON.parse(fs.readFileSync(path.join(runDir, 'PAIRED_UNIVERSE_MANIFEST.json'), 'utf8')).paired; const thresholdRows = JSON.parse(fs.readFileSync(path.join(runDir, 'FOLD_THRESHOLD_ARTIFACT.json'), 'utf8')).thresholds; const thresholds = new Map(thresholdRows.map((r) => [r.foldId, r.thresholdValue]));
  const permutationResult = permutation(paired, thresholds); atomic(path.join(runDir, 'NEGATIVE_CONTROL_SCORE_PERMUTATION.json'), { schemaVersion: 'b0-score-permutation-v1', ...permutationResult });
  const randomResult = randomFeature(paired); atomic(path.join(runDir, 'NEGATIVE_CONTROL_RANDOM_FEATURE.json'), { schemaVersion: 'b0-random-feature-v1', ...randomResult });
  const status = { status: 'NEGATIVE_CONTROLS_COMPLETE', permutationPass: permutationResult.pass, randomFeaturePass: randomResult.pass, formalWeight: 0, researchOnly: true, executionAuthorized: false }; atomic(path.join(runDir, 'RUN_STATUS_CONTROLS.json'), status); process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; }
