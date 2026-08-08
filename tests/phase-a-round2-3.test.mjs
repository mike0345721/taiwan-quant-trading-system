import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEvidenceBlocks,
  buildRedundancyClusters,
  freezeF3Candidates,
  runStrongControls,
  validateStagePayload,
} from '../src/phase-a-round2-3.mjs';

function rows() {
  const output = [];
  for (let index = 0; index < 140; index += 1) {
    const date = `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`;
    output.push({ decisionTradeDate: date, factorId: 'cash_a', factorGroup: 'Cash', qualityState: 'PASS', value: index });
    output.push({ decisionTradeDate: date, factorId: 'cash_b', factorGroup: 'Cash', qualityState: 'PASS', value: index * 2 });
    output.push({ decisionTradeDate: date, factorId: 'futures_a', factorGroup: 'Futures', qualityState: 'PASS', value: Math.sin(index) });
  }
  return output;
}

test('A20 redundancy以coverage及factorId選代表，不使用Target表現', () => {
  const result = buildRedundancyClusters(rows());
  const cluster = result.clusters.find((item) => item.members.includes('cash_a'));
  assert.deepEqual(cluster.members, ['cash_a', 'cash_b']);
  assert.equal(cluster.representative, 'cash_a');
  assert.equal(cluster.targetPerformanceUsed, false);
});

test('A21 Evidence Block只納入A13通過者並去除重複代表', () => {
  const featureRows = rows();
  const redundancy = buildRedundancyClusters(featureRows);
  const evidence = buildEvidenceBlocks({
    featureRows,
    redundancy,
    a13Results: [
      { factorId: 'cash_a', targetId: 'next_day_direction', computeAllocationEligible: true },
      { factorId: 'cash_b', targetId: 'next_day_direction', computeAllocationEligible: true },
      { factorId: 'futures_a', targetId: 'next_day_direction', computeAllocationEligible: false },
    ],
  });
  const cash = evidence.blocks.find((block) => block.blockId === 'CASH__next_day_direction');
  assert.deepEqual(cash.factors, ['cash_a']);
  assert.equal(cash.createsSignal, false);
});

test('A30最多五個候選且契約敏感因子不可Promotion', () => {
  const studies = Array.from({ length: 7 }, (_, index) => ({
    strongControlPass: true,
    studyId: `S${index}`,
    blockId: `B${index}`,
    factorGroup: 'Futures',
    targetId: 'next_day_direction',
    modelId: 'RIDGE_LOGISTIC',
    factors: [index === 0 ? 'term_spread_bps' : `f${index}`],
    holm: { adjustedP: 0.001 + index / 1000 },
    aggregate: { relativeImprovement: 0.02 },
  }));
  const frozen = freezeF3Candidates({ studies }, ['term_spread_bps']);
  assert.equal(frozen.candidates.length, 5);
  assert.equal(frozen.candidates[0].contractPolicyStatus, 'PROVISIONAL');
  assert.equal(frozen.candidates.every((item) => item.promotionEligible === false), true);
});

test('A23強負控制使用固定Seed時可重現', () => {
  const predictions = Array.from({ length: 80 }, (_, index) => ({
    date: String(index), outcome: index / 100, prediction: index / 100 + 0.001, baseline: 0.4,
    volatilityRegime: index % 2 ? 'HIGH_VOL' : 'LOW_VOL', trendRegime: 'TREND', settlementRegime: 'NON_SETTLEMENT',
  }));
  const input = { studies: [{
    blockId: 'CASH__next_day_tx_return', factorGroup: 'Cash', targetId: 'next_day_tx_return', targetKind: 'continuous',
    modelId: 'RIDGE_REGRESSION', factors: ['cash_a'], predictions, positiveFoldShare: 1,
    aggregate: { improvement: 0.1, relativeImprovement: 0.2 },
  }] };
  assert.deepEqual(runStrongControls(input, 20260730), runStrongControls(input, 20260730));
});

test('Stage輸出Schema強制安全邊界及Hash欄位', () => {
  const hash = 'a'.repeat(64);
  assert.equal(validateStagePayload('A20', {
    stage: 'A20', snapshotHash: hash, specHash: hash, targetSpecHash: hash,
    featureSpecHash: hash, blockerPatchHash: hash, redundancy: {},
    researchOnly: true, formalWeight: 0, executionAuthorized: false,
  }), true);
  assert.throws(() => validateStagePayload('A20', {
    stage: 'A20', snapshotHash: hash, specHash: hash, targetSpecHash: hash,
    featureSpecHash: hash, blockerPatchHash: hash, redundancy: {},
    researchOnly: true, formalWeight: 1, executionAuthorized: false,
  }), /safeguards/);
});
