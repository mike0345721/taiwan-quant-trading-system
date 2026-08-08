import assert from 'node:assert/strict';
import test from 'node:test';

import {
  negativeControlDigest,
  runLowCostNegativeControls,
} from '../src/phase-a-negative-controls.mjs';

function seededRows(length = 220) {
  let state = 123456789;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length }, (_, index) => {
    const factorValue = random() * 2 - 1;
    return {
      decisionTradeDate: `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      factorValue,
      targetValue: factorValue + (random() - 0.5) * 0.15,
    };
  });
}

function a12Result(overrides = {}) {
  return {
    evaluationStatus: 'DESCRIPTIVE_COMPLETE',
    evaluationQuintiles: {
      standardizedTopMinusBottom: 1.2,
    },
    evaluationStability: {
      top5ContributionShare: 0.10,
    },
    ...overrides,
  };
}

test('A13相同輸入與固定種子產生完全相同結果', () => {
  const input = {
    factorId: 'factor_a',
    targetId: 'target_a',
    evaluationRows: seededRows(),
    a12Result: a12Result(),
    globalSeed: 20260730,
  };
  const first = runLowCostNegativeControls(input);
  const second = runLowCostNegativeControls(input);
  assert.equal(negativeControlDigest(first), negativeControlDigest(second));
  assert.deepEqual(first, second);
});

test('清楚且非集中於少數日期的關係只取得Round 2運算資格，不得晉升', () => {
  const result = runLowCostNegativeControls({
    factorId: 'factor_strong',
    targetId: 'target_strong',
    evaluationRows: seededRows(),
    a12Result: a12Result(),
    globalSeed: 20260730,
  });
  assert.equal(result.evaluationStatus, 'PROVISIONAL_ROUND2_PASS');
  assert.equal(result.computeAllocationEligible, true);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.formalWeight, 0);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.nextAllowedStep, 'A20_REQUIRES_PRODUCT_OWNER_APPROVAL');
});

test('資料不足時不得執行假檢定或假裝通過', () => {
  const result = runLowCostNegativeControls({
    factorId: 'factor_short',
    targetId: 'target_short',
    evaluationRows: seededRows(20),
    a12Result: a12Result({ evaluationStatus: 'INSUFFICIENT_DATA' }),
    globalSeed: 20260730,
  });
  assert.equal(result.evaluationStatus, 'INSUFFICIENT_DATA');
  assert.equal(result.movingBlockPlacebo, null);
  assert.equal(result.computeAllocationEligible, false);
  assert.equal(result.promotionEligible, false);
});

test('A13不改動輸入配對資料', () => {
  const rows = seededRows();
  const before = JSON.stringify(rows);
  runLowCostNegativeControls({
    factorId: 'factor_immutable',
    targetId: 'target_immutable',
    evaluationRows: rows,
    a12Result: a12Result(),
    globalSeed: 20260730,
  });
  assert.equal(JSON.stringify(rows), before);
});
