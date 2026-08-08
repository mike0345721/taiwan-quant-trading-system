import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeUnivariate,
  buildDailyTargets,
  buildFixedSplit,
  buildUnivariatePairs,
  pearson,
  quantile,
  spearman,
  univariateDigest,
} from '../src/phase-a-univariate.mjs';

function dateAt(index) {
  const cursor = new Date('2024-01-01T00:00:00Z');
  cursor.setUTCDate(cursor.getUTCDate() + index);
  return cursor.toISOString().slice(0, 10);
}

function dailyFixture(days = 520) {
  const marketRows = Array.from({ length: days }, (_, index) => {
    const contract = index < 300 ? '202401' : '202402';
    const close = 18000 + index * 2 + Math.sin(index / 3) * 20;
    return {
      trade_date: dateAt(index),
      tx_contract: contract,
      tx_close: close,
      tx_change_pct: index ? 0.1 + Math.sin(index / 3) * 0.05 : 0,
    };
  });
  const futuresContractRows = marketRows.map((row, index) => ({
    trade_date: row.trade_date,
    product: 'TX',
    contract: row.tx_contract,
    session: '一般',
    high: row.tx_close + 30 + index % 5,
    low: row.tx_close - 25 - index % 4,
  }));
  const futuresOiRows = marketRows.map((row, index) => ({
    trade_date: row.trade_date,
    days_to_near_expiry: 20 - (index % 20),
  }));
  return { marketRows, futuresContractRows, futuresOiRows };
}

test('基本相關與分位數統計具決定性', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(spearman([10, 20, 30], [3, 2, 1]), -1);
});

test('Daily Target排除換約日，並使用同契約日高低價', () => {
  const fixture = dailyFixture();
  const rows = buildDailyTargets(fixture);
  const roll = rows.find((row) => row.decisionTradeDate === dateAt(300));
  assert.equal(roll.rollTransition, true);
  assert.equal(roll.nextDayReturn, null);
  assert.equal(roll.nextDayRange, null);
  const normal = rows.find((row) => row.decisionTradeDate === dateAt(10));
  assert.ok(normal.nextDayRange > 0);
  assert.equal(normal.sourceTradeDate, dateAt(9));
});

test('A12固定70/30切分、1日purge，二元風險門檻只來自Development', () => {
  const targets = buildDailyTargets(dailyFixture());
  const split = buildFixedSplit(targets);
  assert.equal(split.eligible, true);
  const featureRows = targets.map((row, index) => ({
    decisionTradeDate: row.decisionTradeDate,
    factorId: 'test_factor',
    value: index,
    qualityState: 'PASS',
  }));
  const first = analyzeUnivariate({
    factorId: 'test_factor',
    targetId: 'next_day_large_move',
    featureRows,
    targetRows: targets,
  });
  const altered = targets.map((row) => (
    row.decisionTradeDate >= split.evaluationStartDate
      ? { ...row, nextDayAbsoluteReturn: 1000 }
      : row
  ));
  const second = analyzeUnivariate({
    factorId: 'test_factor',
    targetId: 'next_day_large_move',
    featureRows,
    targetRows: altered,
  });
  assert.equal(
    first.thresholdsFromDevelopmentOnly.largeMove80,
    second.thresholdsFromDevelopmentOnly.largeMove80,
  );
  assert.equal(first.counts.purge, 1);
});

test('相同A12輸入產生相同Digest，資料不足不得假裝完成', () => {
  const targets = buildDailyTargets(dailyFixture());
  const featureRows = targets.map((row, index) => ({
    decisionTradeDate: row.decisionTradeDate,
    factorId: 'test_factor',
    value: index < 20 ? index : null,
    qualityState: index < 20 ? 'PASS' : 'MISSING_VALUE',
  }));
  const first = analyzeUnivariate({
    factorId: 'test_factor',
    targetId: 'next_day_tx_return',
    featureRows,
    targetRows: targets,
  });
  const second = analyzeUnivariate({
    factorId: 'test_factor',
    targetId: 'next_day_tx_return',
    featureRows,
    targetRows: targets,
  });
  assert.equal(first.evaluationStatus, 'INSUFFICIENT_DATA');
  assert.equal(first.promotionEligible, false);
  assert.equal(univariateDigest(first), univariateDigest(second));
});

test('A13可重用的Evaluation配對與A12使用相同切分且不包含purge日', () => {
  const targets = buildDailyTargets(dailyFixture());
  const featureRows = targets.map((row, index) => ({
    decisionTradeDate: row.decisionTradeDate,
    factorId: 'test_factor',
    value: index,
    qualityState: 'PASS',
  }));
  const result = analyzeUnivariate({
    factorId: 'test_factor',
    targetId: 'next_day_tx_return',
    featureRows,
    targetRows: targets,
  });
  const pairs = buildUnivariatePairs({
    factorId: 'test_factor',
    targetId: 'next_day_tx_return',
    featureRows,
    targetRows: targets,
  });
  assert.deepEqual(pairs.split, result.fold);
  assert.equal(pairs.evaluation.length, result.counts.evaluation);
  assert.equal(
    pairs.evaluation.some((row) => row.decisionTradeDate === pairs.split.purgeDate),
    false,
  );
});
