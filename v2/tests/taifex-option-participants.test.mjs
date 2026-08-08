import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptionInstitutionCsv, parseOptionInstitutionHtml, parseOptionLargeTraderCsv } from '../src/taifex-option-participants.mjs';

test('parses TXO institutional rows without merging participants', () => {
  const html = `<input id="queryDate" value="2026/07/09"><table><tr><th>商品</th></tr>
  <tr><td>1</td><td>臺指選擇權</td><td>自營商</td><td>110</td><td>1</td><td>106</td><td>2</td><td>4</td><td>3</td><td>57</td><td>4</td><td>56</td><td>5</td><td>1</td><td>6</td></tr>
  <tr><td>投信</td><td>3</td><td>1</td><td>5</td><td>2</td><td>-2</td><td>-1</td><td>6</td><td>3</td><td>19</td><td>8</td><td>-13</td><td>-5</td></tr>
  <tr><td>外資</td><td>76</td><td>1</td><td>79</td><td>2</td><td>-3</td><td>-1</td><td>21</td><td>3</td><td>30</td><td>4</td><td>-9</td><td>-1</td></tr></table>`;
  const rows = parseOptionInstitutionHtml(html, '2026-07-09');
  assert.deepEqual(rows.map((row) => row.participant), ['dealer', 'investment_trust', 'foreign']);
  assert.equal(rows[2].oiNet, -9);
});

test('parses downloadable TXO institutional CSV', () => {
  const csv = '日期,商品名稱,身份別,多方交易口數,多方交易契約金額(千元),空方交易口數,空方交易契約金額(千元),多空交易口數淨額,多空交易契約金額淨額(千元),多方未平倉口數,多方未平倉契約金額(千元),空方未平倉口數,空方未平倉契約金額(千元),多空未平倉口數淨額,多空未平倉契約金額淨額(千元)\n2026/07/09,臺指選擇權,外資及陸資,76189,1054613,79487,1094258,-3298,-39645,21393,656462,30928,1071347,-9535,-414885\n';
  const rows = parseOptionInstitutionCsv(csv);
  assert.equal(rows[0].participant, 'foreign');
  assert.equal(rows[0].oiNet, -9535);
});

test('parses TXO large trader call and put scopes', () => {
  const csv = '日期,商品(契約),商品名稱(契約名稱),買賣權,到期月份(週別),交易人類別,前五大交易人買方,前五大交易人賣方,前十大交易人買方,前十大交易人賣方,全市場未沖銷部位數\n2026/07/08,TXO,臺指,買權,666666,0,1,2,3,4,5\n2026/07/08,TXO,臺指,賣權,999999,1,6,7,8,9,10\n';
  const rows = parseOptionLargeTraderCsv(csv);
  assert.deepEqual(rows.map((row) => [row.optionRight, row.expiryScope, row.traderCategory]), [
    ['call', 'weekly', 'all_traders'], ['put', 'all_contracts', 'specific_legal'],
  ]);
});
