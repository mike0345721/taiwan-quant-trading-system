import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeResearchQuery, V2ResearchService } from '../src/v2-research.mjs';

test('V2 research query accepts only fixed ranges, deltas and contract format', () => {
  assert.deepEqual(normalizeResearchQuery({ days: '120', delta: '5', contract: '202607F2' }), { days: 120, delta: 5, contract: '202607F2' });
  assert.deepEqual(normalizeResearchQuery({ days: '999', delta: '7', contract: "x' OR 1=1" }), { days: 60, delta: 1, contract: '' });
});

test('V2 research service returns a read-only dashboard payload', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-v2-'));
  const file = path.join(folder, 'research.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE market_daily(trade_date TEXT, twii_close REAL, tx_close REAL, tx_open_interest INTEGER, basis REAL);
    CREATE TABLE futures_positions_daily(trade_date TEXT, foreign_net INTEGER, market_open_interest INTEGER);
    CREATE TABLE futures_contract_daily(trade_date TEXT, product TEXT, contract TEXT, session TEXT, open REAL, high REAL, low REAL, close REAL, is_active INTEGER);
    CREATE TABLE options_contract_daily(trade_date TEXT, contract TEXT, contract_type TEXT, expiry_date TEXT, days_to_expiry INTEGER, is_active INTEGER, call_volume INTEGER, put_volume INTEGER, volume_pc_ratio REAL, call_oi INTEGER, put_oi INTEGER, oi_pc_ratio REAL, call_wall_strike REAL, call_wall_oi INTEGER, put_wall_strike REAL, put_wall_oi INTEGER, max_pain REAL);
    CREATE TABLE options_strike_daily(trade_date TEXT, contract TEXT, strike REAL, call_oi INTEGER, put_oi INTEGER, call_volume INTEGER, put_volume INTEGER);
    CREATE TABLE option_oi_changes(trade_date TEXT, contract TEXT, strike REAL, call_oi_delta_1d INTEGER, put_oi_delta_1d INTEGER, call_oi_delta_3d INTEGER, put_oi_delta_3d INTEGER, call_oi_delta_5d INTEGER, put_oi_delta_5d INTEGER);
    CREATE TABLE quality_issues(severity TEXT);
    INSERT INTO market_daily VALUES ('2026-07-09', 100, 102, 900, 2);
    INSERT INTO futures_positions_daily VALUES ('2026-07-09', -50, NULL);
    INSERT INTO futures_contract_daily VALUES ('2026-07-09','TX','202607','一般',99,104,98,102,1);
    INSERT INTO options_contract_daily VALUES ('2026-07-09','202607F2','weekly','2026-07-10',1,1,10,12,1.2,20,30,1.5,110,8,90,9,100);
    INSERT INTO options_strike_daily VALUES ('2026-07-09','202607F2',100,5,7,2,3);
    INSERT INTO option_oi_changes VALUES ('2026-07-09','202607F2',100,1,2,3,4,5,6);
  `);
  db.close();
  try {
    const result = new V2ResearchService(file).query({ days: 20, delta: 3 });
    assert.equal(result.service.readOnly, true);
    assert.equal(result.query.contract, '202607F2');
    assert.equal(result.futures[0].marketOi, 900);
    assert.equal(result.futures[0].txHigh, 104);
    assert.equal(result.options.strikes[0].putDelta, 4);
    assert.equal(result.options.history[0].callWallOi, 8);
    assert.equal(result.options.history[0].putWallOi, 9);
    assert.equal(result.globalContext.available, false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('V2 backtest report is read from a fixed server-side file', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-v2-report-'));
  const report = path.join(folder, 'latest-backtest.json');
  fs.writeFileSync(report, JSON.stringify({ assumptions: { costPoints: 8 }, strategies: [{ key: 'demo' }] }));
  try {
    const result = new V2ResearchService(path.join(folder, 'missing.sqlite'), report).backtestReport();
    assert.equal(result.assumptions.costPoints, 8);
    assert.equal(result.strategies[0].key, 'demo');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('V2 decision support exposes only research-safe summaries', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-v2-decision-'));
  const report = path.join(folder, 'latest-backtest.json');
  fs.writeFileSync(report, '{}');
  fs.writeFileSync(path.join(folder, 'no-trade-veto.json'), JSON.stringify({
    generatedAt: '2026-07-13T01:00:00.000Z',
    studies: [{
      key: 'high_vol_regime',
      holdout: { kept: { profitFactor: 3.75, mae10PctPoints: -833 }, vetoed: { trades: 6 } },
      evidence: { verdict: 'insufficient_holdout' },
    }],
  }));
  fs.writeFileSync(path.join(folder, 'holding-selector.json'), JSON.stringify({
    generatedAt: '2026-07-13T02:00:00.000Z',
    development: { folds: [{ choice: 'no_trade' }, { choice: 'hold_1d' }, { choice: 'no_trade' }] },
    finalHoldout: { choice: 'hold_2d' },
    caveat: 'research only',
  }));
  fs.writeFileSync(path.join(folder, 'paired-incremental.json'), JSON.stringify({
    families: [{ holdout: { comparisons: [{ supported: false }, { supported: false }] } }],
  }));
  try {
    const result = new V2ResearchService(path.join(folder, 'missing.sqlite'), report).decisionSupport();
    assert.equal(result.status, 'research_only');
    assert.equal(result.noTrade.highVolatility.verdict, 'insufficient_holdout');
    assert.equal(result.noTrade.highVolatility.vetoedTrades, 6);
    assert.equal(result.holding.finalChoice, 'hold_2d');
    assert.deepEqual(result.holding.foldChoices, { no_trade: 2, hold_1d: 1 });
    assert.equal(result.incremental.holdoutSupportedComparisons, 0);
    assert.equal(result.incremental.holdoutTotalComparisons, 2);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
