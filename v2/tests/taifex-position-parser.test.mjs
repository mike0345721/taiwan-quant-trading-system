import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaifexPositionCsv } from '../src/taifex-position-parser.mjs';

test('parses monthly TAIFEX institutional positions by trade date', () => {
  const csv = `日期,商品名稱,身份別,多方交易口數,b,空方交易口數,d,多空交易口數淨額,f,多方未平倉口數,g,空方未平倉口數,h,多空未平倉口數淨額\n2026/06/01,臺股期貨,外資及陸資,100,0,120,0,-20,0,16134,0,80807,0,-64673\n2026/06/01,臺股期貨,自營商,80,0,70,0,10,0,7217,0,4761,0,2456\n2026/06/02,臺股期貨,外資及陸資,90,0,110,0,-20,0,15432,0,82450,0,-67018`;
  const result = parseTaifexPositionCsv(csv);
  assert.equal(result.get('2026-06-01').foreign.net, -64673);
  assert.equal(result.get('2026-06-01').dealer.long, 7217);
  assert.equal(result.get('2026-06-01').dealer.tradeNet, 10);
  assert.equal(result.get('2026-06-02').foreign.short, 82450);
});
