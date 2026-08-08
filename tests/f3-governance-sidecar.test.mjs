import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'data', 'research', 'f3-governance-v2', 'owner-review-2026-08-02');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
const fileHash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('F3 registry preserves Cohort A and contains every required governance field', () => {
  const registry = readJson('F3_ELIGIBLE_REGISTRY.json');
  const required = [
    'candidateId', 'marketMechanism', 'economicRationale', 'productRole', 'evidenceBlock',
    'fixedFactors', 'fixedFormula', 'fixedTarget', 'expectedDirection', 'availableAt',
    'baselineDefinition', 'rejectionCriteria', 'validationMethod', 'overlappingCandidates',
    'redundancyCluster', 'contractPolicyStatus', 'evidenceHash',
  ];
  assert.equal(registry.candidates.length, 9);
  for (const candidate of registry.candidates) {
    for (const field of required) assert.ok(Object.hasOwn(candidate, field), `${candidate.candidateId} missing ${field}`);
    assert.equal(candidate.evaluationStatus, 'PENDING');
    assert.equal(candidate.promotionEligible, false);
    assert.equal(candidate.formalWeight, 0);
    assert.equal(candidate.researchOnly, true);
    assert.equal(candidate.executionAuthorized, false);
  }
  assert.deepEqual(
    registry.candidates.filter((row) => row.cohortId === 'F3_ACTIVE_COHORT_A').map((row) => row.candidateId),
    ['F3C01', 'F3C02', 'F3C03', 'F3C04', 'F3C05'],
  );
});

test('deferred order is frozen without rescuing original F2 failures', () => {
  const registry = readJson('F3_ELIGIBLE_REGISTRY.json');
  const deferred = readJson('F3_DEFERRED_COHORTS.json');
  assert.deepEqual([...deferred.cohortB, ...deferred.cohortC].map((row) => row.priority), [1, 2, 3, 4]);
  assert.ok(registry.classifications.some((row) => row.factorId === 'contract_changed' && row.classification === 'REJECTED'));
  assert.ok(registry.excludedF2FailRescue.some((row) => row.factorId === 'basis_change_5d_bps'));
});

test('target-family capacity and immutable evidence hashes remain valid', () => {
  const coverage = readJson('F3_REDUNDANCY_AND_COVERAGE_MAP.json');
  const registry = readJson('F3_ELIGIBLE_REGISTRY.json');
  assert.equal(coverage.allTargetFamiliesWithinCapacity, true);
  assert.ok(coverage.targetFamilyChecks.every((row) => row.primaryCount <= 1 && row.challengerCount <= 1));
  const phaseAEvidence = path.join(ROOT, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2', 'reports', 'PHASE_A_EVIDENCE.json');
  const reconciledView = path.join(ROOT, 'data', 'research', 'pp1-contract-reconciliation-v1', 'run-2026-08-01', 'PHASE_A_RECONCILED_VIEW.json');
  assert.equal(fileHash(phaseAEvidence), registry.phaseAOriginalEvidenceHash);
  assert.equal(fileHash(reconciledView), registry.phaseAReconciledViewHash);
  assert.equal(registry.formalWeight, 0);
  assert.equal(registry.researchOnly, true);
  assert.equal(registry.executionAuthorized, false);
});
