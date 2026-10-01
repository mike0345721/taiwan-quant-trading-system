import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexLeadership, leadershipCopyAllowlist } from '../src/index-leadership.mjs';

function indexEvent(ranking, entries, overrides = {}) {
  return {
    recordType: 'IX0001_INDEX_CONTRIBUTION_RAW', indexCode: 'IX0001', ranking,
    tradeDate: '2026-08-24', session: 'DAY', eventTime: '2026-08-24T09:01:04+08:00',
    receivedAt: '2026-08-24T01:01:04.100Z', availableAt: '2026-08-24T01:01:04.100Z',
    simtrade: false, qualityStatus: 'PASS', qualityReasons: [], rawPayloadHash: 'a'.repeat(64), entries,
    ...overrides,
  };
}

function fixture() {
  return {
    indexContribution: {
      abs10: indexEvent('abs10', [
        { code: '2317', name: '鴻海', points: -8, price: 210, reference: 212, priceChange: -2, pctChange: -0.94 },
        { code: '2330', name: '台積電', points: 12, price: 1000, reference: 990, priceChange: 10, pctChange: 1.01 },
      ]),
      positive25: indexEvent('positive25', [
        { code: '2454', points: 3 }, { code: '2330', points: 12 },
      ]),
      negative25: indexEvent('negative25', [
        { code: '2303', points: -2 }, { code: '2317', points: -8 },
      ]),
    },
    industryContribution: {
      recordType: 'IX0001_INDUSTRY_CONTRIBUTION_RAW', indexCode: 'IX0001', tradeDate: '2026-08-24', session: 'DAY',
      eventTime: '2026-08-24T09:01:04+08:00', receivedAt: '2026-08-24T01:01:04.200Z', availableAt: '2026-08-24T01:01:04.200Z',
      simtrade: false, qualityStatus: 'PASS', qualityReasons: [], rawPayloadHash: 'b'.repeat(64),
      indexClose: 25000, indexPriceChange: 4, industryPointsSum: 4, industryInvariantDelta: 0,
      industryInvariantTolerance: 0.1, entries: [{ category: '01', points: 6 }, { category: '02', points: -2 }],
    },
    simulatedMatching: { indexContribution: {}, industryContribution: null },
  };
}

test('DAY IX0001 leadership preserves provider data and derives only descriptive rankings and sums', () => {
  const result = buildIndexLeadership(fixture(), {
    now: new Date('2026-08-24T01:01:05.000Z'), indexSubscriptionState: 'RESTORED', industrySubscriptionState: 'RESTORED',
  });
  assert.equal(result.state, 'LIVE');
  assert.equal(result.sourceMode, 'LIVE_RAW');
  assert.deepEqual(result.indexLeadership.topAbsolute.map((row) => row.code), ['2330', '2317']);
  assert.deepEqual(result.indexLeadership.topPositive.map((row) => row.code), ['2330', '2454']);
  assert.deepEqual(result.indexLeadership.topNegative.map((row) => row.code), ['2317', '2303']);
  assert.equal(result.indexLeadership.positivePointsSum, 15);
  assert.equal(result.indexLeadership.negativePointsSum, -10);
  assert.deepEqual(result.industryLeadership.rows.map((row) => row.category), ['01', '02']);
  assert.equal(result.industryLeadership.invariantDelta, 0);
  assert.equal(result.recommendation, false);
  assert.equal(result.systemDirectionalSignal, false);
  assert.equal(result.formalWeight, 0);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.orderRoutesEnabled, false);
});

test('NIGHT and off-hours show latest DAY context without mixing TX identity', () => {
  const result = buildIndexLeadership(fixture(), { now: new Date('2026-08-24T12:00:00.000Z') });
  assert.equal(result.state, 'SESSION_CLOSED');
  assert.equal(result.sourceMode, 'EOD_CONTEXT');
  assert.equal(result.session, 'DAY');
  assert.equal(result.sourceTradeDate, '2026-08-24');
  assert.equal('actualContract' in result, false);
  assert.equal(result.reasonCode, 'CURRENT_SESSION_NOT_TWSE_DAY');
});

test('stale prior DAY data remains dated context and never becomes live', () => {
  const raw = fixture();
  for (const row of Object.values(raw.indexContribution)) row.tradeDate = '2026-08-21';
  raw.industryContribution.tradeDate = '2026-08-21';
  const result = buildIndexLeadership(raw, { now: new Date('2026-08-24T01:01:05.000Z') });
  assert.equal(result.state, 'SESSION_CLOSED');
  assert.equal(result.freshnessState, 'SESSION_CLOSED');
  assert.equal(result.sourceTradeDate, '2026-08-21');
});

