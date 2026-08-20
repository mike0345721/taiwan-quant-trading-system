import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendLiveEvent,
  auditLiveEventLedger,
  evaluateLiveEventAcceptance,
  replayLiveEventLedger,
  taiwanMarketSession,
} from '../src/live-event-ledger.mjs';
import {
  durableAcceptanceFromReport,
  selectDurableLiveAcceptance,
} from '../src/live-acceptance-state.mjs';

function event(receivedAt, sequence, overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    provider: 'shioaji',
    kind: 'stock_tick',
    code: '2330',
    product: '2330',
    receivedAt,
    exchangeTimestamp: receivedAt,
    sequence,
    duplicate: false,
    sequenceGap: 0,
    clockSkewMs: 0,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: { code: '2330', close: 100 + sequence },
    ...overrides,
  };
}

test('live market events append into a verifiable hash chain and replay by time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-24.ndjson');
  appendLiveEvent(file, event('2026-07-24T01:00:00.000Z', 1));
  appendLiveEvent(file, event('2026-07-24T01:00:01.000Z', 2));
  const audit = auditLiveEventLedger(file, { now: new Date('2026-07-24T01:00:02.000Z') });
  assert.equal(audit.ok, true);
  assert.equal(audit.events, 2);
  assert.equal(audit.stale, false);
  assert.deepEqual(audit.latency, {
    samples: 2, p50Ms: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0,
    negativeSamples: 0, negativeRate: 0, absoluteP95Ms: 0,
    interpretation: 'received_at_minus_exchange_timestamp; includes host/exchange clock offset',
  });
  assert.equal(replayLiveEventLedger(file, { until: '2026-07-24T01:00:00.500Z' }).length, 1);
});

test('live audit reports latency percentiles and distinguishes trading from non-trading stale data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-27.ndjson');
  [10, 20, 30, 40, 100].forEach((latency, index) => {
    appendLiveEvent(file, event(`2026-07-27T01:0${index}:00.000Z`, index + 1, {
      clockSkewMs: latency,
    }));
  });
  const duringSession = auditLiveEventLedger(file, {
    now: new Date('2026-07-27T02:00:00.000Z'),
    staleAfterMs: 60_000,
  });
  assert.equal(duringSession.marketSession.isTradingSession, true);
  assert.equal(duringSession.staleExpected, false);
  assert.deepEqual(duringSession.latency, {
    samples: 5, p50Ms: 30, p95Ms: 100, p99Ms: 100, minMs: 10, maxMs: 100,
    negativeSamples: 0, negativeRate: 0, absoluteP95Ms: 100,
    interpretation: 'received_at_minus_exchange_timestamp; includes host/exchange clock offset',
  });
  const afterClose = auditLiveEventLedger(file, {
    now: new Date('2026-07-27T06:00:00.000Z'),
    staleAfterMs: 60_000,
  });
  assert.equal(afterClose.marketSession.state, 'after_close');
  assert.equal(afterClose.staleExpected, true);
  assert.equal(taiwanMarketSession(new Date('2026-07-26T02:00:00.000Z')).state, 'non_trading_session');
});

