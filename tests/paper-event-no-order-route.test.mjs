import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('paper event ledger remains a local CLI and does not add broker or order endpoints', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const appendScript = fs.readFileSync(new URL('../scripts/append-paper-event.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /paper-event|paper\/event|broker\/order|placeOrder/);
  assert.match(appendScript, /data[',\s]+['"]forward/);
  assert.match(appendScript, /executionAuthorized: false/);
});

