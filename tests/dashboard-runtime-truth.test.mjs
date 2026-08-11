import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readDashboardRuntimeTruth } from '../src/dashboard-runtime-truth.mjs';

const root = path.resolve('data/decision-workspace/runtime-truth-fixtures');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('runtime truth fails closed when governed artifacts are not exposed', async () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const truth = await readDashboardRuntimeTruth({ baseRoot: root, now: new Date('2026-08-12T00:00:00.000Z') });
  assert.equal(truth.governed, false);
  assert.equal(truth.reason, 'RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD');
  assert.equal(truth.executionAuthorized, false);
});
