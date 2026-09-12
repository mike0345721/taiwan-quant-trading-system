import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadFlowRefresh } from '../src/dashboard-flow-refresh.mjs';
import { loadDashboardObservedFlow } from '../src/dashboard-observed-flow.mjs';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { cru34LiveCanonicalJson } from '../src/cru34-live-checkpoint.mjs';
import { V2ResearchService } from '../src/v2-research.mjs';

const now = new Date('2026-09-07T01:05:35Z');
const safety = { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
const head = '55e78c1c94b45afb94ad9c528e398efd253a7f1d';
const keys = ['primary60s', 'context300s', 'window900s', 'window1800s', 'window3600s', 'window14400s'];

// Same hash-chained input factory as cru34-live-projection.test; no live artifact is read.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-flow-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledgerPath = path.join(root, 'ledger.ndjson');
  const snapshotPath = path.join(root, 'latest.json');
  let previousHash = 'GENESIS';
  const records = [];
  for (let second = 0; second <= 330; second += 30) {
    const at = new Date(Date.parse('2026-09-07T01:00:00Z') + second * 1000).toISOString();
    for (const kind of ['futures_bidask', 'futures_tick']) {
      const body = { schemaVersion: '1.0.0', provider: 'shioaji', code: 'TXFI6', product: 'TXFI6',
        receivedAt: at, exchangeTimestamp: at, sequence: null, eventId: crypto.randomUUID(),
        duplicate: false, sequenceGap: 0, clockSkewMs: 0, ...safety, kind,
        payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', tradeDate: '2026-09-07',
          session: 'DAY', datetime: at, eventTime: at, simtrade: false, bid_price: [99], ask_price: [100],
          close: 100, price: 100, volume: 2, executedVolume: 2, tick_type: 1 }, previousHash };
      previousHash = crypto.createHash('sha256').update(`${previousHash}\n${cru34LiveCanonicalJson(body)}`).digest('hex');
      records.push({ ...body, recordHash: previousHash });
    }
  }
  fs.writeFileSync(ledgerPath, records.map(JSON.stringify).join('\n') + '\n');
  projectCru34LiveBatch({ ledgerPath, snapshotPath, checkpointPath: path.join(root, 'checkpoint.json'),
    instrumentProfile: { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 },
    maxBatchBytes: 1024 * 1024, maxBatchRecords: 1000, staleAfterMs: 30_000, now });
  const options = { runtimeCommit: head, dataRoot: root, projectionRoot: root,
    liveSnapshotPath: snapshotPath, liveStatusPath: path.join(root, 'status.json'), now };
  const status = { schemaVersion: 'cru34-live-worker-status-v1', status: 'AVAILABLE', observedAt: now.toISOString(),
    snapshotPath, statusPath: options.liveStatusPath, dataRoot: root, projectionRoot: root,
    pid: process.pid, workerInstanceId: crypto.randomUUID(), ...safety };
  const lock = { pid: status.pid, workerInstanceId: status.workerInstanceId, dataRoot: root, projectionRoot: root };
  const save = () => {
    fs.writeFileSync(options.liveStatusPath, JSON.stringify(status));
    fs.writeFileSync(path.join(root, 'worker.lock'), JSON.stringify(lock));
  };
  save();
  return { root, options, status, lock, save, ledgerPath };
}

test('Flow delivery retains all six adapter windows and frozen semantics without reading raw ledger', (t) => {
  const f = fixture(t);
  const expected = loadDashboardObservedFlow(f.options);
  assert.equal(expected.sourceState, 'LIVE');
  // Remove the input after producing the bounded artifact: route cannot rescan it.
  fs.unlinkSync(f.ledgerPath);
  const actual = loadFlowRefresh(f.options);
  const { delivery, ...semantic } = actual;
  assert.deepEqual(semantic, expected);
  for (const key of keys) {
    assert.deepEqual(actual.windows[key], expected.windows[key]);
    assert.equal(Object.isFrozen(actual.windows[key]), true);
  }
  assert.deepEqual(delivery, { runtimeCommit: head, servedAt: now.toISOString(), workerInstanceId: f.status.workerInstanceId });
  assert.equal(JSON.stringify(actual).includes(f.root), false);
});

