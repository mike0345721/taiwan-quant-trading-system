import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRuntimeVersionStatus, readRuntimeIdentity, validateFormalRuntimeVersionTruth } from '../src/runtime-identity.mjs';

test('runtime identity uses exact process-local safe.directory and exposes only the commit', () => {
  let observed = null;
  const projectRoot = path.resolve('synthetic project', 'standalone-v1');
  const identity = readRuntimeIdentity(projectRoot, {
    exec(command, args, options) {
      observed = { command, args, options };
      return 'CE014639DF478317678B345347A107D8A9133CC6\n';
    },
  });
  assert.deepEqual(identity, {
    status: 'VERIFIED',
    commit: 'ce014639df478317678b345347a107d8a9133cc6',
  });
  assert.equal(observed.command, 'git');
  assert.deepEqual(observed.args, [
    '-c', `safe.directory=${projectRoot}`, 'rev-parse', 'HEAD',
  ]);
  assert.equal(observed.options.cwd, projectRoot);
  assert.equal(observed.args.includes('safe.directory=*'), false);
});

test('runtime identity fails closed when Git identity cannot be verified', () => {
  const identity = readRuntimeIdentity('.', { exec() { throw new Error('dubious ownership'); } });
  assert.deepEqual(identity, { status: 'UNAVAILABLE', commit: null });
});

test('runtime version status distinguishes synced, mismatch and unknown without asset inference', () => {
  const commit = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  const verified = { status: 'VERIFIED', commit };
  assert.equal(buildRuntimeVersionStatus({ runtimeIdentity: verified, approvedMainIdentity: verified }).syncState, 'SYNCED');
  assert.equal(buildRuntimeVersionStatus({ runtimeIdentity: verified, approvedMainIdentity: { status: 'VERIFIED', commit: other } }).syncState, 'MISMATCH');
  assert.equal(buildRuntimeVersionStatus({ runtimeIdentity: verified, approvedMainIdentity: { status: 'UNAVAILABLE', commit: null } }).syncState, 'UNKNOWN');
});

test('runtime identity can resolve the exact local main ref with process-local trust only', () => {
  let args = null;
  readRuntimeIdentity('D:\\Taiwan stock\\standalone-v1', {
    ref: 'refs/heads/main',
    exec(_command, inputArgs) { args = inputArgs; return `${'a'.repeat(40)}\n`; },
  });
  assert.equal(args.at(-1), 'refs/heads/main');
  assert.equal(args.includes('safe.directory=*'), false);
});

function formalFixture() {
  const commit = 'a'.repeat(40);
  const version = buildRuntimeVersionStatus({
    runtimeIdentity: { status: 'VERIFIED', commit },
    approvedMainIdentity: { status: 'VERIFIED', commit },
    runtimeStartedAt: '2026-10-08T01:00:00.000Z',
  });
  return { version, options: { expectedRuntimeCommit: commit, expectedApprovedMainCommit: commit,
    actualDataMode: 'LIVE', sourceClean: true, host: '127.0.0.1', port: 8787,
    previewType: null, now: new Date('2026-10-08T01:00:01.000Z') } };
}

test('formal identity accepts verified clean LIVE main without requiring a preview declaration', () => {
  const { version, options } = formalFixture();
  const result = validateFormalRuntimeVersionTruth(version, options);
  assert.deepEqual(result, { ready: true, reasons: [] });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
});

test('formal identity rejects unmerged candidates and self-declared synced versions', () => {
  const { version, options } = formalFixture();
  const candidate = 'b'.repeat(40);
  const cases = [
    [{ ...version, runtimeCommit: candidate }, { ...options, expectedRuntimeCommit: candidate }],
    [{ ...version, runtimeCommit: candidate, approvedMainCommit: candidate }, options],
    [version, { ...options, expectedRuntimeCommit: null }],
    [version, { ...options, expectedApprovedMainCommit: null }],
    [version, { ...options, expectedApprovedMainCommit: candidate }],
    [{ ...version, approvedMainCommit: candidate }, options],
    [{ ...version, syncState: 'MISMATCH' }, options],
    [{ ...version, syncState: 'UNKNOWN' }, options],
  ];
  for (const [declaration, evidence] of cases) {
    assert.ok(validateFormalRuntimeVersionTruth(declaration, evidence).reasons.includes('FORMAL_APPROVED_MAIN_MISMATCH'));
  }
});

