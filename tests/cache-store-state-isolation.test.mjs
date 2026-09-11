import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CacheStore } from '../src/cache-store.mjs';

test('CacheStore reads governed source and writes only isolated state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-isolation-'));
  const source = path.join(root, 'source');
  const state = path.join(root, 'state');
  fs.mkdirSync(path.join(source, 'history'), { recursive: true });
  const original = { asOfDate: '2026-09-10', source: true };
  fs.writeFileSync(path.join(source, 'latest.json'), JSON.stringify(original));
  fs.writeFileSync(path.join(source, 'history', '2026-09-10.json'), JSON.stringify(original));
  const store = new CacheStore({
    dataDir: source,
    historyDir: path.join(source, 'history'),
    stateDir: state,
    stateHistoryDir: path.join(state, 'history'),
  });
  await store.init();
  assert.deepEqual(await store.loadLatest(), original);
  const refreshed = { asOfDate: '2026-09-11', source: false };
  await store.save(refreshed);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'latest.json'), 'utf8')), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'latest.json'), 'utf8')), refreshed);
  assert.deepEqual((await store.listHistory(2)).map((row) => row.asOfDate), ['2026-09-11', '2026-09-10']);
  fs.rmSync(root, { recursive: true, force: true });
});
