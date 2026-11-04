import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { cru34LiveCanonicalJson, cru34LiveHash } from '../src/cru34-live-checkpoint.mjs';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { projectCru34CalendarBatch, cru34TaipeiDate } from '../src/cru34-calendar-rollover.mjs';

function chain(start, count = 4, previousHash = 'GENESIS') {
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(Date.parse(start) + i * 1000).toISOString();
    const body = { schemaVersion: '1.0.0', provider: 'shioaji', code: 'TXFI6', product: 'TXFI6',
      kind: 'futures_tick', receivedAt: at, exchangeTimestamp: at, sequence: null,
      eventId: `${start}-${i}`, duplicate: false, sequenceGap: 0, clockSkewMs: 0,
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-08',
        session: 'NIGHT', datetime: at, eventTime: at, simtrade: false, close: 100 + i,
        price: 100 + i, volume: 2, executedVolume: 2, tick_type: 1 }, previousHash };
    const recordHash = crypto.createHash('sha256').update(`${previousHash}\n${cru34LiveCanonicalJson(body)}`).digest('hex');
    previousHash = recordHash;
    return { ...body, recordHash };
  });
}
const bytes = records => `${records.map(JSON.stringify).join('\n')}\n`;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru34-calendar-'));
  const dataRoot = path.join(root, 'data'), projectionRoot = path.join(root, 'projection');
  fs.mkdirSync(path.join(dataRoot, 'live-events'), { recursive: true });
  const ledger = date => path.join(dataRoot, 'live-events', `${date}.ndjson`);
  const checkpoint = date => path.join(projectionRoot, `${date}.checkpoint.json`);
  const cursor = () => JSON.parse(fs.readFileSync(path.join(projectionRoot, 'calendar-cursor.json')));
  const run = (at, extra = {}) => projectCru34CalendarBatch({ dataRoot, projectionRoot,
    calendarNow: new Date(at), now: new Date(at), maxBatchRecords: 2,
    resolveSessionTradeDate: () => ({ tradeDate: '2026-09-08', session: 'NIGHT' }), ...extra });
  return { root, dataRoot, projectionRoot, ledger, checkpoint, cursor, run };
}

test('Taipei date boundary is independent of host timezone', () => {
  assert.equal(cru34TaipeiDate(new Date('2026-09-07T15:59:59Z')), '2026-09-07');
  assert.equal(cru34TaipeiDate(new Date('2026-09-07T16:00:00Z')), '2026-09-08');
  assert.throws(() => cru34TaipeiDate(new Date('bad')), /CLOCK_INVALID/);
});

test('late old-file suffix drains across bounded polls and restart before new GENESIS', () => {
  const f = fixture(), old = chain('2026-09-07T15:59:50Z', 6), next = chain('2026-09-07T16:00:00Z', 2);
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(old.slice(0, 2)));
  const before = f.run('2026-09-07T15:59:52Z');
  fs.appendFileSync(f.ledger('2026-09-07'), bytes(old.slice(2)));
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(next));
  const rawOld = fs.readFileSync(f.ledger('2026-09-07'));
  const a = f.run('2026-09-07T16:00:03Z');
  assert.equal(a.checkpoint.lastVerifiedLedgerOrdinal, 4);
  assert.equal(a.calendarRollover.status, 'DRAINING_PREVIOUS_CALENDAR_FILE');
  assert.equal(f.cursor().activeDate, '2026-09-07');
  const b = f.run('2026-09-07T16:00:04Z');
  assert.equal(b.checkpoint.lastVerifiedLedgerOrdinal, 6);
  assert.equal(b.calendarRollover.status, 'CALENDAR_TAIL_DRAINED');
  assert.equal(f.cursor().activeDate, '2026-09-08');
  assert.equal(f.cursor().closed.recordHash, old.at(-1).recordHash);
  const c = f.run('2026-09-07T16:00:05Z');
  assert.equal(c.checkpoint.lastVerifiedLedgerOrdinal, 2);
  assert.notEqual(c.checkpoint.sourceLedgerIdentity, before.checkpoint.sourceLedgerIdentity);
  assert.equal(c.snapshot.warmup.observedSpanMs, 1000, 'no invented cross-file continuity');
  assert.deepEqual(fs.readFileSync(f.ledger('2026-09-07')), rawOld);
  assert.equal(fs.readFileSync(f.ledger('2026-09-08'), 'utf8'), bytes(next));
});

