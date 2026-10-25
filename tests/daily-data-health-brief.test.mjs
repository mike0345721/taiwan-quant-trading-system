import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { digest } from '../src/market-state-forward-shadow.mjs';
import { buildDailyCollectionAcceptance } from '../src/daily-collection-acceptance.mjs';
import { buildDailyDataOperations } from '../src/daily-data-operations.mjs';
import { buildDailyDataHealthBrief, projectDataOperations, readDataOperations } from '../src/dashboard-data-operations.mjs';

// Synthetic regression cases, not receipts for the historical MSI observations.
const date = '2026-09-29', cutoff = `${date}T18:10:00+08:00`;
const calendarJson = fs.readFileSync(new URL('../config/taifex-official-calendar-2026.json', import.meta.url), 'utf8');
const browser = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/data-operations.js', import.meta.url), 'utf8'), browser);
function fixture({ first = '09:53:00', last = '13:44:00', batch = {}, generatedAt = cutoff, marketDayState = 'TRADING_DAY' } = {}) {
  const input = { calendarDate: date, tradeDate: date, marketDayState, generatedAt, sessions: ['DAY', 'NIGHT'], registry: { datasets: [] },
    liveEvidence: { ledgerFound: true, callbackErrors: 0, writerErrors: 0, droppedEvents: 0, reconnectCount: 1,
      sessionWindows: { DAY: { sessionStart: `${date}T08:45:00+08:00`, sessionEnd: `${date}T13:45:00+08:00` },
        NIGHT: { sessionStart: '2026-09-28T15:00:00+08:00', sessionEnd: '2026-09-29T05:00:00+08:00' } },
      feeds: { 'TX:futures_tick:DAY': { recordCount: 12, bytes: 1200, contracts: ['TXFJ6'],
        firstReceivedAt: `${date}T${first}+08:00`, lastReceivedAt: `${date}T${last}+08:00`,
        sessionStart: `${date}T08:45:00+08:00`, sessionEnd: `${date}T13:45:00+08:00` } },
      sourceArtifactIdentity: { type: 'append-only-ledger-fixed-byte-cutoff',
        files: [{ file: '/private/raw.ndjson', cutoffBytes: 1200, prefixSha256: 'a'.repeat(64) }] } },
    batchEvidence: batch };
  const a1 = { ...buildDailyCollectionAcceptance(input), evidenceInputs: { calendar: { sha256: digest(calendarJson) } } };
  const report = buildDailyDataOperations({ acceptanceReport: a1, acceptanceInputs: input, calendarJson,
    checkpointType: 'FINAL_TRADEDATE_CHECKPOINT', generatedAt });
  const view = projectDataOperations(report);
  view.schedulerHealth = { tradeDate: date, observedAt: `${date}T18:11:00+08:00`, completion: 'COMPLETE', punctuality: 'ON_TIME',
    checkpoints: ['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT'].map(checkpointType => ({ checkpointType, state: 'ON_TIME_SUCCEEDED' })) };
  view.dailyHealthBrief = buildDailyDataHealthBrief(view);
  return { input, report, view };
}
const row = (view, id, session = 'EOD') => view.rows.find(r => r.datasetId === id && r.session === session);

test('scheduled success, received records, partial cutoff and research restriction stay independent', () => {
  const { view, report } = fixture();
  const r = row(view, 'tx_actual_trade', 'DAY'), b = view.dailyHealthBrief;
  assert.equal(b.scheduler.completion, 'COMPLETE');
  assert.equal(b.received.withRecords, 1);
  assert.equal(r.evidenceSummary.recordCount, 12);
  assert.equal(r.evidenceSummary.firstReceivedAt, `${date}T09:53:00+08:00`);
  assert.equal(r.coverageState, 'PARTIAL');
  assert.equal(r.researchEligibility, 'NOT_READY');
  assert.ok(r.reasonCodes.includes('LATE_START'));
  assert.ok(r.reasonCodes.includes('STALE_DELIVERY'));
  assert.ok(r.reasonCodes.includes('PROVIDER_RECONNECT'));
  assert.equal(b.cutoffAssessment.state, report.overallState);
  assert.equal(b.cutoffAssessment.state, 'PARTIAL');
  assert.equal(b.cutoffAssessment.at, new Date(cutoff).toISOString());
  assert.notEqual(b.researchPrerequisites.state, 'PASS');
  assert.equal(b.runtimeVerified, false);
  const html = browser.DataOperations.render(view);
  for (const text of ['各階段工作完成', '有資料 1', '09:53:00', '不可用於既定研究', '缺段數：未知／尚無量測', '不驗證 MSI 即時運行狀態']) assert.ok(html.includes(text), text);
});

