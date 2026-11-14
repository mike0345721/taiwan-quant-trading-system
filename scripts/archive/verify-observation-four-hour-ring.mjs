// Synthetic source preparation using the production retention function; no service/collector.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { checkpointEvent, pruneRolling } from '../src/cru34-live-projection-worker.mjs';
import { buildCru34LiveCheckpoint, cru34LiveCanonicalJson } from '../src/cru34-live-checkpoint.mjs';
import { SAFETY, digest } from '../src/cvd-observation-core.mjs';
const [root] = process.argv.slice(2);
if (!path.isAbsolute(root || '') || fs.existsSync(root)) throw Error('FRESH_ABSOLUTE_OUTPUT_REQUIRED');
fs.mkdirSync(root, { recursive: true });
const start = Date.parse('2026-11-04T07:00:00Z'), total = 289200, source = 'sha256:' + digest('synthetic 4h1m ring 20events/s');
let hash = 'GENESIS', canonicalState = null, events = [], peakRss = 0, lastTime;
const began = new Date().toISOString(), wall = performance.now();
for (let offset = 0; offset < total; offset += 4000) {
  const rows = [];
  for (let n = offset; n < Math.min(total, offset + 4000); n++) {
    lastTime = new Date(start + n * 50).toISOString();
    const tick = n % 4 === 3, price = 20000 + Math.floor(n / 4) % 80;
    const row = buildLiveEventRecord({kind:tick?'futures_tick':'futures_bidask',code:'TXFK6',receivedAt:lastTime,...SAFETY,
      payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-05',session:'NIGHT',eventTime:lastTime,
        ...(tick?{close:price,volume:1,tick_type:1}:{bid_price:[price-1],ask_price:[price]})}}, hash);
    hash = row.recordHash; rows.push(row);
  }
  const result = materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source,ledgerOrdinalOffset:offset,initialState:canonicalState});
  canonicalState = result.terminalState; events.push(...result.events.map(checkpointEvent));
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
const before = events.length, pruneStart = performance.now(), cutoff = events.at(-1);
events = pruneRolling(events, cutoff);
const pruneMs = performance.now() - pruneStart;
assert.ok(events.length < 250000); assert.ok(events.length > 144000);
const checkpoint = buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:total,lastVerifiedRecordHash:hash,
  lastVerifiedStartByteOffset:total*700,lastVerifiedEndByteOffset:total*700+699,canonicalState,lastVerifiedAvailableAt:lastTime,rollingCanonicalEvents:events});
const bytes = cru34LiveCanonicalJson(checkpoint) + '\n';
assert.ok(Buffer.byteLength(bytes) <= 96*1024*1024, 'original consumer source budget');
fs.writeFileSync(path.join(root,'2026-11-04.checkpoint.json'), bytes);
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const result = {evidenceType:'SYNTHETIC_ORIGINAL_RETENTION_NOT_LIVE',began,ended:new Date().toISOString(),elapsedSeconds:(performance.now()-wall)/1000,
  generatedEvents:before,retainedEvents:events.length,ticks:events.filter(e=>e.kind==='futures_tick').length,
  quotes:events.filter(e=>e.kind==='futures_bidask').length,checkpointBytes:Buffer.byteLength(bytes),pruneMs,preparationPeakRss:peakRss,
  firstOrdinal:events[0].ledgerOrdinal,lastOrdinal:events.at(-1).ledgerOrdinal,sourceAvailableAt:lastTime,
  originalLimits:{retainedEvents:250000,consumerSourceBytes:96*1024*1024},status:'PASS',...SAFETY};
fs.writeFileSync(path.join(root,'receipt.json'), JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
