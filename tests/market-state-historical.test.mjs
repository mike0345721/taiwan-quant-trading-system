import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoricalMarketStateRecords, summarizeHistoricalMarketState } from '../src/market-state-historical.mjs';

function row(tradeDate, factorId, value, overrides = {}) {
  return {
    factorId,
    decisionTradeDate: tradeDate,
    decisionAt: `${tradeDate}T08:30:00+08:00`,
    sourceTradeDate: tradeDate,
    availableAt: `${tradeDate}T07:00:00+08:00`,
    sourceTable: 'fixture',
    sourceContract: null,
    formula: factorId,
    transformFormula: null,
    qualityState: 'PASS',
    qualityReason: null,
    value,
    ...overrides,
  };
}

function dateAt(index) {
  const cursor = new Date(Date.UTC(2026, 0, 1));
  cursor.setUTCDate(cursor.getUTCDate() + index);
  return cursor.toISOString().slice(0, 10);
}

test('historical dry run derives bullish local state and collapses NDX_PROXY + SOX into one global block', () => {
  const date = '2026-08-10';
  const records = buildHistoricalMarketStateRecords([
    row(date, 'price_twii_return__sum_or_change_5d', 2.1),
    row(date, 'price_tx_return__sum_or_change_5d', 2.4),
    row(date, 'breadth_listed_advance_decline', 0.35),
    row(date, 'cross_ndx_return', 1.2),
    row(date, 'cross_sox_return', 1.8),
    row(date, 'cross_usdtwd_return', -0.4),
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].state.trend, 'TREND_UP');
  assert.equal(records[0].state.direction, 'BULLISH');
  assert.equal(records[0].state.globalAlignment, 'TAILWIND');
  assert.equal(records[0].evidence.filter((item) => item.key === 'usGrowthBlock').length, 1);
  assert.equal(records[0].evidence.some((item) => item.key === 'ndx'), false);
  assert.equal(records[0].evidence.some((item) => item.key === 'sox'), false);
});

test('bullish local price and bearish breadth remain a first-class Direction conflict', () => {
  const date = '2026-08-11';
  const [record] = buildHistoricalMarketStateRecords([
    row(date, 'price_twii_return__sum_or_change_5d', 1.5),
    row(date, 'price_tx_return__sum_or_change_5d', 1.8),
    row(date, 'breadth_listed_advance_decline', -0.45),
  ]);
  assert.equal(record.state.trend, 'UNCLEAR');
  assert.equal(record.state.direction, 'CONFLICT');
  assert.ok(record.conflicts.some((item) => item.type === 'DIRECTION_BLOCK_CONFLICT'));
});

test('local persistence disagreement with neutral breadth produces descriptive RANGE state', () => {
  const date = '2026-08-11';
  const [record] = buildHistoricalMarketStateRecords([
    row(date, 'price_twii_return__sum_or_change_5d', 0.7),
    row(date, 'price_tx_return__sum_or_change_5d', -0.4),
    row(date, 'breadth_listed_advance_decline', 0.05),
  ]);
  assert.equal(record.state.trend, 'RANGE');
});

test('ATM IV uses distinct past-only history and can elevate volatility/risk without creating direction', () => {
  const rows = [];
  for (let index = 0; index < 61; index += 1) {
    const date = dateAt(index);
    rows.push(row(date, 'atm_iv', index < 60 ? 10 + index : 200));
  }
  const records = buildHistoricalMarketStateRecords(rows);
  const last = records.at(-1);
  const atm = last.evidence.find((item) => item.key === 'atmIvContext');
  assert.equal(atm.percentileSampleSize, 60);
  assert.equal(atm.percentile, 1);
  assert.equal(last.state.volatility, 'HIGH');
  assert.equal(last.state.risk, 'NORMAL');
  assert.equal(last.riskResearchContext, 'ELEVATED');
  assert.equal(last.state.direction, 'UNAVAILABLE');
});

test('futures OI direction uses near-contract OI and the previous distinct usable same-contract row', () => {
  const first = '2026-08-10';
  const second = '2026-08-11';
  const records = buildHistoricalMarketStateRecords([
    row(first, 'near_contract_oi', 100, { sourceContract: '202608' }),
    row(first, 'contract_changed', 0, { sourceContract: '202608' }),
    row(first, 'rollover_risk', 0, { sourceContract: '202608' }),
    row(second, 'price_tx_return', 1),
    row(second, 'near_contract_oi', 125, { sourceContract: '202608' }),
    row(second, 'contract_changed', 0, { sourceContract: '202608' }),
    row(second, 'rollover_risk', 0, { sourceContract: '202608' }),
  ]);
  const context = records.at(-1).evidence.find((item) => item.key === 'priceOiJointContext');
  assert.ok(context);
  assert.equal(context.direction, 'BULLISH');
  assert.equal(context.oiDelta.delta, 25);
  assert.equal(context.sameContractOiDelta, 25);
  assert.equal(context.oiTrace.currentSourceTradeDate, second);
  assert.equal(context.oiTrace.currentSourceContract, '202608');
  assert.equal(context.oiTrace.currentOi, 125);
  assert.equal(context.oiTrace.previousSourceTradeDate, first);
  assert.equal(context.oiTrace.previousSourceContract, '202608');
  assert.equal(context.oiTrace.previousOi, 100);
  assert.equal(context.currentContract, '202608');
  assert.equal(context.previousContract, '202608');
  assert.equal(context.productScope, 'TX_MTX_TMF_EQUIVALENT');
  assert.match(context.source, /futures_oi_daily:near_contract_oi:TX_MTX_TMF_EQUIVALENT/);
});

