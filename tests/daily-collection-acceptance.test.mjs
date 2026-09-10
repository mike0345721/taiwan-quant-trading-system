import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
      'TX:futures_tick:DAY': { recordCount: 4, bytes: 400, firstReceivedAt: '2026-09-09T00:45:00Z', lastReceivedAt: '2026-09-09T05:45:00Z', contracts: ['TXFI6'], sessionStart: '2026-09-09T00:45:00Z', sessionEnd: '2026-09-09T05:45:00Z' },
      'TX:futures_bidask:DAY': { recordCount: 5, bytes: 500, firstReceivedAt: '2026-09-09T00:45:00Z', lastReceivedAt: '2026-09-09T05:45:00Z', contracts: ['TXFI6'], sessionStart: '2026-09-09T00:45:00Z', sessionEnd: '2026-09-09T05:45:00Z' },
      '2330:stock_tick:DAY': { recordCount: 2, bytes: 200, firstReceivedAt: '2026-09-09T00:45:00Z', lastReceivedAt: '2026-09-09T05:45:00Z', contracts: ['2330'], sessionStart: '2026-09-09T00:45:00Z', sessionEnd: '2026-09-09T05:45:00Z' },
      'IX0001:index_quote:DAY': { recordCount: 2, bytes: 200, firstReceivedAt: '2026-09-09T00:45:00Z', lastReceivedAt: '2026-09-09T05:45:00Z', contracts: ['IX0001'], sessionStart: '2026-09-09T00:45:00Z', sessionEnd: '2026-09-09T05:45:00Z' },
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

test('NIGHT operational evidence does not contaminate a valid DAY feed', () => {
  const report = build({
    liveEvidence: live({
      sessions: {
        DAY: { callbackErrors: 0, writerErrors: 0, droppedEvents: 0, reconnectCount: 0, missingFiles: [] },
        NIGHT: { callbackErrors: 2, writerErrors: 1, droppedEvents: 0, reconnectCount: 1, missingFiles: ['night.ndjson'] },
      },
    }),
  });
  const item = feed(report, 'tx_actual_trade', 'DAY');
  assert.equal(item.captureState, 'PASS');
  assert.equal(item.persistenceState, 'PASS');
  assert.ok(!item.reasonCodes.includes('CALLBACK_ERROR'));
  assert.ok(!item.reasonCodes.includes('LEDGER_NOT_FOUND'));
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
    ['futures_bidask', '2026-09-09T16:01:01Z'],
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
  const nightGeneratedAt = '2026-09-10T01:00:00.000Z';
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-10', generatedAt: nightGeneratedAt,
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
  assert.equal(feed(report, 'tx_best_quote', 'NIGHT').calendarDate, '2026-09-10');
  assert.deepEqual(feed(report, 'tx_best_quote', 'NIGHT').calendarDates, ['2026-09-10']);

  const appended = buildLiveEventRecord({
    schemaVersion: '1.0.0', provider: 'fixture', kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6',
    receivedAt: '2026-09-09T15:02:00+08:00', exchangeTimestamp: '2026-09-09T15:02:00+08:00',
    sequence: null, duplicate: false, sequenceGap: 0, formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T15:02:00+08:00', simtrade: false },
  }, previousHash);
  fs.appendFileSync(ledger, `${JSON.stringify(appended)}\n`, 'utf8');
  const replayed = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-10', generatedAt: nightGeneratedAt,
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
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: 1, sequenceGap: 0, duplicate: false,
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

  const exact = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { ok: true, sources: [{
      source: 'auditLiveEventLedger', sourceFile: '2026-09-09.ndjson', bytes: fs.statSync(ledger).size,
      latestHash: record.recordHash, sequenceGaps: 0, ok: true,
      prefixSha256: crypto.createHash('sha256').update(fs.readFileSync(ledger)).digest('hex'),
    }] },
  });
  assert.equal(exact.ledgerAudit.ok, true);
  const exactReport = buildDailyCollectionAcceptance({ ...context, sessions: ['DAY'], liveEvidence: exact });
  assert.equal(feed(exactReport, 'tx_actual_trade', 'DAY').integrityState, 'PASS');
  assert.equal(feed(exactReport, 'tx_actual_trade', 'DAY').coverageState, 'PARTIAL');
  assert.equal(feed(exactReport, 'tx_actual_trade', 'DAY').researchEligibility, 'NOT_READY');
});

