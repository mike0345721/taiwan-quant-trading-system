import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { PRIVATE_ROOT, pinCvdPrefix, verifyCvdPrefix, runCvdOffline, publishCvdArtifact, preserveCvdError } from '../src/cvd-offline-io.mjs';

// ENGINEERING fixtures only. These do not establish historical-market evidence.
function fixture(t) {
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(PRIVATE_ROOT, 'cvd-io-engineering-'));
  t.after(() => {
    const relative = path.relative(PRIVATE_ROOT, root);
    assert.ok(relative.startsWith('cvd-io-engineering-') && !relative.includes(path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let previous = 'GENESIS';
  const records = ['futures_bidask', 'futures_tick', 'status', 'futures_tick'].map((kind, i) => {
    const at = `2026-09-10T09:00:00.${String(i * 100).padStart(3, '0')}+08:00`;
    const record = buildLiveEventRecord({ kind, code: 'TXFI6', receivedAt: at,
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      payload: { productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-10', session: 'DAY',
        eventTime: at, bid_price: [99], ask_price: [101], price: 101, volume: 3, tick_type: i === 3 ? 2 : 1 } }, previous);
    previous = record.recordHash;
    return record;
  });
  const sourcePath = path.join(root, 'ENGINEERING.jsonl');
  const bytes = records.map((r) => `${JSON.stringify(r)}\n`).join('');
  fs.writeFileSync(sourcePath, bytes);
  return { root, records, sourcePath, bytes, output: path.join(root, 'output') };
}

test('C2/C3 physical cutoff is stable after append; resumed and full results are identical', (t) => {
  const f = fixture(t);
  const pin = pinCvdPrefix(f.sourcePath, 2);
  const first = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 2, root: f.output, chunkSize: 1 });
  const initialArtifact = fs.readFileSync(first.file);
  fs.appendFileSync(f.sourcePath, '{"unfinished":');
  verifyCvdPrefix(pin);
  const repeated = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 2, root: f.output, resumePath: first.file });
  assert.equal(repeated.processedRecords, 0);
  assert.equal(repeated.file, first.file);
  assert.deepEqual(fs.readFileSync(first.file), initialArtifact);
  const resumed = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output, resumePath: first.file, chunkSize: 1 });
  const full = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output, chunkSize: 4 });
  assert.equal(resumed.processedRecords, 2);
  assert.equal(resumed.artifact.checkpoint.state.ordinal, 4);
  assert.deepEqual(resumed.artifact.semantic, full.artifact.semantic);
  assert.deepEqual(resumed.artifact.checkpoint, full.artifact.checkpoint);
  assert.equal(resumed.artifact.semanticHash, full.artifact.semanticHash);
});

test('C2 changed prefix, replaced source, truncated prefix and incomplete record fail closed', (t) => {
  const f = fixture(t);
  const pin = pinCvdPrefix(f.sourcePath, 2);
  fs.writeFileSync(f.sourcePath, f.bytes.replace('09:00:00', '09:00:01'));
  assert.throws(() => verifyCvdPrefix(pin), /CVD_PREFIX_HASH_MISMATCH/);
  fs.writeFileSync(f.sourcePath, f.bytes.slice(0, 10));
  assert.throws(() => verifyCvdPrefix(pin), /CVD_SOURCE_TRUNCATED/);
  assert.throws(() => pinCvdPrefix(f.sourcePath, 1), /CVD_COMPLETE_PREFIX_UNAVAILABLE/);
  fs.renameSync(f.sourcePath, path.join(f.root, 'old.jsonl'));
  fs.writeFileSync(f.sourcePath, f.bytes);
  assert.throws(() => verifyCvdPrefix(pin), /CVD_SOURCE_REPLACED/);
});

test('C3 resume rejects different source, modified physical prefix and lower cutoff', (t) => {
  const f = fixture(t);
  const first = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 2, root: f.output });
  const copy = path.join(f.root, 'copy.jsonl');
  fs.copyFileSync(f.sourcePath, copy);
  assert.throws(() => runCvdOffline({ sourcePath: copy, cutoffOrdinal: 4, root: f.output, resumePath: first.file }), /CVD_RESUME_PREFIX_MISMATCH/);
  assert.throws(() => runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 1, root: f.output, resumePath: first.file }), /CVD_RESUME_PREFIX_MISMATCH/);
  fs.writeFileSync(f.sourcePath, f.bytes.replace('09:00:00', '09:00:01'));
  assert.throws(() => runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output, resumePath: first.file }), /CVD_RESUME_PREFIX_MISMATCH/);
});

