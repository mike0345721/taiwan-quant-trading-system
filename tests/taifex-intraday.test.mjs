import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateTaifexTxCsv, taifexSession, taifexTimestamp } from '../src/taifex-intraday.mjs';

test('TAIFEX day and night sessions follow Taipei trading hours', () => {
  assert.equal(taifexSession('084500'), 'day');
  assert.equal(taifexSession('134500'), 'day');
  assert.equal(taifexSession('150000'), 'night');
  assert.equal(taifexSession('042959'), 'night');
  assert.equal(taifexSession('50000'), 'night');
  assert.equal(taifexTimestamp('20260714', '150459'), '2026-07-14T07:00:00.000Z');
  assert.equal(taifexTimestamp('20260717', '134500'), '2026-07-17T05:40:00.000Z');
  assert.equal(taifexTimestamp('20260610', '050000'), '2026-06-09T20:55:00.000Z');
});

test('official B+S ticks aggregate into separate five-minute TX sessions', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-ticks-'));
  try {
    const file = path.join(folder, 'ticks.csv');
    fs.writeFileSync(file, [
      '成交日期,商品代號,到期月份(週別),成交時間,成交價格,成交數量(B+S),近月價格,遠月價格,開盤集合競價',
      '20260714,TX     ,202607     ,150000,44778,2,-,-,*',
      '20260714,TX     ,202607     ,150459,44780,4,-,-, ',
      '20260715,TX     ,202607     ,084500,45000,6,-,-,*',
      '20260715,TX     ,202607     ,084959,45010,2,-,-, ',
      '20260715,TX     ,202608     ,084500,44900,2,-,-,*',
    ].join('\n'), 'utf8');
    const result = await aggregateTaifexTxCsv(file, { tradeDate: '2026-07-15' });
    assert.equal(result.sessions.night.contract, '202607');
    assert.equal(result.sessions.night.bars[0].volume, 3);
    assert.equal(result.sessions.night.bars[0].close, 44780);
    assert.equal(result.sessions.day.contract, '202607');
    assert.equal(result.sessions.day.bars[0].volume, 4);
    assert.equal(result.sessions.day.bars[0].high, 45010);
    assert.equal(result.sessions.day.tradeDateCombinedVolume, 7);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('rollover day keeps night and day on the same day-session dominant contract', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-rollover-'));
  try {
    const file = path.join(folder, 'ticks.csv');
    fs.writeFileSync(file, [
      '成交日期,商品代號,到期月份(週別),成交時間,成交價格,成交數量(B+S),近月價格,遠月價格,開盤集合競價',
      '20260714,TX     ,202607     ,150000,44778,20,-,-,*',
      '20260714,TX     ,202608     ,150000,44690,4,-,-,*',
      '20260715,TX     ,202607     ,084500,45000,2,-,-,*',
      '20260715,TX     ,202608     ,084500,45600,30,-,-,*',
    ].join('\n'), 'utf8');
    const result = await aggregateTaifexTxCsv(file, { tradeDate: '2026-07-15' });
    assert.equal(result.selectedContract, '202608');
    assert.equal(result.contractSelection, 'day_session_volume_leader');
    assert.equal(result.sessions.day.contract, '202608');
    assert.equal(result.sessions.night.contract, '202608');
    assert.equal(result.sessions.night.bars[0].close, 44690);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
