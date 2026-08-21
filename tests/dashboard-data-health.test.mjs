import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataHealthContract, DATA_HEALTH_ENUMS } from '../src/dashboard-data-health.mjs';

const now = new Date('2026-08-12T02:15:00.000Z');

function source(sourceName = 'official') {
  return { ok: true, source: sourceName, fetchedAt: '2026-08-12T02:14:00.000Z', scope: 'fixture', release: '盤中行情' };
}

test('data health keeps source availability separate from unimplemented derivation', () => {
  const audit = {
    ledgerFile: 'fixture.ndjson',
    productFamilies: { TX: { targetCode: 'TXFH6' }, MTX: { targetCode: 'MXFH6' }, TMF: { targetCode: 'TMFH6' } },
    acceptance: {
      status: 'PASS', checks: { reconnectEvidence: true },
      requiredKindCounts: {
        TXFH6: { tick: 100, bidAsk: 200 }, MXFH6: { tick: 100, bidAsk: 200 }, TMFH6: { tick: 100, bidAsk: 200 },
      },
    },
  };
  const health = buildDataHealthContract({
    now,
    snapshot: {
      futuresMarket: { data: { txDay: { contract: '202608' } } },
      sources: {
        marketOverview: source(), marketBreadth: source(), spotInstitutional: source(), futuresMarket: source(),
        futuresInstitutional: source(), options: source(), taiwanVix: source(),
      },
    },
    service: { brokerMarketData: { connected: true, safetyVerified: true, latestReceivedAt: '2026-08-12T02:14:45.000Z', marketSession: { state: 'trading_session' } } },
    futuresAudit: audit,
    runtimeTruth: { governed: false },
  });
  const txTick = health.items.find((item) => item.sourceId === 'txTick');
  const estimatedCvd = health.items.find((item) => item.sourceId === 'estimatedCvd');
  assert.equal(txTick.sourceAvailability, 'SOURCE_AVAILABLE');
  assert.equal(txTick.freshnessState, 'LIVE');
  assert.equal(estimatedCvd.sourceAvailability, 'SOURCE_AVAILABLE');
  assert.equal(estimatedCvd.readinessState, 'DERIVATION_NOT_IMPLEMENTED');
  assert.equal(estimatedCvd.freshnessState, 'UNAVAILABLE');
  assert.equal(health.executionAuthorized, false);
});
test('data health vocabulary is frozen and does not invent numeric defaults', () => {
  assert.deepEqual(DATA_HEALTH_ENUMS.freshnessState, ['LIVE', 'FRESH', 'DELAYED', 'STALE', 'SESSION_CLOSED', 'UNAVAILABLE']);
  assert.ok(DATA_HEALTH_ENUMS.sourceAvailability.includes('SOURCE_MISSING'));
  assert.ok(DATA_HEALTH_ENUMS.readinessState.includes('CONTRACT_NOT_FROZEN'));
  const health = buildDataHealthContract({ now, snapshot: { sources: {} } });
  assert.equal(health.items.find((item) => item.sourceId === 'forwardShadowRuntime').reason, 'RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD');
});

test('governed chart derivations expose source, readiness and quality independently', () => {
  const chart = {
    status: 'READY',
    timeframe: '5m',
    actualContract: 'TXFH6',
    session: 'DAY',
    sessionId: '2026-08-12-DAY',
    source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    sourceEventCount: 120,
    bars: [{ time: '2026-08-12T00:45:00.000Z' }],
    openingRange: { status: 'READY' },
    levels: { vwap: { availability: 'AVAILABLE' } },
    qualityStatus: 'PASS',
    lastEventTime: '2026-08-12T02:14:30.000Z',
    availableAt: '2026-08-12T02:14:45.000Z',
  };
  const health = buildDataHealthContract({ now, snapshot: { sources: {} }, chart });
  for (const sourceId of ['chartBar', 'chartHistory', 'liveVwap', 'openingRange']) {
    const item = health.items.find((candidate) => candidate.sourceId === sourceId);
    assert.equal(item.sourceAvailability, 'SOURCE_AVAILABLE');
    assert.equal(item.readinessState, 'READY');
    assert.equal(item.freshnessState, 'LIVE');
    assert.equal(item.actualContract, 'TXFH6');
  }
});

test('chart derivation failure is not misreported as a missing upstream Tick source', () => {
  const contract = buildDataHealthContract({
    chart: {
      status: 'UNAVAILABLE', reason: 'BAR_DERIVATION_FAILED', sourceEventCount: 4,
      bars: [], actualContract: 'TXFH6', qualityStatus: 'UNAVAILABLE',
    },
    now: new Date('2026-08-12T01:00:00.000Z'),
  });
  const chartBar = contract.items.find((item) => item.sourceId === 'chartBar');
  assert.equal(chartBar.sourceAvailability, 'SOURCE_AVAILABLE');
  assert.equal(chartBar.readinessState, 'DERIVATION_FAILURE');
  assert.equal(chartBar.reason, 'BAR_DERIVATION_FAILED');
});

test('live breadth and SOX expose independent raw/delayed truth without promotion', () => {
  const liveBreadth = {
    state: 'LIVE', freshnessState: 'LIVE', reasonCode: 'TIMESTAMP_LINEAGE_INSUFFICIENT',
    observation: {
      sourceId: 'SHIOAJI_INDEX_QUOTE_IX0001', tradeDate: '2026-08-14', session: 'DAY',
      eventTime: '2026-08-14T01:01:00.000Z', receivedAt: '2026-08-14T01:01:01.000Z',
      availableAt: '2026-08-14T01:01:01.000Z', qualityStatus: 'QUALITY_INSUFFICIENT',
    },
  };
  const globalContext = { latest: [{
    symbol: 'SOX', tradeDate: '2026-08-13', availableAt: '2026-08-14T00:30:00.000Z',
    source: 'existing-research-source', close: 11800, returnPct: 0.53,
  }] };
  const contract = buildDataHealthContract({ now, liveBreadth, globalContext });
  const breadth = contract.items.find((item) => item.sourceId === 'ix0001LiveBreadth');
  const sox = contract.items.find((item) => item.sourceId === 'soxResearchContext');
  assert.equal(breadth.freshnessState, 'LIVE');
  assert.equal(breadth.quality, 'QUALITY_INSUFFICIENT');
  assert.equal(breadth.readinessState, 'RAW_VALIDATED_CANDIDATE');
  assert.equal(breadth.startup, 'REUSES_EXISTING_8790_CALLBACK');
  assert.equal(sox.freshnessState, 'DELAYED');
  assert.equal(sox.sourceType, 'SOX_EOD_RESEARCH_CONTEXT');
  assert.equal(sox.coverage, '2026-08-13');
  assert.equal(contract.executionAuthorized, false);
});
