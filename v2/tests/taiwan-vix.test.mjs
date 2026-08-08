import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTaiwanVixWithKnownUs, parseTaifexVixDaily, taifexVixMonthUrls } from '../src/taiwan-vix.mjs';

test('TAIFEX VIX parser uses the official closing one-minute average', () => {
  const text = '交易日期 時間 臺指選擇權波動率指數 收盤前1分鐘平均指數\n20260701 13450000 38.12 38.14\n';
  assert.deepEqual(parseTaifexVixDaily(text), [{ observationDate: '2026-07-01', value: 38.14 }]);
});

test('TAIFEX VIX page discovery keeps unique official monthly files', () => {
  const html = `window.open('https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/202607new.txt')
    window.open('https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/202606new.txt')
    window.open('https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/202607new.txt')`;
  assert.equal(taifexVixMonthUrls(html).length, 2);
});

test('Taiwan VIX alignment never consumes a same-date U.S. VIX close', () => {
  const rows = alignTaiwanVixWithKnownUs(
    [{ observationDate: '2026-07-08', value: 38.13 }],
    [{ observationDate: '2026-07-07', value: 16.13 }, { observationDate: '2026-07-08', value: 16.90 }],
  );
  assert.equal(rows[0].usSourceDate, '2026-07-07');
  assert.equal(rows[0].usVix, 16.13);
});