test('post-cutoff 805 rows cannot become available at 18:10 or qualified through projection', () => {
  const batch = { taifex_daily_market: { datasetId: 'taifex_daily_market', sourceDate: date,
    sourceArtifactIdentity: { sha256: 'b'.repeat(64), databasePath: '/private/trading.sqlite' }, recordCount: 805,
    observedAt: `${date}T21:39:00+08:00`, availableAt: `${date}T21:15:00+08:00`, cutoffValidated: false,
    captureState: 'PASS', persistenceState: 'PASS', integrityState: 'PASS', researchEligibility: 'READY', reasonCodes: ['EVIDENCE_AFTER_CUTOFF'] } };
  const { view } = fixture({ batch });
  const r = row(view, 'taifex_daily_market');
  assert.equal(r.evidenceSummary.recordCount, 805);
  assert.equal(r.evidenceSummary.observedAt, null);
  assert.equal(r.evidenceSummary.availableAt, null);
  assert.equal(r.operationalState, 'UNKNOWN');
  assert.equal(r.researchEligibility, 'UNKNOWN');
  assert.ok(r.reasonCodes.includes('EVIDENCE_AFTER_CUTOFF'));
  assert.equal(row(view, 'tx_large_trader').evidenceSummary.recordCount, null);
  assert.equal(view.dailyHealthBrief.cutoffAssessment.at, new Date(cutoff).toISOString());
  assert.equal(JSON.stringify(view).includes('/private/'), false);
  assert.equal(JSON.stringify(view).includes('prefixSha256'), false);
  const html = browser.DataOperations.render(view);
  assert.ok(html.includes('實收筆數：805'));
  assert.ok(html.includes('有列數不代表 cutoff 前已收到或完整'));
  assert.equal(html.includes('21:15:00'), false);
});

test('yesterday or future assessment stays visible but never supplies today counts or qualification', () => {
  for (const today of ['2026-09-28', '2026-09-30']) {
    const { view } = fixture();
    view.schedulerHealth.tradeDate = today;
    const b = view.dailyHealthBrief = buildDailyDataHealthBrief(view);
    assert.equal(b.assessmentScope, 'OTHER_DATE_SNAPSHOT');
    assert.equal(b.received.withRecords, null);
    assert.equal(b.cutoffAssessment.at, null);
    assert.equal(b.cutoffAssessment.requiredAndDueCount, null);
    assert.equal(b.cutoffAssessment.state, 'UNKNOWN');
    assert.equal(b.researchPrerequisites.state, 'UNKNOWN');
    assert.equal(b.reportHash, view.artifactIdentity.reportHash);
    assert.ok(browser.DataOperations.render(view).includes(`最近評估屬 ${date}，不能當成今日證據`));
  }
});

test('missing cloud/MSI artifacts mean UNKNOWN, not not-run, empty data, full or active', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'health-brief-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data'), outputRoot = path.join(dataRoot, 'quality/daily-data-operations');
  const view = readDataOperations({ dataRoot, outputRoot, now: new Date('2026-09-30T12:00:00Z') });
  assert.equal(fs.existsSync(dataRoot), false); // Reader cannot bootstrap data/services.
  assert.equal(view.acceptanceJobHealth.jobState, 'UNKNOWN');
  assert.equal(view.acceptanceJobHealth.jobReason, 'JOB_HEALTH_UNAVAILABLE');
  assert.equal(view.dailyHealthBrief.assessmentScope, 'UNAVAILABLE');
  assert.equal(view.dailyHealthBrief.received.assessedRows, null);
  assert.equal(view.dailyHealthBrief.received.zeroRecords, null);
  assert.equal(view.dailyHealthBrief.cutoffAssessment.state, 'UNKNOWN');
  const html = browser.DataOperations.render(view);
  assert.ok(html.includes('工作狀態未驗證'));
  assert.ok(!html.includes('本次工作</dt><dd>尚未執行'));
});

test('unknown calendar applicability never infers closure from weekday or a successful scheduler', () => {
  const { view } = fixture({ marketDayState: 'UNKNOWN' });
  assert.equal(view.dailyHealthBrief.cutoffAssessment.state, 'UNKNOWN');
  assert.equal(row(view, 'tx_actual_trade', 'DAY').dueState, 'UNKNOWN');
  assert.equal(row(view, 'tx_actual_trade', 'DAY').evidenceSummary.recordCount, null);
});

test('pending session does not become failed/complete; absent QC measurements never become zero', () => {
  const { view } = fixture({ generatedAt: `${date}T10:00:00+08:00`, last: '09:59:00' });
  const r = row(view, 'tx_actual_trade', 'DAY');
  assert.equal(r.operationalState, 'PENDING');
  assert.equal(r.evidenceSummary.expectedRecordCount, null);
  for (const key of ['missingIntervalCount', 'duplicateCount', 'timestampErrorCount']) assert.equal(r.evidenceSummary[key], null);
});

test('rendered evidence escapes source strings without adding raw lineage to projection', () => {
  const { view } = fixture();
  row(view, 'tx_actual_trade', 'DAY').evidenceSummary.sourceDate = '<img src=x onerror=alert(1)>';
  const html = browser.DataOperations.render(view);
  assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('&lt;img'));
});
