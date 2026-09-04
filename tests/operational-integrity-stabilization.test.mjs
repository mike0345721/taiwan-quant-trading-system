import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildContinuityReport } from '../src/data-continuity.mjs';
import { readBoundedLiveCoverage, scanLiveCoverageFile } from '../src/data-continuity-audit.mjs';
import { buildDailyUpdateGateSummary } from '../src/daily-update-gates.mjs';
import { classifyChildExit, finalizePendingDailyStatus, parseScheduledTaskLifetime } from '../src/forward-lifecycle-observability.mjs';

const root = path.resolve('.');
const temp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('P0 observer exposes one injected runtime root for ledger and daily status with no canonical fallback', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/run-p0-forward-paper-observer.mjs'), 'utf8');
  assert.match(source, /--runtime-root/);
  assert.match(source, /path\.join\(runtimeRoot, 'PAPER_TRADING_EVENT_LEDGER\.jsonl'\)/);
  assert.match(source, /path\.join\(runtimeRoot, 'daily'\)/);
  assert.doesNotMatch(source, /const statusDir = path\.join\(root, 'data\/paper\/p0-forward\/daily'\)/);
});

test('observed child runner writes heartbeats and propagates expected and unexpected exits', () => {
  for (const exitCode of [0, 7]) {
    const dir = temp('forward-lifecycle-');
    const child = path.join(dir, `child-${exitCode}.mjs`);
    const status = path.join(dir, 'status.json');
    const log = path.join(dir, 'child.log');
    fs.writeFileSync(child, `await new Promise((resolve)=>setTimeout(resolve,80)); console.log('child'); process.exitCode=${exitCode};\n`);
    const run = spawnSync(process.execPath, [
      'scripts/run-observed-forward-child.mjs', '--name', 'TEST_OBSERVER', '--script', child,
      '--status', status, '--log', log, '--expected-trade-date', '2026-08-14', '--heartbeat-ms', '20',
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, exitCode);
    const result = JSON.parse(fs.readFileSync(status, 'utf8'));
    assert.equal(result.processExitCode, exitCode);
    assert.equal(result.exitReason, exitCode === 0 ? 'EXPECTED_CHILD_EXIT' : 'UNEXPECTED_CHILD_EXIT');
    assert.equal(result.expectedTradeDate, '2026-08-14');
    assert.equal(result.lastLifecycleStage, 'WRAPPER_EXITED');
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.orderRoutesEnabled, false);
    assert.ok(Date.parse(result.lastHeartbeatAt) >= Date.parse(result.observerStartedAt));
  }
});

