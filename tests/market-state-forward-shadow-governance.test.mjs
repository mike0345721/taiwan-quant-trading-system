import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from '../src/market-state-forward-shadow-calendar.mjs';
import { collectForwardLargeMoveOutcome } from '../src/market-state-forward-shadow-outcome-collector.mjs';

const root = path.resolve('data/market-state/forward-shadow/cru22-governance-fixtures');
const HASH = 'a'.repeat(64);

test('governed trading calendar is deterministic and holiday is not a scheduled trading day', () => {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'calendar.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 'taifex-governed-trading-calendar-v1',
    sourceType: 'TAIFEX_OFFICIAL_CALENDAR_SNAPSHOT',
    ownerApproved: true,
    sourceHash: HASH,
    tradingDates: ['2026-08-11'],
    nonTradingDates: ['2026-08-10'],
  }));
  const first = loadGovernedTradingCalendar(file);
  const second = loadGovernedTradingCalendar(file);
  assert.equal(first.fileHash, second.fileHash);
  assert.equal(resolveGovernedTradingDay(first, '2026-08-11').officialTradingDay, true);
  assert.equal(resolveGovernedTradingDay(first, '2026-08-10').officialTradingDay, false);
  assert.throws(() => resolveGovernedTradingDay(first, '2026-08-12'), /TRADING_DAY_NOT_COVERED/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('forward outcome collector reuses frozen LARGE_MOVE sessionReturnBps and actual contract lineage', async () => {
  fs.mkdirSync(root, { recursive: true });
  const ledger = path.join(root, 'live.ndjson');
  const row = (time, close, id) => JSON.stringify({
    kind: 'futures_tick', eventId: id, exchangeTimestamp: time, receivedAt: time,
    payload: { _product_family: 'TX', date: '2026-08-11', _target_code: '202608', simtrade: false, close, volume: 1 },
  });
  fs.writeFileSync(ledger, `${row('2026-08-11T00:45:00.000Z', 20000, 'a')}\n${row('2026-08-11T05:44:59.000Z', 20200, 'b')}\n`);
  const result = await collectForwardLargeMoveOutcome({
    ledgerFile: ledger,
    tradeDate: '2026-08-11',
    actualContract: '202608',
    outcomeContract: { version: 'market-state-outcome-contract-v1', sha256: HASH },
    collectedAt: '2026-08-11T13:50:00+08:00',
  });
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.outcome.actualContract, '202608');
  assert.equal(result.outcome.sessionReturnBps, 100);
  assert.equal(result.outcome.outcomeSourceLineage.session, 'DAY');
  assert.equal(result.outcome.outcomeSourceLineage.actualContract, '202608');
  assert.match(result.outcome.outcomeSourceHash, /^[a-f0-9]{64}$/);
  fs.rmSync(root, { recursive: true, force: true });
});
