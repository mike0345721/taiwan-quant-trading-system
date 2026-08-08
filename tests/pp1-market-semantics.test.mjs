import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINEAGE_MODES,
  adaptLegacyIntradayArchive,
  buildContinuousSeries,
  buildContractSelectionSet,
  buildGapObservation,
  buildTimestampLineage,
  canonicalContractIdentity,
  classifySession,
  closeQuality,
} from '../src/pp1-market-semantics.mjs';

const sourceHash = 'a'.repeat(64);
const policyHash = 'b'.repeat(64);
const calendar = {
  sourceDataHash: sourceHash,
  sessions: [
    { sessionId: '2026-07-30-NIGHT', sessionType: 'NIGHT', sessionTradeDate: '2026-07-31', sessionStart: '2026-07-30T15:00:00+08:00', sessionEnd: '2026-07-31T05:00:00+08:00' },
    { sessionId: '2026-07-31-DAY', sessionType: 'DAY', sessionTradeDate: '2026-07-31', sessionStart: '2026-07-31T08:45:00+08:00', sessionEnd: '2026-07-31T13:45:00+08:00', isSettlementTradeDate: false },
    { sessionId: '2026-08-19-DAY', sessionType: 'DAY', sessionTradeDate: '2026-08-19', sessionStart: '2026-08-19T08:45:00+08:00', sessionEnd: '2026-08-19T13:30:00+08:00', isSettlementTradeDate: true },
    { sessionId: '2026-08-19-NIGHT', sessionType: 'NIGHT', sessionTradeDate: '2026-08-20', sessionStart: '2026-08-19T15:00:00+08:00', sessionEnd: '2026-08-20T05:00:00+08:00' },
  ],
};

function liveLineage(at = '2026-07-31T08:45:01+08:00') {
  return { lineageMode: 'LIVE', exchangeTimestamp: at, receivedTimestamp: at };
}

function contracts() {
  return [
    { ...canonicalContractIdentity({ provider: 'SHIOAJI', providerCode: '202608' }), product: 'TX', expiryDate: '2026-08-19', finalTradingTimestamp: '2026-08-19T13:30:00+08:00' },
    { ...canonicalContractIdentity({ provider: 'SHIOAJI', providerCode: '202609' }), product: 'TX', expiryDate: '2026-09-16', finalTradingTimestamp: '2026-09-16T13:30:00+08:00' },
  ];
}

test('LIVE lineage只要求交易所與接收時間', () => {
  const result = buildTimestampLineage({ lineageMode: LINEAGE_MODES.LIVE, exchangeTimestamp: '2026-07-31T00:45:00Z', receivedTimestamp: '2026-07-31T00:45:01Z' });
  assert.equal(result.replayAvailableAt, null);
  assert.equal(result.featureAvailableAt, '2026-07-31T00:45:01.000Z');
});

test('LIVE缺receivedTimestamp會拒絕', () => {
  assert.throws(() => buildTimestampLineage({ lineageMode: 'LIVE', exchangeTimestamp: '2026-07-31T00:45:00Z' }), /LIVE_REQUIRES/);
});

test('HISTORICAL_REPLAY不要求receivedTimestamp', () => {
  const result = buildTimestampLineage({ lineageMode: 'HISTORICAL_REPLAY', exchangeTimestamp: '2026-01-02T00:45:00Z', replayAvailableAt: '2026-07-29T12:00:00Z' });
  assert.equal(result.receivedTimestamp, null);
  assert.equal(result.featureAvailableAt, '2026-07-29T12:00:00.000Z');
});

test('HISTORICAL_REPLAY缺replayAvailableAt會拒絕', () => {
  assert.throws(() => buildTimestampLineage({ lineageMode: 'HISTORICAL_REPLAY', exchangeTimestamp: '2026-01-02T00:45:00Z' }), /REPLAY_REQUIRES/);
});

test('OFFICIAL_BATCH接受版本化官方availableAt證據', () => {
  const result = buildTimestampLineage({ lineageMode: 'OFFICIAL_BATCH', officialAvailableAt: '2026-07-31T07:00:00Z' });
  assert.equal(result.featureAvailableAt, '2026-07-31T07:00:00.000Z');
});

test('featureAvailableAt取所有必要輸入最晚時間', () => {
  const result = buildTimestampLineage({ ...liveLineage(), necessaryInputAvailableAts: ['2026-07-31T09:00:00+08:00'] });
  assert.equal(result.featureAvailableAt, '2026-07-31T01:00:00.000Z');
});

