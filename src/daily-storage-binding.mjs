import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertPlainLocalPath } from './owner-local-research-root.mjs';

export const dailyCodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dailyBindingKey = 'DAILY_WRITER_BINDING_PATH';
const systemKeys = new Set(('ALLUSERSPROFILE APPDATA COMMONPROGRAMFILES COMMONPROGRAMFILES(X86) COMMONPROGRAMW6432 COMPUTERNAME COMSPEC ' +
  'DRIVERDATA HOMEDRIVE HOMEPATH LOCALAPPDATA LOGONSERVER NUMBER_OF_PROCESSORS OS PATH PATHEXT PROCESSOR_ARCHITECTURE ' +
  'PROCESSOR_IDENTIFIER PROCESSOR_LEVEL PROCESSOR_REVISION PROGRAMDATA PROGRAMFILES PROGRAMFILES(X86) PROGRAMW6432 ' +
  'PSMODULEPATH PUBLIC SYSTEMDRIVE SYSTEMROOT TEMP TMP USERDOMAIN USERDOMAIN_ROAMINGPROFILE USERNAME USERPROFILE WINDIR ' +
  'HOME LANG LC_ALL LC_CTYPE TERM TZ SHELL PWD SHLVL _').split(' '));
const stageValues = {
  V2_DOMESTIC_SKIP_HISTORY: '1', V2_OPTION_INSTITUTION_MONTHS: '1', V2_OPTION_INSTITUTION_DELAY_MS: '1500',
  V2_OPTION_LARGE_MONTHS: '1', V2_OPTION_LARGE_DELAY_MS: '1500', V2_BREADTH_WORKERS: '1', V2_BREADTH_BATCH: '4',
  V2_BREADTH_MAX_JOBS: '12', V2_BREADTH_DELAY_MS: '2500', V2_LENDING_WORKERS: '1', V2_LENDING_BATCH: '3',
  V2_LENDING_MAX_DATES: '6', V2_LENDING_DELAY_MS: '2500',
};

export function assertDailyEnvironment(env, { stage = false } = {}) {
  for (const key of Object.keys(env)) {
    if (systemKeys.has(key.toUpperCase()) || key === dailyBindingKey) continue;
    if (stage && Object.hasOwn(stageValues, key) && env[key] === stageValues[key]) continue;
    throw Error(`DAILY_ENV_REJECTED:${key}`); // names only; never log values
  }
}

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value)
      || /[\0\r\n]/.test(value) || value.split(/[\\/]/).some(p => p === '.' || p === '..')
      || (process.platform === 'win32' && !/^[A-Za-z]:[\\/][^:]*$/.test(value))) throw Error('DAILY_LOCAL_PATH_REQUIRED');
  return path.resolve(value);
}
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };

// No Git mutation, optional locks, env-based repository selection or network.
export function inspectDailySource(sourceRoot, env = process.env, run = spawnSync) {
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => systemKeys.has(key.toUpperCase())));
  const git = args => {
    const result = run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', sourceRoot, ...args],
      { env: gitEnv, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw Error('DAILY_SOURCE_GIT_REJECTED');
    return result.stdout.trim();
  };
  if (!same(path.resolve(git(['rev-parse', '--show-toplevel'])), sourceRoot)) throw Error('DAILY_SOURCE_ROOT_REJECTED');
  const head = git(['rev-parse', 'HEAD']), tree = git(['rev-parse', 'HEAD^{tree}']);
  if (git(['status', '--porcelain=v1', '--untracked-files=all'])) throw Error('DAILY_SOURCE_DIRTY');
  // Check tracked paths as well as Git's tree identity; reject symlinks/hardlinks.
  for (const entry of git(['ls-tree', '-rz', 'HEAD']).split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    if (!match) throw Error('DAILY_SOURCE_TREE_REJECTED');
    const file = path.join(sourceRoot, match[3]);
    assertPlainLocalPath(file, false);
    const bytes = fs.readFileSync(file);
    const blobHash = value => crypto.createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
    // Standard Windows Git CRLF checkout is allowed; no external Git filters.
    if (blobHash(bytes) !== match[2] && (bytes.includes(0) || blobHash(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))) !== match[2]))
      throw Error('DAILY_SOURCE_BYTES_REJECTED');
  }
  return { head, tree };
}

