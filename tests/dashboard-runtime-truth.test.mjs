import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readDashboardRuntimeTruth } from '../src/dashboard-runtime-truth.mjs';
import { createOwnerLaunchApprovalArtifact, createReadyForLaunchManifest, stableJson } from '../src/market-state-forward-shadow.mjs';

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

test('runtime truth exposes official MISSED explanation and keeps current scheduler separate from historical evidence', async () => {
  fs.rmSync(root, { recursive: true, force: true });
  const runRoot = path.join(root, 'governed-run');
  fs.mkdirSync(path.join(runRoot, 'daily-status'), { recursive: true });
  const manifest = createReadyForLaunchManifest({
    // Manifest metadata is synthetic; fixtures are read from the test's temporary root.
    runId: 'governed-run', runtimeRoot: 'D:\\test-fixtures\\governed-run',
    secondaryBackupRoot: 'D:\\backup', officialStartTradeDate: '2026-08-11', finalMainCommit: 'a'.repeat(40),
    schedulerTime: '08:25 Asia/Taipei', outcomeSchedulerTime: '14:00 Asia/Taipei',
    selectedAxes: ['direction', 'globalAlignment'], formalWeight: 0, researchOnly: true, executionAuthorized: false,
    evaluator: { version: 'v1', sha256: '1'.repeat(64) }, outcomeContract: { version: 'v1', sha256: '2'.repeat(64) }, linkageContract: { version: 'v1', sha256: '3'.repeat(64) },
    frozenForwardGate: { version: 'v1', sha256: '4'.repeat(64) }, tradingCalendar: { version: 'v1', sha256: '5'.repeat(64) },
  });
  const approval = createOwnerLaunchApprovalArtifact({
    ownerDecisionReference: 'OWNER-TEST', approvedAt: '2026-08-10T00:00:00.000Z',
    manifestHash: manifest.manifestHash, finalMainCommit: manifest.finalMainCommit, officialStartTradeDate: manifest.officialStartTradeDate,
    schedulerTime: manifest.schedulerTime, outcomeSchedulerTime: manifest.outcomeSchedulerTime,
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  });
  fs.writeFileSync(path.join(runRoot, 'launch-manifest.json'), stableJson(manifest));
  fs.writeFileSync(path.join(runRoot, 'owner-launch-approval.json'), stableJson(approval));
  fs.writeFileSync(path.join(runRoot, 'official-ledger.ndjson'), `${JSON.stringify({ recordType: 'SESSION_STATUS', qualityStatus: 'MISSED', tradeDate: '2026-08-12', sessionId: '2026-08-12-DAY', scheduledAt: '2026-08-12T08:25:00+08:00', recordedAt: '2026-08-12T00:27:15.177Z', missedReason: 'NO_LEGAL_PREMARKET_SNAPSHOT' })}\n`);
  fs.writeFileSync(path.join(runRoot, 'daily-status', '2026-08-12-state.json'), JSON.stringify({ tradeDate: '2026-08-12', lifecycle: ['PRECHECK', 'TRADING_DAY_CHECK', 'INPUT_AVAILABILITY_CHECK', 'APPEND_SESSION_STATUS'] }));

  const truth = await readDashboardRuntimeTruth({
    baseRoot: root,
    now: new Date('2026-08-13T00:00:00.000Z'),
    taskQuery: async () => ({ exists: false, enabled: false }),
  });
  assert.equal(truth.statusExplanation.status, 'MISSED');
  assert.equal(truth.statusExplanation.reasonCode, 'NO_LEGAL_PREMARKET_SNAPSHOT');
  assert.equal(truth.statusExplanation.failedStage, 'INPUT_AVAILABILITY_CHECK');
  assert.equal(truth.statusExplanation.schedulerReadiness.historicalStateAtTradeDate, 'UNKNOWN');
});
