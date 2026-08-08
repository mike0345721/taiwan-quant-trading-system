import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptionsLiveEvent, optionsFeedReadiness } from '../src/options-live-contract.mjs';

test('option live event normalizes provider data without authorizing execution', () => {
  const event = normalizeOptionsLiveEvent({
    type: 'option_quote', contract: '202607W4', expiry: '2026-07-24', strike: 44500, right: 'C',
    exchangeTimestamp: '2026-07-23T01:00:00.000Z', receivedAt: '2026-07-23T01:00:00.120Z',
    bid: 120, ask: 121, bidSize: 8, askSize: 5,
    bidDepth: [{ price: 120, size: 8 }], askDepth: [{ price: 121, size: 5 }],
  }, 'shioaji');
  assert.equal(event.provider, 'shioaji');
  assert.equal(event.latencyMs, 120);
  assert.equal(event.quality.quoteValid, true);
  assert.equal(event.quality.tradeDirectionAvailable, false);
  assert.equal(event.executionAuthorized, false);
});

test('option feed remains research-only and fails closed before broker connection', () => {
  const event = normalizeOptionsLiveEvent({
    type: 'option_quote', contract: '202607W4', strike: 44500, right: 'P',
    exchangeTimestamp: '2026-07-23T01:00:00.000Z', receivedAt: '2026-07-23T01:00:00.050Z', bid: 80, ask: 81,
  }, 'shioaji');
  const waiting = optionsFeedReadiness({ connected: false, sampleEvents: [event] });
  assert.equal(waiting.researchCollectionReady, false);
  assert.equal(waiting.liveExecutionEnabled, false);
  assert.ok(waiting.blockers.includes('broker_not_connected'));
});

test('invalid option timestamps, rights and depth are rejected', () => {
  const base = { type: 'option_tick', contract: '202607W4', strike: 44500, right: 'C', exchangeTimestamp: '2026-07-23T01:00:00Z', receivedAt: '2026-07-23T01:00:01Z' };
  assert.throws(() => normalizeOptionsLiveEvent({ ...base, right: 'X' }), /right_invalid/);
  assert.throws(() => normalizeOptionsLiveEvent({ ...base, bidDepth: [{ price: -1, size: 2 }] }), /bid_depth_level_invalid/);
  const reversed = normalizeOptionsLiveEvent({ ...base, receivedAt: '2026-07-23T00:59:59Z' });
  assert.equal(reversed.quality.timestampOrderValid, false);
});