test('native sequence gap fails integrity even when the ledger hash audit is valid', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-sequence-gap-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: 3, sequenceGap: 2, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { ok: true, sources: [{ sourceFile: '2026-09-09.ndjson', bytes: fs.statSync(ledger).size, latestHash: record.recordHash, sequenceGaps: 2, ok: true }] },
  });
  const report = buildDailyCollectionAcceptance({ ...context, sessions: ['DAY'], liveEvidence: evidence });
  const item = feed(report, 'tx_actual_trade', 'DAY');
  assert.equal(item.integrityState, 'FAIL');
  assert.ok(item.reasonCodes.includes('CONTINUITY_BREAK'));
});

test('malformed sequence-gap evidence remains UNKNOWN and cannot become a proven zero', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-sequence-unknown-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: 1, sequenceGap: 'unknown', duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { ok: true, sources: [{ sourceFile: '2026-09-09.ndjson', bytes: fs.statSync(ledger).size, latestHash: record.recordHash, sequenceGaps: 0, ok: true }] },
  });
  const report = buildDailyCollectionAcceptance({ ...context, sessions: ['DAY'], liveEvidence: evidence });
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').integrityState, 'UNKNOWN');
});

test('an empty governed ledger file remains explicit and prevents session PASS', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-missing-ledger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const existing = path.join(directory, '2026-09-09.ndjson');
  const missing = path.join(directory, '2026-09-10.ndjson');
  fs.writeFileSync(missing, '', 'utf8');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T15:01:00+08:00',
    exchangeTimestamp: '2026-09-09T15:01:00+08:00', sequence: 1, sequenceGap: 0, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T15:01:00+08:00', simtrade: false },
  }, 'GENESIS');
  const bidask = buildLiveEventRecord({
    kind: 'futures_bidask', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T15:01:01+08:00',
    exchangeTimestamp: '2026-09-09T15:01:01+08:00', sequence: 2, sequenceGap: 0, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T15:01:01+08:00', simtrade: false },
  }, record.recordHash);
  fs.writeFileSync(existing, `${JSON.stringify(record)}\n${JSON.stringify(bidask)}\n`, 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09', '2026-09-10']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([existing, missing], {
    calendar, tradeDate: '2026-09-10', generatedAt: context.generatedAt,
  });
  assert.deepEqual(evidence.missingFiles, ['2026-09-10.ndjson']);
  assert.deepEqual(evidence.sourceArtifactIdentity.missingFiles, ['2026-09-10.ndjson']);
  const report = buildDailyCollectionAcceptance({
    ...context, tradeDate: '2026-09-10', sessions: ['NIGHT'], liveEvidence: evidence,
  });
  const item = feed(report, 'tx_actual_trade', 'NIGHT');
  assert.equal(item.captureState, 'PARTIAL');
  assert.equal(item.persistenceState, 'PARTIAL');
  assert.ok(item.reasonCodes.includes('LEDGER_NOT_FOUND'));
  assert.equal(report.summary.nightSessionState, 'UNKNOWN');
  assert.equal(report.overallState, 'PARTIAL');
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

test('zero delivery before the governed session close remains pending', () => {
  const report = buildDailyCollectionAcceptance({
    ...context,
    generatedAt: '2026-09-09T00:30:00.000Z',
    liveEvidence: live({
      feeds: {},
      sessionWindows: { DAY: { sessionStart: '2026-09-09T00:45:00.000Z', sessionEnd: '2026-09-09T05:45:00.000Z' } },
    }),
  });
  const item = feed(report, 'tx_actual_trade', 'DAY');
  assert.equal(item.captureState, 'PENDING');
  assert.equal(item.coverageState, 'PENDING');
  assert.equal(item.researchEligibility, 'UNKNOWN');
});

