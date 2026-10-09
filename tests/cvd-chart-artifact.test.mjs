import { needsIsolatedTest, runIsolatedTest } from './isolated-git-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REPO, PRIVATE_ROOT, BRANCH } from '../src/cvd-observation-isolation.mjs';
import { materializeCvdBatch } from '../src/cvd-observation-materializer.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY, stableJson, digest } from '../src/cvd-observation-core.mjs';
import { prepareCvdChart, loadCvdChart } from '../src/cvd-chart-artifact.mjs';

const bootstrap = needsIsolatedTest(REPO, BRANCH, 'cvd-chart-artifact.test.mjs');
if (bootstrap) {
  test('synthetic cases exercise real guards in an independent worktree', () => {
    runIsolatedTest(REPO, BRANCH, 'cvd-chart-artifact.test.mjs');
  });
} else {
  test('real isolated artifact: same-prefix price context, load parity, raw corruption, atomic failure/retry, integrity refusal', () => {
    const runId = `chart-test-${crypto.randomUUID()}`; const dir = path.join(PRIVATE_ROOT, 'fixtures'); fs.mkdirSync(dir, { recursive: true });
    const sourcePath = path.join(dir, `${runId}.ndjson`); let previousHash = 'GENESIS';
    const rows = [0, 1, 2].map(i => {
      const stamp = `2026-09-14T09:00:0${i}+08:00`;
      const r = buildLiveEventRecord({ code: 'TXFI6', kind: 'futures_tick', receivedAt: stamp, ...SAFETY,
        payload: { _product_family: 'TX', _target_code: 'TXFI6', actualContract: 'TXFI6', productFamily: 'TX', tradeDate: '2026-09-14', session: 'DAY', datetime: stamp, eventTime: stamp, close: 100 + i, volume: 2, tick_type: i === 1 ? 2 : 1 } }, previousHash);
      previousHash = r.recordHash; return r;
    });
    const bytes = rows.map(r => stableJson(r) + '\n').join(''); fs.writeFileSync(sourcePath, bytes);
    const { generation } = materializeCvdBatch({ sourcePath, runId });
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => { if (typeof file === 'number') { originalWrite(file, '{'); throw Error('INJECTED_PARTIAL_WRITE'); } return originalWrite(file, ...args); };
    try { assert.throws(() => prepareCvdChart(runId), /INJECTED_PARTIAL_WRITE/); } finally { fs.writeFileSync = originalWrite; }
    const receipt = prepareCvdChart(runId), frames = loadCvdChart(receipt.bundleHash);
    assert.equal(receipt.priceBars, 1); assert.equal(frames['1m'].currentCvd, generation.result.semantic.value);
    assert.equal(frames['4h'].currentCvd, frames['1m'].currentCvd);
    fs.writeFileSync(sourcePath, bytes.replace('100', '999'));
    assert.throws(() => prepareCvdChart(runId), /PREFIX_MISMATCH/);
    // Loading a prepared projection must not revisit even a changed raw source.
    assert.equal(loadCvdChart(receipt.bundleHash)['1m'].currentCvd, generation.result.semantic.value);
    fs.writeFileSync(sourcePath, bytes);
    const artifact = path.join(PRIVATE_ROOT, 'chart', `${receipt.bundleHash}.json`), before = fs.readFileSync(artifact);
    fs.writeFileSync(artifact, '{}'); assert.throws(() => loadCvdChart(receipt.bundleHash), /BUNDLE_INVALID/); fs.writeFileSync(artifact, before);
    const pointer = path.join(PRIVATE_ROOT, 'output', runId, 'latest.json'), oldPointer = fs.readFileSync(pointer);
    fs.writeFileSync(pointer, '{}'); assert.throws(() => loadCvdChart(receipt.bundleHash), /POINTER_INVALID/); fs.writeFileSync(pointer, oldPointer);
    // Isolated synthetic generation only: exercise budget before any raw read.
    const altered = structuredClone(generation); altered.endByteOffset = 64 * 1024 * 1024 + 1;
    const { generationHash: discarded, ...alteredBody } = altered;
    altered.generationHash = digest(stableJson(alteredBody));
    fs.writeFileSync(path.join(PRIVATE_ROOT, 'output', runId, `${altered.generationHash}.json`), stableJson(altered));
    const nextPointer = JSON.parse(oldPointer); nextPointer.generationHash = altered.generationHash;
    fs.writeFileSync(pointer, JSON.stringify(nextPointer));
    assert.throws(() => prepareCvdChart(runId), /PREFIX_BUDGET/);
    assert.throws(() => loadCvdChart(receipt.bundleHash), /GENERATION_CHANGED/);
    fs.writeFileSync(pointer, oldPointer);
    assert.throws(() => loadCvdChart('../unsafe'), /BUNDLE_ID_INVALID/);
  });
}
