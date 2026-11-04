import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
import { createMarketObservationState, appendMarketObservationRecords, marketObservationSnapshot } from '../src/market-observation-core.mjs';
import { observationDecisionSnapshot } from '../src/market-observation-journal.mjs';
import { decisionDigest, validateDecisionSnapshot } from '../src/dashboard-decision-workspace.mjs';
import { appendDecisionJournal, readDecisionJournal, appendDecisionOutcome, readDecisionOutcomes } from '../src/decision-journal.mjs';

function fixture() {
  const prices = [100, 102, 105, 103, 101, 104, 107, 106, 103, 99, 97, 100, 103, 108, 109, 104, 99, 96, 98, 101];
  let previousHash = 'GENESIS';
  const rows = prices.map((close, i) => {
    const at = new Date(Date.UTC(2026, 10, 4, 1, i)).toISOString();
    const row = buildLiveEventRecord({ kind: 'futures_tick', code: 'TXFK6', receivedAt: at, ...SAFETY,
      payload: { productFamily: 'TX', actualContract: 'TXFK6', tradeDate: '2026-11-04', session: 'DAY',
        eventTime: at, close, volume: 2, tick_type: i % 3 === 0 ? 2 : 1 } }, previousHash);
    previousHash = row.recordHash; return row;
  });
  const sourceLedgerIdentity = `sha256:${'b'.repeat(64)}`, resolverIdentity = 'journal-fixture-v1';
  const state = appendMarketObservationRecords(createMarketObservationState(sourceLedgerIdentity, resolverIdentity), rows,
    { sourceLedgerIdentity, resolverIdentity, ledgerOrdinalOffset: 0 });
  const snapshot = (cutoff = rows.at(-1).receivedAt) => marketObservationSnapshot(state, { cutoff, now: cutoff, mode: 'REPLAY' });
  return { rows, snapshot };
}
function reseal(snapshot) { const { snapshotHash, ...body } = snapshot; return { ...body, snapshotHash: decisionDigest(body) }; }

test('same source snapshot survives existing manual journal and linked Outcome without rewriting original evidence', () => {
  const f = fixture(), observation = f.snapshot(), snapshot = observationDecisionSnapshot(observation);
  assert.ok(observation.events.length > 1); assert.ok(validateDecisionSnapshot(snapshot).valid);
  assert.equal(snapshot.price.value, observation.price.last);
  assert.equal(snapshot.marketObservation.snapshotId, observation.snapshotId);
  assert.deepEqual(snapshot.marketObservation.summary, observation.summary);
  assert.deepEqual(snapshot.marketObservation.events, observation.events);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru61-journal-'));
  const journal = path.join(root, 'journal.ndjson'), outcomes = path.join(root, 'journal-outcomes.ndjson');
  const original = appendDecisionJournal(journal, { intent: 'NO_TRADE', setup: observation.events[0].id,
    reason: 'Fixture integration observation; no trading signal', invalidation: observation.events[0].invalidationConditions.join('; '), snapshot },
  { now: new Date('2026-11-04T01:20:00Z') });
  const before = fs.readFileSync(journal);
  const outcome = appendDecisionOutcome(outcomes, journal, { decisionRecordHash: original.recordHash,
    executionStatus: 'NOT_EXECUTED', thesisStatus: 'UNKNOWN', outcomeNote: 'Fixture manual observation only' },
  { now: new Date('2026-11-04T01:25:00Z') });
  const read = readDecisionJournal(journal), readOutcomes = readDecisionOutcomes(outcomes, { journalPath: journal });
  assert.equal(read[0].snapshot.marketObservation.snapshotId, observation.snapshotId);
  assert.equal(read[0].snapshot.marketObservation.events[0].deltaCvd, observation.events[0].deltaCvd);
  assert.equal(outcome.snapshotHash, original.snapshotHash); assert.equal(readOutcomes[0].decisionRecordHash, original.recordHash);
  assert.deepEqual(fs.readFileSync(journal), before);
  assert.equal(read[0].intent, 'NO_TRADE'); assert.equal(outcome.executionAuthorized, false);
});

test('cutoff and source price time remain distinct when no new trades arrive', () => {
  const f = fixture(), observation = f.snapshot('2026-11-04T01:40:00.000Z');
  const snapshot = observationDecisionSnapshot(observation);
  assert.ok(validateDecisionSnapshot(snapshot).valid);
  assert.equal(snapshot.snapshotTime, '2026-11-04T01:40:00.000Z');
  assert.equal(snapshot.price.value, 101);
  assert.equal(snapshot.price.availableAt, f.rows.at(-1).receivedAt, 'cutoff cannot refresh an older market observation');
  assert.notEqual(snapshot.price.availableAt, snapshot.snapshotTime);
});

test('equivalent offset cutoff is normalized consistently for existing snapshot validation', () => {
  const snapshot = observationDecisionSnapshot(fixture().snapshot('2026-11-04T09:20:00+08:00'));
  assert.ok(validateDecisionSnapshot(snapshot).valid);
  assert.equal(snapshot.snapshotTime, '2026-11-04T01:20:00.000Z');
  assert.equal(snapshot.marketObservation.cutoff, snapshot.snapshotTime);
});

test('snapshot helper refuses unavailable or trading-authorized input', () => {
  assert.equal(observationDecisionSnapshot(null), null);
  const observation = fixture().snapshot();
  assert.equal(observationDecisionSnapshot({ ...observation, executionAuthorized: true }), null);
  assert.equal(observationDecisionSnapshot({ ...observation, identity: null }), null);
  assert.equal(observationDecisionSnapshot({ ...observation, snapshotId: null }), null);
});

test('existing journal validator rejects changed identity or future event evidence even if rehashed', () => {
  const snapshot = observationDecisionSnapshot(fixture().snapshot());
  const identity = structuredClone(snapshot); identity.marketObservation.identity.actualContract = 'TXFL6';
  assert.throws(() => validateDecisionSnapshot(reseal(identity)), /OBSERVATION_INVALID/);
  const future = structuredClone(snapshot); future.marketObservation.events[0].confirmedAt = '2026-11-04T03:00:00.000Z';
  assert.throws(() => validateDecisionSnapshot(reseal(future)), /OBSERVATION_INVALID/);
});

test('journal cannot preserve nested event permission escalation under a safe outer snapshot', () => {
  const snapshot = structuredClone(observationDecisionSnapshot(fixture().snapshot()));
  snapshot.marketObservation.events[0].executionAuthorized = true;
  assert.throws(() => validateDecisionSnapshot(reseal(snapshot)), /OBSERVATION_INVALID/);
});

test('journal rejects an event with a different continuity identity or later availability', () => {
  const base = observationDecisionSnapshot(fixture().snapshot());
  const different = structuredClone(base); different.marketObservation.events[0].identity.continuityEpoch = 'TX:999';
  assert.throws(() => validateDecisionSnapshot(reseal(different)), /OBSERVATION_INVALID/);
  const late = structuredClone(base); late.marketObservation.events[0].availableAt = '2026-11-04T03:00:00.000Z';
  assert.throws(() => validateDecisionSnapshot(reseal(late)), /OBSERVATION_INVALID/);
});