test('C6 immutable publication detects conflicting bytes and preserves existing artifact', (t) => {
  const f = fixture(t);
  const result = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output });
  const before = fs.readFileSync(result.file);
  assert.throws(() => publishCvdArtifact(f.output, { ...result.artifact, semantic: { changed: true } }), /CVD_IMMUTABLE_CONFLICT/);
  assert.deepEqual(fs.readFileSync(result.file), before);
  assert.equal(fs.readdirSync(f.output).filter((x) => x.endsWith('.tmp')).length, 0);
});

test('C6 real child processes publish equivalent artifact concurrently', async (t) => {
  const f = fixture(t);
  const result = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output });
  const target = path.join(f.root, 'concurrent');
  const moduleUrl = new URL('../src/cvd-offline-io.mjs', import.meta.url).href;
  const code = `import fs from 'node:fs'; import { publishCvdArtifact } from ${JSON.stringify(moduleUrl)}; const artifact=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); publishCvdArtifact(process.argv[2], artifact);`;
  const child = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, result.file, target], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    p.stderr.on('data', (x) => { errors += x; });
    p.on('error', reject);
    p.on('exit', (exit) => exit === 0 ? resolve() : reject(new Error(errors || `child exit ${exit}`)));
  });
  await Promise.all([child(), child()]);
  assert.deepEqual(fs.readdirSync(target), [path.basename(result.file)]);
  assert.deepEqual(fs.readFileSync(path.join(target, path.basename(result.file))), fs.readFileSync(result.file));
});

test('C6 write/fsync/link and error-sink faults leave old artifact intact', (t) => {
  const f = fixture(t);
  const result = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output });
  const before = fs.readFileSync(result.file);
  for (const operation of ['writeFileSync', 'fsyncSync', 'linkSync']) {
    const io = { ...fs, [operation]: () => { throw Object.assign(new Error('injected'), { code: 'EIO' }); } };
    assert.throws(() => publishCvdArtifact(f.output, result.artifact, { io }), /injected/);
    assert.deepEqual(fs.readFileSync(result.file), before);
    assert.equal(fs.readdirSync(f.output).filter((x) => x.endsWith('.tmp')).length, 0);
  }
  assert.equal(preserveCvdError(f.output, new Error('private source details'), {
    io: { ...fs, writeFileSync: () => { throw new Error('error sink failed'); } },
  }), false);
  assert.deepEqual(fs.readFileSync(result.file), before);
  assert.equal(preserveCvdError(f.output, new Error('private source details')), true);
  const incident = fs.readdirSync(f.output).find((x) => x.startsWith('incident-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.output, incident))).code, 'CVD_OPERATION_FAILED');
});

test('C3 persisted checksum/schema/JSON corruption rejects resume and preserves valid bytes', (t) => {
  const f = fixture(t);
  const result = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output });
  const before = fs.readFileSync(result.file);
  const corrupt = path.join(f.output, 'corrupt.json');
  const modified = structuredClone(result.artifact);
  modified.checkpoint.state.ordinal = 0;
  const schema = structuredClone(result.artifact);
  schema.checkpoint.state.schemaVersion = 'wrong';
  for (const bytes of [JSON.stringify(modified), JSON.stringify(schema), '{']) {
    fs.writeFileSync(corrupt, bytes);
    assert.throws(() => runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output, resumePath: corrupt }));
    assert.deepEqual(fs.readFileSync(result.file), before);
  }
});

test('C6 publication rejects filename traversal before creating a file', (t) => {
  const f = fixture(t);
  const result = runCvdOffline({ sourcePath: f.sourcePath, cutoffOrdinal: 4, root: f.output });
  const before = fs.readdirSync(f.output).sort();
  for (const semanticHash of ['../escape', '../../escape', '', 'A'.repeat(64)]) {
    assert.throws(() => publishCvdArtifact(f.output, { ...result.artifact, semanticHash }), /CVD_ARTIFACT_ID_INVALID/);
  }
  assert.deepEqual(fs.readdirSync(f.output).sort(), before);
  assert.equal(fs.existsSync(path.resolve(f.output, '../escape.json')), false);
});
