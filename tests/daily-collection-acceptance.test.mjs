import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDailyCollectionAcceptance,
  stableDailyAcceptanceJson,
  streamDailyLedgerEvidence,
} from '../src/daily-collection-acceptance.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';

const DATASETS = [
  ['tx_actual_trade', 'QUALITY_INSUFFICIENT'],
  ['tx_best_quote', 'QUALITY_INSUFFICIENT'],
  ['equity_2330_raw_price', 'QUALITY_LIMITED'],
  ['taiex_index', 'QUALITY_LIMITED'],
  ['taifex_daily_market', 'PASS'],
  ['tx_futures_oi', 'QUALITY_LIMITED'],
  ['tx_institutional_positions', 'QUALITY_LIMITED'],
  ['tx_large_trader', 'QUALITY_LIMITED'],
  ['txo_strike_expiry_cp_oi', 'QUALITY_LIMITED'],
  ['market_breadth_and_sector_leadership', 'QUALITY_LIMITED'],
  ['derived_pressure_response_efficiency', 'QUALITY_INSUFFICIENT'],
  ['twn_futures', 'UNAVAILABLE'],
  ['nq_futures', 'UNAVAILABLE'],
];

const registry = { datasets: DATASETS.map(([dataset_id, quality_status]) => ({ dataset_id, quality_status })) };
const context = {
  calendarDate: '2026-09-09',
  tradeDate: '2026-09-09',
  marketDayState: 'TRADING_DAY',
  generatedAt: '2026-09-09T12:00:00.000Z',
  sessions: ['DAY'],
  registry,
};

function stageStatus(completedAt = '2026-09-09T08:00:00.000Z') {
  return {
    completedAt,
    stages: [
      { key: 'taifex', ok: true },
      { key: 'futures_positions', ok: true },
      { key: 'market_breadth', ok: true },
    ],
    gateSummary: { marketDaily: { tradeDate: '2026-09-09', status: 'VALID' } },
  };
}

function live(overrides = {}) {
  return {
    ledgerFound: true,
    feeds: {
      'TX:futures_tick:DAY': { recordCount: 4, bytes: 400, firstReceivedAt: '2026-09-09T01:00:00Z', lastReceivedAt: '2026-09-09T01:01:00Z', contracts: ['TXFI6'] },
      'TX:futures_bidask:DAY': { recordCount: 5, bytes: 500, firstReceivedAt: '2026-09-09T01:00:01Z', lastReceivedAt: '2026-09-09T01:01:01Z', contracts: ['TXFI6'] },
      '2330:stock_tick:DAY': { recordCount: 2, bytes: 200, firstReceivedAt: '2026-09-09T01:00:02Z', lastReceivedAt: '2026-09-09T01:01:02Z', contracts: ['2330'] },
      'IX0001:index_quote:DAY': { recordCount: 2, bytes: 200, firstReceivedAt: '2026-09-09T01:00:03Z', lastReceivedAt: '2026-09-09T01:01:03Z', contracts: ['IX0001'] },
    },
    totalRawBytes: 1_300,
    totalRecords: 13,
    reconnectCount: 0,
    callbackErrors: 0,
    writerErrors: 0,
    droppedEvents: 0,
    invalidLines: 0,
    nativeSequenceAvailable: false,
    ledgerAudit: { ok: true },
    sourceArtifactIdentity: { type: 'test-fixture' },
    ...overrides,
  };
}

function build(extra = {}) {
  return buildDailyCollectionAcceptance({
    ...context,
    liveEvidence: live(),
    dailyUpdateStatus: stageStatus(),
    ...extra,
  });
}

function feed(report, datasetId, session = null) {
  return report.feeds.find((item) => item.datasetId === datasetId && (!session || item.session === session));
}

