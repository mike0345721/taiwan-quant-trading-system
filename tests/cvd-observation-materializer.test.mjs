import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY, stableJson, digest } from '../src/cvd-observation-core.mjs';
import { PRIVATE_ROOT, REPO, BRANCH, isolatedRunRoot, assertInputPath } from '../src/cvd-observation-isolation.mjs';
import { materializeCvdBatch, readCvdGeneration } from '../src/cvd-observation-materializer.mjs';

// The existing CI checkout is a shallow primary checkout. Exercise the real guard in a fresh
// Git worktree; no fixture bypass, changed CI lane or skipped I/O assertion.
const ciBootstrap = process.env.GITHUB_ACTIONS === 'true' && fs.lstatSync(path.join(REPO, '.git')).isDirectory();
if (ciBootstrap) {
  test('CI materializer cases run through the same real isolated-worktree guard', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cru54-ci-')), candidate = path.join(parent, 'candidate');
    const setup = spawnSync('git', ['worktree', 'add', '-b', BRANCH, candidate, 'HEAD'], { cwd: REPO, encoding: 'utf8', timeout: 30_000 });
    assert.equal(setup.status, 0, setup.stderr);
    const run = spawnSync(process.execPath, ['--test', 'tests/cvd-observation-materializer.test.mjs'],
      { cwd: candidate, encoding: 'utf8', timeout: 300_000, windowsHide: true });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    process.stdout.write(run.stdout);
  });
}

