import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCandidateMinutes,
  candidateFiveMinuteTimestamp,
  compareCandidateDay,
  evaluateOverlapAdmission,
} from '../src/shioaji-kbar-overlap.mjs';

test('right-labelled Shioaji minute bars map to left-labelled five-minute bars', () => {
  assert.equal(
    candidateFiveMinuteTimestamp('2026-07-24T08:46:00+08:00'),
    '2026-07-24T00:45:00.000Z',
  );
  assert.equal(
    candidateFiveMinuteTimestamp('2026-07-24T13:45:00+08:00'),
    '2026-07-24T05:40:00.000Z',
  );
});

test('candidate minutes preserve OHLC ordering and sum volume', () => {
  const rows = [
    { tradeDate: '2026-07-24', timestamp: '2026-07-24T08:46:00+08:00', open: 10, high: 12, low: 9, close: 11, volume: 3 },
    { tradeDate: '2026-07-24', timestamp: '2026-07-24T08:47:00+08:00', open: 11, high: 14, low: 10, close: 13, volume: 5 },
  ];
  const result = aggregateCandidateMinutes(rows);
  assert.deepEqual(result.bars[0], {
    timestamp: '2026-07-24T00:45:00.000Z',
    open: 10,
    high: 14,
    low: 9,
    close: 13,
    volume: 8,
    minuteCount: 2,
  });
});

test('formal admission stays blocked when continuous contract identity is not explicit', () => {
  const official = {
    tradeDate: '2026-07-24',
    contract: '202608',
    bars: [{ timestamp: '2026-07-24T00:45:00.000Z', open: 10, high: 14, low: 9, close: 13, volume: 8 }],
  };
  const rows = [
    { tradeDate: '2026-07-24', timestamp: '2026-07-24T08:46:00+08:00', open: 10, high: 14, low: 9, close: 13, volume: 8 },
  ];
  const day = compareCandidateDay(rows, official);
  const admission = evaluateOverlapAdmission([day], { expectedDays: 1, expectedBarsPerDay: 1 });
  assert.equal(admission.gates.exactOhlc, true);
  assert.equal(admission.gates.exactVolume, true);
  assert.equal(admission.gates.explicitContractIdentity, false);
  assert.equal(admission.formalAdmissionEligible, false);
});
