import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendForwardRecords, readLedger, specificationHash, validateForwardRecord } from '../src/forward-ledger.mjs';

const specification = { version: 'x', freezeThroughDate: '2026-07-09', strategyKeys: ['demo'], assumptions: { costPoints: 8 } };

test('forward specification hash is stable across object key order', () => {
  assert.equal(specificationHash({ b: 2, a: 1 }), specificationHash({ a: 1, b: 2 }));
});

test('forward ledger is append-only and idempotent', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-forward-'));
  const file = path.join(folder, 'ledger.jsonl');
  const record = { specificationHash: specificationHash(specification), strategyKey: 'demo', signalDate: '2026-07-10', outcomeStatus: 'resolved' };
  try {
    validateForwardRecord(record, specification);
    assert.deepEqual(appendForwardRecords(file, [record, record]), { appended: 1, total: 1 });
    assert.deepEqual(appendForwardRecords(file, [record]), { appended: 0, total: 1 });
    assert.equal(readLedger(file).length, 1);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('forward ledger rejects old dates and changed rule hashes', () => {
  assert.throws(() => validateForwardRecord({ specificationHash: 'bad', strategyKey: 'demo', signalDate: '2026-07-10', outcomeStatus: 'pending' }, specification), /HASH_MISMATCH/);
  assert.throws(() => validateForwardRecord({ specificationHash: specificationHash(specification), strategyKey: 'demo', signalDate: '2026-07-09', outcomeStatus: 'pending' }, specification), /DATE_NOT_NEW/);
});