test('simulated matching is separated and excluded from live leadership', () => {
  const raw = {
    indexContribution: {}, industryContribution: null,
    simulatedMatching: { indexContribution: { abs10: indexEvent('abs10', [{ code: '2330', points: 99 }], { simtrade: true }) }, industryContribution: null },
  };
  const result = buildIndexLeadership(raw, { now: new Date('2026-08-24T01:01:05.000Z') });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.simulatedMatchingPresent, true);
  assert.deepEqual(result.indexLeadership.topAbsolute, []);
});

test('default-off runtime exposes source capability without claiming an active subscription', () => {
  const result = buildIndexLeadership({ collectionEnabled: false }, {
    now: new Date('2026-08-24T01:01:05.000Z'),
    indexSubscriptionState: 'DEFAULT_OFF', industrySubscriptionState: 'DEFAULT_OFF',
  });
  assert.equal(result.runtimeActivationState, 'DEFAULT_OFF');
  assert.equal(result.dataHealth.ix0001IndexContribution.sourceAvailability, 'SOURCE_AVAILABLE');
  assert.equal(result.dataHealth.ix0001IndexContribution.subscriptionState, 'DEFAULT_OFF');
  assert.equal(result.dataHealth.ix0001IndexContribution.restorationState, 'NOT_REQUESTED');
  assert.equal(result.dataHealth.ix0001IndexContribution.freshnessState, 'UNAVAILABLE');
  assert.equal(result.dataHealth.ix0001IndustryContribution.freshnessState, 'UNAVAILABLE');
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.quality, 'QUALITY_INSUFFICIENT');
});

test('missing and non-numeric provider fields remain null instead of becoming zero', () => {
  const raw = fixture();
  raw.indexContribution.abs10.entries = [{
    code: '2330', price: null, reference: undefined, priceChange: '', pctChange: false, points: true,
  }];
  raw.industryContribution = {
    ...raw.industryContribution,
    indexClose: null,
    indexPriceChange: '',
    industryPointsSum: false,
    industryInvariantDelta: true,
    industryInvariantTolerance: '0.1',
    entries: [{ category: '01', points: undefined }],
  };

  const result = buildIndexLeadership(raw, { now: new Date('2026-08-24T01:01:05.000Z') });
  assert.deepEqual(result.indexLeadership.rankings.abs10.entries[0], {
    code: '2330', price: null, reference: null, priceChange: null, pctChange: null, points: null,
  });
  assert.equal(result.industryLeadership.source.indexClose, null);
  assert.equal(result.industryLeadership.source.indexPriceChange, null);
  assert.equal(result.industryLeadership.source.industryPointsSum, null);
  assert.equal(result.industryLeadership.source.industryInvariantDelta, null);
  assert.equal(result.industryLeadership.source.industryInvariantTolerance, null);
  assert.equal(result.industryLeadership.source.entries[0].points, null);
});

test('partial rankings remain quality-insufficient even when the received event passes validation', () => {
  const raw = fixture();
  delete raw.indexContribution.negative25;
  const result = buildIndexLeadership(raw, { now: new Date('2026-08-24T01:01:05.000Z') });
  assert.equal(result.quality, 'QUALITY_INSUFFICIENT');
});

test('copy allowlist contains only descriptive Leadership contracts and explicit non-promotion flags', () => {
  const result = buildIndexLeadership(fixture(), { now: new Date('2026-08-24T01:01:05.000Z') });
  const copy = leadershipCopyAllowlist(result);
  assert.deepEqual(Object.keys(copy), [
    'indexLeadership', 'industryLeadership', 'leadershipSource',
    'LEADERSHIP_DESCRIPTIVE_ONLY', 'NOT_PROMOTED', 'NOT_A_TRADING_SIGNAL',
  ]);
  assert.equal(copy.LEADERSHIP_DESCRIPTIVE_ONLY, true);
  assert.equal(copy.NOT_PROMOTED, true);
  assert.equal(copy.NOT_A_TRADING_SIGNAL, true);
  assert.doesNotMatch(JSON.stringify(copy), /BUY|SELL|confidence|directionalSignal/i);
});