test('normal TX Tick is captured and persisted while native-sequence completeness remains unknown', () => {
  const report = build();
  const item = feed(report, 'tx_actual_trade', 'DAY');
  assert.equal(item.captureState, 'PASS');
  assert.equal(item.persistenceState, 'PASS');
  assert.equal(item.integrityState, 'UNKNOWN');
  assert.equal(item.researchEligibility, 'READY_WITH_LIMITATION');
  assert.ok(item.reasonCodes.includes('NATIVE_SEQUENCE_UNAVAILABLE'));
  assert.equal(report.summary.daySessionState, 'UNKNOWN');
  assert.equal(report.overallState, 'UNKNOWN');
});

test('normal TX BidAsk is classified independently from TX Tick', () => {
  const report = build();
  const item = feed(report, 'tx_best_quote', 'DAY');
  assert.equal(item.quoteType, 'BidAsk');
  assert.equal(item.recordCount, 5);
  assert.equal(item.captureState, 'PASS');
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').recordCount, 4);
});

test('not-enabled TWN remains NOT_EXPECTED and does not enter required denominator', () => {
  const report = build();
  const item = feed(report, 'twn_futures');
  assert.equal(item.expectedState, 'NOT_EXPECTED');
  assert.equal(item.captureState, 'NOT_EXPECTED');
  assert.ok(item.reasonCodes.includes('NOT_ENABLED'));
  assert.ok(!report.feeds.filter((row) => row.expectedState === 'REQUIRED').includes(item));
});

test('TWSE 2330 and IX0001 are not incorrectly required during TAIFEX NIGHT', () => {
  const report = build({ sessions: ['DAY', 'NIGHT'] });
  for (const datasetId of ['equity_2330_raw_price', 'taiex_index']) {
    const item = feed(report, datasetId, 'NIGHT');
    assert.equal(item.expectedState, 'NOT_EXPECTED');
    assert.ok(item.reasonCodes.includes('NOT_IN_CURRENT_SCOPE'));
  }
});

test('pre-publication batch is PENDING / NOT_PUBLISHED_YET, not FAIL', () => {
  const report = buildDailyCollectionAcceptance({
    ...context,
    generatedAt: '2026-09-09T00:30:00.000Z',
    liveEvidence: live(),
    dailyUpdateStatus: stageStatus('2026-09-09T00:29:00.000Z'),
  });
  const item = feed(report, 'taifex_daily_market');
  assert.equal(item.expectedState, 'PENDING');
  assert.equal(item.captureState, 'PENDING');
  assert.ok(item.reasonCodes.includes('NOT_PUBLISHED_YET'));
});

