import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspectShioajiBridge } from '../src/shioaji-bridge-client.mjs';

const quoteTypeHealth = Object.fromEntries(['Tick', 'BidAsk'].map((quoteType) => [quoteType, {
  quoteType, subscriptionState: 'RESTORED', deliveryState: 'LIVE', freshnessState: 'LIVE',
  lastObservedAt: '2026-08-26T01:00:00.000Z',
}]));
const requiredSubscriptions = [
  ...['TX', 'MTX', 'TMF'].map((product) => ({ product, state: 'RESTORED', quoteTypes: ['Tick', 'BidAsk'], quoteTypeHealth })),
  { product: '2330', state: 'RESTORED', quoteTypes: ['Tick'] },
  { product: 'IX0001', state: 'RESTORED', quoteTypes: ['Quote'] },
];

function fixture(payload) {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('accepts only a connected read-only Shioaji bridge', async () => {
  const server = await fixture({
    ok: true, provider: 'shioaji', mode: 'market_data_only',
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false, symbolsReceived: 2,
    bridgeState: 'HEALTHY', writerState: 'PASS', requiredSubscriptions,
    eventStorage: 'append_only_hash_chain', eventsWritten: 20, freeBytes: 10_000_000_000,
    txoCollection: { enabled: false, collectorState: 'STOPPED_EXPECTED', privatePath: 'must-not-leak' },
  });
  const { port } = server.address();
  const status = await inspectShioajiBridge({ baseUrl: `http://127.0.0.1:${port}` });
  server.close();
  assert.equal(status.connected, true);
  assert.equal(status.symbolsReceived, 2);
  assert.equal(status.orderRoutesEnabled, false);
  assert.equal(status.eventsWritten, 20);
  assert.equal(status.eventStorage, 'append_only_hash_chain');
  assert.equal(status.txoCollection.collectorState, 'STOPPED_EXPECTED');
  assert.doesNotMatch(JSON.stringify(status), /must-not-leak|privatePath/);
});

test('fails closed when Tick is missing even though BidAsk is live', async () => {
  const tx = requiredSubscriptions.find((item) => item.product === 'TX');
  const server = await fixture({
    ok: true, provider: 'shioaji', mode: 'market_data_only', formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false, bridgeState: 'DEGRADED', writerState: 'PASS',
    reasonCode: 'MISSING_REQUIRED_QUOTE_TYPE',
    requiredSubscriptions: requiredSubscriptions.map((item) => item.product === 'TX' ? {
      ...tx, state: 'PARTIAL', quoteTypeHealth: {
        ...tx.quoteTypeHealth, Tick: { ...tx.quoteTypeHealth.Tick, deliveryState: 'MISSING', lastObservedAt: null },
      },
    } : item),
  });
  const { port } = server.address();
  const status = await inspectShioajiBridge({ baseUrl: `http://127.0.0.1:${port}` });
  server.close();
  assert.equal(status.connected, false);
  assert.equal(status.error, 'MISSING_REQUIRED_QUOTE_TYPE');
  assert.equal(status.requiredSubscriptions.find((item) => item.product === 'TX').quoteTypeHealth.Tick.deliveryState, 'MISSING');
});

test('fails closed when a HEALTHY bridge reports PENDING or UNKNOWN quote delivery', async () => {
  for (const deliveryState of ['PENDING', 'UNKNOWN']) {
    const tx = requiredSubscriptions.find((item) => item.product === 'TX');
    const server = await fixture({
      ok: true, provider: 'shioaji', mode: 'market_data_only', formalWeight: 0, researchOnly: true,
      executionAuthorized: false, orderRoutesEnabled: false, bridgeState: 'HEALTHY', writerState: 'PASS',
      requiredSubscriptions: requiredSubscriptions.map((item) => item.product === 'TX' ? {
        ...tx, state: 'RESTORED', quoteTypeHealth: {
          ...tx.quoteTypeHealth, Tick: { ...tx.quoteTypeHealth.Tick, deliveryState, lastObservedAt: null },
        },
      } : item),
    });
    const { port } = server.address();
    const status = await inspectShioajiBridge({ baseUrl: `http://127.0.0.1:${port}` });
    server.close();
    assert.equal(status.connected, false, deliveryState);
    assert.equal(status.error, 'bridge_degraded', deliveryState);
  }
});

test('fails closed if a bridge reports an execution route', async () => {
  const server = await fixture({
    ok: true, provider: 'shioaji', mode: 'market_data_only',
    executionAuthorized: true, orderRoutesEnabled: true,
  });
  const { port } = server.address();
  const status = await inspectShioajiBridge({ baseUrl: `http://127.0.0.1:${port}` });
  server.close();
  assert.equal(status.connected, false);
  assert.equal(status.error, 'unsafe_bridge_response');
});
