import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFiveMinuteBars, prepareFiveMinuteImport } from '../src/intraday-import.mjs';

function payload(overrides = {}) {
  return {
    source: 'broker_market_data', provider: 'shioaji', product: 'TX', contract: '202607', session: 'day', timeframe: '5m',
    bars: Array.from({ length: 6 }, (_, index) => ({ timestamp: new Date(Date.parse('2026-07-17T01:00:00Z') + index * 300_000).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 100, complete: true })),
    ...overrides,
  };
}

test('valid broker bars are normalized and written atomically', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-import-'));
  try {
    const file = path.join(folder, 'latest-bars.json');
    const result = importFiveMinuteBars(payload(), file, { now: new Date('2026-07-17T02:00:00Z') });
    assert.equal(result.ok, true);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.provider, 'shioaji');
    assert.equal(saved.barCount, 6);
    assert.equal(saved.bars[0].open, 100);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('future bars, malformed contracts, and mock imports are rejected', () => {
  const future = payload({ contract: 'TX', bars: [{ timestamp: '2026-07-18T01:00:00Z', open: 1, high: 2, low: 1, close: 2, volume: 1 }] });
  const result = prepareFiveMinuteImport(future, { now: new Date('2026-07-17T02:00:00Z') });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('future_bar_rejected'));
  assert.ok(result.errors.includes('contract_must_be_yyyymm'));
  assert.equal(prepareFiveMinuteImport(payload({ source: 'mock' }), { now: new Date('2026-07-17T02:00:00Z') }).ok, false);
});

test('historical replay cannot overwrite the live file by default', () => {
  const result = prepareFiveMinuteImport(payload({ source: 'historical_replay' }), { now: new Date('2026-07-17T02:00:00Z') });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('historical_replay_not_live'));
});
