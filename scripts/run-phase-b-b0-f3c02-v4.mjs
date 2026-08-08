import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'preregistration-v4');
const runDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const expected = {
  brief: 'a1ff65922e4e57a2909dd9d9c9c765fe3c642f337421004a85fac8212766f9f9',
  contract: 'b4c5024cbb9679a0cb998f541924b697e30efd394b2a1e396e8c9ab6efd638c6',
  draft: '8066196fe828653c63efcf22744aa9bb969b96cf6b9786f5fe453d1b9805aa54',
  baseline: '9664ca8777cfdf827e6383b952ac006f7577f59c0abe86e7182d44e8dd2451cf',
};

const hashFile = (file) => sha256Hex(fs.readFileSync(file));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function assert(condition, message) { if (!condition) throw new Error(message); }
function atomicJcs(file, value) {
  const bytes = Buffer.from(jcsNfc(value), 'utf8');
  if (fs.existsSync(file)) {
    assert(hashFile(file) === sha256Hex(bytes), `existing_output_hash_mismatch:${path.basename(file)}`);
    return hashFile(file);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
  return hashFile(file);
}

try {
  assert(!fs.existsSync(runDir), 'HARD_FAIL_RUN_ID_EXISTS');
  fs.mkdirSync(runDir, { recursive: false });
  const briefPath = path.join(sourceDir, 'B0_F3C02_OWNER_BRIEF_V4.md');
  const contractPath = path.join(sourceDir, 'B0_F3C02_EXECUTION_CONTRACT_V4.json');
  const draftPath = path.join(sourceDir, 'B0_F3C02_DRAFT_MANIFEST_V4.json');
  const baselinePath = path.join(root, 'data', 'research', 't0-h0-phase-b-baseline-v1', 'freeze-2026-08-02', 'T0_H0_PHASE_B_BASELINE_FREEZE_MANIFEST.json');
  assert(hashFile(briefPath) === expected.brief, 'owner_brief_hash_mismatch');
  assert(hashFile(contractPath) === expected.contract, 'contract_bundle_hash_mismatch');
  assert(hashFile(draftPath) === expected.draft, 'draft_manifest_hash_mismatch');
  assert(hashFile(baselinePath) === expected.baseline, 'baseline_freeze_hash_mismatch');
  const contract = readJson(contractPath);
  const draft = readJson(draftPath);
  const freezeCore = {
    schemaVersion: 'b0-f3c02-preregistration-freeze-v4',
    ownerBriefHash: expected.brief,
    draftManifestHash: expected.draft,
    contractBundleHash: expected.contract,
    baselineFreezeHash: expected.baseline,
    t0FormalRunLogicalHash: draft.t0FormalRunLogicalHash,
    candidateEvidenceHash: draft.candidateEvidenceHash,
    a22ArtifactHash: draft.a22ArtifactHash,
    activeCohortHash: draft.activeCohortHash,
    eligibleRegistryHash: draft.eligibleRegistryHash,
    candidateId: 'F3C02', phaseBRole: 'RISK_VETO', interventionType: 'NO_TRADE_VETO',
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const freezeLogicalHash = sha256Hex(Buffer.from(jcsNfc(freezeCore), 'utf8'));
  const freeze = { ...freezeCore, freezeLogicalHash };
  const freezeHash = atomicJcs(path.join(runDir, 'B0_F3C02_PREREGISTRATION_FREEZE_MANIFEST_V4.json'), freeze);
  const checks = {
    prngAlgorithm: contract.prng?.algorithm === 'XOSHIRO256_STAR_STAR_V1',
    hashToSeed: contract.seedMaterial?.digest === 'SHA256_OF_JCS_NFC_UTF8' && contract.seedMaterial?.stateMapping === 'FOUR_UNSIGNED_64_BIG_ENDIAN_WORDS',
    canonicalSerialization: contract.canonicalSerialization?.id === 'RFC_8785_JCS_WITH_NFC_PRENORMALIZATION_V1',
    numericPrecision: contract.numericPrecision?.id === 'IEEE_754_BINARY64_V1',
    unavailable: contract.unavailable?.invalidAction === 'SCHEMA_HARD_FAIL',
    permutation: contract.scorePermutation?.algorithm === 'WITHIN_FOLD_FINITE_OOS_FISHER_YATES_V1',
    randomFeature: contract.randomFeature?.algorithm === 'EMPIRICAL_TRAIN_FOLD_RESAMPLE_WITH_REPLACEMENT_V1',
    randomDistribution: contract.randomFeature?.distribution === 'UNIFORM_EMPIRICAL_TRAIN_FOLD_MARGINAL',
    bootstrap: contract.bootstrap?.iterations === 2000 && jcsNfc(contract.bootstrap?.blockLengths) === '[5,10]',
    noPlaceholder: !/PLACEHOLDER|IMPLEMENTATION_DEFINED|LIBRARY_DEFAULT|MULTIPLE_VALID_OPTIONS/i.test(jcsNfc(contract)),
  };
  const contractGate = {
    schemaVersion: 'b0-f3c02-contract-completeness-gate-v4', status: Object.values(checks).every(Boolean) ? 'PASS' : 'HARD_FAIL', checks,
    knownAnswerTestsRequired: true,
    freezeLogicalHash,
    environment: { node: process.version, v8: process.versions.v8, operatingSystem: os.platform(), architecture: os.arch() },
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const gateHash = atomicJcs(path.join(runDir, 'CONTRACT_COMPLETENESS_GATE_V4.json'), contractGate);
  const status = {
    schemaVersion: 'b0-f3c02-run-status-v2', runId: 'run-2026-08-02-v4', status: contractGate.status === 'PASS' ? 'CONTRACT_GATE_PASS_AWAITING_RESEARCH_STAGES' : 'HARD_FAIL',
    currentStage: 'CONTRACT_COMPLETENESS_GATE', freezeHash, freezeLogicalHash, contractGateHash: gateHash,
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  atomicJcs(path.join(runDir, 'RUN_STATUS.json'), status);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (contractGate.status !== 'PASS') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
