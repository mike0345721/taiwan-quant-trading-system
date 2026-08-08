import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correctionRecord,
  materializeV3OutcomeLedger,
  outcomeNeedsCorrection,
  v3OutcomeKey,
} from '../src/v3-outcome-ledger.mjs';

const prior = {
  decisionVersion: '3.4.0', signalDate: '2026-07-15', horizonDays: 2,
  entryOpen: 45519, exitClose: 42725, realizedRangePct: 101.6,
  longMfePct: 1.6, longMaePct: -100, resolvedAt: '2026-07-17T13:20:08.492Z',
};
const recomputed = {
  ...prior,
  pathHigh: 46248, pathLow: 42527,
  realizedRangePct: (46248 - 42527) / 45519 * 100,
  longMfePct: (46248 / 45519 - 1) * 100,
  longMaePct: (42527 / 45519 - 1) * 100,
  ohlcValidation: { strict: true }, resolvedAt: '2026-07-18T00:00:00.000Z',
};

test('append-only correction supersedes the prior outcome in effective reads', () => {
  assert.equal(outcomeNeedsCorrection(prior, recomputed), true);
  const correction = correctionRecord(prior, recomputed, 'zero OHLC contamination repaired');
  const ledger = materializeV3OutcomeLedger([prior, correction]);
  assert.deepEqual(ledger.errors, []);
  assert.equal(ledger.corrections, 1);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.byKey.get(v3OutcomeKey(prior)).realizedRangePct, recomputed.realizedRangePct);
  assert.equal(ledger.byKey.get(v3OutcomeKey(prior)).supersedesResolvedAt, prior.resolvedAt);
});

test('correction without a prior version is rejected', () => {
  const correction = correctionRecord(prior, recomputed, 'repair');
  const ledger = materializeV3OutcomeLedger([correction]);
  assert.ok(ledger.errors.some((error) => error.includes('correction_without_prior')));
});
