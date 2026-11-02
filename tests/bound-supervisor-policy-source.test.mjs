// Source-derived argv fixtures only. No PowerShell, process or runtime is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

// Git may check these files out as CRLF on Windows; compare normalized source.
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const supervisor = read('scripts/bound-startup-supervision.psm1');
const nativeFixtures = read('tests/bound-startup-supervision.test.ps1');
const sha = text => createHash('sha256').update(text).digest('hex');

// Read the shipped, deliberately small literal-concatenation expression without
// evaluating PowerShell or substituting a separately maintained argv template.
function concatenate(expression, bindings) {
  const token = /\s*('(?:[^']|'')*'|\$(?:EntryPath|BindingPath|attempt))\s*(\+|$)/gy;
  let result = '', offset = 0;
  while (offset < expression.length) {
    token.lastIndex = offset;
    const match = token.exec(expression);
    assert.ok(match, 'unexpected worker argument expression');
    result += match[1].startsWith("'")
      ? match[1].slice(1, -1).replaceAll("''", "'")
      : bindings[match[1].slice(1)];
    offset = token.lastIndex;
    if (!match[2]) break;
  }
  assert.equal(offset, expression.length);
  return result;
}

const assignments = [...supervisor.matchAll(/^\s*\$arguments=(.+)$/gm)];
assert.equal(assignments.length, 1, 'one actual supervisor worker argument assignment');
const switches = [...supervisor.matchAll(/if \(\$(NoBrowser|CheckOnly)\) \{ \$arguments\+='([^']+)' \}/g)];
assert.equal(switches.length, 2, 'both existing conditional switches must be recognized');

for (const [NoBrowser, CheckOnly] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`source-derived worker argv respects policy: NoBrowser=${NoBrowser}, CheckOnly=${CheckOnly}`, () => {
    const bindings = {
      EntryPath: 'D:\\synthetic source + only\\entry.ps1',
      BindingPath: 'D:\\synthetic bindings\\config.json',
      attempt: 'D:\\synthetic receipts\\one attempt',
    };
    let args = concatenate(assignments[0][1], bindings);
    for (const [, name, suffix] of switches) if ({ NoBrowser, CheckOnly }[name]) args += suffix;
    const calls = [];
    const launchMock = value => { calls.push(value); };
    launchMock(args);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0], /ExecutionPolicy|Bypass/i);
    assert.equal(calls[0], '-NoProfile -NonInteractive -File "' + bindings.EntryPath +
      '" -BindingPath "' + bindings.BindingPath + '" -InternalWorker -AttemptDirectory "' + bindings.attempt +
      '"' + (NoBrowser ? ' -NoBrowser' : '') + (CheckOnly ? ' -CheckOnly' : ''));
  });
}

test('all lifecycle, ownership, deadline, guard and environment source is preserved from 398f3c7', () => {
  const prefix = /-NoProfile -NonInteractive(?: -ExecutionPolicy Bypass)? -File /g;
  assert.equal([...supervisor.matchAll(prefix)].length, 1);
  const baseline = supervisor.replace(prefix, '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ');
  assert.equal(sha(baseline), 'e65d7f4ddee0654282700b31abc1e8cc614bf696f4be70f018dd8880082a0c13');
});

test('native fixtures use normal policy while preserving every other normalized baseline character', () => {
  assert.doesNotMatch(nativeFixtures, /ExecutionPolicy|Bypass/);
  assert.equal([...nativeFixtures.matchAll(/-NoProfile -NonInteractive -File /g)].length, 2);
  const baseline = nativeFixtures.replaceAll('-NoProfile -NonInteractive -File ',
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ');
  assert.equal(sha(baseline), '4a9fcf6feba374bdae07ead355fab04f574d9283213689979ef459b566a23a9d');
});

test('the existing public/internal entry is unchanged; no replacement control path', () => {
  assert.equal(sha(read('scripts/start-bound-daily-use.ps1')),
    'db40db398d6bc7cf5aad87ebc58b1625b9fc51e18cbba942f4f7df43d2b0412a');
});