test('formal identity rejects preview mode and wrong actual activation boundaries', () => {
  const { version, options } = formalFixture();
  for (const previewType of ['CRU21_OWNER_PREVIEW', 'CRU44_OWNER_PREVIEW', 'INTEGRATION_OWNER_PREVIEW']) {
    assert.ok(validateFormalRuntimeVersionTruth({ ...version, previewType }, options).reasons.includes('FORMAL_PREVIEW_NOT_ALLOWED'));
    assert.ok(validateFormalRuntimeVersionTruth(version, { ...options, previewType }).reasons.includes('FORMAL_PREVIEW_NOT_ALLOWED'));
  }
  for (const override of [{ host: '0.0.0.0' }, { port: 18722 }, { port: 8790 }, { port: null }]) {
    assert.ok(validateFormalRuntimeVersionTruth(version, { ...options, ...override }).reasons.includes('FORMAL_RUNTIME_BOUNDARY_REJECTED'));
  }
  for (const actualDataMode of ['MOCK', null, undefined]) {
    assert.ok(validateFormalRuntimeVersionTruth({ ...version, dataMode: 'LIVE' }, { ...options, actualDataMode }).reasons.includes('FORMAL_LIVE_DATA_REQUIRED'));
  }
  for (const sourceClean of [false, null, undefined]) {
    assert.ok(validateFormalRuntimeVersionTruth(version, { ...options, sourceClean }).reasons.includes('FORMAL_SOURCE_NOT_CLEAN'));
  }
});

test('formal identity rejects absent, invalid and future runtime start times', () => {
  const { version, options } = formalFixture();
  for (const runtimeStartedAt of [null, '', 'invalid', '2026-10-08T01:00:06.001Z']) {
    assert.ok(validateFormalRuntimeVersionTruth({ ...version, runtimeStartedAt }, options).reasons.includes('FORMAL_RUNTIME_START_TIME_INVALID'));
  }
  assert.ok(validateFormalRuntimeVersionTruth(version, { ...options, now: new Date(NaN) }).reasons.includes('FORMAL_RUNTIME_START_TIME_INVALID'));
  assert.equal(validateFormalRuntimeVersionTruth(null).ready, false);
});

test('linked candidate worktree reads shared local main without mistaking candidate HEAD for approved main', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-identity-'));
  const primary = path.join(root, 'primary'), candidate = path.join(root, 'candidate');
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    fs.mkdirSync(primary);
    git(primary, ['init', '--quiet', '--initial-branch=main']);
    git(primary, ['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic main']);
    const main = git(primary, ['rev-parse', 'HEAD']);
    git(primary, ['worktree', 'add', '-b', 'synthetic-candidate', candidate]);
    git(candidate, ['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic candidate']);
    const runtimeIdentity = readRuntimeIdentity(candidate);
    const approvedMainIdentity = readRuntimeIdentity(candidate, { ref: 'refs/heads/main' });
    assert.equal(runtimeIdentity.status, 'VERIFIED');
    assert.notEqual(runtimeIdentity.commit, main);
    assert.deepEqual(approvedMainIdentity, { status: 'VERIFIED', commit: main });
    const version = buildRuntimeVersionStatus({ runtimeIdentity, approvedMainIdentity, runtimeStartedAt: '2026-10-27T00:00:00Z' });
    assert.equal(version.syncState, 'MISMATCH');
    const result = validateFormalRuntimeVersionTruth(version, { expectedRuntimeCommit: runtimeIdentity.commit,
      expectedApprovedMainCommit: main, actualDataMode: 'LIVE', sourceClean: true, host: '127.0.0.1', port: 8787,
      now: new Date('2026-10-27T00:00:01Z') });
    assert.ok(result.reasons.includes('FORMAL_APPROVED_MAIN_MISMATCH'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
