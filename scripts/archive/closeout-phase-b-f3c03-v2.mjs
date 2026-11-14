import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-f3c03', 'run-2026-08-03-v2');
const read = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8'));
const hash = (file) => sha256Hex(fs.readFileSync(file));
const digest = (value) => sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
function assert(condition, message) { if (!condition) throw new Error(message); }
function writeOnce(name, value) { const file = path.join(runDir, name); const bytes = Buffer.from(jcsNfc(value)); if (fs.existsSync(file)) { assert(hash(file) === sha256Hex(bytes), `immutable_output_mismatch:${name}`); return hash(file); } const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, bytes, { flag: 'wx' }); fs.renameSync(tmp, file); return hash(file); }

const primary = read('PRIMARY_ENDPOINTS.json');
const bootstrap = read('BOOTSTRAP_PRIMARY_ENDPOINTS.json');
const permutation = read('NEGATIVE_CONTROL_SCORE_PERMUTATION.json');
const randomFeature = read('NEGATIVE_CONTROL_RANDOM_FEATURE.json');
const margin = read('F3C03_EXPECTANCY_NONINFERIORITY_MARGIN_ARTIFACT.json');
const observed = primary.observed;
const endpointPass = Object.fromEntries(bootstrap.results.map((row) => [row.endpointId, row.pass]));
const gates = {
  sample: primary.samplePass,
  overallTradeRetention: observed.tradeRetention >= .75,
  longTradeRetention: observed.longTradeRetention >= .60,
  maxDrawdown: endpointPass.OVERALL_MAX_DRAWDOWN_IMPROVEMENT,
  longES10: endpointPass.LONG_ES10_IMPROVEMENT,
  expectancyNonInferiority: endpointPass.OVERALL_EXPECTANCY_NONINFERIORITY,
  profitFactor: observed.s1PF >= observed.s0PF - .05,
  scorePermutation: permutation.pass,
  randomFeature: randomFeature.pass,
};
const allPass = Object.values(gates).every(Boolean);
const finalState = allPass ? 'F4_HISTORICAL_INCREMENTAL_CANDIDATE' : 'REJECTED';
const evaluation = {
  schemaVersion: 'f3c03-phase-b-evaluation-v2', candidateId: 'F3C03', runId: 'run-2026-08-03-v2',
  testedRole: 'RISK_VETO', interventionType: 'LONG_ONLY_NO_TRADE_VETO', status: finalState,
  evaluationStatus: allPass ? 'PENDING' : 'FAIL', activeValidationStatus: allPass ? 'CLOSED_F4_CANDIDATE' : 'CLOSED_REJECTED',
  promotionStage: allPass ? 'F4_HISTORICAL_INCREMENTAL_CANDIDATE' : 'F3_PREREGISTERED_CANDIDATE', promotionEligible: false,
  gates, observed, expectancyMargin: margin, formalWeight: 0, researchOnly: true, signalEligible: false, paperEligible: false, executionAuthorized: false,
  requiresNewFrozenForward: allPass, thresholdRetestAuthorized: false, formulaRevisionAuthorized: false, roleRescueAuthorized: false,
};
writeOnce('F3C03_PHASE_B_EVALUATION_REGISTRY_RECORD.json', evaluation);
if (!allPass) writeOnce('F3C03_NEGATIVE_EVIDENCE_REGISTRY_RECORD.json', { schemaVersion: 'negative-evidence-v1', candidateId: 'F3C03', runId: evaluation.runId, researchOutcome: 'NEGATIVE_EVIDENCE', failedGates: Object.entries(gates).filter(([, pass]) => !pass).map(([gate]) => gate), evidenceHash: digest({ gates, observed }), immutable: true });

const protectedV1 = path.join(root, 'data', 'research', 'phase-b-f3c03', 'run-2026-08-02-v1', 'F3C03_STAGE_B_HARD_FAIL_CLOSEOUT.json');
assert(hash(protectedV1) === '8f1efd20ef7d7a0d3120bc9b1c3bb146e4cfd60a0a21cc659a8a725e7da3a514', 'v1_closeout_hash_changed');
const artifactNames = fs.readdirSync(runDir).filter((name) => name !== 'FINAL_CLOSEOUT_MANIFEST.json').sort();
const artifacts = artifactNames.map((name) => ({ name, hash: hash(path.join(runDir, name)) }));
const manifestCore = { schemaVersion: 'f3c03-v2-final-closeout-manifest-v1', runId: evaluation.runId, workPackageStatus: 'CLOSED', engineeringStatus: 'PASS', researchStatus: allPass ? 'F4_CANDIDATE_PENDING_OWNER' : 'REJECTED', candidateStatus: finalState, artifactCount: artifacts.length, artifacts, v1CloseoutHash: hash(protectedV1), scopeDiff: ['EXPECTANCY_ENDPOINT_SEMANTICS_ONLY'], formalWeight: 0, researchOnly: true, executionAuthorized: false };
const manifest = { ...manifestCore, logicalHash: digest(manifestCore) };
const manifestHash = writeOnce('FINAL_CLOSEOUT_MANIFEST.json', manifest);
process.stdout.write(`${JSON.stringify({ status: finalState, gates, manifestHash }, null, 2)}\n`);
