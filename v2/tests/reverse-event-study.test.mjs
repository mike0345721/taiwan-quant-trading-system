import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReverseEvents } from '../src/reverse-event-study.mjs';

test('reverse event thresholds use prior volatility and expose precursor windows', () => {
  const rows = Array.from({ length: 140 }, (_, index) => ({
    tradeDate: `2026-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
    txOpen: 20000, txHigh: 20100, txLow: 19900, txClose: index === 100 ? 20400 : 20020,
    sameDayReturnPct: index === 100 ? 2 : 0.1, regime: 'range', foreignSpot: index,
  }));
  const report = analyzeReverseEvents(rows, { startDate: '2026-01-01', windows: [1, 3] });
  assert.equal(report.eventCounts.large_rise, 1);
  assert.ok(report.studies.some((item) => item.eventType === 'large_rise' && item.precursorDays === 3));
  assert.ok(Array.isArray(report.candidates));
});

test('missing precursor data stays missing instead of becoming zero', () => {
  const rows = Array.from({ length: 90 }, (_, index) => ({
    tradeDate: `2026-01-${String(index + 1).padStart(3, '0')}`,
    txOpen: 100, txHigh: 101, txLow: 99, txClose: index === 70 ? 102 : 100.1,
    sameDayReturnPct: index === 70 ? 2 : 0.1, regime: 'range', foreignSpot: null,
  }));
  const report = analyzeReverseEvents(rows, { startDate: '2026-01-001', windows: [1] });
  const study = report.studies.find((item) => item.eventType === 'large_rise' && item.feature === 'foreignSpot');
  assert.equal(study.eventSamples, 0);
  assert.equal(study.eventMean, null);
});
