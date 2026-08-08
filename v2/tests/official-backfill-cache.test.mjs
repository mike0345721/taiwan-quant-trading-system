import test from 'node:test';
import assert from 'node:assert/strict';
import { periodCacheIsImmutable } from '../src/official-backfill.mjs';

test('completed historical month cache is immutable', () => {
  assert.equal(periodCacheIsImmutable({ start: '2026-06-01', end: '2026-06-30' }, new Date('2026-07-18T10:00:00Z')), true);
});

test('range ending today is refreshed so morning partial data cannot block evening update', () => {
  assert.equal(periodCacheIsImmutable({ start: '2026-07-01', end: '2026-07-18' }, new Date('2026-07-18T10:00:00Z')), false);
});