test('closing-session timestamp lag is reported but does not fail regular-session acceptance timing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-29.ndjson');
  try {
    appendLiveEvent(file, event('2026-07-29T05:30:06.000Z', 1, {
      exchangeTimestamp: '2026-07-29T13:30:00',
      clockSkewMs: 6_000,
    }));
    appendLiveEvent(file, event('2026-07-29T05:31:06.000Z', 1, {
      kind: 'index_quote',
      code: 'IX0001',
      product: 'IX0001',
      exchangeTimestamp: '2026-07-29T13:31:00',
      clockSkewMs: 6_000,
    }));
    const audit = auditLiveEventLedger(file, { now: new Date('2026-07-29T05:32:00.000Z') });
    const acceptance = evaluateLiveEventAcceptance(audit, {
      minEventsPerProduct: 1,
      minDurationMs: 0,
      requireReconnectEvidence: false,
      operationalHealth: { callbackErrors: 0, dropped: 0, writerErrors: 0 },
    });
    assert.equal(audit.clockSkewEvents, 2);
    assert.equal(audit.regularSessionClockSkewEvents, 0);
    assert.equal(acceptance.failReasons.includes('clock_skew_detected'), false);
    assert.equal(acceptance.checks.timing, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy live rows derive callback latency and lifecycle events do not hide stale quotes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-27.ndjson');
  appendLiveEvent(file, event('2026-07-27T01:00:00.200Z', 1, {
    exchangeTimestamp: '2026-07-27T09:00:00',
    clockSkewMs: null,
    payload: {
      code: '2330',
      close: 100,
      _received_at: '2026-07-27T09:00:00.150+08:00',
    },
  }));
  appendLiveEvent(file, event('2026-07-27T06:00:00.000Z', null, {
    kind: 'bridge_started',
    code: 'bridge',
    product: 'bridge',
    exchangeTimestamp: '2026-07-27T14:00:00+08:00',
    payload: { code: 'bridge' },
  }));
  const audit = auditLiveEventLedger(file, {
    now: new Date('2026-07-27T06:00:10.000Z'),
    staleAfterMs: 60_000,
  });
  assert.deepEqual(audit.latency, {
    samples: 1, p50Ms: 150, p95Ms: 150, p99Ms: 150, minMs: 150, maxMs: 150,
    negativeSamples: 0, negativeRate: 0, absoluteP95Ms: 150,
    interpretation: 'received_at_minus_exchange_timestamp; includes host/exchange clock offset',
  });
  assert.equal(audit.latestReceivedAt, '2026-07-27T06:00:00.000Z');
  assert.equal(audit.latestMarketReceivedAt, '2026-07-27T01:00:00.200Z');
  assert.equal(audit.stale, true);
  assert.equal(audit.staleExpected, true);
});

test('tampering, execution fields and secrets fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-24.ndjson');
  appendLiveEvent(file, event('2026-07-24T01:00:00.000Z', 1));
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].payload.close = 999;
  fs.writeFileSync(file, `${JSON.stringify(rows[0])}\n`);
  assert.equal(auditLiveEventLedger(file).ok, false);
  assert.throws(() => appendLiveEvent(path.join(dir, 'bad.ndjson'), event('2026-07-24T01:00:00.000Z', 1, {
    payload: { order: { action: 'must-not-be-stored' } },
  })), /sensitive_or_execution/);
});

test('read-only bridge source persists events and contains no order routes', () => {
  const source = fs.readFileSync(new URL('../broker/shioaji_readonly_bridge.py', import.meta.url), 'utf8');
  assert.match(source, /LiveEventLedger/);
  assert.match(source, /EVENT_LEDGER\.append/);
  assert.match(source, /set_session_down_callback/);
  assert.match(source, /subscriptions_ready/);
  assert.match(source, /set_on_tick_fop_v1_callback/);
  assert.match(source, /set_on_bidask_fop_v1_callback/);
  assert.match(source, /\("TX", "TXFR1"\)/);
  assert.match(source, /\("MTX", "MXFR1"\)/);
  assert.match(source, /\("TMF", "TMFR1"\)/);
  assert.match(source, /quote_type=sj\.QuoteType\.BidAsk/);
  assert.match(source, /ThreadingHTTPServer\(\(HOST, PORT\), Handler\)/);
  assert.match(source, /acquire_single_instance\(\)/);
  assert.match(source, /shioaji_readonly_bridge_already_running/);
  assert.match(source, /controlled_bridge_shutdown/);
  assert.match(source, /orderRoutesEnabled/);
  assert.equal((source.match(/sj\.Shioaji\(/g) || []).length, 1, 'must keep one Shioaji login');
  assert.equal((source.match(/LiveEventLedger\(/g) || []).length, 1, 'must keep one writer');
  assert.match(source, /DW4_TXO_COLLECTION_ENABLED/);
  assert.match(source, /TXO default-off/);
  assert.doesNotMatch(source, /Register-ScheduledTask|Startup\\/i);
  assert.doesNotMatch(source, /\.place_order|\.cancel_order|update_status|list_positions/);
});

test('live event acceptance requires both products and reports continuity evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-24.ndjson');
  appendLiveEvent(file, event('2026-07-24T01:00:00.000Z', 1));
  appendLiveEvent(file, event('2026-07-24T01:00:30.000Z', 1, {
    kind: 'index_quote', code: 'IX0001', product: 'IX0001',
  }));
  appendLiveEvent(file, event('2026-07-24T01:01:00.000Z', 2));
  appendLiveEvent(file, event('2026-07-24T01:01:30.000Z', 2, {
    kind: 'index_quote', code: 'IX0001', product: 'IX0001',
  }));
  const audit = auditLiveEventLedger(file, { now: new Date('2026-07-24T01:02:00.000Z') });
  const acceptance = evaluateLiveEventAcceptance(audit, {
    minEventsPerProduct: 2,
    minDurationMs: 60_000,
    maxInterEventGapMs: 120_000,
    requireReconnectEvidence: false,
    operationalHealth: { callbackErrors: 0, dropped: 0, writerErrors: 0 },
  });
  assert.deepEqual(audit.products, ['2330', 'IX0001']);
  assert.equal(audit.productStats['2330'].events, 2);
  assert.equal(audit.productStats.IX0001.events, 2);
  assert.equal(audit.productKindStats['2330'].stock_tick, 2);
  assert.equal(audit.productKindStats.IX0001.index_quote, 2);
  assert.equal(acceptance.status, 'PASS');
  assert.equal(acceptance.passed, true);
  assert.deepEqual(acceptance.reasons, []);
});

