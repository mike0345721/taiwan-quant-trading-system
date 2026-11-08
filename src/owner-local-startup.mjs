import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MARKET_CANDIDATE_BRANCH, assertCandidateRoots, assertMarketCandidateFilesystemRoots } from './cru21-market-candidate.mjs';
import { OWNER_SCOPE, OWNER_PREVIEW, validateOwnerIdentity } from './owner-local-acceptance.mjs';

export function assertInteractiveOwnerParent(observed, { scriptPath, bindingPath, shellPath }) {
  // Accept only the documented interactive -File invocation. An env flag or a
  // piped JSON frame sent by an unattended Node/task process is not admission.
  const normalized = value => String(value || '').replaceAll('/', '\\').toLowerCase();
  // Constrained grammar: quotes are mandatory only when a pathname contains whitespace.
  // No extra flags, embedded quotes, token concatenation or alternate argument order.
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = value => {
    const v=normalized(value);
    if(!v || /["\r\n\0]/.test(v)) throw Error('OWNER_INTERACTIVE_PARENT_REQUIRED');
    const q=escape(v);
    return /\s/.test(v) ? '"'+q+'"' : '(?:"'+q+'"|'+q+')';
  };
  const expected = new RegExp('^-noprofile\\s+-sta\\s+-file\\s+'+token(scriptPath)+'\\s+-bindingpath\\s+'+token(bindingPath)+'$');
  const line = String(observed?.commandLine || '');
  const args = line.replace(/^(?:"[^"]+"|\S+)\s+/, '');
  if (observed?.interactive !== true || !Number.isInteger(observed.sessionId) || observed.sessionId <= 0
      || observed.parentSessionId !== observed.sessionId || normalized(observed.executablePath) !== normalized(shellPath)
      || !expected.test(normalized(args))) throw Error('OWNER_INTERACTIVE_PARENT_REQUIRED');
}

export function verifyInteractiveOwnerParent(scriptPath, bindingPath) {
  const shellPath = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}'; `
    + `$self=Get-Process -Id ${process.pid}; @{commandLine=$p.CommandLine;executablePath=$p.ExecutablePath;`
    + `parentSessionId=[int]$p.SessionId;sessionId=[int]$self.SessionId;interactive=[Environment]::UserInteractive}|ConvertTo-Json -Compress`;
  let observed;
  try { observed = JSON.parse(execFileSync(shellPath, ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:16384,stdio:['ignore','pipe','pipe'] })); }
  catch { throw Error('OWNER_INTERACTIVE_PARENT_UNVERIFIED'); }
  assertInteractiveOwnerParent(observed, { scriptPath, bindingPath, shellPath });
}

export function assertPlainLocalPath(target, directory = true) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || /^[\\/]{2}/.test(target) || /[\0\r\n]/.test(target))
    throw Error('OWNER_LOCAL_PATH_REQUIRED');
  for (let current = target;; current = path.dirname(current)) {
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || (current === target && !directory ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()))
      throw Error('OWNER_PATH_ALIAS_REJECTED');
    if (current === path.dirname(current)) break;
  }
  if (fs.realpathSync(target).toLowerCase() !== path.resolve(target).toLowerCase()) throw Error('OWNER_PATH_ALIAS_REJECTED');
}

