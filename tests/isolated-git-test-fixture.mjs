import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real branch/worktree guards in a disposable, independent Git
// repository. Never create/delete branches or worktrees in the source repo.
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
};
export function needsIsolatedTest(repo, branch, file) {
  const isolated = fs.lstatSync(path.join(repo, '.git')).isFile()
    && git(repo, ['branch', '--show-current']) === branch;
  if (process.env.ISOLATED_GIT_TEST_FILE === file && !isolated) throw Error('TEST_WORKTREE_BOOTSTRAP_FAILED');
  return !isolated;
}
export function runIsolatedTest(repo, branch, file) {
  assert.match(file, /^[a-z0-9-]+\.test\.mjs$/);
  const parent = path.join(repo, 'data', 'isolated-test-worktrees');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const primary = path.join(root, 'primary'), candidate = path.join(root, 'candidate');
  const head = git(repo, ['rev-parse', 'HEAD']);
  try {
    fs.mkdirSync(primary);
    git(primary, ['init', '--quiet']);
    git(primary, ['config', 'core.autocrlf', 'false']);
    git(primary, ['config', 'core.longpaths', 'true']);
    git(primary, ['fetch', '--quiet', '--depth=1', repo, head]);
    git(primary, ['worktree', 'add', '-b', branch, candidate, 'FETCH_HEAD']);
    assert.equal(git(candidate, ['rev-parse', 'HEAD']), head);
    // Include current tracked edits under review, but no env/auth/data files.
    // The branch guard and all production code remain real and unchanged.
    const changed = git(repo, ['diff', '--name-only', 'HEAD', '--', 'tests', 'src', 'scripts']).split('\n').filter(Boolean);
    for (const relative of [...new Set([...changed, 'tests/isolated-git-test-fixture.mjs'])]) {
      assert.ok(!relative.includes('..') && /^(tests|src|scripts)\//.test(relative));
      const source = path.join(repo, relative), target = path.join(candidate, relative);
      if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
      else if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    const r = spawnSync(process.execPath, ['--test', path.join('tests', file)], {
      cwd: candidate, encoding: 'utf8', windowsHide: true, timeout: 300_000,
      env: { ...process.env, ISOLATED_GIT_TEST_FILE: file }, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    process.stdout.write(r.stdout);
  } finally {
    const actual = fs.realpathSync(root), allowed = fs.realpathSync(parent);
    assert.equal(path.dirname(actual), allowed);
    assert.ok(path.basename(actual).startsWith('case-') && !fs.lstatSync(root).isSymbolicLink());
    fs.rmSync(actual, { recursive: true, force: true, maxRetries: 3 });
  }
}
