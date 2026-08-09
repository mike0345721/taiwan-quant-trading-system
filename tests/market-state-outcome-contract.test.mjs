import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_STATE_OUTCOME_CONTRACT_V1,
  returnBps,
  openingGapContinuous,
  sessionExcursions,
  trendRangeStructure,
  first60mContinuation,
  sampleInterpretation,
} from '../src/market-state-outcome-contract.mjs';

test('owner-approved contract is continuous-first, single-axis and non-executable', () => {
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.ownerApproved, true);
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.primaryAnalysis, 'CONTINUOUS_FIRST');
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.linkageMode, 'SINGLE_AXIS_ONLY');
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.formalWeight, 0);
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.researchOnly, true);
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.executionAuthorized, false);
  for (const outcome of Object.values(MARKET_STATE_OUTCOME_CONTRACT_V1.outcomes)) {
    assert.equal(outcome.binaryThresholdAuthorized, false);
  }
});

test('risk ELEVATED is research context only and is not canonicalized', () => {
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.riskHandling.linkageField, 'riskResearchContext');
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.riskHandling.canonicalProductRiskState, false);
  assert.equal(MARKET_STATE_OUTCOME_CONTRACT_V1.riskHandling.elevatedCanonicalized, false);
});

test('basis-point return and opening gap are deterministic continuous measures', () => {
  assert.equal(returnBps(20000, 20200), 100);
  assert.deepEqual(openingGapContinuous({ priorNightClose: 20000, dayOpen: 20100 }), {
    gapPoints: 100,
    gapBps: 50,
  });
});

test('session excursions expose continuous move and downside measures', () => {
  const result = sessionExcursions({
    sessionOpen: 20000,
    sessionHigh: 20200,
    sessionLow: 19800,
    sessionClose: 20100,
  });
  assert.equal(result.upExcursionBps, 100);
  assert.equal(result.downExcursionBps, 100);
  assert.equal(result.maxExcursionBps, 100);
  assert.equal(result.sessionReturnBps, 50);
  assert.equal(result.downsideExcursionBps, 100);
  assert.equal(result.closeRecoveryFromLowBps, 150);
});

test('trend/range structure uses frozen path efficiency and close location formulas', () => {
  const result = trendRangeStructure({
    sessionOpen: 100,
    sessionHigh: 110,
    sessionLow: 95,
    sessionClose: 108,
    path: [100, 102, 101, 105, 108],
  });
  assert.equal(result.sessionReturnBps, 800);
  assert.equal(result.closeLocation, 13 / 15);
  assert.equal(result.pathEfficiency, 8 / 10);
});

test('trend/range path cannot silently start or end on a different price', () => {
  assert.throws(() => trendRangeStructure({
    sessionOpen: 100,
    sessionHigh: 110,
    sessionLow: 95,
    sessionClose: 108,
    path: [101, 105, 108],
  }), /OUTCOME_PATH_BOUNDARY_MISMATCH/);
});

test('first 60m continuation is signed relative to the opening-leg direction', () => {
  const up = first60mContinuation({ p0845: 20000, p0900: 20100, p0945: 20200 });
  assert.equal(up.openingLegBps, 50);
  assert.equal(up.continuationRawBps, 50);
  assert.equal(up.total60mBps, 100);
  assert.equal(up.continuationInOpeningDirectionBps, 50);
  assert.equal(up.unavailableReason, null);

  const reversal = first60mContinuation({ p0845: 20000, p0900: 19900, p0945: 20000 });
  assert.equal(reversal.openingLegBps, -50);
  assert.equal(reversal.continuationRawBps, 50);
  assert.equal(reversal.total60mBps, 0);
  assert.equal(reversal.continuationInOpeningDirectionBps, -50);
});

test('flat opening leg does not invent a persistence direction', () => {
  const result = first60mContinuation({ p0845: 20000, p0900: 20000, p0945: 20100 });
  assert.equal(result.continuationInOpeningDirectionBps, null);
  assert.equal(result.unavailableReason, 'FLAT_OPENING_LEG');
});

test('sample policy is frozen before outcome exposure', () => {
  assert.equal(sampleInterpretation(19), 'DO_NOT_INTERPRET');
  assert.equal(sampleInterpretation(20), 'DESCRIPTIVE_ONLY');
  assert.equal(sampleInterpretation(29), 'DESCRIPTIVE_ONLY');
  assert.equal(sampleInterpretation(30), 'EFFECT_SIZE_AND_CI_ALLOWED');
});
