import test from 'node:test';
import assert from 'node:assert/strict';
import {
  black76Greeks,
  deriveOptionGreeksProbe,
  impliedVolatilityBlack76,
} from '../src/option-greeks.mjs';

test('Black-76 IV inversion reproduces price, delta and positive gamma', () => {
  const input = {
    future: 40000,
    strike: 40200,
    time: 20 / 365,
    volatility: 0.24,
    rate: 0.015,
    right: 'call',
  };
  const priced = black76Greeks(input);
  const iv = impliedVolatilityBlack76({ ...input, price: priced.price });
  const rebuilt = black76Greeks({ ...input, volatility: iv });
  assert.ok(Math.abs(iv - input.volatility) < 1e-7);
  assert.ok(Math.abs(rebuilt.price - priced.price) < 1e-7);
  assert.ok(rebuilt.delta > 0 && rebuilt.delta < 1);
  assert.ok(rebuilt.gamma > 0);
});

test('bounded option probe preserves invalid quotes as unknown and never authorizes execution', () => {
  const result = deriveOptionGreeksProbe({
    checkedAt: '2026-07-30T11:00:00+08:00',
    futurePrice: 40600,
    expiry: '2026-08-19',
    contracts: [
      {
        code: 'TXO40600H6',
        strikePrice: 40600,
        optionRight: 'C',
        bid: 1500,
        ask: 1550,
        validTwoSidedQuote: true,
      },
      {
        code: 'TXO40600T6',
        strikePrice: 40600,
        optionRight: 'P',
        bid: null,
        ask: null,
        validTwoSidedQuote: false,
      },
    ],
  });
  assert.equal(result.calculated, 1);
  assert.ok(result.observations[0].iv > 0);
  assert.equal(result.observations[1].status, 'UNKNOWN_INVALID_QUOTE');
  assert.equal(result.observations[1].iv, null);
  assert.equal(result.timestampGate, 'PENDING_PROVIDER_SNAPSHOT_TS_SEMANTICS');
  assert.equal(result.executionAuthorized, false);
});