test('夜盤跨午夜仍歸次一交易日', () => {
  const result = classifySession('2026-07-31T00:30:00+08:00', calendar);
  assert.equal(result.calendarDate, '2026-07-31');
  assert.equal(result.tradeDate, '2026-07-31');
  assert.equal(result.sessionId, '2026-07-30-NIGHT');
  assert.equal(result.crossMidnight, true);
});

test('13:30至15:00沒有活動Session', () => {
  assert.throws(() => classifySession('2026-08-19T14:00:00+08:00', calendar), /SESSION_UNKNOWN/);
});

test('到期日日盤可選到期契約，15:00夜盤改選次月', () => {
  const day = classifySession('2026-08-19T10:00:00+08:00', calendar);
  const night = classifySession('2026-08-19T15:01:00+08:00', calendar);
  const daySet = buildContractSelectionSet({ sessionContext: day, contracts: contracts(), completedReferenceVolumes: { 202608: 100, 202609: 50 }, selectedAt: day.sessionStart, policySpecHash: policyHash, sourceDataHash: sourceHash, timestampLineage: liveLineage('2026-08-19T08:45:00+08:00') });
  const nightSet = buildContractSelectionSet({ sessionContext: night, contracts: contracts(), completedReferenceVolumes: { 202609: 200 }, selectedAt: night.sessionStart, policySpecHash: policyHash, sourceDataHash: sourceHash, timestampLineage: liveLineage('2026-08-19T15:00:00+08:00') });
  assert.equal(daySet.records.find((row) => row.contractRole === 'NEAREST_ELIGIBLE_MONTH').contractCode, '202608');
  assert.equal(nightSet.records.find((row) => row.contractRole === 'NEAREST_ELIGIBLE_MONTH').contractCode, '202609');
});

test('六種契約角色共用selectionSet且角色不取代contractCode', () => {
  const session = classifySession('2026-07-31T09:00:00+08:00', calendar);
  const result = buildContractSelectionSet({ sessionContext: session, contracts: contracts(), completedReferenceVolumes: { 202608: 100, 202609: 50 }, selectedAt: session.sessionStart, policySpecHash: policyHash, sourceDataHash: sourceHash, timestampLineage: liveLineage() });
  assert.equal(result.records.length, 6);
  assert.equal(new Set(result.records.map((row) => row.selectionSetId)).size, 1);
  assert.ok(result.records.every((row) => row.contractRole && row.contractCode));
});

test('5%以內平手沿用前一Session主力', () => {
  const session = classifySession('2026-07-31T09:00:00+08:00', calendar);
  const result = buildContractSelectionSet({ sessionContext: session, contracts: contracts(), completedReferenceVolumes: { 202608: 100, 202609: 96 }, previousFrozenContractCode: '202609', selectedAt: session.sessionStart, policySpecHash: policyHash, sourceDataHash: sourceHash, timestampLineage: liveLineage() });
  const observed = result.records.find((row) => row.contractRole === 'OBSERVED_LIQUIDITY_LEAD');
  const frozen = result.records.find((row) => row.contractRole === 'SESSION_FROZEN_LIQUIDITY_LEAD');
  assert.equal(observed.contractCode, null);
  assert.equal(frozen.contractCode, '202609');
});

test('流動性資料不完整時交易契約不可交易', () => {
  const session = classifySession('2026-07-31T09:00:00+08:00', calendar);
  const result = buildContractSelectionSet({ sessionContext: session, contracts: contracts(), completedReferenceVolumes: {}, selectedAt: session.sessionStart, policySpecHash: policyHash, sourceDataHash: sourceHash, timestampLineage: liveLineage() });
  const trading = result.records.find((row) => row.contractRole === 'SELECTED_TRADING');
  assert.equal(trading.contractCode, '202608');
  assert.equal(trading.qualityState, 'UNAVAILABLE');
  assert.equal(trading.tradeEligible, false);
});

test('開盤集合競價與合格收盤可產生PASS Raw Gap', () => {
  const result = buildGapObservation({ definition: 'dayOpenVsPriorNightClose', source: { sessionId: 'N1', tradeDate: '2026-07-31', contractCode: '202608', closePrice: 22000, sessionType: 'NIGHT', closeAgeSeconds: 5 }, target: { sessionId: 'D1', tradeDate: '2026-07-31', contractCode: '202608', openPrice: 22030, openingType: 'OPENING_AUCTION', sessionStart: '2026-07-31T08:45:00+08:00', exchangeTimestamp: '2026-07-31T08:45:00+08:00' }, timestampLineage: liveLineage('2026-07-31T08:45:00+08:00') });
  assert.equal(result.rawGap, 30);
  assert.equal(result.qualityState, 'PASS');
  assert.equal(result.tradeEligible, true);
});

