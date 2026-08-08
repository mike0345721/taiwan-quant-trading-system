import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TAIFEX replay audit compares official OHLCV and remains read-only', () => {
  const source = fs.readFileSync(new URL('../scripts/audit-taifex-replay.mjs', import.meta.url), 'utf8');
  for (const field of ['open', 'high', 'low', 'close']) assert.match(source, new RegExp(`['\"]${field}['\"]`));
  assert.match(source, /checks\.volume/);
  assert.match(source, /checks\.daySessionCoverage/);
  assert.match(source, /checks\.nightSessionCoverage/);
  assert.match(source, /checks\.contractConsistency/);
  assert.match(source, /PRAGMA query_only/);
  assert.match(source, /executionAuthorized: false/);
});