test('zero delivery after TWSE close fails while TAIFEX DAY remains pending', () => {
  const report = buildDailyCollectionAcceptance({
    ...context,
    generatedAt: '2026-09-09T05:35:00.000Z',
    liveEvidence: live({
      ledgerFound: false,
      feeds: {},
      sessionWindows: { DAY: { sessionStart: '2026-09-09T00:45:00.000Z', sessionEnd: '2026-09-09T05:45:00.000Z' } },
    }),
  });
  assert.equal(feed(report, 'tx_actual_trade', 'DAY').captureState, 'PENDING');
  assert.equal(feed(report, 'equity_2330_raw_price', 'DAY').captureState, 'UNKNOWN');
  assert.ok(feed(report, 'equity_2330_raw_price', 'DAY').reasonCodes.includes('LEDGER_NOT_FOUND'));
  assert.equal(feed(report, 'taiex_index', 'DAY').captureState, 'UNKNOWN');
});

test('unsupported native sequence identity cannot produce integrity PASS', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-sequence-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: true, sequenceGap: 0, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  const prefixSha256 = crypto.createHash('sha256').update(fs.readFileSync(ledger)).digest('hex');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { sources: [{ sourceFile: '2026-09-09.ndjson', bytes: fs.statSync(ledger).size, latestHash: record.recordHash, sequenceGaps: 0, prefixSha256, ok: true }] },
  });
  const item = feed(buildDailyCollectionAcceptance({ ...context, liveEvidence: evidence }), 'tx_actual_trade', 'DAY');
  assert.equal(item.integrityState, 'UNKNOWN');
  assert.ok(item.reasonCodes.includes('NATIVE_SEQUENCE_UNAVAILABLE'));
});

test('boolean sequence gap cannot be coerced into proven zero continuity', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-gap-type-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = path.join(directory, '2026-09-09.ndjson');
  const record = buildLiveEventRecord({
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: '2026-09-09T09:00:00+08:00',
    exchangeTimestamp: '2026-09-09T09:00:00+08:00', sequence: 1, sequenceGap: false, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { productFamily: 'TX', actualContract: 'TXFI6', datetime: '2026-09-09T09:00:00+08:00', simtrade: false },
  }, 'GENESIS');
  fs.writeFileSync(ledger, `${JSON.stringify(record)}\n`, 'utf8');
  const prefixSha256 = crypto.createHash('sha256').update(fs.readFileSync(ledger)).digest('hex');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-09']), nonTradingDates: new Set([]) };
  const evidence = await streamDailyLedgerEvidence([ledger], {
    calendar, tradeDate: '2026-09-09', generatedAt: context.generatedAt,
    ledgerAudit: { sources: [{ sourceFile: '2026-09-09.ndjson', bytes: fs.statSync(ledger).size, latestHash: record.recordHash, sequenceGaps: 0, prefixSha256, ok: true }] },
  });
  assert.equal(evidence.feeds['TX:futures_tick:DAY'].nativeSequenceGapUnknown, true);
  assert.equal(feed(buildDailyCollectionAcceptance({ ...context, liveEvidence: evidence }), 'tx_actual_trade', 'DAY').integrityState, 'UNKNOWN');
});

