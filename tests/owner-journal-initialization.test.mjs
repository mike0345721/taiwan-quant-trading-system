import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareOwnerJournal, ownerJournalRoot } from '../src/owner-local-journal.mjs';

function fixture(t) {
  const base = path.resolve('data'); fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, 'journal-init-'));
  t.after(() => { assert.ok(home.startsWith(base + path.sep)); fs.rmSync(home, { recursive: true, force: true }); });
  const binding = Object.fromEntries(['sourceRoot', 'readDataRoot', 'producerDataRoot'].map(k => [k, path.join(home, k)]));
  for (const dir of Object.values(binding)) fs.mkdirSync(dir);
  return binding;
}

for (const failure of ['manifest', 'workspace']) test(`initialization failure at ${failure} leaves no published partial journal and retry succeeds`, t => {
  const binding = fixture(t);
  const method = failure === 'manifest' ? 'writeFileSync' : 'mkdirSync';
  const original = fs[method];
  fs[method] = function (target, ...args) {
    if (String(target).endsWith(failure === 'manifest' ? 'binding.json' : 'decision-workspace'))
      throw Object.assign(Error('injected initialization failure'), { code: 'ENOSPC' });
    return original.call(this, target, ...args);
  };
  try { assert.throws(() => prepareOwnerJournal(binding), /injected/); }
  finally { fs[method] = original; }
  assert.equal(fs.existsSync(ownerJournalRoot(binding)), false);
  assert.equal(prepareOwnerJournal(binding), ownerJournalRoot(binding));
});

test('pre-existing incomplete identity is rejected and never repaired or cleared', t => {
  const binding = fixture(t), journal = ownerJournalRoot(binding);
  fs.mkdirSync(journal, { recursive: true });
  fs.writeFileSync(path.join(journal, 'old-evidence'), 'preserve');
  assert.throws(() => prepareOwnerJournal(binding));
  assert.deepEqual(fs.readdirSync(journal), ['old-evidence']);
});

test('publisher losing a race validates the complete winning namespace', t => {
  const binding = fixture(t), journal = ownerJournalRoot(binding);
  const original = fs.renameSync;
  let raced = false;
  fs.renameSync = function (from, to) {
    if (to === journal && !raced) {
      raced = true;
      prepareOwnerJournal(binding);
      fs.writeFileSync(path.join(journal, 'decision-workspace/journal.ndjson'), 'winner');
    }
    return original.call(this, from, to);
  };
  try { assert.equal(prepareOwnerJournal(binding), journal); }
  finally { fs.renameSync = original; }
  assert.equal(raced, true);
  assert.equal(fs.readFileSync(path.join(journal, 'decision-workspace/journal.ndjson'), 'utf8'), 'winner');
});

test('a racing incomplete or foreign namespace is rejected without repair', t => {
  const binding = fixture(t), journal = ownerJournalRoot(binding);
  const original = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (to === journal) {
      fs.mkdirSync(journal);
      fs.writeFileSync(path.join(journal, 'old-evidence'), 'never clear');
      throw Object.assign(Error('another publisher'), { code: 'EEXIST' });
    }
    return original.call(this, from, to);
  };
  try { assert.throws(() => prepareOwnerJournal(binding)); }
  finally { fs.renameSync = original; }
  assert.deepEqual(fs.readdirSync(journal), ['old-evidence']);
  assert.equal(fs.readFileSync(path.join(journal, 'old-evidence'), 'utf8'), 'never clear');
});
