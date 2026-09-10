import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cru34LiveCanonicalJson } from '../src/cru34-live-checkpoint.mjs';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { buildCru34SemanticPayload } from '../src/cru34-snapshot-artifact.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';
import {
  buildCru44MultiWindowReference,
  CRU44_WINDOW_REGISTRY,
} from '../src/cru44-multi-window-observed-flow.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });
const SOURCE = `sha256:${'a'.repeat(64)}`;

function chain(rows, { cryptographic = false } = {}) {
  let previousHash = 'GENESIS';
  return rows.map((row, index) => {
    const base = {
      schemaVersion: '1.0.0', provider: 'shioaji', code: row.code || 'TXFI6',
      product: row.code || 'TXFI6', receivedAt: row.receivedAt,
      exchangeTimestamp: row.eventTime || row.receivedAt, sequence: null,
      eventId: `cru44-${index}`, duplicate: false, sequenceGap: 0, clockSkewMs: 0,
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      kind: row.kind || 'futures_tick',
      payload: row.payload || {
        code: row.code || 'TXFI6', productFamily: 'TX', actualContract: row.code || 'TXFI6',
        tradeDate: row.tradeDate || '2026-09-09', session: row.session || 'DAY',
        datetime: row.eventTime || row.receivedAt, eventTime: row.eventTime || row.receivedAt,
        close: row.price, price: row.price, volume: row.volume || 1,
        executedVolume: row.volume || 1, tick_type: row.tickType ?? 1, simtrade: false,
      },
      previousHash,
    };
    const recordHash = cryptographic
      ? crypto.createHash('sha256').update(`${previousHash}\n${cru34LiveCanonicalJson(base)}`).digest('hex')
      : crypto.createHash('sha256').update(`fixture-${index}`).digest('hex');
    previousHash = recordHash;
    return { ...base, recordHash };
  });
}

function rows({ seconds = 14_460, noisy = false } = {}) {
  const start = Date.parse('2026-09-09T01:00:00.000Z');
  const values = [];
  for (let second = 0; second <= seconds; second += 30) {
    values.push({
      receivedAt: new Date(start + second * 1_000).toISOString(),
      price: noisy ? 100 + (second / 30 % 2 ? 1 : 0) + second / 300 : 100 + second / 30,
      tickType: second % 60 === 0 ? 1 : 2,
    });
  }
  return values;
}

function rowsWithQuotes() {
  return rows().flatMap((tick) => {
    const quoteTime = new Date(Date.parse(tick.receivedAt) - 100).toISOString();
    return [{
      kind: 'futures_bidask', receivedAt: quoteTime, eventTime: quoteTime,
      payload: {
        code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6',
        tradeDate: '2026-09-09', session: 'DAY', datetime: quoteTime, eventTime: quoteTime,
        bid_price: [tick.price - 1], ask_price: [tick.price],
      },
    }, tick];
  });
}

function reference(records, extra = {}) {
  return buildCru44MultiWindowReference(records, {
    sourceLedgerIdentity: SOURCE,
    instrumentProfile: PROFILE,
    ...extra,
  });
}

test('finite registry contains compatibility anchors and governed 15m/30m/1h/4h windows only', () => {
  assert.deepEqual(Object.keys(CRU44_WINDOW_REGISTRY), [
    'primary60s', 'context300s', 'window900s', 'window1800s', 'window3600s', 'window14400s',
  ]);
  assert.equal(CRU44_WINDOW_REGISTRY.window900s.windowMs, 900_000);
  assert.equal(CRU44_WINDOW_REGISTRY.window1800s.windowMs, 1_800_000);
  assert.equal(CRU44_WINDOW_REGISTRY.window1800s.sessionPolicy, 'SAME_GOVERNED_SESSION');
  assert.equal(CRU44_WINDOW_REGISTRY.window3600s.windowMs, 3_600_000);
  assert.equal(CRU44_WINDOW_REGISTRY.window14400s.windowMs, 14_400_000);
  assert.equal(CRU44_WINDOW_REGISTRY.window14400s.continuityPolicy, 'SAME_CONTINUITY_EPOCH');
});

test('CRU-44 reference preserves byte-equivalent CRU-34 1m/5m semantic payload', () => {
  const records = chain(rows());
  const value = reference(records);
  const oldSnapshot = buildTxIntradayResearchSnapshot(records, {
    sourceLedgerIdentity: SOURCE, instrumentProfile: PROFILE,
  });
  const oldPayload = buildCru34SemanticPayload(oldSnapshot, { tickSize: 1, sourceMode: 'LIVE' });
  assert.equal(JSON.stringify(value.compatibilityPayload), JSON.stringify(oldPayload));
  assert.equal(value.multiWindow.compatibility.primary60sUnchanged, true);
  assert.equal(value.multiWindow.compatibility.context300sUnchanged, true);
});

