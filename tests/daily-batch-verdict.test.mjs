import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyBatchVerdict, requiredSourceState, SOURCE_STAGES, DERIVE_STAGES, AUDIT_STAGES } from '../src/daily-batch-verdict.mjs';
import { buildDailyUpdateGateSummary } from '../src/daily-update-gates.mjs';

const ALL = [...Object.keys(SOURCE_STAGES), ...Object.keys(DERIVE_STAGES), ...Object.keys(AUDIT_STAGES)];
function batch({ fail = {}, stopAfter = null, marketDaily, state = 'failed', startedAt = '2026-11-13T13:15:51.003Z' } = {}) {
  const stages = [];
  for (const key of ALL) {
    stages.push(fail[key] ? { key, ok: false, error: fail[key] } : { key, ok: true });
    if (key === stopAfter) break;
  }
  return { state, startedAt, completedAt: state === 'running' ? null : '2026-11-13T13:43:42.953Z', targetTradeDate: '2026-11-13',
    totalStages: 35, stages, gateSummary: { marketDaily } };
}
const valid = { status: 'VALID', tradeDate: '2026-11-13' };

test('11/13 night: TAIFEX download timed out but the daily bar is stored, history audits fail -> today PARTIAL, exit 0', () => {
  const status = batch({ marketDaily: valid, fail: {
    taifex: 'spawnSync node ETIMEDOUT', twse_gaps: 'spawnSync node ETIMEDOUT', quality: 'exit_2',
    live_event_ledger_audit: 'exit_1', data_continuity_audit: 'exit_2' } });
  const { todayIngestion: today, historicalAudit: history } = buildDailyBatchVerdict(status);
  assert.equal(today.state, 'PARTIAL'); assert.equal(today.exitCode, 0);
  assert.equal(today.dataThroughTradeDate, '2026-11-13');
  assert.deepEqual(today.missing.map(item => item.key), ['taifex', 'twse_gaps']);
  assert.match(today.line, /已入庫到 11\/13/); assert.match(today.line, /期貨日 K 已入庫，其他期交所資料可能不完整/);
  assert.match(today.line, /11\/13 21:15 批次/, 'batch time is Taipei');
  assert.equal(history.state, 'FAIL');
  assert.deepEqual(history.failed.map(item => item.key), ['quality', 'live_event_ledger_audit', 'data_continuity_audit']);
  assert.match(history.line, /門檻沒有放寬/);
  // The release gate itself is untouched by the split.
  const gate = buildDailyUpdateGateSummary({ stages: status.stages, failures: [], marketDaily: valid });
  assert.equal(gate.requiredSource, 'BLOCKED'); assert.ok(gate.reasons.includes('QUALITY_DEBT'));
});

test('08:30 morning batch: today not yet due is not counted missing when the previous trading day is stored', () => {
  const morning = { status: 'MISSING', tradeDate: '2026-11-13', dueState: 'NOT_DUE', reasonCode: 'DAY_SESSION_NOT_ENDED',
    expectedCompletedTradeDate: '2026-11-12', completedDateRow: { tradeDate: '2026-11-12', status: 'PRESENT' } };
  const { todayIngestion: today } = buildDailyBatchVerdict(batch({ marketDaily: morning, state: 'completed', startedAt: '2026-11-13T00:30:55Z' }));
  assert.equal(today.state, 'PASS'); assert.equal(today.exitCode, 0); assert.equal(today.notDue, true);
  assert.equal(today.dataThroughTradeDate, '2026-11-12');
  assert.match(today.line, /已入庫到 11\/12/); assert.match(today.line, /13:45 收盤後才會有今日資料，不算缺漏/);
  // Gate summary keeps reporting the absence exactly as before.
  assert.ok(buildDailyUpdateGateSummary({ stages: [{ key: 'taifex', ok: true }], marketDaily: morning }).reasons.includes('MARKET_DAILY_MISSING'));
  const previousMissing = { ...morning, completedDateRow: { tradeDate: '2026-11-12', status: 'MISSING' } };
  const failed = buildDailyBatchVerdict(batch({ marketDaily: previousMissing, state: 'completed' })).todayIngestion;
  assert.equal(failed.state, 'FAILED'); assert.equal(failed.exitCode, 1); assert.match(failed.line, /11\/12 不在資料庫/);
});

test('after the close a missing daily bar fails today, as does a failed derivation step', () => {
  const missing = { status: 'MISSING', tradeDate: '2026-11-13', dueState: 'UNKNOWN' };
  const a = buildDailyBatchVerdict(batch({ marketDaily: missing, state: 'completed' })).todayIngestion;
  assert.equal(a.state, 'FAILED'); assert.equal(a.exitCode, 1); assert.match(a.line, /11\/13 不在資料庫/);
  const b = buildDailyBatchVerdict(batch({ marketDaily: valid, fail: { features: 'exit_1' }, stopAfter: 'features' })).todayIngestion;
  assert.equal(b.state, 'FAILED'); assert.equal(b.exitCode, 1); assert.match(b.line, /日資料特徵/);
});

test('an early abort marks the untouched steps as not run instead of passing them', () => {
  const v = buildDailyBatchVerdict(batch({ marketDaily: valid, fail: { prepare: 'exit_1' }, stopAfter: 'prepare' }));
  assert.equal(v.todayIngestion.state, 'FAILED');
  assert.ok(v.todayIngestion.missing.every(item => item.notRun));
  assert.equal(v.historicalAudit.state, 'NOT_RUN'); assert.notEqual(v.historicalAudit.state, 'PASS');
});

test('closed market, unknown calendar, running batch and missing file each say what they are', () => {
  const closed = buildDailyBatchVerdict(batch({ marketDaily: { status: 'NOT_EXPECTED', reasonCode: 'MARKET_CLOSED' }, state: 'completed' })).todayIngestion;
  assert.equal(closed.state, 'NOT_EXPECTED'); assert.equal(closed.exitCode, 0); assert.match(closed.line, /休市/);
  const unknown = buildDailyBatchVerdict(batch({ marketDaily: { status: 'UNKNOWN' }, state: 'completed' })).todayIngestion;
  assert.equal(unknown.state, 'UNKNOWN'); assert.equal(unknown.exitCode, 1);
  const running = buildDailyBatchVerdict(batch({ marketDaily: valid, state: 'running', stopAfter: 'taifex' }));
  assert.equal(running.todayIngestion.state, 'RUNNING'); assert.equal(running.historicalAudit.state, 'RUNNING');
  assert.deepEqual(running.todayIngestion.missing, [], 'stages not reached yet are not reported missing while running');
  assert.equal(buildDailyBatchVerdict(null).todayIngestion.state, 'UNKNOWN');
  assert.equal(requiredSourceState(undefined).state, 'UNKNOWN');
});
