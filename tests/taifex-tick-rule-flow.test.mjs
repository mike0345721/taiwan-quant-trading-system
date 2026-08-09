import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateTaifexTickRuleFlowCsv } from '../src/taifex-tick-rule-flow.mjs';

function fixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taifex-flow-'));
  const file = path.join(dir, 'sample.csv');
  fs.writeFileSync(file, ['Date,Product,Contract,Time,Price,B+S', ...lines].join('\n'), 'utf8');
  return { dir, file };
}

test('paid trade summary derives tick-rule signed volume without claiming real aggressor side', async () => {
  const { dir, file } = fixture([
    '20260102,TX,202601,084500,100,2',
    '20260102,TX,202601,084501,101,4',
    '20260102,TX,202601,084502,101,2',
    '20260102,TX,202601,084503,100,6',
  ]);
  try {
    const result = await aggregateTaifexTickRuleFlowCsv(file, { tradeDate: '2026-01-02' });
    const day = result.sessions.day;
    assert.equal(day.totalVolume, 7); // B+S / 2 => 1+2+1+3
    assert.equal(day.upVolume, 3); // +2 plus zero-tick carry +1
    assert.equal(day.downVolume, 3);
    assert.equal(day.unclassifiedVolume, 1); // first tick cannot be signed
    assert.equal(day.signedVolume, 0);
    assert.equal(day.tickRuleCvd, 0);
    assert.equal(day.estimatedTradeDirection, true);
    assert.equal(day.realAggressorSide, false);
    assert.equal(day.bidAskAvailable, false);
    assert.equal(day.researchOnly, true);
    assert.equal(day.executionAuthorized, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('day-session volume leader anchors day and night to the same contract', async () => {
  const { dir, file } = fixture([
    '20260102,TX,202601,084500,100,20',
    '20260102,TX,202602,084500,100,4',
    '20260101,TX,202601,150001,99,2',
    '20260101,TX,202602,150001,99,40',
  ]);
  try {
    const result = await aggregateTaifexTickRuleFlowCsv(file, { tradeDate: '2026-01-02' });
    assert.equal(result.selectedContract, '202601');
    assert.equal(result.contractSelection, 'day_session_volume_leader');
    assert.equal(result.sessions.day.contract, '202601');
    assert.equal(result.sessions.night.contract, '202601');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spread rows and malformed rows never enter the proxy', async () => {
  const { dir, file } = fixture([
    '20260102,TX,202601/202602,084500,100,2',
    '20260102,TX,202601,084501,bad,2',
    '20260102,TX,202601,084502,101,2',
  ]);
  try {
    const result = await aggregateTaifexTickRuleFlowCsv(file, { tradeDate: '2026-01-02' });
    assert.equal(result.excludedSpreadRows, 1);
    assert.equal(result.malformedTicks, 1);
    assert.equal(result.acceptedTicks, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