function fixture() {
  const id = `test-${crypto.randomUUID()}`;
  const dir = path.join(PRIVATE_ROOT, 'fixtures'); fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, `${id}.ndjson`);
  let previousHash = 'GENESIS';
  const rows = [
    { kind: 'futures_bidask', payload: { bid_price: [99], ask_price: [100] } },
    { kind: 'futures_tick', payload: { volume: 2, tick_type: 1 } },
    { kind: 'futures_tick', payload: { volume: 3, tick_type: 2 } },
    { kind: 'futures_tick', payload: { volume: 4, tick_type: 0 } },
    { kind: 'futures_tick', payload: { volume: 999, tick_type: 1 }, duplicate: true },
  ].map((row, i) => {
    const r = buildLiveEventRecord({ ...row, code: 'TXFI6', receivedAt: `2026-09-11T09:00:0${i}+08:00`,
      payload: { productFamily: 'TX', actualContract: 'TXFI6', eventTime: `2026-09-11T09:00:0${i}+08:00`,
        close: 100, note: '台股', ...row.payload }, ...SAFETY }, previousHash); previousHash = r.recordHash; return r;
  });
  const bytes = rows.map(r => `${stableJson(r)}\r\n`).join(''); fs.writeFileSync(sourcePath, bytes);
  return { id, sourcePath, rows, bytes, run: (suffix, extra = {}) => materializeCvdBatch({ sourcePath, runId: `${id}-${suffix}`, ...extra }) };
}
if (!ciBootstrap) {
test('full vs actual process restart/checkpoint suffix: entire generation equivalence; idle stable; source bytes intact', () => {
  const f = fixture(), full = f.run('full').generation;
  const first = f.run('chunks', { maxRecords: 2 }).generation;
  const original = JSON.stringify(first);
  const child = spawnSync(process.execPath, ['scripts/materialize-cvd-observation.mjs', f.sourcePath, `${f.id}-chunks`],
    { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  const resumed = readCvdGeneration(`${f.id}-chunks`);
  assert.deepEqual(resumed, full); assert.equal(full.result.semantic.value, -1);
  assert.equal(full.result.semantic.segments[0].unknownVolume, 4);
  assert.equal(full.checkpoint.state.ordinal, 5); assert.equal(full.result.semantic.series.length, 3);
  assert.equal(full.result.semantic.availableAt, f.rows[4].receivedAt);
  assert.equal(full.result.semantic.lastTradeAvailableAt, f.rows[3].receivedAt);
  assert.equal(full.cutoffReceivedAt, f.rows[4].receivedAt);
  assert.equal(f.run('chunks').state, 'NO_NEW_RECORDS');
  assert.equal(JSON.stringify(first), original);
  const persistedFirst = JSON.parse(fs.readFileSync(path.join(isolatedRunRoot(`${f.id}-chunks`), `${first.generationHash}.json`)));
  assert.deepEqual(persistedFirst, first); assert.equal(fs.readFileSync(f.sourcePath, 'utf8'), f.bytes);
});
test('append and partial UTF-8/CRLF tail never skips or invents a physical record', () => {
  const f = fixture(), bytes = Buffer.from(f.bytes), boundary = bytes.lastIndexOf(Buffer.from('\r\n'), bytes.length - 3) + 2;
  const split = bytes.indexOf(Buffer.from('台'), boundary) + 1;
  fs.writeFileSync(f.sourcePath, bytes.subarray(0, split));
  const a = f.run('partial'); assert.equal(a.generation.checkpoint.state.ordinal, 4);
  assert.equal(f.run('partial').state, 'WAITING_FOR_COMPLETE_RECORD');
  fs.appendFileSync(f.sourcePath, bytes.subarray(split, bytes.length - 1));
  assert.equal(f.run('partial').state, 'WAITING_FOR_COMPLETE_RECORD');
  fs.appendFileSync(f.sourcePath, bytes.subarray(bytes.length - 1));
  const b = f.run('partial'); assert.equal(b.processedRecords, 1); assert.equal(b.generation.checkpoint.state.ordinal, 5);
  assert.deepEqual(b.generation, f.run('whole').generation);
  assert.equal(digest(fs.readFileSync(f.sourcePath)), digest(bytes));
});
test('source prefix alteration, truncate, replacement, wrong source and resolver drift refuse continuation', () => {
  for (const kind of ['alter', 'truncate', 'replace', 'other', 'resolver']) {
    const f = fixture(), first = f.run(kind, { maxRecords: 2 });
    const root = isolatedRunRoot(`${f.id}-${kind}`), pointer = fs.readFileSync(path.join(root, 'latest.json'));
    if (kind === 'alter') fs.writeFileSync(f.sourcePath, f.bytes.replace('TXFI6', 'TXFJ6'));
    if (kind === 'truncate') fs.truncateSync(f.sourcePath, 1);
    if (kind === 'replace') { fs.renameSync(f.sourcePath, `${f.sourcePath}.preserved`); fs.writeFileSync(f.sourcePath, f.bytes); }
    if (kind === 'other') { f.sourcePath = fixture().sourcePath; }
    if (kind === 'resolver') {
      const g = structuredClone(first.generation); g.checkpoint.state.resolverIdentity = 'wrong';
      // Deliberate disk corruption must fail the generation seal, without repairing it.
      fs.writeFileSync(path.join(root, `${g.generationHash}.json`), JSON.stringify(g));
    }
    assert.throws(() => materializeCvdBatch({ sourcePath: f.sourcePath, runId: `${f.id}-${kind}` }), /CHANGED|TRUNCATED|INVALID/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'latest.json')), pointer);
  }
});
test('pointer traversal and immutable corruption are rejected; never scan/restore another generation', () => {
  const f = fixture(); f.run('corrupt'); const root = isolatedRunRoot(`${f.id}-corrupt`);
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ schemaVersion: 'cru54-cvd-pointer-v1', generationHash: '../outside' }));
  assert.throws(() => f.run('corrupt'), /POINTER_INVALID/);
  assert.throws(() => isolatedRunRoot('../outside'), /RUN_ID/);
  assert.throws(() => assertInputPath(path.join(REPO, 'package.json')), /NOT_ALLOWLISTED/);
  assert.throws(() => assertInputPath('relative.ndjson'), /ABSOLUTE/);
});
test('writer contention and publish failure leave the earlier checkpoint usable, retry counts suffix once', () => {
  const f = fixture(), prefix = f.run('failure', { maxRecords: 2 }).generation;
  const root = isolatedRunRoot(`${f.id}-failure`), pointer = fs.readFileSync(path.join(root, 'latest.json'));
  fs.mkdirSync(path.join(root, 'writer.lock'));
  assert.throws(() => f.run('failure'), /WRITER_BUSY/); fs.rmdirSync(path.join(root, 'writer.lock'));
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('ENGINEERING_POINTER_RENAME_DENIED'); };
  try { assert.throws(() => f.run('failure'), /POINTER_RENAME_DENIED/); } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(path.join(root, 'latest.json')), pointer);
  assert.equal(readCvdGeneration(`${f.id}-failure`).generationHash, prefix.generationHash);
  const retry = f.run('failure'); assert.deepEqual(retry.generation, f.run('reference').generation);
});
test('write/fsync/link errors preserve source and checkpoint; no malformed snapshot is published', () => {
  for (const method of ['writeFileSync', 'fsyncSync', 'linkSync']) {
    const f = fixture(); f.run('io', { maxRecords: 2 }); const root = isolatedRunRoot(`${f.id}-io`);
    const before = fs.readFileSync(path.join(root, 'latest.json')), original = fs[method];
    fs[method] = () => { throw new Error(`ENGINEERING_${method}`); };
    try { assert.throws(() => f.run('io'), new RegExp(`ENGINEERING_${method}`)); } finally { fs[method] = original; }
    assert.deepEqual(fs.readFileSync(path.join(root, 'latest.json')), before);
    assert.equal(digest(fs.readFileSync(f.sourcePath)), digest(f.bytes));
    assert.deepEqual(f.run('io').generation, f.run('reference').generation);
  }
});
test('empty input, ordinal cutoffs and bounded batch refusal remain explicit', () => {
  const f = fixture(); fs.writeFileSync(f.sourcePath, ''); assert.equal(f.run('empty').generation, null);
  fs.writeFileSync(f.sourcePath, f.bytes); const r = f.run('bounded', { stopOrdinal: 2 });
  assert.equal(r.processedRecords, 2); assert.equal(f.run('bounded', { stopOrdinal: 2 }).state, 'CUTOFF_REACHED');
  assert.throws(() => f.run('bounded', { stopOrdinal: 1 }), /CUTOFF_REGRESSION/);
  assert.throws(() => f.run('tiny', { maxBytes: 5 }), /RECORD_EXCEEDS/);
  assert.throws(() => f.run('budget', { maxRecords: 25001 }), /BUDGET_INVALID/);
});
test('loaded implementation cannot stamp results with changed on-disk code identity', () => {
  const f = fixture(), before = f.run('code', { maxRecords: 2 }).generation;
  const read = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    const bytes = read(file, ...args);
    return String(file).endsWith('src/cvd-observation-core.mjs') || String(file).endsWith('src\\cvd-observation-core.mjs')
      ? Buffer.concat([Buffer.from(bytes), Buffer.from(' ')]) : bytes;
  };
  try { assert.throws(() => f.run('code'), /LOADED_CODE_CHANGED/); } finally { fs.readFileSync = read; }
  assert.equal(readCvdGeneration(`${f.id}-code`).generationHash, before.generationHash);
  assert.deepEqual(f.run('code').generation, f.run('reference').generation);
});
}
