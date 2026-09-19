import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true }).trim();
const scope = JSON.parse(fs.readFileSync(path.join(root, 'docs/research/CRU54_PHASE_A_SCOPE.json')));
assert.equal(git(['branch', '--show-current']), scope.branch);
assert.equal(git(['merge-base', scope.base, 'HEAD']), scope.base);
const changed = [...new Set([...git(['diff', '--name-only', scope.base]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean))].sort();
assert.ok(changed.every(file => scope.allowlist.includes(file)), `OUTSIDE_ALLOWLIST:${changed}`);
for (const file of scope.mustPreserve) assert.equal(git(['diff', scope.base, '--', file]), '', `BASELINE_CHANGED:${file}`);
for (const file of scope.allowlist) assert.ok(fs.existsSync(path.join(root, file)), `MISSING:${file}`);
assert.ok(git(['check-ignore', 'data/cru54-private/output/probe.json']));
assert.equal(git(['diff', '--check']), '');
process.stdout.write(`${JSON.stringify({ state: 'CRU54_SCOPE_PASS', base: scope.base, head: git(['rev-parse', 'HEAD']), changed,
  mustPreserve: scope.mustPreserve, safety: scope.safety })}\n`);
