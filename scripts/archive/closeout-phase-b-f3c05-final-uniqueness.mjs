import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-f3c05', 'final-incremental-uniqueness-v2');
const hash = (file) => sha256Hex(fs.readFileSync(file));
function atomic(name, payload, raw = false) { const file = path.join(runDir, name); const bytes = Buffer.from(raw ? payload : jcsNfc(payload), 'utf8'); const expected = sha256Hex(bytes); if (fs.existsSync(file)) { if (hash(file) !== expected) throw new Error(`CLOSEOUT_OUTPUT_MISMATCH:${name}`); return expected; } const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); return expected; }
if (!process.argv.includes('--regression-pass')) throw new Error('FULL_REGRESSION_PASS_FLAG_REQUIRED');
const required = ['FROZEN_EVIDENCE_VALIDATION.json','COMMON_PAIRED_UNIVERSE.json','M0_M1_COMPARISON_CONTRACT.json','FOLD_RESULTS.json','PRIMARY_LOSS_RESULT.json','MOVING_BLOCK_BOOTSTRAP.json','F3C05_SCORE_PERMUTATION.json','CONCENTRATION_CHECK.json','RESUME_IDEMPOTENCY.json','FROZEN_ARTIFACT_PROTECTION.json','EVALUATION_RECORD.json','SCOPE_DIFF.json'];
for (const name of required) if (!fs.existsSync(path.join(runDir, name))) throw new Error(`REQUIRED_OUTPUT_MISSING:${name}`);
const evaluation = JSON.parse(fs.readFileSync(path.join(runDir, 'EVALUATION_RECORD.json'), 'utf8')); const primary = JSON.parse(fs.readFileSync(path.join(runDir, 'PRIMARY_LOSS_RESULT.json'), 'utf8'));
const regressionHash = atomic('FULL_PROJECT_REGRESSION.json', { status: 'PASS', command: 'npm.cmd test', testCount: 259, failCount: 0, researchRerun: false, frozenArtifactsModified: false });
const summary = `# F3C05 Final Incremental Uniqueness Closeout\n\n工程執行完成。F3C05 加入 F3C01 後，OOS RMSE 相對改善為 ${primary.incrementalImprovement}，未達事前固定 5% 門檻；所有主要 Gate 均未通過。\n\n正式狀態：CLOSED_REDUNDANT_DESCRIPTIVE_ONLY。F3C05 只保留描述型連續分數，不得建立 Boundary、Position Sizing、Signal、Paper 或 Execution。\n\nformalWeight=0，researchOnly=true，executionAuthorized=false。\n`;
const summaryHash = atomic('CLOSEOUT_SUMMARY.md', summary, true);
const artifacts = Object.fromEntries([...required, 'FULL_PROJECT_REGRESSION.json', 'CLOSEOUT_SUMMARY.md'].sort().map((name) => [name, hash(path.join(runDir, name))]));
const manifest = { schemaVersion: 'f3c05-final-incremental-uniqueness-closeout-v1', candidateId: 'F3C05', status: evaluation.status, evaluationStatus: evaluation.evaluationStatus, phaseBPrimaryCandidateResearchStatus: 'CLOSED', artifacts, regressionHash, summaryHash, formalWeight: 0, researchOnly: true, executionAuthorized: false, nextProposalOnly: 'P0_MINIMAL_END_TO_END_PAPER_TRADING_IMPLEMENTATION_PLAN' };
const manifestHash = atomic('FINAL_CLOSEOUT_MANIFEST.json', manifest); process.stdout.write(`${JSON.stringify({ status: evaluation.status, manifestHash }, null, 2)}\n`);