test('15m, 30m, 1h and 4h direct paths are independently LIVE under frozen 30s gap semantics', () => {
  const value = reference(chain(rows())).multiWindow;
  for (const key of ['window900s', 'window1800s', 'window3600s', 'window14400s']) {
    assert.equal(value.windows[key].truthState, 'LIVE');
    assert.equal(value.windows[key].evidence.pathEfficiency.status, 'READY');
    assert.equal(value.windows[key].evidence.pathEfficiency.value, 1);
    assert.equal(value.windows[key].evidence.pathEfficiency.maxAllowedGapMs, 30_000);
  }
});

test('all governed long windows retain distinct deterministic evidence', () => {
  const value = reference(chain(rows({ noisy: true }))).multiWindow;
  assert.ok(value.windows.window900s.evidence.pathEfficiency.value < 1);
  assert.ok(value.windows.window1800s.evidence.pathEfficiency.value < 1);
  assert.notEqual(value.windows.window900s.evidence.response.displacementPoints,
    value.windows.window1800s.evidence.response.displacementPoints);
  assert.notEqual(value.windows.window3600s.evidence.response.displacementPoints,
    value.windows.window14400s.evidence.response.displacementPoints);
});

test('each long window warms independently and never exposes a partial value as complete', () => {
  const value = reference(chain(rows({ seconds: 4_020 }))).multiWindow;
  assert.equal(value.windows.window900s.truthState, 'LIVE');
  assert.ok(value.windows.window900s.evidence);
  assert.equal(value.windows.window1800s.truthState, 'LIVE');
  assert.equal(value.windows.window3600s.truthState, 'LIVE');
  assert.equal(value.windows.window14400s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window14400s.unavailableReason, 'WARMING_UP_WINDOW_INCOMPLETE');
  assert.equal(value.windows.window14400s.evidence, null);
});

test('physical append order preserves late earlier-event regression for both long windows', () => {
  const input = rows();
  input.at(-2).eventTime = new Date(Date.parse(input.at(-3).receivedAt) - 1_000).toISOString();
  const value = reference(chain(input)).multiWindow;
  for (const key of ['window900s', 'window1800s', 'window3600s', 'window14400s']) {
    assert.equal(value.windows[key].evidence.pathEfficiency.unavailableReason,
      'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION');
  }
});

test('equal event times retain physical order and produce deterministic long-window paths', () => {
  const input = rows();
  const sameTime = input.at(-1).receivedAt;
  input.at(-3).eventTime = sameTime;
  input.at(-2).eventTime = sameTime;
  input.at(-1).eventTime = sameTime;
  input.at(-3).price = 200;
  input.at(-2).price = 180;
  input.at(-1).price = 210;
  const first = reference(chain(input)).multiWindow;
  const second = reference(chain(input)).multiWindow;
  assert.deepEqual(first.windows, second.windows);
  assert.equal(first.windows.window900s.evidence.response.endPrice, 210);
  assert.ok(first.windows.window900s.evidence.pathEfficiency.value < 1);
});

test('a physically later delayed event cannot leak into an earlier cutoff', () => {
  const prefix = chain(rows());
  const delayed = chain([{
    receivedAt: '2026-09-09T01:31:01.000Z', eventTime: '2026-09-09T01:30:30.000Z', price: 1,
  }]);
  delayed[0].previousHash = prefix.at(-1).recordHash;
  const cutoffLedgerOrdinal = prefix.length;
  const before = reference(prefix, { cutoffLedgerOrdinal }).multiWindow;
  const after = reference([...prefix, delayed[0]], { cutoffLedgerOrdinal }).multiWindow;
  assert.deepEqual(after, before);
});

test('frozen long-gap policy fails Path closed without hiding lawful pressure and response', () => {
  const input = rows();
  input.splice(-2, 1);
  const value = reference(chain(input)).multiWindow;
  for (const key of ['window900s', 'window1800s', 'window3600s', 'window14400s']) {
    assert.equal(value.windows[key].evidence.pathEfficiency.unavailableReason,
      'QUALITY_INSUFFICIENT_LONG_GAP');
    assert.notEqual(value.windows[key].evidence.pressure.pressureRatio, null);
    assert.equal(value.windows[key].evidence.response.status, 'READY');
  }
});

