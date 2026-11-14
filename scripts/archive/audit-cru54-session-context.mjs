import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { REPO } from '../src/cvd-observation-isolation.mjs';
const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim();
const scope = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/research/CRU54_SESSION_CONTEXT_SCOPE.json')));
assert.equal(git(['branch', '--show-current']), scope.branch);
assert.equal(git(['merge-base', scope.acceptedD, 'HEAD']), scope.acceptedD);
const changed = [...new Set([...git(['diff', '--name-only', scope.acceptedD]).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean))].sort();
assert.ok(changed.every(file => scope.allowlist.includes(file)), 'SESSION_CONTEXT_OUTSIDE_ALLOWLIST');
for (const file of scope.allowlist) assert.ok(fs.existsSync(path.join(REPO, file)), 'ALLOWLIST_FILE_MISSING:' + file);
const prior = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/research/CRU54_PHASE_A_SCOPE.json')));
for (const file of [...prior.allowlist, ...prior.mustPreserve]) assert.equal(git(['diff', scope.acceptedD, '--', file]), '', 'ACCEPTED_SOURCE_CHANGED:' + file);
for (const phase of ['B','C','D']) {
  const accepted = JSON.parse(fs.readFileSync(path.join(REPO,`docs/research/CRU54_PHASE_${phase}_SCOPE.json`)));
  for (const file of accepted.allowlist.filter(f => !scope.allowlist.includes(f))) assert.equal(git(['diff',scope.acceptedD,'--',file]),'','ACCEPTED_SOURCE_CHANGED:'+file);
}
assert.equal(git(['diff', '--check']), '');
assert.ok(git(['check-ignore', 'data/cru54-private/session-context/probe.json']));
console.log(JSON.stringify({ state: 'CRU54_SESSION_CONTEXT_SCOPE_PASS', head: git(['rev-parse','HEAD']), phaseABase: scope.acceptedD, changed, safety: scope.safety }));
