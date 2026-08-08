import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const runDir = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02');
const read = (name) => JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8'));

test('T0 Final Gate通過且不開啟研究績效或執行權限', () => {
  const gate = read('T0_DATA_REPLAY_GATE.json');
  assert.equal(gate.status, 'PASS');
  assert.equal(gate.workPackageStatus, 'CLOSED');
  assert.equal(gate.fallbackPolicyImplemented, true);
  assert.equal(gate.fallbackActuallyUsed, false);
  assert.equal(gate.performanceResearchExecuted, false);
  assert.equal(gate.formalWeight, 0);
  assert.equal(gate.researchOnly, true);
  assert.equal(gate.executionAuthorized, false);
  assert.ok(Object.values(gate.gates).every(Boolean));
});

test('7個結算日皆以PP-1指定真實契約完成必要重播', () => {
  const scan = read('T0_SETTLEMENT_CONTRACT_SCAN.json');
  assert.equal(scan.scans.length, 7);
  for (const row of scan.scans) {
    assert.equal(row.eligibilityClass, 'STRICT_PP1_ALIGNED');
    assert.equal(row.actualReplayContractCode, row.selectedResearchContractCode);
    assert.equal(row.replay.requiredThrough1100Complete, true);
    assert.equal(row.replay.researchOnly, true);
    assert.equal(row.replay.executionAuthorized, false);
  }
});

test('Strict與Extended Manifest分離且未夾帶績效欄位', () => {
  const strict = read('T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json');
  const extended = read('T0_EXTENDED_RESEARCH_H0_MANIFEST.json');
  assert.equal(strict.sessionCount, 137);
  assert.equal(extended.sessionCount, 137);
  assert.equal(strict.performanceResearchAuthorized, false);
  assert.equal(extended.performanceResearchAuthorized, false);
  const forbidden = ['netPnl', 'grossPnl', 'profitFactor', 'expectancy', 'winRate'];
  const text = JSON.stringify({ strict, extended });
  for (const key of forbidden) assert.equal(text.includes(`"${key}"`), false);
});

test('Phase A、PP-1與Reconciliation保護Hash全部有效', () => {
  const gate = read('T0_DATA_REPLAY_GATE.json');
  assert.equal(gate.protectedChecks.length, 3);
  assert.ok(gate.protectedChecks.every((row) => row.pass));
});

test('Closeout Manifest明確關閉工作包但不授權H0 Run', () => {
  const closeout = read('T0_CLOSEOUT_MANIFEST.json');
  assert.equal(closeout.t0FinalSpec, 'PASS');
  assert.equal(closeout.t0DataReplayGate, 'PASS');
  assert.equal(closeout.workPackage, 'CLOSED');
  assert.equal(closeout.strictSessionCount, 137);
  assert.equal(closeout.fallbackSessionCount, 0);
  assert.equal(closeout.noSampleSessionCount, 0);
  assert.equal(closeout.strictCoverageRate, 1);
  assert.deepEqual(closeout.testEvidence, { command: 'npm.cmd test', passed: 223, failed: 0 });
  assert.equal(closeout.t0HistoricalH0RunAuthorized, false);
  assert.equal(closeout.executionAuthorized, false);
});
