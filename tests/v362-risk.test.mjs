import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { classifyV362Risk, buildV362RiskSummary } from '../src/v362-risk.mjs';

test('V3.6.2 risk becomes high for a VIX surge or elevated option volatility', () => {
  const result = classifyV362Risk({
    vix: 21, vix5dPct: 12, vixThreshold: 18,
    atmIv: 0.25, atmHigh: 0.21, skew: 0.03, skewHigh: 0.04,
    foreign5d: -7000, foreignThreshold: 6300,
    shortAdd1d: 1600, shortAddThreshold: 1375,
  });
  assert.equal(result.level, 'high');
  assert.equal(result.foreignDirection, 'bearish_watch');
  assert.equal(result.shortAlert, 'high_add');
});

test('missing risk data stays unknown and is never treated as zero', () => {
  const result = classifyV362Risk({});
  assert.equal(result.level, 'unknown');
  assert.equal(result.vixLevel, 'unknown');
  assert.equal(result.optionLevel, 'unknown');
  assert.equal(result.foreignDirection, 'unknown');
});

test('normal volatility and small foreign change remain observational', () => {
  const result = classifyV362Risk({
    vix: 15, vix5dPct: -3, vixThreshold: 18,
    atmIv: 0.15, atmHigh: 0.21, skew: 0.02, skewHigh: 0.04,
    foreign5d: -3000, foreignThreshold: 6300,
    shortAdd1d: 500, shortAddThreshold: 1375,
  });
  assert.equal(result.level, 'low');
  assert.equal(result.foreignDirection, 'neutral');
  assert.equal(result.shortAlert, 'small_add');
});

test('explicit missing risk fields and missing thresholds remain unknown', () => {
  const keys = ['vix', 'vix5dPct', 'vixThreshold', 'atmIv', 'atmHigh', 'skew', 'skewHigh',
    'foreign5d', 'foreignThreshold', 'shortAdd1d', 'shortAddThreshold'];
  for (const missing of [null, '', '   ', false, true, [], {}]) {
    const result = classifyV362Risk(Object.fromEntries(keys.map(key => [key, missing])));
    for (const key of ['level', 'vixLevel', 'optionLevel', 'foreignDirection', 'shortAlert'])
      assert.equal(result[key], 'unknown', `${key} must preserve missing input ${JSON.stringify(missing)}`);
    assert.equal(result.atmAlert, false);
    assert.equal(result.skewAlert, false);
  }
  const result = classifyV362Risk({ foreign5d: -1, foreignThreshold: null, shortAdd1d: 2, shortAddThreshold: '' });
  assert.equal(result.foreignDirection, 'unknown');
  assert.equal(result.shortAlert, 'unknown');
});

test('real numeric zero is retained as an observation', () => {
  const result = classifyV362Risk({ vix5dPct: 0, foreign5d: 0, foreignThreshold: 10,
    shortAdd1d: '0', shortAddThreshold: 10 });
  assert.equal(result.level, 'low');
  assert.equal(result.foreignDirection, 'neutral');
  assert.equal(result.shortAlert, 'flat');
});

test('measurements without their comparison thresholds cannot imply normal risk', () => {
  for (const input of [{ vix: 20, vixThreshold: null }, { atmIv: 0.2, atmHigh: null },
    { skew: 0.03, skewHigh: '' }]) {
    const result = classifyV362Risk(input);
    assert.equal(result.level, 'unknown');
    assert.equal(result.vixLevel, 'unknown');
    assert.equal(result.optionLevel, 'unknown');
  }
  const independent = classifyV362Risk({ vix: 20, vixThreshold: null, vix5dPct: 12 });
  assert.equal(independent.level, 'high');
  assert.equal(independent.vixLevel, 'high');
});

test('summary preserves missing short position operands before calculating change', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE market_daily(trade_date TEXT, tx_close REAL);
      INSERT INTO market_daily VALUES('2026-01-06',30000);
      CREATE TABLE macro_observations(observation_date TEXT, value REAL, series_key TEXT);
      CREATE TABLE option_volatility_daily(trade_date TEXT, contract TEXT, expiry_date TEXT,
        days_to_expiry INTEGER, atm_iv REAL, skew_25d REAL, iv_rv_spread REAL, quality_status TEXT, contract_type TEXT);
      CREATE TABLE futures_positions_daily(trade_date TEXT, foreign_net REAL, foreign_short REAL);
      INSERT INTO futures_positions_daily VALUES('2026-01-06',20,30),('2026-01-05',10,NULL);
      CREATE TABLE research_input_registry_daily(dataset_key TEXT, collection_status TEXT, trade_date TEXT);`);
    const missing = buildV362RiskSummary(db, { v3: { thresholds: { shortAdd70: 10 } } });
    assert.equal(missing.foreignFutures.shortAdd1d, null);
    assert.equal(missing.foreignFutures.shortAlert, 'unknown');
    db.exec("UPDATE futures_positions_daily SET foreign_short=0 WHERE trade_date='2026-01-05'");
    const actualZero = buildV362RiskSummary(db, { v3: { thresholds: { shortAdd70: 10 } } });
    assert.equal(actualZero.foreignFutures.shortAdd1d, 30);
    assert.equal(actualZero.foreignFutures.shortAlert, 'high_add');
  } finally { db.close(); }
});
