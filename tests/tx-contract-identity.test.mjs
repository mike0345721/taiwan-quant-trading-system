import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareTxContractIdentity,
  normalizeTxEodContractMonth,
  txLiveContractMonth,
} from '../src/tx-contract-identity.mjs';

test('TXFI6 on 2026-09 trade date canonicalizes to 202609', () => {
  assert.equal(txLiveContractMonth('TXFI6', '2026-09-07'), '202609');
});

test('canonical comparison accepts different raw encodings of the same TX expiry', () => {
  const result = compareTxContractIdentity({
    liveContract: 'TXFI6',
    liveContractMonth: '202609',
    tradeDate: '2026-09-07',
    eodContract: '202609',
  });
  assert.equal(result.compatible, true);
  assert.equal(result.state, 'COMPATIBLE');
  assert.equal(result.reason, null);
  assert.equal(result.liveContract, 'TXFI6');
  assert.equal(result.liveContractMonth, '202609');
  assert.equal(result.eodContractMonth, '202609');
});

test('canonical comparison rejects a true different expiry month', () => {
  const result = compareTxContractIdentity({
    liveContract: 'TXFI6',
    tradeDate: '2026-09-07',
    eodContract: '202610',
  });
  assert.equal(result.compatible, false);
  assert.equal(result.state, 'MISMATCH');
  assert.equal(result.reason, 'ACTUAL_CONTRACT_MISMATCH');
});

test('canonical comparison fails closed on missing or unsupported identity', () => {
  const result = compareTxContractIdentity({
    liveContract: 'TXFR1',
    tradeDate: '2026-09-07',
    eodContract: '202609',
  });
  assert.equal(result.compatible, false);
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reason, 'CONTRACT_IDENTITY_INCOMPLETE');
});

test('canonical comparison accepts canonical raw identity from governed replay', () => {
  assert.equal(compareTxContractIdentity({
    liveContract: '202609',
    liveContractMonth: '202609',
    tradeDate: '2026-09-07',
    eodContract: '202609',
  }).compatible, true);
});

test('canonical comparison fails closed when declared month contradicts raw live lineage', () => {
  assert.deepEqual(compareTxContractIdentity({
    liveContract: 'TXFI6',
    liveContractMonth: '202610',
    tradeDate: '2026-09-07',
    eodContract: '202610',
  }), {
    compatible: false,
    state: 'UNAVAILABLE',
    reason: 'CONTRACT_IDENTITY_INCOMPLETE',
    liveContract: 'TXFI6',
    liveContractMonth: null,
    eodContractMonth: '202610',
  });
});

test('canonical comparison does not let an explicit month rescue unsupported raw lineage', () => {
  assert.equal(compareTxContractIdentity({
    liveContract: 'TX-UNKNOWN',
    liveContractMonth: '202609',
    tradeDate: '2026-09-07',
    eodContract: '202609',
  }).reason, 'CONTRACT_IDENTITY_INCOMPLETE');
});

test('EOD contract month normalizer accepts only YYYYMM identity', () => {
  assert.equal(normalizeTxEodContractMonth('202609'), '202609');
  assert.equal(normalizeTxEodContractMonth(' TXFI6 '), null);
  assert.equal(normalizeTxEodContractMonth('202609W1'), null);
});
