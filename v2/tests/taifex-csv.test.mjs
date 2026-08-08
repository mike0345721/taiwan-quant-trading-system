import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatedOptionExpiry, monthRanges, optionStructure, parseFuturesCsv, parseOptionsCsv } from '../src/taifex-csv.mjs';

test('parses TAIFEX futures regular-session CSV and ignores night rows', () => {
  const csv = `交易日期,契約,到期月份(週別),開盤價,最高價,最低價,收盤價,漲跌價,漲跌%,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段,價差對單式委託成交量\n2025/07/01,TX,202507,22197,22593,22191,22353,209,0.94%,86050,22352,107188,22350,22353,22593,18558,,一般,,\n2025/07/01,TX,202507,22138,22160,22013,22160,16,0.07%,28118,-,-,22154,22161,22263,18558,,盤後,,`;
  const rows = parseFuturesCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tradeDate, '2025-07-01');
  assert.equal(rows[0].close, 22353);
  assert.equal(rows[0].openInterest, 107188);
});

test('parses TAIFEX option Call and Put rows', () => {
  const csv = `交易日期,契約,到期月份(週別),履約價,買賣權,開盤價,最高價,最低價,收盤價,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段,漲跌價,漲跌%,\n2025/07/01,TXO,202507W1,19500.0000,買權,-,-,-,-,0,3010,0,2950,3120,-,-,,一般,-,-,\n2025/07/01,TXO,202507W1,19500.0000,賣權,0.9,0.9,0.2,0.3,673,0.1,1445,0.2,0.3,11.5,0.2,,一般,-0.8,-72.73%,`;
  const rows = parseOptionsCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].right, '賣權');
  assert.equal(rows[1].openInterest, 1445);
});

test('builds monthly ranges, estimated expiries, and option structure', () => {
  assert.deepEqual(monthRanges('2025-07-07', '2025-08-05'), [
    { start: '2025-07-07', end: '2025-07-31' },
    { start: '2025-08-01', end: '2025-08-05' },
  ]);
  assert.equal(estimatedOptionExpiry('202507'), '2025-07-16');
  assert.equal(estimatedOptionExpiry('202507W1'), '2025-07-02');
  const structure = optionStructure(new Map([
    [100, { strike: 100, callOi: 10, putOi: 100 }],
    [110, { strike: 110, callOi: 120, putOi: 20 }],
  ]));
  assert.equal(structure.callWall.strike, 110);
  assert.equal(structure.putWall.strike, 100);
});