for (const [name, mutate, reason] of [
  ['missing status', (f) => fs.unlinkSync(f.options.liveStatusPath), 'LIVE_PRODUCER_STATUS_NOT_AVAILABLE'],
  ['missing lock', (f) => fs.unlinkSync(path.join(f.root, 'worker.lock')), 'LIVE_PRODUCER_INSTANCE_MISMATCH'],
  ['dead process', (f) => { f.status.pid = f.lock.pid = 2147483647; f.save(); }, 'LIVE_PRODUCER_PROCESS_MISSING'],
  ['wrong path', (f) => { f.status.dataRoot += '-wrong'; f.save(); }, 'LIVE_PRODUCER_PATH_MISMATCH'],
  ['wrong instance', (f) => { f.lock.workerInstanceId = crypto.randomUUID(); f.save(); }, 'LIVE_PRODUCER_INSTANCE_MISMATCH'],
  ['stale heartbeat', (f) => { f.status.observedAt = new Date(now.getTime() - 15001).toISOString(); f.save(); }, 'LIVE_PRODUCER_HEARTBEAT_STALE'],
  ['unsafe boundary', (f) => { f.status.executionAuthorized = true; f.save(); }, 'LIVE_PRODUCER_SAFETY_INVALID'],
  ['oversized status', (f) => fs.writeFileSync(f.options.liveStatusPath, ' '.repeat(65537)), 'LIVE_PRODUCER_STATUS_NOT_AVAILABLE'],
]) test(`Flow fails closed for ${name}`, (t) => {
  const f = fixture(t); mutate(f);
  const actual = loadFlowRefresh(f.options);
  assert.equal(actual.sourceState, 'UNAVAILABLE');
  assert.equal(actual.windows, null);
  assert.ok(actual.unavailableReason.includes(reason));
});

test('expiry uses existing validUntil and adapter stale semantics, without renewing source time', (t) => {
  const f = fixture(t);
  const expired = new Date('2026-09-07T01:06:10Z');
  f.status.observedAt = expired.toISOString(); f.save();
  const options = { ...f.options, now: expired };
  const actual = loadFlowRefresh(options);
  const expected = loadDashboardObservedFlow(options);
  assert.equal(actual.sourceState, 'STALE');
  const { delivery, ...semantic } = actual;
  assert.deepEqual(semantic, expected);
  assert.equal(delivery.servedAt, expired.toISOString());
});

test('V2 paths resolve against appRoot independent of caller cwd; explicit paths and missing report remain truthful', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru49-v2-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/config.mjs', import.meta.url).href;
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  const env = { ...process.env };
  delete env.V2_RESEARCH_DATABASE_PATH; delete env.V2_BACKTEST_REPORT_PATH;
  const run = (overrides) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {config} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify([config.v2DatabasePath,config.v2ReportPath]));`],
      { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  assert.deepEqual(run({}), [path.join(appRoot, 'v2/data/research-v2.sqlite'), path.join(appRoot, 'v2/reports/latest-backtest.json')]);
  assert.deepEqual(run({ V2_RESEARCH_DATABASE_PATH: 'inputs/research.sqlite', V2_BACKTEST_REPORT_PATH: path.join(root, 'missing.json') }),
    [path.join(appRoot, 'inputs/research.sqlite'), path.join(root, 'missing.json')]);
  const service = new V2ResearchService(path.join(root, 'missing.sqlite'), path.join(root, 'missing.json'));
  assert.throws(() => service.query(), (error) => error.statusCode === 503 && error.message === 'V2_DATABASE_NOT_READY');
  assert.throws(() => service.backtestReport(), (error) => error.statusCode === 503 && error.message === 'V2_BACKTEST_NOT_READY');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok((server.match(/v2Research\.decisionSupport\(\)/g) || []).length >= 2);
  const source = fs.readFileSync(new URL('../src/v2-research.mjs', import.meta.url), 'utf8');
  assert.match(source, /readOnly: true/); assert.match(source, /PRAGMA query_only = ON/);
});
