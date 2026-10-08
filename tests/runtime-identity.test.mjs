import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeVersionStatus, readRuntimeIdentity, validateFormalRuntimeVersionTruth } from '../src/runtime-identity.mjs';

test('runtime identity uses exact process-local safe.directory and exposes only the commit', () => {
  let observed = null;
  const identity = readRuntimeIdentity('D:\\Taiwan stock\\standalone-v1', {
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
    '-c', 'safe.directory=D:\\Taiwan stock\\standalone-v1', 'rev-parse', 'HEAD',
  ]);
  assert.equal(observed.options.cwd, 'D:\\Taiwan stock\\standalone-v1');
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