test('live event acceptance stays not-ready when a required product or sequence is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ledger-'));
  const file = path.join(dir, '2026-07-24.ndjson');
  appendLiveEvent(file, event('2026-07-24T01:00:00.000Z', 1));
  appendLiveEvent(file, event('2026-07-24T01:01:00.000Z', 3, { sequenceGap: 1 }));
  const audit = auditLiveEventLedger(file, { now: new Date('2026-07-24T01:02:00.000Z') });
  const acceptance = evaluateLiveEventAcceptance(audit, {
    minEventsPerProduct: 1,
    minDurationMs: 0,
  });
  assert.equal(acceptance.status, 'FAIL');
  assert.equal(acceptance.passed, false);
  assert.ok(acceptance.reasons.includes('required_product_missing:IX0001'));
  assert.ok(acceptance.reasons.includes('sequence_gap_detected'));
});

test('live acceptance uses required product windows instead of bridge lifecycle gaps', () => {
  const audit = {
    ok: true,
    events: 220,
    duplicateRate: 0,
    sequenceGaps: 0,
    clockSkewEvents: 0,
    outOfOrderEvents: 0,
    durationMs: 45 * 60_000,
    maxInterEventGapMs: 12 * 60_000,
    reconnectEvidenceCycles: 1,
    productStats: {
      2330: {
        events: 110,
        firstReceivedAt: '2026-07-24T01:10:00.000Z',
        lastReceivedAt: '2026-07-24T01:40:00.000Z',
        maxInterEventGapMs: 30_000,
      },
      IX0001: {
        events: 100,
        firstReceivedAt: '2026-07-24T01:10:00.000Z',
        lastReceivedAt: '2026-07-24T01:39:00.000Z',
        maxInterEventGapMs: 10_000,
      },
      bridge: {
        events: 10,
        firstReceivedAt: '2026-07-24T00:55:00.000Z',
        lastReceivedAt: '2026-07-24T01:40:00.000Z',
        maxInterEventGapMs: 12 * 60_000,
      },
    },
  };
  const acceptance = evaluateLiveEventAcceptance(audit, {
    requireReconnectEvidence: false,
  });
  assert.equal(acceptance.status, 'PENDING');
  assert.equal(acceptance.passed, false);
  assert.ok(acceptance.reasons.includes('observation_window_too_short'));
  assert.ok(!acceptance.reasons.includes('possible_disconnect_gap_detected'));
  assert.equal(acceptance.evidence.requiredProductDurationMs, 29 * 60_000);
  assert.equal(acceptance.evidence.requiredProductMaxGapMs, 30_000);
});

