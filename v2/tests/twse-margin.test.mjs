import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTwseMarginPayload } from '../src/twse-margin.mjs';

test('parses official financing amount and short balance units', () => {
  const payload = { stat: 'OK', date: '20260709', tables: [{ data: [
    ['融資(交易單位)', '1', '2', '3', '4', '9,614,955'],
    ['融券(交易單位)', '1', '2', '3', '4', '203,714'],
    ['融資金額(仟元)', '1', '2', '3', '4', '619,648,244'],
  ] }] };
  assert.deepEqual(parseTwseMarginPayload(payload, '2026-07-09'), {
    tradeDate: '2026-07-09', marginBalanceE: 6196.48244, shortBalanceLots: 203714,
  });
});
