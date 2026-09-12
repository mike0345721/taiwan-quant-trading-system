import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/research/CRU50_MAINTENANCE.json', import.meta.url)));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const actual = [...new Set([...git('diff', '--name-only', manifest.base), ...git('ls-files', '--others', '--exclude-standard')])].sort();
const unexpected = actual.filter(p => !manifest.allowlist.includes(p));
if (unexpected.length) throw new Error(`CVD_SCOPE_VIOLATION:${unexpected.join(',')}`);
for (const name of actual) {
  if (git('ls-tree', '--name-only', manifest.base, '--', name).length) throw new Error(`CVD_SHARED_CHANGE:${name}`);
}
console.log(JSON.stringify({ status: 'PASS', base: manifest.base, actualFiles: actual, sharedChanges: 0,
  productionEntryChanges: 0, assertion: 'ADDITIVE_OFFLINE_FILES_ONLY_NOT_RUNTIME_ACCEPTANCE' }, null, 2));
