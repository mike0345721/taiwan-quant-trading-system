import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSourceFreshness, SOURCE_METADATA } from '../src/data-quality.mjs';

test('margin is pending before official 21:00 production window', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-09', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('margin', source, '2026-07-13', new Date('2026-07-13T10:00:00Z')), 'pending_publication');
});

test('old margin becomes stale after production window', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-09', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('margin', source, '2026-07-13', new Date('2026-07-13T14:00:00Z')), 'stale');
});

test('daily official sources remain pending before their own publication windows', () => {
  const old = { ok: true, stale: true, dataDate: '2026-07-16' };
  assert.equal(evaluateSourceFreshness('spotInstitutional', old, '2026-07-17', new Date('2026-07-17T06:00:00Z')), 'pending_publication');
  assert.equal(evaluateSourceFreshness('options', old, '2026-07-17', new Date('2026-07-17T08:00:00Z')), 'pending_publication');
  assert.equal(evaluateSourceFreshness('options', old, '2026-07-17', new Date('2026-07-17T09:00:00Z')), 'stale');
});

test('cache and failures are never shown as current', () => {
  assert.equal(evaluateSourceFreshness('options', { ok: true, stale: true, fallbackFromCache: true }, '2026-07-13'), 'cached');
  assert.equal(evaluateSourceFreshness('options', { ok: false }, '2026-07-13'), 'failed');
  assert.match(SOURCE_METADATA.largeTraders.scope, /TX\+MTX\/4\+TMF\/20/);
});

test('latest Friday data remains current on a closed weekend', () => {
  const source = { ok: true, stale: true, dataDate: '2026-07-17', fallbackFromCache: false };
  assert.equal(evaluateSourceFreshness('options', source, '2026-07-17', new Date('2026-07-18T10:00:00Z')), 'current');
});
