import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertPlainLocalPath } from './owner-local-research-root.mjs';

// Fixed private namespace, derived from admitted input identities, never an env
// write-path override. Commits, passwords and per-launch sessions are not identity.
export function ownerJournalBinding(binding) {
  const canonical = value => {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value)
        || /[\0\r\n]/.test(value)) throw Error('OWNER_JOURNAL_BINDING_REJECTED');
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return Object.freeze({ schema: 'owner-private-journal-binding-v1',
    sourceRoot: canonical(binding.sourceRoot), readDataRoot: canonical(binding.readDataRoot),
    researchRoot: canonical(binding.researchRoot ?? path.join(binding.readDataRoot, 'v2')),
    producerDataRoot: canonical(binding.producerDataRoot) });
}

export function ownerJournalRoot(binding) {
  const identity = ownerJournalBinding(binding);
  const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return path.join(binding.sourceRoot, 'data', 'owner-local-journals', key);
}

export function assertOwnerJournalFilesystemRoots(roots) {
  const expected = ownerJournalRoot(roots);
  if (roots.journalRoot !== expected) throw Error('OWNER_JOURNAL_BINDING_REJECTED');
  assertPlainLocalPath(expected);
  const manifest = path.join(expected, 'binding.json');
  assertPlainLocalPath(manifest, false);
  if (fs.statSync(manifest).size > 16384) throw Error('OWNER_JOURNAL_BINDING_REJECTED');
  if (fs.readFileSync(manifest, 'utf8') !== JSON.stringify(ownerJournalBinding(roots)) + '\n')
    throw Error('OWNER_JOURNAL_BINDING_REJECTED');
  const workspace = path.join(expected, 'decision-workspace');
  assertPlainLocalPath(workspace);
  const names = fs.readdirSync(expected);
  if (names.some(name => !['binding.json', 'decision-workspace'].includes(name)))
    throw Error('OWNER_JOURNAL_NAMESPACE_REJECTED');
  for (const name of fs.readdirSync(workspace)) {
    if (!['journal.ndjson', 'journal-outcomes.ndjson', 'journal-outcomes.lock'].includes(name)) throw Error('OWNER_JOURNAL_NAMESPACE_REJECTED');
    assertPlainLocalPath(path.join(workspace, name), false);
  }
  return true;
}

// Launcher invokes this only after interactive consent and binding preflight.
// Existing run directories are never discovered, moved, merged or opened here.
export function prepareOwnerJournal(binding) {
  const journalRoot = ownerJournalRoot(binding);
  for (const dir of [binding.sourceRoot, binding.readDataRoot, binding.producerDataRoot]) assertPlainLocalPath(dir);
  for (const dir of [path.join(binding.sourceRoot, 'data'), path.dirname(journalRoot)]) {
    try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    assertPlainLocalPath(dir);
  }
  let exists = false;
  try { fs.lstatSync(journalRoot); exists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!exists) {
    // Never publish a partial identity. Unique same-parent staging keeps rename
    // on one filesystem. Failed/losing staging is retained, never reused.
    const staging = fs.mkdtempSync(`${journalRoot}.staging-`);
    assertPlainLocalPath(staging);
    fs.writeFileSync(path.join(staging, 'binding.json'), JSON.stringify(ownerJournalBinding(binding)) + '\n', { flag: 'wx', mode: 0o600 });
    fs.mkdirSync(path.join(staging, 'decision-workspace'), { mode: 0o700 });
    // A cooperating winner publishes a nonempty directory, which rename cannot
    // replace. On Windows even an empty existing directory cannot be replaced.
    try {
      try { fs.lstatSync(journalRoot); exists = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!exists) fs.renameSync(staging, journalRoot);
    } catch (error) {
      // Do not infer success from EEXIST/EPERM; validate the winner below.
      try { fs.lstatSync(journalRoot); } catch { throw error; }
    }
  }
  assertOwnerJournalFilesystemRoots({ ...binding, journalRoot });
  return journalRoot;
}