test('FIRST_LEGAL_TRADE延遲60秒內只能描述', () => {
  const result = buildGapObservation({ definition: 'dayOpenVsPriorNightClose', source: { sessionId: 'N1', tradeDate: '2026-07-31', contractCode: '202608', closePrice: 22000, sessionType: 'NIGHT', closeAgeSeconds: 5 }, target: { sessionId: 'D1', tradeDate: '2026-07-31', contractCode: '202608', openPrice: 22010, openingType: 'FIRST_LEGAL_TRADE', sessionStart: '2026-07-31T08:45:00+08:00', exchangeTimestamp: '2026-07-31T08:45:45+08:00' }, timestampLineage: liveLineage('2026-07-31T08:45:45+08:00') });
  assert.equal(result.rawGap, 10);
  assert.equal(result.qualityState, 'DEGRADED');
  assert.equal(result.tradeEligible, false);
});

test('FIRST_LEGAL_TRADE超過60秒不形成Raw Gap', () => {
  const result = buildGapObservation({ definition: 'dayOpenVsPriorNightClose', source: { sessionId: 'N1', tradeDate: '2026-07-31', contractCode: '202608', closePrice: 22000, sessionType: 'NIGHT', closeAgeSeconds: 5 }, target: { sessionId: 'D1', tradeDate: '2026-07-31', contractCode: '202608', openPrice: 22010, openingType: 'FIRST_LEGAL_TRADE', sessionStart: '2026-07-31T08:45:00+08:00', exchangeTimestamp: '2026-07-31T08:46:01+08:00' }, timestampLineage: liveLineage('2026-07-31T08:46:01+08:00') });
  assert.equal(result.gapState, 'TARGET_DELAYED');
  assert.equal(result.rawGap, null);
  assert.equal(result.qualityState, 'UNAVAILABLE');
});

test('跨契約Gap標示ROLL_TRANSITION且不可交易', () => {
  const result = buildGapObservation({ definition: 'dayOpenVsPriorNightClose', source: { sessionId: 'N1', tradeDate: '2026-07-31', contractCode: '202607', closePrice: 22000, sessionType: 'NIGHT', closeAgeSeconds: 5 }, target: { sessionId: 'D1', tradeDate: '2026-07-31', contractCode: '202608', openPrice: 22010, openingType: 'OPENING_AUCTION', sessionStart: '2026-07-31T08:45:00+08:00', exchangeTimestamp: '2026-07-31T08:45:00+08:00' }, timestampLineage: liveLineage('2026-07-31T08:45:00+08:00') });
  assert.equal(result.gapState, 'ROLL_TRANSITION');
  assert.equal(result.rawGap, null);
});

test('日夜收盤品質門檻分離', () => {
  assert.equal(closeQuality('DAY', 2), 'PASS');
  assert.equal(closeQuality('DAY', 10), 'DEGRADED');
  assert.equal(closeQuality('DAY', 10.1), 'UNAVAILABLE');
  assert.equal(closeQuality('NIGHT', 20), 'PASS');
  assert.equal(closeQuality('NIGHT', 60), 'DEGRADED');
  assert.equal(closeQuality('NIGHT', 60.1), 'UNAVAILABLE');
});

test('Return-linked不計跨契約報酬，Back-adjusted非as-of不得進模型', () => {
  const result = buildContinuousSeries([
    { eventTimestamp: '2026-07-30T13:45:00+08:00', contractCode: '202607', price: 100 },
    { eventTimestamp: '2026-07-30T15:00:00+08:00', contractCode: '202608', price: 110, rollOldReferencePrice: 100, rollNewReferencePrice: 110 },
    { eventTimestamp: '2026-07-30T15:01:00+08:00', contractCode: '202608', price: 111 },
  ], { asOfReconstruction: 'LATEST_REVISED' });
  assert.equal(result.returnLinked[1].continuousValue, 1000);
  assert.ok(Math.abs(result.returnLinked[2].continuousValue - (1000 * 111 / 110)) < 1e-9);
  assert.ok(result.backAdjusted.every((row) => row.historicalModelEligible === false));
});

test('Legacy Adapter deterministic且不重複改寫輸入', () => {
  const payload = { contract: '202608', session: 'day', bars: [{ timestamp: '2026-07-31T00:45:00.000Z', open: 1, high: 2, low: 1, close: 2, volume: 3, complete: true }] };
  const a = adaptLegacyIntradayArchive(payload, { calendarSnapshot: calendar, replayAvailableAt: '2026-08-01T00:00:00Z' });
  const b = adaptLegacyIntradayArchive(payload, { calendarSnapshot: calendar, replayAvailableAt: '2026-08-01T00:00:00Z' });
  assert.deepEqual(a, b);
  assert.equal(payload.bars[0].tradeDate, undefined);
});
