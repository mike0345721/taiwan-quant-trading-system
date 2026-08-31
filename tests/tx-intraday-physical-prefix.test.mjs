import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const OPTIONS = Object.freeze({
  sourceLedgerIdentity: 'ledger-cru34-prefix',
  instrumentProfile: Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 }),
});

function tick(hash, second, price) {
  const eventTime = `2026-08-26T09:00:${String(second).padStart(2, '0')}+08:00`;
  return {
    kind: 'futures_tick',
    code: 'TXFI6',
    product: 'TXFI6',
    receivedAt: eventTime,
    exchangeTimestamp: eventTime,
    recordHash: hash,
    duplicate: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6',
      eventTime, datetime: eventTime, tradeDate: '2026-08-26', session: 'DAY',
      simtrade: false, price, close: price, executedVolume: 1, volume: 1, tick_type: 1,
    },
  };
}

function chain(records) {
  let previousHash = 'GENESIS';
  return records.map((record) => {
    const linked = { ...record, previousHash };
    previousHash = record.recordHash;
    return linked;
  });
}

test('contiguous governed prefix is accepted', () => {
  const records = chain([tick('t1', 0, 100), tick('t2', 10, 101), tick('t3', 20, 102)]);
  const snapshot = buildTxIntradayResearchSnapshot(records, OPTIONS);
  assert.notEqual(snapshot.unavailableReason, 'PHYSICAL_LEDGER_PREFIX_UNVERIFIED');
  assert.equal(snapshot.lineage.inputPrefixStatus, 'VERIFIED_CONTIGUOUS_HASH_CHAIN_PREFIX');
  assert.equal(snapshot.lineage.inputPrefixRecordCount, 3);
  assert.equal(snapshot.lineage.inputPrefixTerminalHash, 't3');
});

test('filtered ledger with a missing physical middle record fails closed', () => {
  const records = chain([tick('t1', 0, 100), tick('t2', 10, 101), tick('t3', 20, 102)]);
  const filtered = [records[0], records[2]];
  const snapshot = buildTxIntradayResearchSnapshot(filtered, OPTIONS);
  assert.equal(snapshot.status, 'UNAVAILABLE');
  assert.equal(snapshot.unavailableReason, 'PHYSICAL_LEDGER_PREFIX_UNVERIFIED');
  assert.equal(snapshot.lineage.inputPrefixStatus, 'INVALID_HASH_CHAIN_CONTINUITY');
  assert.equal(snapshot.lineage.inputPrefixFailingLedgerOrdinal, 2);
});

test('missing hash-chain lineage fields fail closed', () => {
  const records = [tick('t1', 0, 100), tick('t2', 10, 101), tick('t3', 20, 102)];
  const snapshot = buildTxIntradayResearchSnapshot(records, OPTIONS);
  assert.equal(snapshot.status, 'UNAVAILABLE');
  assert.equal(snapshot.unavailableReason, 'PHYSICAL_LEDGER_PREFIX_UNVERIFIED');
  assert.equal(snapshot.lineage.inputPrefixStatus, 'UNVERIFIED_HASH_CHAIN_FIELDS_MISSING');
});