export const dailyStorageTrees = ['v2/data', 'v2/reports', 'v2/logs', 'data/history', 'data/live-events', 'data/intraday', 'data/forward', 'data/automation-logs'];
function inspectStorage(storageRoot) {
  for (const name of ['', 'v2', 'v2/data', 'v2/reports', 'v2/logs', 'data']) assertPlainLocalPath(path.join(storageRoot, name));
  const db = path.join(storageRoot, 'v2/data/research-v2.sqlite');
  assertPlainLocalPath(db, false);
  if (fs.statSync(db).size < 100) throw Error('DAILY_EXISTING_DATABASE_REQUIRED');
  // Metadata only, never follow aliases or read market records. Bound the scan.
  let count = 0;
  const scan = target => {
    if (++count > 250000) throw Error('DAILY_STORAGE_METADATA_LIMIT');
    let st;
    try { st = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    assertPlainLocalPath(target, st.isDirectory());
    if (st.isDirectory()) for (const name of fs.readdirSync(target)) scan(path.join(target, name));
  };
  for (const name of dailyStorageTrees) scan(path.join(storageRoot, name));
  scan(path.join(storageRoot, 'data/latest.json'));
}

export function validateDailyBinding(binding, { env = process.env, codeRoot = dailyCodeRoot,
  machine = os.hostname(), inspectSource = inspectDailySource, stage = false } = {}) {
  assertDailyEnvironment(env, { stage });
  const keys = ['schema', 'machine', 'sourceRoot', 'storageAppRoot', 'expectedHead', 'expectedTree'];
  if (!binding || Object.keys(binding).length !== keys.length || keys.some(k => !Object.hasOwn(binding, k))
      || binding.schema !== 'daily-writer-binding-v1' || binding.machine !== machine
      || !/^[a-f0-9]{40}$/.test(binding.expectedHead) || !/^[a-f0-9]{40}$/.test(binding.expectedTree)) throw Error('DAILY_BINDING_REJECTED');
  const sourceRoot = localPath(binding.sourceRoot), storageAppRoot = localPath(binding.storageAppRoot);
  if (!same(sourceRoot, localPath(codeRoot)) || inside(sourceRoot, storageAppRoot) || inside(storageAppRoot, sourceRoot)) throw Error('DAILY_ROOT_BINDING_REJECTED');
  assertPlainLocalPath(sourceRoot);
  const source = inspectSource(sourceRoot, env);
  if (source.head !== binding.expectedHead || source.tree !== binding.expectedTree) throw Error('DAILY_SOURCE_IDENTITY_REJECTED');
  inspectStorage(storageAppRoot);
  return Object.freeze({ sourceRoot, storageAppRoot, storageV2Root: path.join(storageAppRoot, 'v2'), bound: true });
}

export function readDailyBinding(bindingPath, options = {}) {
  const file = localPath(bindingPath);
  assertPlainLocalPath(file, false);
  if (fs.statSync(file).size > 16384) throw Error('DAILY_BINDING_SIZE_REJECTED');
  return validateDailyBinding(JSON.parse(fs.readFileSync(file, 'utf8')), options);
}

// No free-form data-root override. Every bound consumer revalidates the binding
// before opening storage. Unbound callers retain their original defaults.
export function dailyStorageRoots(defaultAppRoot = dailyCodeRoot, env = process.env) {
  if (!Object.hasOwn(env, dailyBindingKey)) return { sourceRoot: defaultAppRoot, storageAppRoot: defaultAppRoot,
    storageV2Root: path.join(defaultAppRoot, 'v2'), bound: false };
  return readDailyBinding(env[dailyBindingKey], { env, stage: true });
}

export function assertDailyArguments(allowed = [], argv = process.argv.slice(2), env = process.env) {
  if (!Object.hasOwn(env, dailyBindingKey)) return;
  if (argv.some(arg => !allowed.includes(arg))) throw Error('DAILY_ARGUMENT_REJECTED');
}