test('UNKNOWN volume remains unknown and blocks formal direction independently per long window', () => {
  const input = rows();
  for (let index = 0; index < input.length; index += 5) input[index].tickType = 0;
  const value = reference(chain(input)).multiWindow;
  for (const key of ['window900s', 'window1800s', 'window3600s', 'window14400s']) {
    const pressure = value.windows[key].evidence.pressure;
    assert.ok(pressure.unknownVolume > 0);
    assert.ok(pressure.classifiedCoverage < 1);
    assert.equal(pressure.direction, 'UNAVAILABLE');
    assert.equal(pressure.unavailableReason, 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  }
});

test('contract/session/tradeDate boundary restarts warmup instead of bleeding prior history', () => {
  const input = rows();
  for (const row of input.slice(-4)) {
    row.code = 'TXFJ6'; row.tradeDate = '2026-09-10'; row.session = 'NIGHT';
  }
  const value = reference(chain(input)).multiWindow;
  assert.equal(value.identity.actualContract, 'TXFJ6');
  assert.equal(value.windows.window900s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window1800s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window3600s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window14400s.truthState, 'WARMING_UP');
});

test('reconnect continuityEpoch boundary restarts every long-window warmup', () => {
  const input = rows();
  input.push({
    kind: 'quote_type_reconnect_resubscribe',
    receivedAt: '2026-09-09T01:31:01.000Z',
    payload: { code: 'bridge', product: 'TX' },
  });
  input.push({ receivedAt: '2026-09-09T01:31:02.000Z', price: 200 });
  const value = reference(chain(input)).multiWindow;
  assert.equal(value.identity.continuityEpoch, 'TX:2');
  assert.equal(value.windows.window900s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window1800s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window3600s.truthState, 'WARMING_UP');
  assert.equal(value.windows.window14400s.truthState, 'WARMING_UP');
});

test('bounded worker multi-window payload equals full GENESIS reference for all governed windows', () => {
  const records = chain(rows(), { cryptographic: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru44-worker-'));
  const ledgerPath = path.join(root, 'ledger.ndjson');
  const checkpointPath = path.join(root, 'checkpoint.json');
  const snapshotPath = path.join(root, 'latest.json');
  fs.writeFileSync(ledgerPath, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const now = new Date(new Date(records.at(-1).receivedAt).getTime() + 5_000);
  const projected = projectCru34LiveBatch({
    ledgerPath, checkpointPath, snapshotPath, instrumentProfile: PROFILE,
    maxBatchBytes: 8 * 1024 * 1024, maxBatchRecords: 1_000, now,
  });
  const oracle = buildCru44MultiWindowReference(records, {
    sourceLedgerIdentity: projected.checkpoint.sourceLedgerIdentity,
    instrumentProfile: PROFILE,
  });
  assert.deepEqual(projected.snapshot.semanticPayload, oracle.compatibilityPayload);
  assert.deepEqual(projected.snapshot.multiWindowPayload, oracle.multiWindow);
  assert.ok(projected.checkpoint.rollingCanonicalEvents.length <= records.length);
  assert.ok(fs.statSync(checkpointPath).size < 1_000_000);
});

test('checkpoint retains only pressure-relevant quotes and remains GENESIS-equivalent', () => {
  const records = chain(rowsWithQuotes(), { cryptographic: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru44-quote-compact-'));
  const ledgerPath = path.join(root, 'ledger.ndjson');
  const checkpointPath = path.join(root, 'checkpoint.json');
  const snapshotPath = path.join(root, 'latest.json');
  fs.writeFileSync(ledgerPath, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  let projected = null;
  for (let batch = 0; batch < 10 && projected?.checkpoint?.lastVerifiedLedgerOrdinal !== records.length; batch += 1) {
    projected = projectCru34LiveBatch({
      ledgerPath, checkpointPath, snapshotPath, instrumentProfile: PROFILE,
      maxBatchBytes: 8 * 1024 * 1024, maxBatchRecords: 200,
    });
  }
  assert.equal(projected.checkpoint.lastVerifiedLedgerOrdinal, records.length);
  const oracle = buildCru44MultiWindowReference(records, {
    sourceLedgerIdentity: projected.checkpoint.sourceLedgerIdentity,
    instrumentProfile: PROFILE,
    sourceTruthState: 'STALE',
  });
  assert.deepEqual(projected.snapshot.multiWindowPayload, oracle.multiWindow);
  const retained = projected.checkpoint.rollingCanonicalEvents;
  const retainedTicks = retained.filter((event) => event.kind === 'futures_tick').length;
  const retainedQuotes = retained.filter((event) => event.kind === 'futures_bidask').length;
  assert.ok(retainedQuotes <= retainedTicks + 8);
  assert.ok(fs.statSync(checkpointPath).size < 1_500_000);
});

test('bounded state retains one prior Tick so irregular cadence can prove full 4h warmup', () => {
  const input = rows();
  input[2].receivedAt = new Date(Date.parse(input[2].receivedAt) + 3_000).toISOString();
  const records = chain(input, { cryptographic: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru44-warmup-anchor-'));
  const ledgerPath = path.join(root, 'ledger.ndjson');
  const checkpointPath = path.join(root, 'checkpoint.json');
  const snapshotPath = path.join(root, 'latest.json');
  fs.writeFileSync(ledgerPath, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const result = projectCru34LiveBatch({
    ledgerPath, checkpointPath, snapshotPath, instrumentProfile: PROFILE,
    maxBatchBytes: 8 * 1024 * 1024, maxBatchRecords: 1_000,
  });
  assert.equal(result.snapshot.multiWindowPayload.windows.window14400s.truthState, 'STALE');
  assert.ok(result.snapshot.multiWindowPayload.windows.window14400s.evidence);
  assert.ok(result.checkpoint.rollingCanonicalEvents[0].availableMs
    <= Date.parse(result.snapshot.semanticPayload.availableAt));
});
