import test from 'node:test';
import assert from 'node:assert/strict';
import { latestFundamentalBefore } from '../src/fundamental-releases.mjs';

test('monthly fundamentals use actual release date rather than reference month', () => {
  const rows = [
    { reference_period: '2026-05', release_date: '2026-06-09', release_time: '16:00', value: 51.7 },
    { reference_period: '2026-06', release_date: '2026-07-09', release_time: '16:00', value: 44.0 },
  ];
  assert.equal(latestFundamentalBefore(rows, '2026-07-09'), rows[0]);
  assert.equal(latestFundamentalBefore(rows, '2026-07-10'), rows[1]);
});

test('same-day data released after market open is unavailable to the open decision', () => {
  const rows = [{ reference_period: '2026-06', release_date: '2026-07-09', release_time: '16:00', value: 44.0 }];
  assert.equal(latestFundamentalBefore(rows, '2026-07-09', '08:45'), null);
});