test('empty ledger identity and missing-file scope are deterministic', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-empty-scope-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const friday = path.join(directory, '2026-09-04.ndjson');
  const saturday = path.join(directory, '2026-09-05.ndjson');
  const monday = path.join(directory, '2026-09-07.ndjson');
  fs.writeFileSync(friday, '', 'utf8');
  fs.writeFileSync(saturday, '', 'utf8');
  fs.writeFileSync(monday, '', 'utf8');
  const calendar = { payload: { sourceHash: 'fixture' }, fileHash: 'fixture', exceptions: new Map(), tradingDates: new Set(['2026-09-04', '2026-09-07']), nonTradingDates: new Set(['2026-09-05', '2026-09-06']) };
  const evidence = await streamDailyLedgerEvidence([friday, saturday, monday], {
    calendar, tradeDate: '2026-09-07', cutoffBytesByFile: {
      '2026-09-04.ndjson': 0, '2026-09-05.ndjson': 0, '2026-09-07.ndjson': 0,
    },
    expectedSessionsByFile: {
      '2026-09-04.ndjson': ['NIGHT'], '2026-09-05.ndjson': ['NIGHT'], '2026-09-07.ndjson': ['DAY'],
    },
  });
  assert.deepEqual(evidence.sessions.DAY.missingFiles, ['2026-09-07.ndjson']);
  assert.deepEqual(evidence.sessions.NIGHT.missingFiles, ['2026-09-04.ndjson', '2026-09-05.ndjson']);
  assert.equal(evidence.sourceArtifactIdentity.files.length, 0);
  assert.equal(evidence.sourceArtifactIdentity.unavailableFiles.length, 3);
  const report = buildDailyCollectionAcceptance({
    ...context, tradeDate: '2026-09-07', calendarDate: '2026-09-07', generatedAt: '2026-09-07T06:00:00.000Z',
    sessions: ['DAY', 'NIGHT'], liveEvidence: evidence,
  });
  assert.deepEqual(feed(report, 'tx_actual_trade', 'DAY').sourceArtifactIdentity, evidence.sourceArtifactIdentity);
});

test('missing NIGHT ledgers remain session-scoped when an unrelated DAY feed exists', () => {
  const identity = { type: 'fixture', files: [{ file: '2026-09-07.ndjson' }], missingFiles: ['2026-09-04.ndjson', '2026-09-05.ndjson'] };
  const report = buildDailyCollectionAcceptance({
    ...context, tradeDate: '2026-09-07', calendarDate: '2026-09-07', generatedAt: '2026-09-07T06:00:00.000Z',
    sessions: ['DAY', 'NIGHT'],
    liveEvidence: live({
      feeds: { '2330:stock_tick:DAY': live().feeds['2330:stock_tick:DAY'] },
      sessions: {
        DAY: { callbackErrors: 0, writerErrors: 0, droppedEvents: 0, reconnectCount: 0, missingFiles: [] },
        NIGHT: { callbackErrors: 0, writerErrors: 0, droppedEvents: 0, reconnectCount: 0, missingFiles: ['2026-09-04.ndjson', '2026-09-05.ndjson'] },
      },
      sourceArtifactIdentity: identity,
    }),
  });
  const item = feed(report, 'tx_actual_trade', 'NIGHT');
  assert.equal(item.captureState, 'PARTIAL');
  assert.equal(item.persistenceState, 'PARTIAL');
  assert.ok(item.reasonCodes.includes('LEDGER_NOT_FOUND'));
  assert.deepEqual(item.sourceArtifactIdentity, identity);
});

test('CLI emits MARKET_CLOSED acceptance on a governed non-trading date', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cru25-daily-market-closed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/build-daily-collection-acceptance.mjs'),
    '--trade-date=2026-09-06', '--calendar-date=2026-09-06',
    '--generated-at=2026-09-06T08:00:00.000Z', '--sessions=DAY,NIGHT',
    `--data-root=${directory}`, `--output-root=${path.join(directory, 'output')}`,
    `--calendar=${path.resolve('config/taifex-official-calendar-2026.json')}`,
    `--registry=${path.resolve('config/data-requirements-v1.json')}`,
    `--daily-status=${path.join(directory, 'missing-status.json')}`,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'output', '2026-09-06.json'), 'utf8'));
  assert.equal(report.marketDayState, 'NON_TRADING_DAY');
  assert.equal(report.overallState, 'NOT_EXPECTED');
  assert.ok(report.feeds.filter((item) => item.mode === 'LIVE_EVENT').every((item) => item.reasonCodes.includes('MARKET_CLOSED')));
});