test('live acceptance remains pending until both products emit after controlled restart', () => {
  const audit = {
    ok: true,
    events: 220,
    invalidLines: 0,
    hashFailures: 0,
    duplicateRate: 0,
    sequenceGaps: 0,
    clockSkewEvents: 0,
    outOfOrderEvents: 0,
    reconnectEvidenceCycles: 1,
    latestReconnectReadyAt: '2026-07-28T02:00:00.000Z',
    postReconnectProductEvents: { 2330: 1 },
    postReconnectProductStats: {
      2330: {
        events: 1,
        firstReceivedAt: '2026-07-28T02:00:01.000Z',
        lastReceivedAt: '2026-07-28T02:00:01.000Z',
        maxInterEventGapMs: 0,
      },
      IX0001: {
        events: 0,
        firstReceivedAt: '2026-07-28T02:00:01.000Z',
        lastReceivedAt: '2026-07-28T02:00:01.000Z',
        maxInterEventGapMs: 0,
      },
    },
    productStats: {
      2330: {
        events: 110,
        firstReceivedAt: '2026-07-28T01:00:00.000Z',
        lastReceivedAt: '2026-07-28T01:31:00.000Z',
        maxInterEventGapMs: 30_000,
      },
      IX0001: {
        events: 110,
        firstReceivedAt: '2026-07-28T01:00:00.000Z',
        lastReceivedAt: '2026-07-28T01:31:00.000Z',
        maxInterEventGapMs: 30_000,
      },
    },
  };
  const acceptance = evaluateLiveEventAcceptance(audit, {
    evidenceNotBefore: '2026-07-27T22:43:48.359307+08:00',
    operationalHealth: { callbackErrors: 0, dropped: 0, writerErrors: 0 },
  });
  assert.equal(acceptance.status, 'PENDING');
  assert.equal(acceptance.passed, false);
  assert.ok(acceptance.pendingReasons.includes('post_restart_market_quotes_missing'));
});

test('durable live acceptance does not regress when a later daily audit is pending', () => {
  const passReport = {
    generatedAt: '2026-07-28T06:00:00.000Z',
    ledgerFile: '2026-07-28.ndjson',
    acceptance: { status: 'PASS', passed: true, reasons: [] },
  };
  const pendingReport = {
    generatedAt: '2026-07-29T06:00:00.000Z',
    ledgerFile: '2026-07-29.ndjson',
    acceptance: {
      status: 'PENDING',
      passed: false,
      reasons: ['observation_window_too_short'],
    },
  };
  const previousDurable = durableAcceptanceFromReport(passReport);
  const result = selectDurableLiveAcceptance({
    currentReport: pendingReport,
    previousDurable,
    revalidatedPreviousReport: passReport,
    generatedAt: '2026-07-29T07:00:00.000Z',
  });
  assert.equal(result.acceptance.status, 'PASS');
  assert.equal(result.sourceLedgerFile, '2026-07-28.ndjson');
  assert.equal(result.preserved, true);
});

test('durable live acceptance fails closed if its source evidence no longer revalidates', () => {
  const passReport = {
    generatedAt: '2026-07-28T06:00:00.000Z',
    ledgerFile: '2026-07-28.ndjson',
    acceptance: { status: 'PASS', passed: true, reasons: [] },
  };
  const failedReport = {
    generatedAt: '2026-07-29T06:00:00.000Z',
    ledgerFile: '2026-07-29.ndjson',
    acceptance: {
      status: 'FAIL',
      passed: false,
      reasons: ['ledger_integrity_failed'],
    },
  };
  const previousDurable = durableAcceptanceFromReport(passReport);
  const result = selectDurableLiveAcceptance({
    currentReport: failedReport,
    previousDurable,
    revalidatedPreviousReport: {
      ...passReport,
      acceptance: {
        status: 'FAIL',
        passed: false,
        reasons: ['ledger_integrity_failed'],
      },
    },
  });
  assert.equal(result.acceptance.status, 'FAIL');
  assert.equal(result.sourceLedgerFile, '2026-07-29.ndjson');
  assert.equal(result.preserved, false);
});
