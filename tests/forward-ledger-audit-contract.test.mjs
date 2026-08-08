import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('forward ledger audit rejects duplicates, mock rows and execution authority', () => {
  const source = fs.readFileSync(new URL('../scripts/audit-forward-ledger.mjs', import.meta.url), 'utf8');
  assert.match(source, /duplicate/);
  assert.match(source, /mock_forbidden/);
  assert.match(source, /execution_forbidden/);
  assert.match(source, /frozenResearchOnly: true/);
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(source, /materializeV3OutcomeLedger/);
  assert.match(source, /effectiveOutcomeRecords/);
  assert.match(source, /outcomeCorrections/);
  assert.doesNotMatch(source, /path\.resolve\(['"]v2['"]/);
});