test('incomplete old terminal line stays pending and becomes drainable when complete', () => {
  const f = fixture(), records = chain('2026-09-07T15:59:50Z', 3);
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(records.slice(0, 2)));
  f.run('2026-09-07T15:59:52Z');
  const last = JSON.stringify(records[2]);
  fs.appendFileSync(f.ledger('2026-09-07'), last.slice(0, 40));
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 1)));
  const a = f.run('2026-09-07T16:00:01Z');
  assert.equal(a.calendarRollover.status, 'PREVIOUS_LEDGER_PARTIAL_TAIL_PENDING');
  assert.equal(a.calendarRollover.remainingBytes, 40);
  assert.equal(f.cursor().activeDate, '2026-09-07');
  fs.appendFileSync(f.ledger('2026-09-07'), `${last.slice(40)}\n`);
  assert.equal(f.run('2026-09-07T16:00:02Z').calendarRollover.status, 'CALENDAR_TAIL_DRAINED');
});

test('missing next file keeps old cursor; missing active file with a checkpoint fails closed', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z');
  assert.equal(f.run('2026-09-07T16:00:01Z').calendarRollover.status, 'NEXT_CALENDAR_LEDGER_PENDING');
  fs.renameSync(f.ledger('2026-09-07'), `${f.ledger('2026-09-07')}.held`);
  assert.equal(f.run('2026-09-07T16:00:02Z').reason, 'ACTIVE_LEDGER_MISSING');
});

test('publication failure does not advance cursor or checkpoint and restart repeats suffix', () => {
  const f = fixture(), records = chain('2026-09-07T15:59:50Z', 3);
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(records.slice(0, 2)));
  f.run('2026-09-07T15:59:52Z');
  fs.appendFileSync(f.ledger('2026-09-07'), bytes(records.slice(2)));
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 1)));
  assert.throws(() => f.run('2026-09-07T16:00:01Z', { publishSnapshot() { throw new Error('SYNTHETIC_PUBLICATION_FAILURE'); } }), /PUBLICATION_FAILURE/);
  assert.equal(f.cursor().activeDate, '2026-09-07');
  assert.equal(JSON.parse(fs.readFileSync(f.checkpoint('2026-09-07'))).lastVerifiedLedgerOrdinal, 2);
  assert.equal(f.run('2026-09-07T16:00:02Z').checkpoint.lastVerifiedLedgerOrdinal, 3);
});

test('corrupt old anchor never advances transition', () => {
  const f = fixture(), records = chain('2026-09-07T15:59:50Z', 2);
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(records)); f.run('2026-09-07T15:59:52Z');
  records[0].payload.price = 999;
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(records));
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 1)));
  assert.throws(() => f.run('2026-09-07T16:00:02Z'), /HASH_CHAIN_INVALID/);
  assert.equal(f.cursor().activeDate, '2026-09-07');
});

test('unexpected forward checkpoint blocks before an old source can publish', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z'); fs.writeFileSync(f.checkpoint('2026-09-08'), '{}');
  let calls = 0;
  const result = f.run('2026-09-07T16:00:02Z', { projectBatch() { calls++; } });
  assert.equal(result.reason, 'FORWARD_CHECKPOINT_CONFLICT_RECONCILIATION_REQUIRED'); assert.equal(calls, 0);
});

test('unexpected forward published snapshot blocks even if next checkpoint was not committed', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z');
  const file = path.join(f.projectionRoot, 'latest.json');
  const { snapshotHash, ...body } = JSON.parse(fs.readFileSync(file));
  body.semanticPayload.availableAt = '2026-09-07T16:00:01Z';
  fs.writeFileSync(file, JSON.stringify({ ...body, snapshotHash: cru34LiveHash(body) }));
  const result = f.run('2026-09-07T16:00:02Z', { projectBatch() { assert.fail('must not publish old source'); } });
  assert.equal(result.reason, 'FORWARD_SNAPSHOT_CONFLICT_RECONCILIATION_REQUIRED');
});

test('closed-file later growth is exposed without rewinding the live snapshot', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z');
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 2)));
  f.run('2026-09-07T16:00:02Z'); f.run('2026-09-07T16:00:03Z');
  const current = fs.readFileSync(path.join(f.projectionRoot, 'latest.json'));
  fs.appendFileSync(f.ledger('2026-09-07'), '\n');
  assert.equal(f.run('2026-09-07T16:00:04Z').reason, 'CLOSED_LEDGER_CHANGED_RECONCILIATION_REQUIRED');
  assert.deepEqual(fs.readFileSync(path.join(f.projectionRoot, 'latest.json')), current);
});

