import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PRIVATE_ROOT = path.join(REPO, 'data', 'cru54-private');
export const BASE_SHA = 'd3702315b46a1a6c23384338ae40904b8bc589c2';
export const BRANCH = 'codex/cru-54-cvd-current-main-v1';
const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
const equal = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function assertPlainPath(target) {
  const absolute = path.resolve(target);
  for (let item = absolute; ; item = path.dirname(item)) {
    if (fs.existsSync(item)) {
      if (fs.lstatSync(item).isSymbolicLink() || !equal(fs.realpathSync.native(item), item)) throw new Error('CVD_PATH_REDIRECTION');
    }
    if (path.dirname(item) === item) break;
  }
  return absolute;
}
export function assertIsolatedWorktree() {
  assertPlainPath(REPO);
  if (!fs.lstatSync(path.join(REPO, '.git')).isFile() || git(['branch', '--show-current']) !== BRANCH) throw new Error('CVD_ISOLATED_WORKTREE_REQUIRED');
  // Exact baseline ancestry is the source/scope audit gate. Runtime isolation also works in a shallow CI worktree.
  const common = path.resolve(REPO, git(['rev-parse', '--git-common-dir']));
  const primary = path.dirname(common);
  if (equal(primary, REPO)) throw new Error('CVD_PRIMARY_WORKTREE_REFUSED');
  assertPlainPath(PRIVATE_ROOT);
  if (!git(['check-ignore', path.join(PRIVATE_ROOT, 'output', 'probe.json')])) throw new Error('CVD_OUTPUT_NOT_IGNORED');
  return { repo: REPO, primary, privateRoot: PRIVATE_ROOT, head: git(['rev-parse', 'HEAD']) };
}
export function isolatedRunRoot(runId) {
  assertIsolatedWorktree();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(runId || '')) throw new Error('CVD_RUN_ID_INVALID');
  return assertPlainPath(path.join(PRIVATE_ROOT, 'output', runId));
}
export function assertInputPath(sourcePath) {
  const { primary } = assertIsolatedWorktree();
  if (!path.isAbsolute(sourcePath || '')) throw new Error('CVD_ABSOLUTE_SOURCE_REQUIRED');
  const actual = assertPlainPath(sourcePath);
  const roots = [path.join(primary, 'data', 'live-events'), path.join(PRIVATE_ROOT, 'fixtures')];
  if (!roots.some(root => equal(path.dirname(actual), root)) || !/\.ndjson$/.test(actual)) throw new Error('CVD_SOURCE_NOT_ALLOWLISTED');
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('CVD_SOURCE_NOT_PLAIN_FILE');
  return actual;
}
