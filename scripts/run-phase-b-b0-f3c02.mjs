import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  APPROVED, atomicJson, canonicalJson, contractCompleteness, sha256Buffer, sha256File,
} from '../src/phase-b-b0-contract-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'data', 'research', 't0-h0-phase-b-baseline-v1', 'freeze-2026-08-02');
const runDir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v1');
const draftPath = path.join(sourceDir, 'B0_PREREGISTRATION_DRAFT_MANIFEST.json');
const validationPath = path.join(sourceDir, 'B0_PREREGISTRATION_V3_VALIDATION.json');
const baselinePath = path.join(sourceDir, 'T0_H0_PHASE_B_BASELINE_FREEZE_MANIFEST.json');

function hardAssert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeOnceOrVerify(filePath, payload) {
  const encoded = canonicalJson(payload);
  const logicalHash = sha256Buffer(encoded);
  if (fs.existsSync(filePath)) {
    hardAssert(sha256File(filePath) === logicalHash, `existing_output_hash_mismatch:${path.basename(filePath)}`);
    return { path: filePath, hash: logicalHash, reused: true };
  }
  atomicJson(filePath, payload);
  hardAssert(sha256File(filePath) === logicalHash, `atomic_commit_hash_mismatch:${path.basename(filePath)}`);
  return { path: filePath, hash: logicalHash, reused: false };
}

try {
  hardAssert(sha256File(draftPath) === APPROVED.draftManifestHash, 'draft_manifest_hash_mismatch');
  hardAssert(sha256File(validationPath) === APPROVED.validationEvidenceHash, 'validation_evidence_hash_mismatch');
  hardAssert(sha256File(baselinePath) === APPROVED.baselineFreezeHash, 'baseline_freeze_hash_mismatch');

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  hardAssert(sha256File(path.join(sourceDir, draft.ownerBrief.path)) === APPROVED.ownerBriefHash, 'owner_brief_hash_mismatch');

  const contracts = [];
  const contractsById = {};
  for (const reference of draft.contracts) {
    const contractPath = path.join(sourceDir, reference.path);
    hardAssert(sha256File(contractPath) === reference.sha256, `contract_hash_mismatch:${reference.contractId}`);
    const payload = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    hardAssert(payload.baselineFreezeManifestHash === APPROVED.baselineFreezeHash, `contract_baseline_hash_mismatch:${reference.contractId}`);
    contracts.push({ ...reference });
    contractsById[reference.contractId] = payload;
  }

  const freezeCore = {
    schemaVersion: 'phase-b-b0-f3c02-preregistration-freeze-v1',
    freezeStatus: 'FROZEN',
    baselineId: 'T0_H0_PHASE_B_BASELINE_V1',
    candidateId: 'F3C02',
    phaseBRole: 'RISK_VETO',
    interventionType: 'NO_TRADE_VETO',
    ownerBriefHash: APPROVED.ownerBriefHash,
    draftManifestHash: APPROVED.draftManifestHash,
    validationEvidenceHash: APPROVED.validationEvidenceHash,
    baselineFreezeHash: APPROVED.baselineFreezeHash,
    t0FormalRunLogicalHash: draft.baseline.formalRunLogicalHash,
    candidateEvidenceHash: 'e5fe4583473045c9e6b5e9506ba868e486102f708697ae36de800c944a34cc7f',
    a22ArtifactHash: '15fe9ef86b14a057e8ba16d29910508a1e20050933c73d04925d4a03bb607cb3',
    activeCohortHash: '486a8552f1ce07e123f2456391bffda98bcbb55995a9e1461e63c5fcf2389999',
    eligibleRegistryHash: 'ced63c6cc2aaacc4bb96d8ae21c6aa67bc3d11a32507f07a988dd7bcc8ccd6dd',
    contracts,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  const freezeLogicalHash = sha256Buffer(canonicalJson(freezeCore));
  const freeze = { ...freezeCore, freezeLogicalHash };
  const freezeOutput = writeOnceOrVerify(path.join(runDir, 'B0_F3C02_PREREGISTRATION_FREEZE_MANIFEST.json'), freeze);

  const gate = contractCompleteness(contractsById);
  const gatePayload = {
    schemaVersion: 'phase-b-b0-contract-completeness-gate-v1',
    candidateId: 'F3C02',
    preregistrationFreezeLogicalHash: freezeLogicalHash,
    ...gate,
    nextStageAllowed: gate.status === 'PASS',
    prohibitedOutputsCreated: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  const gateOutput = writeOnceOrVerify(path.join(runDir, 'CONTRACT_COMPLETENESS_GATE.json'), gatePayload);
  const status = {
    schemaVersion: 'phase-b-b0-run-status-v1',
    runId: 'phase-b-b0-f3c02-run-2026-08-02-v1',
    status: gate.status,
    stoppedAtGate: 'CONTRACT_COMPLETENESS_GATE',
    freezeManifestHash: freezeOutput.hash,
    contractGateHash: gateOutput.hash,
    a22ReproductionStarted: false,
    thresholdCreated: false,
    s0s1Created: false,
    performanceCalculated: false,
    bootstrapExecuted: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  writeOnceOrVerify(path.join(runDir, 'RUN_STATUS.json'), status);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (gate.status !== 'PASS') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

