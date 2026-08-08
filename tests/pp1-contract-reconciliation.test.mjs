import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_SENSITIVE_FACTORS,
  buildReconciledSourceSeries,
  patchCanonicalFeatures,
  pp1DaySelections,
} from '../src/pp1-contract-reconciliation.mjs';

test('PP-1日盤選擇只抽取指定受影響日期與研究契約', () => {
  const sets = [{
    selectionSetId: 'set-1', sessionId: '2026-01-21-DAY', policySpecHash: 'a'.repeat(64), policyVersion: 'v1',
    records: [
      { contractRole: 'SELECTED_RESEARCH', contractCode: '202601', qualityState: 'PASS', selectedContractExpiryDate: '2026-01-21', timestampLineage: { featureAvailableAt: '2026-01-21T08:45:00+08:00' } },
      { contractRole: 'NEXT_MONTHLY', contractCode: '202602' },
    ],
  }, { selectionSetId: 'set-2', sessionId: '2026-01-22-DAY', records: [] }];
  const result = pp1DaySelections(sets, ['2026-01-21']);
  assert.equal(result.length, 1);
  assert.equal(result[0].selectedResearchContract, '202601');
  assert.equal(result[0].nextMonthlyContract, '202602');
});

test('契約政策變更只修改12個敏感因子，非敏感因子保持原值', () => {
  const oldBasisRows = [
    { trade_date: '2026-01-20', near_contract: '202601', next_contract: '202602', close_basis_bps: 10 },
    { trade_date: '2026-01-21', near_contract: '202602', next_contract: '202603', close_basis_bps: 20 },
  ];
  const oldOiRows = [
    { trade_date: '2026-01-20', near_contract: '202601', near_contract_oi: 100, days_to_near_expiry: 1, rollover_risk: 1, contract_changed: 0 },
    { trade_date: '2026-01-21', near_contract: '202602', near_contract_oi: 200, days_to_near_expiry: 28, rollover_risk: 0, contract_changed: 1 },
  ];
  const contractRows = [
    { trade_date: '2026-01-20', product: 'TX', contract: '202601', close: 1000, open_interest: 100, is_active: 1 },
    { trade_date: '2026-01-20', product: 'TX', contract: '202602', close: 1010, open_interest: 200, is_active: 0 },
    { trade_date: '2026-01-21', product: 'TX', contract: '202601', close: 1020, open_interest: 80, is_active: 0 },
    { trade_date: '2026-01-21', product: 'TX', contract: '202602', close: 1030, open_interest: 220, is_active: 1 },
    { trade_date: '2026-01-21', product: 'TX', contract: '202603', close: 1040, open_interest: 20, is_active: 0 },
  ];
  const spotRows = [{ trade_date: '2026-01-20', twii_close: 995 }, { trade_date: '2026-01-21', twii_close: 1015 }];
  const selections = [{ tradeDate: '2026-01-21', selectedResearchContract: '202601', selectedContractExpiryDate: '2026-01-21', selectionQualityState: 'PASS' }];
  const source = buildReconciledSourceSeries({ contractRows, spotRows, oldBasisRows, oldOiRows, selections });
  assert.equal(source.values.get('near_contract_oi').get('2026-01-21').value, 80);
  assert.equal(source.values.get('days_to_near_expiry').get('2026-01-21').value, 0);
  assert.equal(source.values.get('rollover_risk').get('2026-01-21').value, 1);
  const rows = [
    { factorId: 'near_contract_oi', sourceTradeDate: '2026-01-21', value: 200, sourceContract: '202602', qualityState: 'PASS' },
    { factorId: 'cash_foreign_net', sourceTradeDate: '2026-01-21', value: 999, sourceContract: null, qualityState: 'PASS' },
  ];
  const patched = patchCanonicalFeatures(rows, source);
  assert.equal(patched[0].value, 80);
  assert.equal(patched[0].sourceContract, '202601');
  assert.deepEqual(patched[1], rows[1]);
  assert.equal(CONTRACT_SENSITIVE_FACTORS.length, 12);
});

test('缺少PP-1契約OI時保持未知，不以0補造', () => {
  const source = buildReconciledSourceSeries({
    contractRows: [
      { trade_date: '2026-01-21', product: 'TX', contract: '202601', close: 1000, open_interest: null, is_active: 0 },
      { trade_date: '2026-01-21', product: 'TX', contract: '202602', close: 1010, open_interest: 200, is_active: 1 },
    ],
    spotRows: [{ trade_date: '2026-01-21', twii_close: 990 }],
    oldBasisRows: [{ trade_date: '2026-01-21', near_contract: '202602', next_contract: '202603' }],
    oldOiRows: [{ trade_date: '2026-01-21', near_contract: '202602', near_contract_oi: 200, days_to_near_expiry: 28, rollover_risk: 0, contract_changed: 0 }],
    selections: [{ tradeDate: '2026-01-21', selectedResearchContract: '202601', selectedContractExpiryDate: '2026-01-21', selectionQualityState: 'UNAVAILABLE' }],
  });
  assert.equal(source.values.get('near_contract_oi').get('2026-01-21').value, null);
});
