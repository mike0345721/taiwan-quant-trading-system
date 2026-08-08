import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOfficialFuturesCsv,
  parseOfficialLargeTraderHtml,
  parseOfficialOptionsCsv,
} from '../src/taifex-official.mjs';

test('official futures CSV preserves TX/TMF and day/night sessions', () => {
  const header = '交易日期,契約,到期月份(週別),開盤價,最高價,最低價,收盤價,漲跌價,漲跌%,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段';
  const text = [
    header,
    '2026/07/13,TX,202607,45600,45700,45500,45617,-31,-0.07%,115784,45620,53129,45616,45618,-,-,否,一般',
    '2026/07/13,TX,202607,45650,46300,45600,46281,633,1.39%,45509,-,0,46280,46282,-,-,否,盤後',
    '2026/07/13,TMF,202607,45590,45710,45490,45610,-20,-0.04%,20000,45615,12000,45609,45611,-,-,否,一般',
  ].join('\n');
  const rows = parseOfficialFuturesCsv(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => `${row.product}:${row.session}`), ['TX:一般', 'TX:盤後', 'TMF:一般']);
  assert.equal(rows[0].openInterest, 53129);
});

test('official options CSV retains strike, right, volume and OI', () => {
  const header = '交易日期,契約,到期月份(週別),履約價,買賣權,開盤價,最高價,最低價,收盤價,成交量,結算價,未沖銷契約數,最後最佳買價,最後最佳賣價,歷史最高價,歷史最低價,是否因訊息面暫停交易,交易時段';
  const text = [
    header,
    '2026/07/13,TXO,202607W3,45500,買權,1,2,1,2,123,2,456,1,2,-,-,否,一般',
    '2026/07/13,TXO,202607W3,45500,賣權,1,2,1,2,321,2,654,1,2,-,-,否,一般',
  ].join('\n');
  const rows = parseOfficialOptionsCsv(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.right, row.volume, row.openInterest]), [['買權', 123, 456], ['賣權', 321, 654]]);
});

test('official large-trader table uses all-contract row and correct columns', () => {
  const html = `
    <div>2026/07/13 (交易資訊含所有商品及鉅額交易)</div>
    <table>
      <tr><td>臺股期貨(TX+MTX/4+TMF/20)</td><td>週契約</td><td>4 (0)</td><td>100%</td><td>4</td><td>100%</td><td>4</td><td>100%</td><td>4</td><td>100%</td><td>4</td></tr>
      <tr><td>2026 07</td><td>28,676 (26,600)</td><td>48.2%</td><td>35,570</td><td>59.8%</td><td>31,238</td><td>52.5%</td><td>39,978</td><td>67.2%</td><td>59,508</td></tr>
      <tr><td>所有 契約</td><td>69,257 (66,301)</td><td>56.5%</td><td>80,613</td><td>65.7%</td><td>60,099</td><td>49%</td><td>82,335</td><td>67.1%</td><td>122,623</td></tr>
    </table>`;
  assert.deepEqual(parseOfficialLargeTraderHtml(html), {
    dataDate: '2026-07-13',
    data: {
      scope: 'all_contracts', scopeLabel: '所有 契約',
      top5Long: 69257, top5LongSpecific: 66301,
      top10Long: 80613, top10LongSpecific: null,
      top5Short: 60099, top5ShortSpecific: null,
      top10Short: 82335, top10ShortSpecific: null,
      marketOi: 122623,
      scopes: [
        {
          scope: 'near_month', scopeLabel: '2026 07',
          top5Long: 28676, top5LongSpecific: 26600,
          top10Long: 35570, top10LongSpecific: null,
          top5Short: 31238, top5ShortSpecific: null,
          top10Short: 39978, top10ShortSpecific: null,
          marketOi: 59508,
        },
        {
          scope: 'all_contracts', scopeLabel: '所有 契約',
          top5Long: 69257, top5LongSpecific: 66301,
          top10Long: 80613, top10LongSpecific: null,
          top5Short: 60099, top5ShortSpecific: null,
          top10Short: 82335, top10ShortSpecific: null,
          marketOi: 122623,
        },
      ],
    },
  });
});
