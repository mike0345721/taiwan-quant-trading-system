import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { digest, SAFETY } from '../src/cvd-observation-core.mjs';
import { marketObservationSnapshot } from '../src/market-observation-core.mjs';
import { readMarketObservationBatch, loadMarketObservation, clearMarketObservationCache } from '../src/market-observation-source.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
function rows(count = 12, start = '2026-11-04T01:00:00Z') {
  let previousHash = 'GENESIS';
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(Date.parse(start) + i * 60000).toISOString();
    const row = buildLiveEventRecord({ kind: 'futures_tick', code: 'TXFK6', receivedAt: at, ...SAFETY,
      payload: { productFamily: 'TX', actualContract: 'TXFK6', eventTime: at, close: 20000 + i % 5,
        volume: 2, tick_type: i % 3 === 0 ? 2 : 1, simtrade: false } }, previousHash);
    previousHash = row.recordHash;
    return row;
  });
}
const wire = values => `${values.map(JSON.stringify).join('\n')}\n`;
function fixture(values = rows()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru61-source-'));
  const dataRoot = path.join(root, 'data'), cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(path.join(dataRoot, 'live-events'), { recursive: true });
  const sourcePath = path.join(dataRoot, 'live-events', '2026-11-04.ndjson');
  fs.writeFileSync(sourcePath, wire(values));
  return { root, dataRoot, cacheRoot, sourcePath, calendar, values };
}
function consume(options, limit = 100) {
  let result;
  for (let i = 0; i < limit; i++) { result = readMarketObservationBatch(options); if (result.complete) return result; }
  assert.fail(`bounded fixture did not finish: ${result?.reason}`);
}
test.afterEach(() => clearMarketObservationCache());

test('real governed calendar resolver, full/chunk append and restart yield identical observation state', () => {
  const f = fixture(); const original = fs.readFileSync(f.sourcePath);
  const full = consume({ ...f, cacheRoot: null }); clearMarketObservationCache();
  const chunked = consume({ ...f, maxRows: 2 });
  assert.deepEqual(chunked.state, full.state);
  assert.equal(chunked.state.cvd.state.segments[0].identity[1], '2026-11-04');
  assert.equal(chunked.state.cvd.state.segments[0].identity[2], 'DAY');
  assert.equal(chunked.state.cvd.state.segments[0].value, 8);
  clearMarketObservationCache();
  const verifying = readMarketObservationBatch({ ...f, maxBytes: 512 });
  assert.equal(verifying.state, null); assert.equal(verifying.reason, 'CHECKPOINT_PREFIX_VERIFYING');
  assert.ok(verifying.readBytes <= 512);
  const restarted = consume({ ...f, maxBytes: 512 });
  assert.equal(restarted.reason, 'CHECKPOINT_VERIFIED');
  assert.deepEqual(restarted.state, full.state);
  assert.deepEqual(fs.readFileSync(f.sourcePath), original);
});

test('as-of physical prefix stops before future row and remains stable after future append', () => {
  const f = fixture(), cutoff = f.values[4].receivedAt;
  const past = consume({ ...f, maxRows: 2, asOf: cutoff });
  assert.equal(past.state.cvd.state.ordinal, 5); assert.equal(past.reason, 'ASOF_PREFIX_REACHED');
  const pastSnapshot = marketObservationSnapshot(past.state, { cutoff });
  const later = consume({ ...f, maxRows: 2, asOf: f.values.at(-1).receivedAt });
  assert.equal(later.state.cvd.state.ordinal, 12);
  assert.deepEqual(marketObservationSnapshot(later.state, { cutoff }), pastSnapshot);
});

test('REPLAY API carries same snapshot values and identity as bounded source state', () => {
  const f = fixture(), cutoff = f.values.at(-1).receivedAt;
  const direct = consume(f);
  const expected = marketObservationSnapshot(direct.state, { timeframe: '1m', mode: 'REPLAY', cutoff,
    now: cutoff, sourceComplete: true, tradeDate: '2026-11-04', session: 'DAY' });
  const data = loadMarketObservation({ ...f, timeframe: '1m', mode: 'REPLAY', asOf: cutoff,
    now: new Date(cutoff), tradeDate: '2026-11-04', session: 'DAY' });
  assert.equal(data.snapshotId, expected.snapshotId); assert.deepEqual(data.summary, expected.summary);
  assert.equal(data.profile.totalVolume, 24); assert.equal(data.cvd.value, 8);
  assert.equal(data.executionAuthorized, false); assert.match(data.sourceBoundary, /CROSS_FILE_CONTINUITY_NOT_PROVEN/);
});