test('first installation adopts current date without historical replay over existing checkpoint', () => {
  const f = fixture();
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 4)));
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 2)));
  const direct = projectCru34LiveBatch({ ledgerPath: f.ledger('2026-09-08'), checkpointPath: f.checkpoint('2026-09-08'),
    snapshotPath: path.join(f.projectionRoot, 'latest.json'), now: new Date('2026-09-07T16:00:03Z'),
    resolveSessionTradeDate: () => ({ tradeDate: '2026-09-08', session: 'NIGHT' }) });
  const result = f.run('2026-09-07T16:00:04Z');
  assert.equal(result.checkpoint.checkpointHash, direct.checkpoint.checkpointHash);
  assert.equal(f.cursor().activeDate, '2026-09-08');
  assert.equal(fs.existsSync(f.checkpoint('2026-09-07')), false);
  assert.equal(result.calendarRollover.adoption, 'CURRENT_DATE_NO_RETROACTIVE_RECOVERY');
});

test('absent weekend files advance only to an existing bounded next file', () => {
  const f = fixture();
  assert.equal(f.run('2026-09-04T16:00:02Z').reason, 'CURRENT_LEDGER_MISSING');
  fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T01:00:00Z', 2)));
  const result = f.run('2026-09-07T01:00:03Z');
  assert.equal(result.reason, 'CALENDAR_EMPTY_DATE_ADVANCED');
  assert.equal(f.cursor().activeDate, '2026-09-07');
});

test('backward clock, long offline gap and cursor corruption remain explicit', () => {
  const f = fixture(); f.run('2026-09-07T16:00:02Z');
  assert.equal(f.run('2026-09-07T15:00:00Z').reason, 'CALENDAR_CLOCK_MOVED_BACKWARD');
  assert.equal(f.run('2026-09-16T01:00:00Z').reason, 'CALENDAR_TRANSITION_BUDGET_EXCEEDED');
  const file = path.join(f.projectionRoot, 'calendar-cursor.json'), state = f.cursor();
  state.activeDate = '2026-09-01'; fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => f.run('2026-09-08T01:00:00Z'), /STATE_INVALID/);
});

test('a transitioned file disappearing before its first checkpoint is never mistaken for a holiday', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z');
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 2)));
  f.run('2026-09-07T16:00:02Z');
  fs.renameSync(f.ledger('2026-09-08'), `${f.ledger('2026-09-08')}.held`);
  fs.writeFileSync(f.ledger('2026-09-09'), bytes(chain('2026-09-08T16:00:00Z', 2)));
  assert.equal(f.run('2026-09-08T16:00:03Z').reason, 'ACTIVE_LEDGER_MISSING');
  assert.equal(f.cursor().activeDate, '2026-09-08');
});

test('calendar cursor rename failure cannot publish the new source; same root recovers', t => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), bytes(chain('2026-09-07T15:59:50Z', 2)));
  f.run('2026-09-07T15:59:52Z');
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 2)));
  const original = fs.renameSync;
  const injected = t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to).endsWith('calendar-cursor.json')) throw new Error('SYNTHETIC_CURSOR_RENAME_FAILURE');
    return original(from, to);
  });
  try { assert.throws(() => f.run('2026-09-07T16:00:02Z'), /CURSOR_RENAME_FAILURE/); }
  finally { injected.mock.restore(); }
  assert.equal(f.cursor().activeDate, '2026-09-07');
  assert.equal(fs.existsSync(f.checkpoint('2026-09-08')), false);
  assert.equal(f.run('2026-09-07T16:00:03Z').calendarRollover.status, 'CALENDAR_TAIL_DRAINED');
  assert.equal(f.run('2026-09-07T16:00:04Z').checkpoint.lastVerifiedLedgerOrdinal, 2);
});

test('empty earlier ledger crosses only when a new physical ledger exists', () => {
  const f = fixture(); fs.writeFileSync(f.ledger('2026-09-07'), '');
  f.run('2026-09-07T15:59:52Z');
  assert.equal(f.run('2026-09-07T16:00:01Z').calendarRollover.status, 'NEXT_CALENDAR_LEDGER_PENDING');
  fs.writeFileSync(f.ledger('2026-09-08'), bytes(chain('2026-09-07T16:00:00Z', 2)));
  assert.equal(f.run('2026-09-07T16:00:02Z').calendarRollover.status, 'CALENDAR_TAIL_DRAINED');
  assert.equal(f.cursor().closed.size, 0);
  assert.equal(f.cursor().closed.recordHash, null);
});
