import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepareOwnerRoots, ownerEnvironment } from '../src/owner-local-startup.mjs';
import { ownerJournalRoot, assertOwnerJournalFilesystemRoots } from '../src/owner-local-journal.mjs';

test('two independent Owner processes reopen Journal/Outcome with fresh password and Session across commits', t => {
  const base = path.resolve('data'); fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, 'owner-persistence-fixture-'));
  t.after(() => { assert.ok(home.startsWith(base + path.sep)); fs.rmSync(home, { recursive: true, force: true }); });
  const binding = { sourceRoot: path.join(home, 'source'), readDataRoot: path.join(home, 'read'),
    producerDataRoot: path.join(home, 'producer'), expectedHead: 'a'.repeat(40) };
  for (const dir of [binding.sourceRoot, binding.readDataRoot, binding.producerDataRoot]) fs.mkdirSync(dir);
  const preserved = ['data/decision-workspace/journal.ndjson',
    'data/owner-local-acceptance/legacy-run/decision-workspace/journal.ndjson',
    'data/owner-local-acceptance/legacy-run/sessions.json'];
  for (const name of preserved) {
    const file = path.join(binding.sourceRoot, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'SYNTHETIC LEGACY BYTES MUST NOT BE PARSED OR MERGED');
  }
  const run = input => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/owner-journal-worker.mjs', import.meta.url))],
      { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000, windowsHide: true, env: {} });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  const first = run({ binding, write: true });
  const second = run({ binding: { ...binding, expectedHead: 'b'.repeat(40) }, previous: { cookie: first.cookie, password: first.password } });
  assert.notEqual(first.pid, second.pid);
  assert.notEqual(first.roots.privateDataRoot, second.roots.privateDataRoot);
  assert.notEqual(first.roots.chartCacheRoot, second.roots.chartCacheRoot);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal(second.review.data.length, 1, 'reopened real handler must return prior Journal');
  assert.deepEqual(second.review.data, first.review.data);
  assert.deepEqual(second.review.outcomes, first.review.outcomes);
  assert.equal(second.review.outcomes.length, 1);
  assert.deepEqual(fs.readdirSync(binding.readDataRoot), []);
  assert.deepEqual(fs.readdirSync(binding.producerDataRoot), []);
  for (const name of preserved)
    assert.equal(fs.readFileSync(path.join(binding.sourceRoot, name), 'utf8'), 'SYNTHETIC LEGACY BYTES MUST NOT BE PARSED OR MERGED');
});

test('binding changes segregate journals; wrong manifest, arbitrary root, hard links and junctions fail closed', t => {
  const base = path.resolve('data'); fs.mkdirSync(base, { recursive: true });
  const home = fs.mkdtempSync(path.join(base, 'owner-binding-fixture-'));
  t.after(() => { assert.ok(home.startsWith(base + path.sep)); fs.rmSync(home, { recursive: true, force: true }); });
  const binding = { sourceRoot: path.join(home, 'source'), readDataRoot: path.join(home, 'read'), producerDataRoot: path.join(home, 'producer') };
  for (const dir of Object.values(binding)) fs.mkdirSync(dir);
  const first = prepareOwnerRoots(binding, randomUUID());
  for (const key of ['sourceRoot', 'readDataRoot', 'researchRoot', 'producerDataRoot'])
    assert.notEqual(ownerJournalRoot({ ...binding, [key]: path.join(home, key + '-other') }), first.journalRoot, key);
  const otherRead = path.join(home, 'other-read'); fs.mkdirSync(otherRead);
  const second = prepareOwnerRoots({ ...binding, readDataRoot: otherRead }, randomUUID());
  assert.notEqual(first.journalRoot, second.journalRoot);
  assert.deepEqual(fs.readdirSync(path.join(second.journalRoot, 'decision-workspace')), []);
  assert.throws(() => assertOwnerJournalFilesystemRoots({ ...second, journalRoot: first.journalRoot }), /BINDING_REJECTED/);
  const manifest = path.join(first.journalRoot, 'binding.json');
  const original = fs.readFileSync(manifest);
  fs.writeFileSync(manifest, fs.readFileSync(path.join(second.journalRoot, 'binding.json')));
  assert.throws(() => prepareOwnerRoots(binding, randomUUID()), /BINDING_REJECTED/);
  fs.writeFileSync(manifest, original);
  const target = path.join(first.journalRoot, 'decision-workspace/journal.ndjson');
  const marker = path.join(binding.readDataRoot, 'marker'); fs.writeFileSync(marker, 'READ ONLY');
  fs.linkSync(marker, target);
  assert.throws(() => assertOwnerJournalFilesystemRoots(first), /ALIAS_REJECTED/);
  fs.unlinkSync(target);
  const workspace = path.join(first.journalRoot, 'decision-workspace'); fs.rmdirSync(workspace);
  fs.symlinkSync(binding.readDataRoot, workspace, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertOwnerJournalFilesystemRoots(first), /ALIAS_REJECTED/);
  fs.unlinkSync(workspace); fs.mkdirSync(workspace);
  // Preserve the store's existing BUSY semantics; never delete a prior writer guard.
  const guard = path.join(workspace, 'journal-outcomes.lock'); fs.writeFileSync(guard, '');
  assert.equal(assertOwnerJournalFilesystemRoots(first), true);
  assert.equal(fs.existsSync(guard), true);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'READ ONLY');
  const env = ownerEnvironment(binding, first, { OWNER_JOURNAL_ROOT: binding.readDataRoot, JOURNAL_PATH: marker });
  assert.equal(env.OWNER_JOURNAL_ROOT, undefined); assert.equal(env.JOURNAL_PATH, undefined);
});