test('byte/record budgets and incomplete terminal line do not advance unavailable suffix', () => {
  const f = fixture(), first = readMarketObservationBatch({ ...f, maxRows: 1 });
  assert.equal(first.processedRecords, 1); assert.equal(first.complete, false);
  assert.throws(() => readMarketObservationBatch({ ...f, maxRows: 2001 }), /READ_BUDGET/);
  assert.throws(() => readMarketObservationBatch({ ...f, maxBytes: 4 * 1024 * 1024 + 1 }), /READ_BUDGET/);
  const tiny = readMarketObservationBatch({ ...f, maxBytes: 8 });
  assert.equal(tiny.processedRecords, 0); assert.equal(tiny.state.cvd.state.ordinal, 1); assert.equal(tiny.complete, false);
  const last = consume(f); fs.appendFileSync(f.sourcePath, '{"partial":');
  const partial = readMarketObservationBatch(f);
  assert.equal(partial.processedRecords, 0); assert.equal(partial.complete, false);
  assert.deepEqual(partial.state, last.state);
});

test('malformed JSON and invalid record hash never commit an unverified source suffix', () => {
  const f = fixture(rows(2)); const before = consume(f);
  fs.appendFileSync(f.sourcePath, 'not-json\n');
  assert.throws(() => readMarketObservationBatch(f), SyntaxError);
  const stored = JSON.parse(fs.readFileSync(path.join(f.cacheRoot, 'market-observation', `${digest(f.sourcePath)}.json`)));
  assert.equal(stored.body.state.cvd.state.ordinal, before.state.cvd.state.ordinal);
  const g = fixture(); g.values[0].payload.close = 1; fs.writeFileSync(g.sourcePath, wire(g.values));
  assert.throws(() => readMarketObservationBatch(g), /CVD_RECORD_HASH_MISMATCH/);
});

test('source path replacement and truncation fail closed instead of mixing generations', () => {
  const f = fixture(); consume(f);
  fs.renameSync(f.sourcePath, `${f.sourcePath}.held`); fs.writeFileSync(f.sourcePath, wire(f.values));
  assert.throws(() => readMarketObservationBatch(f), /OBSERVATION_SOURCE_CHANGED/);
  const g = fixture(); consume(g); fs.truncateSync(g.sourcePath, 1);
  assert.throws(() => readMarketObservationBatch(g), /OBSERVATION_SOURCE_CHANGED/);
});

test('restart detects changed prefix bytes and tampered cache independently', () => {
  const f = fixture(); consume(f); clearMarketObservationCache();
  const original = fs.readFileSync(f.sourcePath, 'utf8');
  fs.writeFileSync(f.sourcePath, original.replace('20000', '20001'));
  assert.throws(() => consume(f), /OBSERVATION_PREFIX_CHANGED/);
  clearMarketObservationCache();
  const g = fixture(); consume(g); clearMarketObservationCache();
  const cache = path.join(g.cacheRoot, 'market-observation', `${digest(g.sourcePath)}.json`);
  const body = JSON.parse(fs.readFileSync(cache)); body.body.offset++;
  fs.writeFileSync(cache, JSON.stringify(body));
  assert.throws(() => consume(g), /OBSERVATION_CACHE_HASH/);
});

test('midnight remains explicit NIGHT fragment and selected wrong identity degrades', () => {
  const f = fixture(rows(4, '2026-11-03T16:00:00Z'));
  const data = loadMarketObservation({ ...f, mode: 'REPLAY', asOf: f.values.at(-1).receivedAt,
    tradeDate: '2026-11-04', session: 'NIGHT', now: new Date(f.values.at(-1).receivedAt) });
  assert.equal(data.identity.session, 'NIGHT'); assert.equal(data.identity.tradeDate, '2026-11-04');
  assert.equal(data.profile.totalVolume, 8); assert.equal(data.profile.partial, true);
  const wrong = loadMarketObservation({ ...f, mode: 'REPLAY', asOf: f.values.at(-1).receivedAt,
    tradeDate: '2026-11-04', session: 'DAY', now: new Date(f.values.at(-1).receivedAt) });
  assert.equal(wrong.status, 'UNAVAILABLE'); assert.equal(wrong.cvd.value, null);
});
