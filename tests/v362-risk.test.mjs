import test from 'node:test';
import assert from 'node:assert/strict';
import { buildV362RiskSummary, classifyV362Risk } from '../src/v362-risk.mjs';
import { DatabaseSync } from 'node:sqlite';

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

test('explicit null, blank, boolean and nonnumeric inputs cannot become low risk', () => {
  const keys = ['vix','vix5dPct','vixThreshold','atmIv','atmHigh','skew','skewHigh','foreign5d','foreignThreshold','shortAdd1d','shortAddThreshold'];
  for (const value of [null, undefined, '', '  ', false, true, [], {}, NaN, Infinity, 'NaN']) {
    const risk = classifyV362Risk(Object.fromEntries(keys.map(key => [key, value])));
    for (const key of ['level','vixLevel','optionLevel','foreignDirection','shortAlert']) assert.equal(risk[key], 'unknown', `${key}: ${String(value)}`);
  }
});

test('real zero and numeric database strings keep their meaning; missing thresholds do not become zero', () => {
  assert.equal(classifyV362Risk({vix5dPct: 0}).level, 'low');
  assert.equal(classifyV362Risk({vix5dPct: '12'}).level, 'high');
  const risk = classifyV362Risk({vix: null, atmIv: 0.15, atmHigh: null, foreign5d: 0, foreignThreshold: null, shortAdd1d: 0, shortAddThreshold: 100});
  assert.equal(risk.atmAlert, false);
  assert.equal(risk.optionLevel, 'unknown');
  assert.equal(risk.level, 'unknown');
  assert.equal(classifyV362Risk({vix: 15, vixThreshold: null}).vixLevel, 'unknown');
  assert.equal(risk.foreignDirection, 'unknown');
  assert.equal(risk.shortAlert, 'flat');
});

test('database NULLs stay unknown through the dashboard risk summary and recommendation', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE market_daily(trade_date TEXT, tx_close REAL);
      INSERT INTO market_daily VALUES ('2026-10-22', 30000);
      CREATE TABLE macro_observations(observation_date TEXT, value REAL, series_key TEXT);
      INSERT INTO macro_observations VALUES ('2026-10-22', NULL, 'VIXCLS');
      CREATE TABLE option_volatility_daily(trade_date TEXT, contract TEXT, expiry_date TEXT, days_to_expiry INTEGER, atm_iv REAL, skew_25d REAL, iv_rv_spread REAL, quality_status TEXT, contract_type TEXT);
      INSERT INTO option_volatility_daily VALUES ('2026-10-22','TEST','2026-10-28',6,NULL,NULL,NULL,'missing','weekly');
      CREATE TABLE futures_positions_daily(trade_date TEXT, foreign_net REAL, foreign_short REAL);
      INSERT INTO futures_positions_daily VALUES ('2026-10-22',10,NULL), ('2026-10-21',5,100);
      CREATE TABLE research_input_registry_daily(dataset_key TEXT, collection_status TEXT, trade_date TEXT);`);
    const result = buildV362RiskSummary(db);
    assert.equal(result.volatilityRisk, 'unknown');
    assert.equal(result.recommendation, '資料不足，暫停採取方向部位');
    assert.equal(result.vix.value, null);
    assert.equal(result.options.atmIv, null);
    assert.equal(result.options.ivRvSpread, null);
    assert.equal(result.foreignFutures.shortAdd1d, null);
    assert.equal(result.foreignFutures.shortAlert, 'unknown');
  } finally { db.close(); }
});