test('unknown exit reason stays unknown and scheduler parser does not infer LastResult cause without history', () => {
  assert.equal(classifyChildExit({ code: null, signal: null }), 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  const task = parseScheduledTaskLifetime({
    enabled: true, state: 'Ready', runAs: 'MSI\\user', lastResult: 0xC000013A,
    historyAvailable: false,
    action: { executable: 'powershell.exe', arguments: '-File wrapper.ps1', workingDirectory: 'D:\\Taiwan stock\\standalone-v1' },
    settings: { executionTimeLimit: 'PT0S', multipleInstances: 'IgnoreNew', stopIfGoingOnBatteries: true },
  });
  assert.equal(task.lastResult, 0xC000013A);
  assert.equal(task.lastResultInterpretation, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  assert.equal(task.multipleInstances, 'IgnoreNew');
});

test('pending daily status becomes an explicit non-reconciled failure when an observed child exits without terminal evidence', () => {
  const dir = temp('forward-daily-terminal-');
  const daily = path.join(dir, '2026-08-14.json');
  fs.writeFileSync(daily, JSON.stringify({
    tradeDate: '2026-08-14', observerStartTime: '2026-08-14T00:35:00.000Z',
    attemptStatus: 'OBSERVER_STARTED', readinessGate: 'PENDING_SESSION_COMPLETION', executionAuthorized: false,
  }));
  const result = finalizePendingDailyStatus({
    filePath: daily,
    expectedTradeDate: '2026-08-14',
    lifecycleStatus: { observerExitCode: 7, observerSignal: null, exitReason: 'UNEXPECTED_CHILD_EXIT', wrapperExitAt: '2026-08-14T05:47:01.000Z' },
  });
  const final = JSON.parse(fs.readFileSync(daily, 'utf8'));
  assert.equal(result.updated, true);
  assert.equal(final.attemptStatus, 'OTHER_FAILURE');
  assert.equal(final.sessionState, 'SESSION_FAILED');
  assert.equal(final.reconciliationStatus, 'NOT_VERIFIED');
  assert.equal(final.reason, 'OBSERVER_EXITED_BEFORE_SESSION_TERMINAL_EVIDENCE');
  assert.equal(final.executionAuthorized, false);
  assert.equal(final.orderRoutesEnabled, false);
});

test('observed child runner finalizes a pending daily status when its child exits unexpectedly', () => {
  const dir = temp('forward-runner-daily-terminal-');
  const child = path.join(dir, 'child.mjs');
  const status = path.join(dir, 'lifecycle.json');
  const daily = path.join(dir, '2026-08-14.json');
  const log = path.join(dir, 'child.log');
  fs.writeFileSync(child, 'process.exitCode = 7;\n');
  fs.writeFileSync(daily, JSON.stringify({
    tradeDate: '2026-08-14', observerStartTime: '2026-08-14T00:35:00.000Z',
    attemptStatus: 'OBSERVER_STARTED', readinessGate: 'PENDING_SESSION_COMPLETION', executionAuthorized: false,
  }));
  const run = spawnSync(process.execPath, [
    'scripts/run-observed-forward-child.mjs', '--name', 'TEST_OBSERVER', '--script', child,
    '--status', status, '--daily-status', daily, '--log', log, '--expected-trade-date', '2026-08-14',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 7);
  assert.equal(JSON.parse(fs.readFileSync(status, 'utf8')).pendingDailyStatusFinalization.updated, true);
  const final = JSON.parse(fs.readFileSync(daily, 'utf8'));
  assert.equal(final.attemptStatus, 'OTHER_FAILURE');
  assert.equal(final.reconciliationStatus, 'NOT_VERIFIED');
});

test('bounded continuity scan early-exits after required products and fails closed when proof exceeds byte bound', async () => {
  const dir = temp('continuity-bounded-');
  const complete = path.join(dir, '2026-08-12.ndjson');
  fs.writeFileSync(complete, [
    JSON.stringify({ kind: 'index_quote', code: 'IX0001' }),
    JSON.stringify({ kind: 'stock_tick', code: '2330' }),
    ...Array.from({ length: 100 }, () => JSON.stringify({ kind: 'futures_tick', code: 'TX' })),
  ].join('\n'));
  const completeResult = await scanLiveCoverageFile(complete, { maxBytes: 4096 });
  assert.equal(completeResult.provenComplete, true);
  assert.equal(completeResult.earlyExit, true);

  const unresolved = path.join(dir, '2026-08-13.ndjson');
  fs.writeFileSync(unresolved, `${JSON.stringify({ kind: 'index_quote', code: 'IX0001' })}\n${'x'.repeat(8192)}\n`);
  const audit = await readBoundedLiveCoverage({ liveEventsDir: dir, expectedDates: ['2026-08-12', '2026-08-13'], maxBytesPerFile: 4096 });
  assert.deepEqual(audit.coverage['2026-08-12'], ['2330', 'IX0001']);
  assert.deepEqual(audit.unresolvedDates, ['2026-08-13']);
  assert.ok(audit.telemetry.bytesScanned <= 4096 * 2);
  const report = buildContinuityReport({
    generatedAt: '2026-08-14T13:00:00.000Z', expectedDates: ['2026-08-12', '2026-08-13'],
    recoverableCoverage: { marketDaily: ['2026-08-12', '2026-08-13'] },
    liveCoverage: audit.coverage, liveCoverageAudit: audit,
  });
  assert.equal(report.liveEventLedger.status, 'AUDIT_INCOMPLETE');
  assert.deepEqual(report.liveEventLedger.unresolvedDays, ['2026-08-13']);
  assert.equal(report.liveEventLedger.completeDays, 1);
});

test('daily update result keeps TAIFEX and market_daily PASS separate from quality and continuity timeout', () => {
  const summary = buildDailyUpdateGateSummary({
    stages: [
      { key: 'taifex', ok: true },
      { key: 'quality', ok: false, error: 'exit_2' },
      { key: 'data_continuity_audit', ok: false, error: 'spawnSync node ETIMEDOUT' },
    ],
    failures: [{ key: 'quality', critical: false }, { key: 'data_continuity_audit', critical: true }],
    marketDaily: { status: 'VALID', tradeDate: '2026-08-14' },
  });
  assert.equal(summary.requiredSource, 'PASS');
  assert.equal(summary.taifex, 'PASS');
  assert.equal(summary.marketDaily.status, 'VALID');
  assert.equal(summary.quality, 'FAIL');
  assert.equal(summary.continuityAudit, 'TIMEOUT');
  assert.equal(summary.overall, 'FAILED');
  assert.deepEqual(summary.reasons, ['QUALITY_DEBT', 'DATA_CONTINUITY_AUDIT_TIMEOUT']);
});

test('wrappers use operational telemetry helper without changing task definitions or Forward evidence', () => {
  const p0 = fs.readFileSync(path.join(root, 'scripts/run-p0-forward-paper-hidden.ps1'), 'utf8');
  const v310 = fs.readFileSync(path.join(root, 'scripts/run-v310-forward-operations-hidden.ps1'), 'utf8');
  assert.match(p0, /run-observed-forward-child\.mjs/);
  assert.match(v310, /run-observed-forward-child\.mjs/);
  assert.match(v310, /--after-script/);
  assert.doesNotMatch(`${p0}\n${v310}`, /Register-ScheduledTask|Set-ScheduledTask|Start-ScheduledTask/);
});
