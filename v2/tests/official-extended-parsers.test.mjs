import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTpexBreadth, parseTwseBreadth, parseTwseLendingBalance, parseTwseShortLending } from '../src/official-extended-parsers.mjs';

test('parses TWSE stock breadth rather than entire securities universe', () => {
  const result = parseTwseBreadth({ tables: [{ title: '漲跌證券數合計', data: [
    ['上漲(漲停)', '2,000(50)', '411(11)'], ['下跌(跌停)', '3,000(40)', '552(6)'], ['持平', '100', '20'],
  ] }] });
  assert.deepEqual(result, { advance: 411, decline: 552, unchanged: 20, limitUp: 11, limitDown: 6, universeScope: 'TWSE_COMMON_STOCK_COLUMN' });
});

test('derives TPEx breadth only from four-digit common stocks', () => {
  const result = parseTpexBreadth({ tables: [{ fields: ['代號','名稱','收盤','漲跌'], data: [
    ['1234','A','11','1'], ['5678','B','9','-1'], ['00679B','ETF','10','1'],
  ] }] });
  assert.equal(result.advance, 1); assert.equal(result.decline, 1); assert.equal(result.limitUp, 1); assert.equal(result.limitDown, 1);
});

test('aggregates TWSE lending and actual short-lending separately', () => {
  assert.deepEqual(parseTwseLendingBalance({ stat:'OK', data:[['2330','台積電','0','10','3','100']] }),
    { lendingNew:10, lendingReturn:3, lendingBalance:100 });
  assert.deepEqual(parseTwseShortLending({ stat:'OK', data:[['2330','台積電','0','0','0','0','0','0','0','9','2','1','80','20','']] }),
    { shortSaleQuantity:9, shortSaleBuyback:2, shortSaleAdjustment:1, shortSaleBalance:80, availableToShort:20 });
});
