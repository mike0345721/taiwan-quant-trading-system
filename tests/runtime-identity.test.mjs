import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeVersionStatus, readRuntimeIdentity } from '../src/runtime-identity.mjs';

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