// Only called after consent. Git is read-only; no pull, config, safe.directory or clone.
export function verifyOwnerBinding(binding, appRoot, { git = args => execFileSync('git',
  ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
  { cwd: appRoot, encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  inspect = assertPlainLocalPath, machineName = os.hostname() } = {}) {
  if (binding?.schema !== 'owner-local-acceptance-binding-v1' || binding.machineName !== machineName
      || binding.sourceRoot !== appRoot || binding.branch !== MARKET_CANDIDATE_BRANCH
      || /[\\/]worktrees[\\/]/i.test(appRoot)) throw Error('OWNER_RUNTIME_BINDING_REJECTED');
  for (const name of ['sourceRoot', 'readDataRoot', 'producerDataRoot']) inspect(binding[name]);
  // A runtime checkout must have its own .git directory, never this development worktree.
  inspect(path.join(appRoot, '.git'));
  const truth = validateOwnerIdentity({ ...binding, actualHead: git(['rev-parse', 'HEAD']),
    actualTree: git(['rev-parse', 'HEAD^{tree}']), actualBaseMain: git(['rev-parse', 'refs/heads/main']),
    actualBranch: git(['branch', '--show-current']), sourceClean: git(['status', '--porcelain']) === '' });
  if (!truth.ready) throw Error('OWNER_SOURCE_IDENTITY_REJECTED');
  return binding;
}

export function prepareOwnerRoots(binding, runId) {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw Error('OWNER_RUN_ID_REJECTED');
  const privateDirectory = path.join('data', 'owner-local-acceptance', runId);
  const roots = assertCandidateRoots({ sourceRoot: binding.sourceRoot, readDataRoot: binding.readDataRoot,
    producerDataRoot: binding.producerDataRoot, privateDataRoot: path.join(binding.sourceRoot, privateDirectory),
    chartCacheRoot: path.join(binding.sourceRoot, privateDirectory, 'dashboard-chart-cache') }, privateDirectory);
  for (const dir of [path.join(binding.sourceRoot, 'data'), path.join(binding.sourceRoot, 'data/owner-local-acceptance')]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    assertPlainLocalPath(dir);
  }
  // Exclusive per-launch namespace: previous HTTP sessions are never reused with a new password.
  fs.mkdirSync(roots.privateDataRoot, { mode: 0o700 });
  fs.mkdirSync(roots.chartCacheRoot, { mode: 0o700 });
  fs.mkdirSync(path.join(roots.privateDataRoot, 'decision-workspace'), { mode: 0o700 });
  assertMarketCandidateFilesystemRoots(roots);
  return roots;
}

export function ownerEnvironment(binding, roots, inherited = process.env) {
  const env = {};
  // Never import .env, credentials, TLS, GIT_ overrides, Node hooks, AI or broker settings.
  for (const [key, value] of Object.entries(inherited)) {
    if (/^(SystemRoot|WINDIR|PATH|PATHEXT|TEMP|TMP|COMSPEC)$/i.test(key)) env[key] = value;
  }
  return { ...env, HOST: '127.0.0.1', PORT: '18723', NODE_ENV: 'production', COOKIE_SECURE: '1',
    TRUST_PROXY: '0', MOCK_DATA: '0', ASK_GPT_INLINE_ENABLED: '0', CRU21_GUEST_ENABLED: '0',
    REFRESH_INTERVAL_SECONDS: '0', DASHBOARD_CANDIDATE_READ_ONLY: '1',
    DASHBOARD_RELEASE_SCOPE: OWNER_SCOPE, DASHBOARD_PREVIEW_TYPE: OWNER_PREVIEW,
    DASHBOARD_PREVIEW_BRANCH: binding.branch, DASHBOARD_PREVIEW_EXPECTED_HEAD: binding.expectedHead,
    DASHBOARD_PREVIEW_EXPECTED_TREE: binding.expectedTree, DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN: binding.expectedBaseMain,
    DASHBOARD_CANDIDATE_READ_ROOT: roots.readDataRoot, TX_CHART_DATA_ROOT: roots.readDataRoot,
    TX_CHART_CACHE_ROOT: roots.chartCacheRoot, CRU34_LIVE_DATA_ROOT: roots.producerDataRoot,
    CRU34_LIVE_SNAPSHOT_PATH: path.join(roots.producerDataRoot, 'runtime/cru34-live/latest.json'),
    CRU34_LIVE_STATUS_PATH: path.join(roots.producerDataRoot, 'runtime/cru34-live/status.json'),
    V2_RESEARCH_DATABASE_PATH: path.join(roots.readDataRoot, 'v2/data/research-v2.sqlite'),
    V2_BACKTEST_REPORT_PATH: path.join(roots.readDataRoot, 'v2/reports/latest-backtest.json'),
    DATA_OPERATIONS_OUTPUT_ROOT: path.join(roots.readDataRoot, 'quality/daily-data-operations') };
}
