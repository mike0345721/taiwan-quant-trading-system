import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFuturesOrderFlow } from '../src/futures-order-flow.mjs';

function record(kind, timestamp, payload = {}) {
  return {
    kind,
    product: 'TXFH6',
    receivedAt: `${timestamp}+08:00`,
    exchangeTimestamp: timestamp,
    duplicate: false,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: {
      code: 'TXFH6',
      datetime: timestamp,
      simtrade: false,
      ...payload,
    },
  };
}

test('futures order flow builds provider-side CVD and exact tick VWAP', () => {
  const result = buildFuturesOrderFlow([
    record('futures_bidask', '2026-07-30T09:00:00.000', {
      bid_price: [100], ask_price: [101],
    }),
    record('futures_tick', '2026-07-30T09:00:00.100', {
      close: 101, volume: 2, tick_type: 1,
    }),
    record('futures_bidask', '2026-07-30T09:00:01.000', {
      bid_price: [100], ask_price: [101],
    }),
    record('futures_tick', '2026-07-30T09:00:01.100', {
      close: 100, volume: 1, tick_type: 2,
    }),
    record('futures_tick', '2026-07-30T09:00:02.100', {
      close: 100.5, volume: 1, tick_type: 0,
    }),
  ], { targetCodes: ['TXFH6'] });
  const product = result.products.TXFH6;
  assert.equal(product.volume, 4);
  assert.equal(product.buyVolume, 2);
  assert.equal(product.sellVolume, 1);
  assert.equal(product.unknownVolume, 1);
  assert.equal(product.cvd, 1);
  assert.equal(product.quoteCvd, 1);
  assert.equal(product.exactVwap, 100.625);
  assert.equal(product.classifiedVolumeRatio, 0.75);
  assert.equal(product.oneMinuteBars.length, 1);
  assert.equal(product.fiveMinuteBars[0].exactVwap, 100.625);
  assert.equal(result.executionAuthorized, false);
});

test('quote cross-check records conflicts without replacing provider tick type', () => {
  const result = buildFuturesOrderFlow([
    record('futures_bidask', '2026-07-30T09:00:00.000', {
      bid_price: [100], ask_price: [101],
    }),
    record('futures_tick', '2026-07-30T09:00:00.100', {
      close: 100, volume: 3, tick_type: 1,
    }),
  ], { targetCodes: ['TXFH6'] });
  const product = result.products.TXFH6;
  assert.equal(product.buyVolume, 3);
  assert.equal(product.quoteSellVolume, 3);
  assert.equal(product.quoteCvd, -3);
  assert.equal(product.classificationConflicts, 1);
  assert.equal(product.classificationConflictRatio, 1);
  assert.equal(product.quoteMatchedTicks, 1);
});

test('duplicates, simulated ticks and unauthorized records fail closed', () => {
  const ignored = buildFuturesOrderFlow([
    { ...record('futures_tick', '2026-07-30T09:00:00.100', {
      close: 100, volume: 1, tick_type: 1,
    }), duplicate: true },
    record('futures_tick', '2026-07-30T09:00:01.100', {
      close: 100, volume: 1, tick_type: 1, simtrade: true,
    }),
  ], { targetCodes: ['TXFH6'] });
  assert.deepEqual(ignored.products, {});
  assert.throws(() => buildFuturesOrderFlow([
    {
      ...record('futures_tick', '2026-07-30T09:00:00.100', {
        close: 100, volume: 1, tick_type: 1,
      }),
      executionAuthorized: true,
    },
  ], { targetCodes: ['TXFH6'] }), /execution_boundary_invalid/);
});
