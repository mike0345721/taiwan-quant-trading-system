import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { buildDailyUseReceipt, writeDailyUseReceipt, readDailyUseReceipt, validateDailyUseReceipt } from '../src/daily-use-acceptance.mjs';
import { readDataOperations } from '../src/dashboard-data-operations.mjs';
import { parseAcceptanceArgs } from '../scripts/run-daily-data-operations-acceptance.mjs';
import { operationsHash } from '../src/daily-data-operations.mjs';

const candidateSha = 'a'.repeat(40), evidenceHash = 'b'.repeat(64), now = new Date('2026-11-06T03:00:00Z');
const base = () => ({ candidateSha, now, tradeDate: '2026-11-06', session: 'DAY',
  evidence: [{ role: 'OBSERVED_ARTIFACT', sha256: evidenceHash }] });
const runtime = () => ({ sha: candidateSha, observedAt: now.toISOString(), processIdentitySha256: evidenceHash,
  executionRootSha256: evidenceHash, dataRootSha256: evidenceHash, configSha256: evidenceHash });
const row = id => ({ id, operationResult: 'PASS', dataStatus: 'AVAILABLE', evidenceKind: 'NORMAL_UI',
  observedAt: now.toISOString(), evidenceSha256: evidenceHash, reasonCodes: ['OBSERVED_NORMAL_OPERATION'] });
const observed = features => ({ schemaVersion: 'daily-use-observations-v1', candidateSha, calendarDate: '2026-11-06',
  tradeDate: '2026-11-06', session: 'DAY', evidencePolicy: 'OBSERVED_FACTS_NOT_RUNTIME_PROOF',
  runtimes: { dashboard: runtime() }, features });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-use-receipt-'));
  const dataRoot = path.join(root, 'data'), outputRoot = path.join(dataRoot, 'quality/daily-data-operations');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { dataRoot, outputRoot, now };
}
test('missing UI evidence stays unverified despite successful scheduler and batch', () => {
  const r = buildDailyUseReceipt({ ...base(), operations: { overallState: 'PASS', acceptanceJobHealth: { jobState: 'SUCCEEDED' } },
    batch: { state: 'completed', startedAt: '2026-11-06T00:30:00Z', completedAt: '2026-11-06T00:35:00Z' } });
  assert.equal(r.overall, 'UNAVAILABLE'); assert.equal(r.dailyBatch.executionResult, 'SUCCEEDED');
  assert.equal(r.dailyBatch.state, 'UNKNOWN'); assert.equal(r.dailyBatch.evidenceKind, 'UNKNOWN');
  assert.ok(r.features.every(f => f.operationResult === 'NOT RUN' && f.dataStatus === 'UNKNOWN'));
  assert.ok(Object.values(r.runtimes).every(r => r.sha === 'UNKNOWN'));
  assert.equal(r.tradeDate, '2026-11-06'); assert.equal(r.timezone, 'Asia/Taipei');
});
test('today failure and older success cannot claim today complete; errors are allowlisted', () => {
  const r = buildDailyUseReceipt({ ...base(), batch: { state: 'failed', startedAt: '2026-11-06T00:30:01Z', completedAt: '2026-11-06T00:35:00Z',
    fatalError: 'secret account string', gateSummary: { reasons: ['QUALITY_DEBT'] },
    stages: [{ key: 'taifex', ok: true, error: 'secret-path' }] } });
  assert.equal(r.dailyBatch.state, 'JOB_FAILED'); assert.equal(r.dailyBatch.stages[0].ok, true);
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.equal(buildDailyUseReceipt({ ...base(), batch: { state: 'completed', startedAt: '2026-11-05T13:15:00Z' } }).dailyBatch.state, 'UNKNOWN');
});

test('terminal batch evidence requires a completed timestamp inside its observed timeline', () => {
  for (const state of ['completed', 'completed_with_warnings', 'failed']) {
    for (const completedAt of [null, '2026-11-06T04:00:00Z', '2026-11-06T00:29:00Z']) {
      const r = buildDailyUseReceipt({ ...base(), batch: { state, startedAt: '2026-11-06T00:30:00Z', completedAt } });
      assert.equal(r.dailyBatch.executionResult, 'UNKNOWN', `${state}:${completedAt}`);
      assert.equal(r.dailyBatch.state, 'UNKNOWN');
      assert.equal(r.dailyBatch.diagnostics, null);
      assert.ok(r.dailyBatch.reasonCodes.includes('BATCH_TIMELINE_INVALID'));
    }
  }
  const running = buildDailyUseReceipt({ ...base(), batch: { state: 'running', startedAt: '2026-11-06T00:30:00Z', completedAt: null } });
  assert.equal(running.dailyBatch.executionResult, 'RUNNING');
  const impossible = buildDailyUseReceipt({ ...base(), batch: { state: 'running', startedAt: '2026-11-06T00:30:00Z', completedAt: '2026-11-06T00:35:00Z' } });
  assert.equal(impossible.dailyBatch.executionResult, 'UNKNOWN');
});

