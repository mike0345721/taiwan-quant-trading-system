import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspectShioajiBridge } from '../src/shioaji-bridge-client.mjs';

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
    executionAuthorized: false, orderRoutesEnabled: false, symbolsReceived: 2,
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
