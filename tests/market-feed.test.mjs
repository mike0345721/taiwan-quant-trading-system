import test from 'node:test';
import assert from 'node:assert/strict';
import { marketFeedReadiness, normalizeMarketEvent } from '../src/market-feed.mjs';

test('broker events normalize into a provider-neutral schema', () => {
  const event = normalizeMarketEvent({ type: 'tick', product: 'TX', contract: '202607', timestamp: '2026-07-15T01:00:00Z', price: 45_000, volume: 3 }, 'shioaji');
  assert.equal(event.provider, 'shioaji');
  assert.equal(event.price, 45_000);
  assert.equal(event.schemaVersion, '1.0.0');
});

test('pre-live readiness never enables live execution', () => {
  const status = marketFeedReadiness({ replayFrame: { totalBars: 30, state: 'above_vwap_wait' } });
  assert.equal(status.replayImported, true);
  assert.equal(status.liveExecutionEnabled, false);
});
