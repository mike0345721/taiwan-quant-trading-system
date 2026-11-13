// WP 0-2 reproduction: the Dashboard restarts mid-session and nobody opens a page.
// Before: one warm-up request leaves the chart catching up. After: the background pump
// resumes from the persisted checkpoint and reaches the cutoff on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { createTxChartService, continuationPending } from '../src/dashboard-tx-chart-service.mjs';
import { createTxChartPump } from '../src/dashboard-tx-chart-pump.mjs';
import { chartCatchupProgress } from '../src/dashboard-tx-chart-catchup.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const row = (timestamp, price) => ({ kind: 'futures_tick', product: 'TXFH6', receivedAt: timestamp, exchangeTimestamp: timestamp,
  eventId: timestamp, duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
  payload: { code: 'TXFH6', datetime: timestamp, close: price, volume: 1, simtrade: false, _product_family: 'TX', _target_code: 'TXFH6' } });
const start = Date.parse('2026-08-12T08:45:01+08:00');
const ticks = (from, to) => Array.from({ length: to - from }, (_, k) => {
  const i = from + k; return JSON.stringify(row(new Date(start + i * 30000).toISOString(), 20000 + (i % 40))) + '\n';
}).join('');
const selection = { timeframe: '5m', mode: 'LIVE', tradeDate: '2026-08-12', session: 'DAY', asOf: '2026-08-12T13:45:00+08:00' };
const smallReads = { maxSourceBytes: 8192 };

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-pump-'));
  fs.mkdirSync(path.join(root, 'live-events'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, cacheRoot: path.join(root, 'cache'), ledger: path.join(root, 'live-events', '2026-08-12.ndjson') };
}
const service = box => createTxChartService({ dataRoot: box.root, cacheRoot: box.cacheRoot, calendar, sourceLimits: smallReads });

function runPumpUntilCurrent(svc, timeoutMs = 30000) {
  const seen = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pump.stop(); reject(Error(`pump did not catch up: ${JSON.stringify(seen.at(-1)?.catchupProgress)}`)); }, timeoutMs);
    const pump = createTxChartPump({ load: () => svc.load(selection), isPending: continuationPending, intervalMs: 60000,
      catchupDelayMs: 0, onResult: chart => {
        seen.push(chart);
        if (chart?.sourceReadState === 'COMPLETE') { clearTimeout(timer); pump.stop(); resolve(seen); }
      } });
    pump.start();
  });
}

test('restart with no open page: the pump resumes from the checkpoint and reaches the cutoff by itself', async t => {
  const box = sandbox(t);
  // Session so far: 08:45 to about 11:15.
  fs.writeFileSync(box.ledger, ticks(0, 300));
  const before = service(box);
  await runPumpUntilCurrent(before);
  before.close();

  // Dashboard is down while the market keeps writing until 13:44.
  fs.appendFileSync(box.ledger, ticks(300, 600));

  // Old behaviour: a single warm-up request after restart is still far behind.
  const oldStyle = service(box);
  const warm = await oldStyle.load(selection);
  oldStyle.close();
  assert.equal(warm.sourceReadState, 'CATCHUP_PENDING');
  assert.match(warm.catchupProgress.text, /^補讀中 \d+%（已到 \d\d:\d\d／目標 13:45）$/);

  // New behaviour: restart, no page request at all, only the pump.
  const restarted = service(box);
  t.after(() => restarted.close());
  const seen = await runPumpUntilCurrent(restarted);
  const firstOffset = seen[0].sourceProgress[0].sourceOffset;
  assert.ok(firstOffset > Buffer.byteLength(ticks(0, 300)) - 1, 'restart did not resume from the persisted checkpoint');
  const done = seen.at(-1);
  assert.equal(done.catchupProgress, null);
  assert.equal(done.sourceProgress[0].sourceOffset, fs.statSync(box.ledger).size);
  const lastBar = Date.parse(done.bars.at(-1).time) || done.bars.at(-1).time * 1000;
  assert.equal(new Date(lastBar).toISOString(), new Date('2026-08-12T13:40:00+08:00').toISOString());
  // Only the remaining gap was read after restart, not the session from its open.
  assert.ok(seen.length <= Math.ceil(Buffer.byteLength(ticks(300, 600)) / smallReads.maxSourceBytes) + 2, `took ${seen.length} requests`);
});

test('pump: re-requests at once while catching up, waits the interval when current, backs off when busy, stops cleanly', async () => {
  const delays = []; const queue = [];
  const results = [{ sourceReadState: 'CATCHUP_PENDING' }, { reason: 'CHART_REQUEST_BUSY' }, { sourceReadState: 'COMPLETE' }];
  const pump = createTxChartPump({ load: async () => results.shift(), isPending: continuationPending,
    intervalMs: 5000, catchupDelayMs: 100, busyDelayMs: 500,
    setTimer: (fn, ms) => { delays.push(ms); queue.push(fn); return { id: delays.length }; }, clearTimer: () => {} });
  pump.start();
  for (let i = 0; i < 3; i++) await queue.shift()();
  assert.deepEqual(delays, [0, 100, 500, 5000]);
  pump.stop();
  await queue.shift()();
  assert.equal(pump.ticks, 3, 'a stopped pump must not request again');
});

test('progress text: percent from bytes, time when bars exist, never 100% while pending, null when current', () => {
  const pending = chartCatchupProgress({ sourceReadState: 'CATCHUP_PENDING', asOf: '2026-08-12T10:45:00+08:00',
    bars: [{ time: '2026-08-12T09:10:00+08:00' }],
    sourceProgress: [{ sourceOffset: 370, observedSize: 1000 }, { sourceOffset: 0, observedSize: 0 }] });
  assert.equal(pending.text, '補讀中 37%（已到 09:10／目標 10:45）');
  const noBars = chartCatchupProgress({ sourceReadState: 'CATCHUP_PENDING', asOf: '2026-08-12T10:45:00+08:00', bars: [],
    sourceProgress: [{ sourceOffset: 999, observedSize: 1000 }] });
  assert.equal(noBars.text, '補讀中 99%（目標 10:45）');
  const verifying = chartCatchupProgress({ sourceReadState: 'COMPLETE', asOf: '2026-08-12T10:45:00+08:00',
    sourceAuditProgress: { state: 'PENDING', processedRecords: 1, totalRecords: 4 } });
  assert.equal(verifying.text, '驗證中 25%（目標 10:45）');
  assert.equal(chartCatchupProgress({ sourceReadState: 'COMPLETE', asOf: '2026-08-12T10:45:00+08:00' }), null);
});