test('batch stage PASS alone does not pretend dataset capture or persistence PASS', () => {
  const item = feed(build(), 'taifex_daily_market');
  assert.equal(item.captureState, 'UNKNOWN');
  assert.equal(item.persistenceState, 'UNKNOWN');
  assert.equal(item.evidenceStrength, 'DAILY_UPDATE_STAGE_ONLY');
  assert.ok(item.reasonCodes.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
});

test('Daily Update evidence completed after generatedAt cannot leak backward', () => {
  const report = buildDailyCollectionAcceptance({
    ...context,
    generatedAt: '2026-09-09T12:00:00.000Z',
    liveEvidence: live(),
    dailyUpdateStatus: stageStatus('2026-09-09T13:00:00.000Z'),
  });
  const item = feed(report, 'taifex_daily_market');
  assert.equal(item.captureState, 'UNKNOWN');
  assert.equal(item.sourceArtifactIdentity, null);
  assert.ok(item.reasonCodes.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
});

test('writer failure changes persistence but does not invent a capture failure', () => {
  const item = feed(build({ liveEvidence: live({ writerErrors: 2 }) }), 'tx_actual_trade', 'DAY');
  assert.equal(item.captureState, 'PASS');
  assert.equal(item.persistenceState, 'FAIL');
  assert.ok(item.reasonCodes.includes('WRITER_ERROR'));
});

test('callback error prevents a live feed and session from reporting PASS', () => {
  const report = build({ liveEvidence: live({ callbackErrors: 1 }) });
  const item = feed(report, 'tx_actual_trade', 'DAY');
  assert.equal(item.captureState, 'PARTIAL');
  assert.ok(item.reasonCodes.includes('CALLBACK_ERROR'));
  assert.equal(report.summary.daySessionState, 'UNKNOWN');
});

test('queue drop is a persistence and integrity limitation', () => {
  const item = feed(build({ liveEvidence: live({ droppedEvents: 1 }) }), 'tx_best_quote', 'DAY');
  assert.equal(item.captureState, 'PASS');
  assert.equal(item.persistenceState, 'FAIL');
  assert.equal(item.integrityState, 'UNKNOWN');
  assert.ok(item.reasonCodes.includes('QUEUE_DROP'));
});

test('raw TX can pass while Path research remains READY_WITH_LIMITATION', () => {
  const report = build({
    derivedEvidence: {
      session: 'DAY', actualContract: 'TXFI6', captureState: 'PASS', persistenceState: 'PASS',
      integrityState: 'UNKNOWN', researchEligibility: 'READY_WITH_LIMITATION',
      reasonCodes: ['LONG_GAP_QUALITY_INSUFFICIENT'], sourceArtifactIdentity: { snapshotHash: 'fixture' },
    },
  });
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').captureState, 'PASS');
  const derived = feed(report, 'derived_pressure_response_efficiency');
  assert.equal(derived.researchEligibility, 'READY_WITH_LIMITATION');
  assert.ok(derived.reasonCodes.includes('LONG_GAP_QUALITY_INSUFFICIENT'));
});

test('missing evidence remains UNKNOWN and cannot produce overall PASS', () => {
  const report = buildDailyCollectionAcceptance({ ...context, liveEvidence: null, dailyUpdateStatus: null });
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').captureState, 'UNKNOWN');
  assert.equal(report.overallState, 'UNKNOWN');
});

test('same immutable evidence and generatedAt produce deterministic JSON', () => {
  const first = stableDailyAcceptanceJson(build());
  const second = stableDailyAcceptanceJson(build());
  assert.equal(first, second);
});

test('missing storage evidence remains null / NOT_VERIFIED instead of becoming zero', () => {
  const report = build();
  assert.equal(report.storage.derivedArtifactBytes, null);
  assert.equal(report.storage.auditReportBytes, null);
  assert.equal(report.storage.totalBytes, null);
  assert.equal(report.storage.totalBytesScope, 'NOT_VERIFIED');
});

test('night session preserves calendarDate separately from governed tradeDate using temp ledger only', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-acceptance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const records = [];
  let previousHash = 'GENESIS';
  for (const [kind, receivedAt] of [
    ['futures_tick', '2026-09-09T15:01:00+08:00'],
    ['futures_bidask', '2026-09-09T15:01:01+08:00'],
  ]) {
    const record = buildLiveEventRecord({
      schemaVersion: '1.0.0', provider: 'fixture', kind, code: 'TXFI6', product: 'TXFI6',
      receivedAt, exchangeTimestamp: receivedAt, sequence: null, duplicate: false, sequenceGap: 0,
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', datetime: receivedAt, simtrade: false },
    }, previousHash);
    previousHash = record.recordHash;
    records.push(record);
  }
  fs.writeFileSync(ledger, `${records.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  const fixedCutoff = fs.statSync(ledger).size;
  const calendar = {
    payload: { sourceHash: 'fixture', coverageStart: '2026-09-01' }, fileHash: 'fixture', exceptions: new Map(),
    tradingDates: new Set(['2026-09-09', '2026-09-10']), nonTradingDates: new Set([]),
  };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-10', generatedAt: context.generatedAt,
  });
  const item = evidence.feeds['TX:futures_tick:NIGHT'];
  assert.equal(item.recordCount, 1);
  assert.equal(path.basename(evidence.sourceArtifactIdentity.files[0].file), '2026-09-09.ndjson');
  const report = buildDailyCollectionAcceptance({
    ...context, calendarDate: '2026-09-09', tradeDate: '2026-09-10', sessions: ['NIGHT'],
    liveEvidence: evidence, dailyUpdateStatus: null,
  });
  assert.equal(feed(report, 'tx_actual_trade', 'NIGHT').tradeDate, '2026-09-10');
  assert.equal(feed(report, 'tx_actual_trade', 'NIGHT').calendarDate, '2026-09-09');
  assert.deepEqual(feed(report, 'tx_actual_trade', 'NIGHT').calendarDates, ['2026-09-09']);

  const appended = buildLiveEventRecord({
    schemaVersion: '1.0.0', provider: 'fixture', kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6',
    receivedAt: '2026-09-09T15:02:00+08:00', exchangeTimestamp: '2026-09-09T15:02:00+08:00',
    sequence: null, duplicate: false, sequenceGap: 0, formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T15:02:00+08:00', simtrade: false },
  }, previousHash);
  fs.appendFileSync(ledger, `${JSON.stringify(appended)}\n`, 'utf8');
  const replayed = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-10', generatedAt: context.generatedAt,
    cutoffBytesByFile: { '2026-09-09.ndjson': fixedCutoff },
  });
  assert.deepEqual(replayed.feeds, evidence.feeds);
  assert.deepEqual(replayed.sourceArtifactIdentity, evidence.sourceArtifactIdentity);
});

test('first wave exposes MTX/TMF without inventing canonical aliases and includes TXO future', () => {
  const report = build();
  for (const label of ['MTX Tick', 'MTX BidAsk', 'TMF Tick', 'TMF BidAsk']) {
    const item = report.feeds.find((row) => row.technicalLabelEn === label && row.session === 'DAY');
    assert.ok(item);
    assert.equal(item.datasetId, null);
  }
  const txo = feed(report, 'txo_intraday_trade_quote_candidates');
  assert.equal(txo.expectedState, 'NOT_EXPECTED');
  assert.ok(txo.reasonCodes.includes('NOT_ENABLED'));
});

test('live records received after generatedAt cannot leak backward', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-future-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const before = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: null, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  const after = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:02:00+08:00',
    exchangeTimestamp: '2026-09-09T09:02:00+08:00', sequence: null, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:02:00+08:00', simtrade: false },
  }, before.recordHash);
  fs.writeFileSync(ledger, `${JSON.stringify(before)}\n${JSON.stringify(after)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: '2026-09-09T01:01:00.000Z',
  });
  assert.equal(evidence.feeds['TX:futures_tick:DAY'].recordCount, 1);
  assert.equal(evidence.feeds['TX:futures_tick:DAY'].lastReceivedAt, before.receivedAt);
});

test('explicit trade-date mismatch and off-target operational errors cannot contaminate the requested date', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-lineage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const mismatch = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', tradeDate: '2026-09-08', session: 'DAY',
    sequence: 1, duplicate: false, formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  const offTarget = buildLiveEventRecord({
    kind: 'provider_event', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-08T09:00:00+08:00',
    exchangeTimestamp: '2026-09-08T09:00:00+08:00', sequence: null, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { event: 'reconnect', callbackErrors: 9, datetime: '2026-09-08T09:00:00+08:00' },
  }, mismatch.recordHash);
  fs.writeFileSync(ledger, `${JSON.stringify(mismatch)}\n${JSON.stringify(offTarget)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-08', '2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
  });
  assert.equal(evidence.totalRecords, 0);
  assert.equal(evidence.invalidLines, 1);
  assert.equal(evidence.reconnectCount, 0);
  assert.equal(evidence.callbackErrors, 0);
});

test('ledger audit cannot promote integrity unless every selected cutoff is exactly bound', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: 1, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { ok: true, sources: [{ sourceFile: 'other.ndjson', bytes: fs.statSync(ledger).size, latestHash: record.recordHash, ok: true }] },
  });
  assert.equal(evidence.ledgerAudit, null);
  const report = buildDailyCollectionAcceptance({ ...context, sessions: ['DAY'], liveEvidence: evidence });
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').integrityState, 'UNKNOWN');
});

test('unsafe execution boundary record is excluded and reported as insufficient evidence', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-unsafe-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  fs.writeFileSync(ledger, `${JSON.stringify({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', executionAuthorized: true, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6' },
  })}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], { calendar, tradeDate: '2026-09-09' });
  assert.equal(evidence.invalidLines, 1);
  assert.equal(evidence.totalRecords, 0);
});