test('reader rejects a different valid receipt stored under the pointer hash', t => {
  const f = fixture(t), receipt = buildDailyUseReceipt(base());
  const saved = writeDailyUseReceipt({ ...f, receipt });
  const other = buildDailyUseReceipt({ ...base(), candidateSha: 'c'.repeat(40) });
  assert.equal(other.observedAt, receipt.observedAt);
  assert.notEqual(other.receiptHash, receipt.receiptHash);
  fs.writeFileSync(saved.file, JSON.stringify(other));
  assert.equal(readDailyUseReceipt(f).reason, 'RECEIPT_UNVERIFIED');
});

test('batch diagnostics separate historical debt from an unassessed requested date without promoting availability', () => {
  const batch = { state: 'failed', startedAt: '2026-11-06T00:30:01Z', completedAt: '2026-11-06T00:35:41Z',
    stages: [{ key: 'quality', ok: false }, { key: 'data_continuity_audit', ok: false }],
    gateSummary: { marketDaily: { tradeDate: '2026-11-06', status: 'MISSING' }, reasons: ['QUALITY_DEBT'] } };
  const quality = { generatedAt: '2026-11-06T00:34:34Z', last_date: '2026-11-05', issues: { error: 1 },
    byRule: [{ severity: 'error', rule_code: 'INSTITUTIONAL_OI_ARITHMETIC_MISMATCH', count: 1 }],
    institutionalFuturesOiConsistency: { mismatchDates: [{ trade_date: '2026-10-16', internal_mismatch: 1 }] },
    sampleIssues: [{ message: 'secret text' }] };
  const continuity = { generatedAt: '2026-11-06T00:35:40Z', liveEventLedger: {
    status: 'AUDIT_INCOMPLETE', missingDays: ['2026-10-28'], incompleteDays: [], unresolvedDays: ['2026-09-02'],
    auditTelemetry: { policy: 'COMPLETED_TRADING_DATES_ONLY_EARLY_EXIT_OR_FAIL_CLOSED_BOUND' } } };
  const r = buildDailyUseReceipt({ ...base(), batch, auditReports: { quality, continuity } });
  assert.equal(r.dailyBatch.diagnostics.quality.requestedDateAssessment, 'NOT_ASSESSED');
  assert.equal(r.dailyBatch.diagnostics.quality.listedHistoricalErrorCount, 1);
  assert.equal(r.dailyBatch.diagnostics.quality.errorAttribution, 'COMPLETE');
  assert.equal(r.dailyBatch.diagnostics.continuity.requestedDateAssessment, 'OUTSIDE_COMPLETED_DATE_SCOPE');
  assert.equal(r.dailyBatch.state, 'JOB_FAILED'); assert.equal(r.overall, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(r).includes('secret text'));
  const context = {};
  vm.runInNewContext(fs.readFileSync(new URL('../public/data-operations.js', import.meta.url), 'utf8'), context);
  const html = context.DataOperations.render({ dailyUse: r });
  for (const text of ['每日批次原因', '2026-11-05', '2026-10-28', '2026-09-02', '尚無當日資料可評估', '不在本次已完成交易日稽核範圍']) assert.ok(html.includes(text));
  const stale = buildDailyUseReceipt({ ...base(), batch, auditReports: { quality: { ...quality, generatedAt: '2026-11-05T00:34:34Z' } } });
  assert.equal(stale.dailyBatch.diagnostics.quality.evidenceState, 'UNVERIFIED');
  const partial = buildDailyUseReceipt({ ...base(), batch, auditReports: { quality: { ...quality, issues: { error: 2 } } } });
  assert.equal(partial.dailyBatch.diagnostics.quality.errorAttribution, 'PARTIAL');
});
test('historical/synthetic success is engineering only, never live UI', () => {
  for (const kind of ['SYNTHETIC', 'REPLAY', 'MANUAL']) {
    const r = buildDailyUseReceipt({ ...base(), observations: observed([{ ...row('price'), evidenceKind: kind }]) });
    const price = r.features.find(f => f.id === 'price');
    assert.equal(price.engineeringResult, 'PASS'); assert.equal(price.operationResult, 'NOT RUN');
    assert.equal(price.dataStatus, 'UNKNOWN'); assert.equal(r.overall, 'UNAVAILABLE');
  }
});
test('price remains partially usable when research module is limited; no wholesale promotion', () => {
  const r = buildDailyUseReceipt({ ...base(), observations: observed(['entry', 'login', 'price'].map(row)) });
  assert.equal(r.overall, 'PARTIAL'); assert.equal(r.features.find(f => f.id === 'cvd').operationResult, 'NOT RUN');
});
test('running version pairing is required, disk candidate cannot stand in for producer/writer', () => {
  const observations = observed(['entry', 'login', 'liveChain', 'dailyChain'].map(row));
  const r = buildDailyUseReceipt({ ...base(), observations });
  for (const id of ['liveChain', 'dailyChain']) assert.equal(r.features.find(f => f.id === id).operationResult, 'BLOCKED');
  observations.runtimes.dashboard.sha = 'c'.repeat(40);
  assert.equal(buildDailyUseReceipt({ ...base(), observations }).features[0].operationResult, 'BLOCKED');
});
test('wrong day/version/session, future timestamps, duplicate and unbound evidence are rejected', () => {
  for (const patch of [{ candidateSha: 'c'.repeat(40) }, { calendarDate: '2026-11-05' }, { session: 'NIGHT' }])
    assert.throws(() => buildDailyUseReceipt({ ...base(), observations: { ...observed([]), ...patch } }), /IDENTITY/);
  for (const patch of [{ observedAt: '2026-11-07T00:00:00Z' }, { evidenceSha256: 'f'.repeat(64) },
    { availableAt: '2026-11-06T04:00:00Z' }])
    assert.throws(() => buildDailyUseReceipt({ ...base(), observations: observed([{ ...row('price'), ...patch }]) }));
  assert.throws(() => buildDailyUseReceipt({ ...base(), observations: observed([row('price'), row('price')]) }), /FEATURES/);
});
test('immutable receipt survives reader reload, rejects tampering, does not overwrite history or advance on older evidence', t => {
  const f = fixture(t), receipt = buildDailyUseReceipt(base());
  const saved = writeDailyUseReceipt({ ...f, receipt }), original = fs.readFileSync(saved.file);
  writeDailyUseReceipt({ ...f, receipt });
  assert.deepEqual(readDailyUseReceipt(f), receipt);
  assert.equal(readDataOperations(f).dailyUse.receiptHash, receipt.receiptHash);
  writeDailyUseReceipt({ ...f, receipt: buildDailyUseReceipt({ ...base(), now: new Date('2026-11-06T02:00:00Z') }) });
  assert.deepEqual(fs.readFileSync(saved.file), original); assert.equal(readDailyUseReceipt(f).receiptHash, receipt.receiptHash);
  assert.equal(readDailyUseReceipt({ ...f, now: new Date('2026-11-07T03:00:00Z') }), null);
  fs.writeFileSync(saved.file, original.toString().replace('UNAVAILABLE', 'AVAILABLE'));
  assert.equal(readDailyUseReceipt(f).reason, 'RECEIPT_UNVERIFIED');
  assert.throws(() => validateDailyUseReceipt({ ...receipt, overall: 'AVAILABLE' }), /INVALID/);
});
test('UI separates engineering from current data and warns when no daily receipt exists', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(new URL('../public/data-operations.js', import.meta.url), 'utf8'), context);
  assert.match(context.DataOperations.render({}), /尚無今天可核對/);
  const html = context.DataOperations.render({ dailyUse: buildDailyUseReceipt(base()) });
  for (const text of ['工程結果', '當日操作', '當日資料狀態', '未啟用自動排程', 'REBOOT_NOT_RUN']) assert.ok(html.includes(text));
});
test('explicit daily readonly runner arguments do not replace scheduled defaults', () => {
  assert.deepEqual(parseAcceptanceArgs(['--daily-use=true', `--candidate-sha=${candidateSha}`]), { dailyUse: 'true', candidateSha });
  assert.throws(() => parseAcceptanceArgs(['--daily-use=true', '--daily-use=false']));
});
test('a rehashed malformed receipt cannot escape its dated directory or crash the table', () => {
  for (const mutate of [r => { r.calendarDate = '../../outside'; }, r => { r.features[0].reasonCodes = null; },
    r => { r.scope = 'FORMAL'; }, r => { r.features[0].label = '<secret>'; }]) {
    const { receiptHash, ...body } = buildDailyUseReceipt(base()); mutate(body);
    assert.throws(() => validateDailyUseReceipt({ ...body, receiptHash: operationsHash(body) }));
  }
});