test('contract mismatch, rollover and missing previous OI never produce a directional OI vote', () => {
  const mismatch = buildHistoricalMarketStateRecords([
    row('2026-08-10', 'near_contract_oi', 100, { sourceContract: '202608' }),
    row('2026-08-11', 'price_tx_return', 1),
    row('2026-08-11', 'near_contract_oi', 125, { sourceContract: '202609' }),
    row('2026-08-11', 'contract_changed', 0, { sourceContract: '202609' }),
    row('2026-08-11', 'rollover_risk', 0, { sourceContract: '202609' }),
  ]).at(-1);
  assert.equal(mismatch.evidence.some((item) => item.key === 'priceOiJointContext'), false);
  assert.equal(mismatch.unavailable.find((item) => item.key === 'priceOiJointContext').reason, 'OI_CONTRACT_MISMATCH');

  const rollover = buildHistoricalMarketStateRecords([
    row('2026-08-10', 'near_contract_oi', 100, { sourceContract: '202608' }),
    row('2026-08-11', 'price_tx_return', 1),
    row('2026-08-11', 'near_contract_oi', 125, { sourceContract: '202608' }),
    row('2026-08-11', 'contract_changed', 0, { sourceContract: '202608' }),
    row('2026-08-11', 'rollover_risk', 1, { sourceContract: '202608' }),
  ]).at(-1);
  assert.equal(rollover.evidence.some((item) => item.key === 'priceOiJointContext'), false);
  assert.ok(rollover.evidence.some((item) => item.key === 'rolloverQuality'));
  assert.equal(rollover.unavailable.find((item) => item.key === 'priceOiJointContext').reason, 'ROLLOVER_OR_CONTRACT_CHANGED');

  const noPrevious = buildHistoricalMarketStateRecords([
    row('2026-08-11', 'price_tx_return', 1),
    row('2026-08-11', 'near_contract_oi', 125, { sourceContract: '202608' }),
    row('2026-08-11', 'contract_changed', 0, { sourceContract: '202608' }),
    row('2026-08-11', 'rollover_risk', 0, { sourceContract: '202608' }),
  ])[0];
  assert.equal(noPrevious.evidence.some((item) => item.key === 'priceOiJointContext'), false);
  assert.equal(noPrevious.unavailable.find((item) => item.key === 'priceOiJointContext').reason, 'NO_PREVIOUS_OI');
});

test('future evidence is rejected by evaluator and counted as a future-data violation', () => {
  const date = '2026-08-12';
  const records = buildHistoricalMarketStateRecords([
    row(date, 'price_twii_return__sum_or_change_5d', 1, { availableAt: `${date}T09:00:00+08:00` }),
    row(date, 'price_tx_return__sum_or_change_5d', 1),
    row(date, 'breadth_listed_advance_decline', 0.3),
  ]);
  assert.ok(records[0].unavailable.some((item) => item.reason === 'FUTURE_EVIDENCE'));
  assert.equal(summarizeHistoricalMarketState(records).futureDataViolations, 1);
});

test('VIX stays unavailable when canonical publication timing is blocked', () => {
  const date = '2026-08-13';
  const [record] = buildHistoricalMarketStateRecords([
    row(date, 'VIXCLS', null, {
      availableAt: null,
      qualityState: 'BLOCKED_AVAILABLE_AT',
      qualityReason: 'source has observation_date but no release/retrieval timestamp',
    }),
  ]);
  const vix = record.unavailable.find((item) => item.key === 'vixContext');
  assert.ok(vix);
  assert.equal(vix.reason, 'BLOCKED_AVAILABLE_AT');
});

test('historical summary remains research-only and non-executable', () => {
  const date = '2026-08-14';
  const records = buildHistoricalMarketStateRecords([
    row(date, 'price_twii_return__sum_or_change_5d', -1),
    row(date, 'price_tx_return__sum_or_change_5d', -1),
    row(date, 'breadth_listed_advance_decline', -0.3),
  ]);
  const summary = summarizeHistoricalMarketState(records);
  assert.equal(summary.researchOnly, true);
  assert.equal(summary.executionAuthorized, false);
  assert.equal(records[0].researchOnly, true);
  assert.equal(records[0].executionAuthorized, false);
});
