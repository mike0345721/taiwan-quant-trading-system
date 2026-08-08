import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTwseIndexPayload, parseTwseInstitutionPayload } from '../src/twse-core-history.mjs';

test('parses official TAIEX index row', () => {
  const payload = { stat: 'OK', date: '20260709', tables: [{ data: [['發行量加權股價指數', '45,354.61', '<p>-</p>', '379.80', '-0.83']] }] };
  assert.deepEqual(parseTwseIndexPayload(payload, '2026-07-09'), { close: 45354.61, change: -379.8, changePct: -0.83 });
});

test('parses official institutional categories without merging dealer hedge', () => {
  const payload = { stat: 'OK', date: '20260709', data: [
    ['自營商(自行買賣)', '8,000,000,000', '10,000,000,000', '-2,000,000,000'],
    ['自營商(避險)', '15,000,000,000', '20,000,000,000', '-5,000,000,000'],
    ['投信', '29,000,000,000', '10,000,000,000', '19,000,000,000'],
    ['外資及陸資(不含外資自營商)', '53,000,000,000', '100,000,000,000', '-47,000,000,000'],
  ] };
  assert.deepEqual(parseTwseInstitutionPayload(payload, '2026-07-09'), {
    foreignBuyE: 530, foreignSellE: 1000, foreignNetE: -470,
    trustBuyE: 290, trustSellE: 100, trustNetE: 190,
    dealerProprietaryBuyE: 80, dealerProprietarySellE: 100, dealerProprietaryNetE: -20,
    dealerHedgeBuyE: 150, dealerHedgeSellE: 200, dealerHedgeNetE: -50,
    dealerTotalNetE: -70, institutionalTotalE: -350,
    institutionalBuyE: 1050, institutionalSellE: 1400,
  });
});
