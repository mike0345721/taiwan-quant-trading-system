import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const product = fs.readFileSync(path.join(root, 'docs', 'product', 'DW4_EVIDENCE_CONFLICT_MONITOR_V1.md'), 'utf8');
const data = fs.readFileSync(path.join(root, 'docs', 'data', 'DW4_DATA_REQUIREMENTS_AND_COLLECTION.md'), 'utf8');

test('DW-4 documents keep collection separate from promotion and trading', () => {
  assert.match(product, /Collection is not promotion/);
  assert.match(product, /hidden weights/i);
  assert.match(product, /conflictState/);
  assert.match(product, /coverageState/);
  assert.match(product, /dataTrustState/);
  assert.match(product, /executionAuthorized=false/);
  assert.match(data, /productionActivationApproved/);
  assert.match(data, /\*\*NOT ACTIVATED\*\*/);
  assert.match(data, /no broker route/i);
});

test('data matrix preserves source identity and quality limitations', () => {
  assert.match(data, /raise_count/);
  assert.match(data, /nativeSequenceAvailability=UNAVAILABLE/);
  assert.match(data, /NDX_PROXY/);
  assert.match(data, /NQ futures/);
  assert.match(data, /CONTRIBUTION_NOT_YET_ELIGIBLE/);
  assert.match(data, /TIMESTAMP_LINEAGE_INSUFFICIENT/);
  assert.match(data, /2,050 contracts/);
  assert.match(data, /RAW_VALIDATED_CANDIDATE/);
  assert.match(data, /production activation readiness is `NOT_READY`/);
});

test('documents contain no production activation or execution authorization', () => {
  assert.doesNotMatch(`${product}\n${data}`, /executionAuthorized=true/);
  assert.doesNotMatch(`${product}\n${data}`, /orderRoutesEnabled=true/);
  assert.doesNotMatch(`${product}\n${data}`, /productionActivationApproved=true/);
});
