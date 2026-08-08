import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listReplayDays, loadCatalogReplay } from '../src/intraday-replay-catalog.mjs';

function payload(tradeDate, contract, volume) {
  const start = Date.parse(`${tradeDate}T00:45:00.000Z`);
  return {
    source: 'historical_replay', provider: 'test', product: 'TX', contract, session: 'day', timeframe: '5m', tradeDate,
    bars: Array.from({ length: 6 }, (_, index) => ({ timestamp: new Date(start + index * 300_000).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume, complete: true })),
  };
}

test('catalog lists audited replay days and loads a selected date with previous-day and RVOL context', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-replay-catalog-'));
  try {
    for (const [date, volume] of [['2026-07-14', 100], ['2026-07-15', 200]]) {
      fs.writeFileSync(path.join(folder, `${date}-day.json`), JSON.stringify(payload(date, '202607', volume)));
      fs.writeFileSync(path.join(folder, `${date}-night.json`), JSON.stringify({ ...payload(date, '202607', volume), session: 'night' }));
      fs.writeFileSync(path.join(folder, `${date}-audit.json`), JSON.stringify({ state: 'passed_with_scope_warning' }));
    }
    const catalog = listReplayDays(folder);
    assert.equal(catalog.length, 2);
    assert.equal(catalog[1].auditPassed, true);
    const replay = loadCatalogReplay(folder, path.join(folder, 'missing.json'), { tradeDate: '2026-07-15', cursor: 6 });
    assert.equal(replay.selectedTradeDate, '2026-07-15');
    assert.equal(replay.context.previousDayClose, 106);
    assert.equal(replay.context.relativeVolume20d, 2);
    assert.equal(replay.context.nightContractMatches, true);
    assert.equal(replay.executionAuthorized, false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('catalog rejects unknown replay dates without path traversal', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-replay-catalog-'));
  try {
    const replay = loadCatalogReplay(folder, path.join(folder, 'missing.json'), { tradeDate: '../secret', cursor: 1 });
    assert.equal(replay.state, 'replay_date_invalid');
    assert.equal(replay.executionAuthorized, false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
