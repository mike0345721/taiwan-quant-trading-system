import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { digest } from '../src/market-state-forward-shadow.mjs';
import { buildDailyCollectionAcceptance, REASON_ZH } from '../src/daily-collection-acceptance.mjs';
import { OPERATIONAL_PROFILE } from '../src/daily-data-operations-profile.mjs';
import { REMEDIATION_MATRIX, remediationFor } from '../src/daily-data-remediation.mjs';
import { buildDailyDataOperations, operationsHash, validateDailyDataOperations } from '../src/daily-data-operations.mjs';
import { assertOperationsOutputRoot, runDailyDataOperations, readManualJobHealth } from '../scripts/build-daily-data-operations.mjs';

const generatedAt = '2026-09-13T01:00:00.000Z';
const hash = 'a'.repeat(64);
const calendarJson = fs.readFileSync(new URL('../config/taifex-official-calendar-2026.json', import.meta.url), 'utf8');
const withCalendar = report => ({ ...report, evidenceInputs: { calendar: { sha256: digest(calendarJson) } } });
function input(overrides = {}) {
  return { calendarDate: '2026-09-09', tradeDate: '2026-09-09', marketDayState: 'TRADING_DAY',
    generatedAt: '2026-09-12T14:00:00.000Z', sessions: ['DAY', 'NIGHT'], registry: { datasets: [] },
    liveEvidence: { ledgerFound: false, feeds: {},
      sessionWindows: { DAY: { sessionStart: '2026-09-09T00:45:00Z', sessionEnd: '2026-09-09T05:45:00Z' },
        NIGHT: { sessionStart: '2026-09-08T07:00:00Z', sessionEnd: '2026-09-08T21:00:00Z' } },
      sourceArtifactIdentity: { type: 'append-only-ledger-fixed-byte-cutoff', files: [{ file: '2026-09-09.ndjson', cutoffBytes: 10, prefixSha256: hash }] } }, ...overrides };
}
function fixture(overrides) { return structuredClone(withCalendar(buildDailyCollectionAcceptance(input(overrides)))); }
function build(acceptanceReport = fixture(), extra = {}) {
  return buildDailyDataOperations({ acceptanceReport: withCalendar(acceptanceReport), calendarJson, generatedAt, checkpointType: 'EOD_CHECKPOINT', ...extra });
}
function feed(report, id, session = 'EOD') { return report.feeds.find(f => f.datasetId === id && f.session === session); }
function livePass(report) {
  for (const f of report.feeds.filter(f => f.mode === 'LIVE_EVENT' && f.expectedState !== 'NOT_EXPECTED')) {
    Object.assign(f, { captureState: 'PASS', persistenceState: 'PASS', integrityState: 'PASS', coverageState: 'PASS',
      researchEligibility: 'READY', reasonCodes: [] });
  }
  return report;
}
function dueRule(id, dueAt = '2026-09-09T09:00:00Z') {
  return { datasetId: id, tradeDate: '2026-09-09', governanceState: 'GOVERNED', governanceReference: 'synthetic-test-rule',
    dueAt, observedAt: '2026-09-09T08:00:00Z', sourceArtifactIdentity: { sha256: hash } };
}

test('profile has TX raw requirements, DAY-only context, and no invented MTX/TMF canonical IDs', () => {
  assert.equal(OPERATIONAL_PROFILE.filter(r => r.blocksCoreLive).length, 4);
  for (const id of ['tx_actual_trade', 'tx_best_quote']) assert.deepEqual(OPERATIONAL_PROFILE.find(r => r.datasetId === id).applicableSession, ['DAY', 'NIGHT']);
  for (const r of OPERATIONAL_PROFILE.filter(r => r.operationalRole === 'SUPPORTING_OPERATIONAL_MONITOR')) assert.equal(r.datasetId, null);
  const registry = JSON.parse(fs.readFileSync(new URL('../config/data-requirements-v1.json', import.meta.url)));
  for (const row of OPERATIONAL_PROFILE.filter(r => r.datasetId)) assert.ok(registry.datasets.some(d => d.dataset_id === row.datasetId));
});
test('TX Tick/BidAsk count twice by session; DAY context only once; future/derived/conditional excluded', () => {
  const result = build(livePass(fixture()));
  assert.equal(result.coreLive.requiredAndDueCount, 6);
  assert.equal(result.coreEod.requiredAndDueCount, 0);
  assert.equal(result.requiredAndDueCount, 6);
  for (const id of ['equity_2330_raw_price', 'taiex_index']) {
    const night = result.coreLive.rows.find(r => r.datasetId === id && r.session === 'NIGHT');
    assert.equal(night.operationalState, 'NOT_EXPECTED'); assert.equal(night.requiredAndDue, false);
  }
  assert.equal(result.coreLiveState, 'PASS');
  assert.ok(result.futureNotEnabled.every(r => !r.requiredAndDue && r.operationalState === 'NOT_EXPECTED'));
});
test('NIGHT missing 2330/TAIEX cannot fail NIGHT raw data; DAY exclusion not whole-date proof', () => {
  const result = build(livePass(fixture({ sessions: ['NIGHT'] })));
  assert.ok(result.coreLive.rows.filter(r => r.session === 'NIGHT').every(r => ['PASS', 'NOT_EXPECTED'].includes(r.operationalState)));
  assert.equal(result.coreLive.requiredAndDueCount, 2);
  assert.equal(result.coreLiveState, 'UNKNOWN'); // Missing DAY audit stays explicit.
  assert.equal(result.finalizationEligible, false);
});
test('derived NOT_READY never overwrites lawful raw capture PASS', () => {
  const report = livePass(fixture());
  feed(report, 'derived_pressure_response_efficiency', 'NIGHT_PLUS_DAY').researchEligibility = 'NOT_READY';
  const result = build(report);
  assert.equal(result.coreLiveState, 'PASS');
  assert.equal(result.coreLive.captureState, 'PASS');
  assert.equal(result.researchReadiness.derivedRows[0].operationalState, 'FAIL');
  assert.equal(result.researchReadiness.rawCollectionDenominatorContribution, 0);
});
test('native sequence limitation retains integrity UNKNOWN independently from capture', () => {
  const report = livePass(fixture());
  Object.assign(feed(report, 'tx_actual_trade', 'DAY'), { integrityState: 'UNKNOWN', reasonCodes: ['NATIVE_SEQUENCE_UNAVAILABLE'] });
  const result = build(report);
  assert.equal(result.coreLive.captureState, 'PASS'); assert.equal(result.coreLiveState, 'UNKNOWN');
  const action = result.remediationActions.find(r => r.reasonCode === 'NATIVE_SEQUENCE_UNAVAILABLE');
  assert.equal(action.actionClass, 'ACCEPTED_PROVIDER_LIMITATION'); assert.equal(action.blocksCoreLive, false);
});
test('EOD persistence/stage PASS cannot invent due semantics, capture, or dataset PASS', () => {
  const report = livePass(fixture());
  Object.assign(feed(report, 'taifex_daily_market'), { persistenceState: 'PASS', stageEvidence: { ok: true }, recordCount: 10 });
  const result = build(report);
  assert.equal(result.coreEodState, 'UNKNOWN'); assert.equal(result.coreEod.requiredAndDueCount, 0);
  assert.equal(result.overallState, 'UNKNOWN');
  assert.ok(result.reasonCodes.includes('DUE_SEMANTICS_UNGOVERNED'));
});
test('NOT_PUBLISHED_YET remains PENDING, outside denominator', () => {
  const report = fixture();
  Object.assign(feed(report, 'taifex_daily_market'), { captureState: 'PENDING', expectedState: 'PENDING', reasonCodes: ['NOT_PUBLISHED_YET'] });
  const result = build(report);
  assert.equal(result.coreEod.rows[0].operationalState, 'PENDING');
  assert.equal(result.coreEod.rows[0].requiredAndDue, false);
});
test('only source-specific governed due rule admits EOD into denominator', () => {
  const report = fixture();
  Object.assign(feed(report, 'taifex_daily_market'), { captureState: 'FAIL', persistenceState: 'FAIL' });
  assert.equal(build(report).coreEod.rows[0].operationalState, 'UNKNOWN');
  const dueRules = { taifex_daily_market: dueRule('taifex_daily_market') };
  const result = build(report, { dueRules });
  assert.equal(result.coreEod.rows[0].operationalState, 'FAIL');
  assert.equal(result.coreEod.requiredAndDueCount, 1);
  dueRules.taifex_daily_market.observedAt = generatedAt;
  assert.throws(() => build(report, { dueRules }), /DUE_RULE_INVALID/);
});
test('future governed publication time remains pending, not fail', () => {
  const result = build(fixture(), { dueRules: { taifex_daily_market: dueRule('taifex_daily_market', '2026-09-15T09:00:00Z') } });
  assert.equal(result.coreEod.rows[0].dueState, 'PENDING'); assert.equal(result.coreEod.requiredAndDueCount, 0);
});
test('governed dataset publication evidence can establish due without invented thresholds', () => {
  const report = fixture();
  Object.assign(feed(report, 'taifex_daily_market'), { sourceDate: report.tradeDate, availableAt: '2026-09-09T09:00:00Z',
    observedAt: '2026-09-09T09:05:00Z', sourceArtifactIdentity: { sha256: hash }, captureState: 'PASS', persistenceState: 'PASS', integrityState: 'PASS' });
  const result = build(report);
  assert.equal(result.coreEod.rows[0].operationalState, 'PASS'); assert.equal(result.coreEod.requiredAndDueCount, 1);
});
test('DAY checkpoint evaluates DAY only and cannot claim final', () => {
  const inputs = input(); const result = build(buildDailyCollectionAcceptance(inputs), { acceptanceInputs: inputs, checkpointType: 'DAY_CHECKPOINT' });
  assert.equal(result.coreLive.requiredAndDueCount, 4);
  assert.equal(result.checkpointEligible, true); assert.equal(result.finalizationEligible, false);
  assert.ok(result.finalizationReasons.includes('CHECKPOINT_NOT_FINAL'));
});
test('EOD can retain NIGHT pending and FINAL cannot finalize it', () => {
  const inputs = input({ generatedAt: '2026-09-08T12:00:00Z' });
  const report = buildDailyCollectionAcceptance(inputs);
  for (const checkpointType of ['EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT']) {
    const result = build(report, { acceptanceInputs: inputs, checkpointType });
    assert.equal(result.sessionEvaluation.NIGHT, 'PENDING'); assert.equal(result.finalizationEligible, false);
    assert.ok(result.coreLive.rows.filter(r => r.session === 'NIGHT' && r.datasetId.startsWith('tx_')).every(r => r.operationalState === 'PENDING'));
  }
});
test('FINAL permits UNKNOWN after governed sessions ended and unresolved due is not a known future wait', () => {
  const inputs = input(); const result = build(buildDailyCollectionAcceptance(inputs), { acceptanceInputs: inputs, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' });
  assert.equal(result.overallState, 'UNKNOWN'); assert.equal(result.finalizationEligible, true);
  assert.equal(result.finalizationState, 'FINALIZED');
});
test('FINAL cannot discard logically active upstream pending', () => {
  const inputs = input();
  const result = build(buildDailyCollectionAcceptance(inputs), { acceptanceInputs: inputs, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT',
    dueRules: { taifex_daily_market: dueRule('taifex_daily_market', '2026-09-15T09:00:00Z') } });
  assert.equal(result.finalizationEligible, false); assert.ok(result.finalizationReasons.includes('EXPECTED_INPUT_PENDING'));
});
test('market closed has no failure denominator and legitimate finalized NOT_EXPECTED', () => {
  const inputs = input({ calendarDate: '2026-09-12', tradeDate: '2026-09-12', marketDayState: 'NON_TRADING_DAY' });
  const result = build(buildDailyCollectionAcceptance(inputs), { acceptanceInputs: inputs, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' });
  assert.equal(result.overallState, 'NOT_EXPECTED'); assert.equal(result.requiredAndDueCount, 0); assert.equal(result.finalizationEligible, true);
});
test('absent or mismatched session/cutoff evidence cannot finalize', () => {
  assert.equal(build(fixture(), { checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' }).finalizationEligible, false);
  const inputs = input(); const report = fixture(); inputs.liveEvidence.sessionWindows.DAY.sessionEnd = '2027-01-01T00:00:00Z';
  assert.throws(() => build(report, { acceptanceInputs: inputs }), /REPLAY_MISMATCH/);
});
test('all A.1 reasons have explicit mapping; capture gaps are trading-day-only', () => {
  for (const code of Object.keys(REASON_ZH)) assert.ok(REMEDIATION_MATRIX[code], code);
  for (const code of ['CAPTURE_GAP_UNEXPLAINED', 'SUBSCRIPTION_NOT_READY', 'QUOTE_TYPE_MISSING']) {
    const action = remediationFor(code); assert.equal(action.actionClass, 'TRADING_DAY_CAPTURE_VERIFICATION');
    assert.equal(action.canFixOffSession, false); assert.equal(action.needsTradingDay, true);
  }
  assert.equal(remediationFor('WRITER_ERROR').ownerLane, 'CRU49_RUNTIME_OR_SUCCESSOR');
  assert.equal(remediationFor('UNKNOWN_NEW_REASON').actionClass, 'UNMAPPED_REASON_REVIEW');
});
test('MTX/TMF monitoring preserves canonical-ID gap; conditional breadth never claims sector proof', () => {
  const result = build(); assert.equal(result.supportingFeeds.rows.length, 8);
  assert.ok(result.supportingFeeds.rows.every(r => r.datasetId === null && r.reasonCodes.includes('CANONICAL_DATASET_ID_UNAVAILABLE')));
  assert.ok(result.conditionalContext.rows.every(r => !r.blocksCoreLive && !r.blocksCoreEod));
  assert.match(result.conditionalContext.rows.find(r => r.datasetId.includes('breadth')).componentScope, /SECTOR_LEADERSHIP_UNKNOWN/);
});
test('same immutable inputs are deterministic and report validator catches tampering', () => {
  const first = build(); assert.deepEqual(first, build()); assert.equal(validateDailyDataOperations(first), true);
  first.overallState = 'PASS'; assert.throws(() => validateDailyDataOperations(first), /HASH_MISMATCH/);
});
test('later evidence creates new revision and cannot backdate knowledge', () => {
  const report = fixture(); const old = build(report);
  assert.throws(() => build(report, { generatedAt: '2026-09-01T00:00:00Z' }), /GENERATED_AT_BEFORE_INPUT/);
  feed(report, 'taifex_daily_market').availableAt = generatedAt;
  assert.throws(() => build(report), /EVIDENCE_AFTER_CUTOFF/);
  report.generatedAt = generatedAt;
  assert.notEqual(old.reportHash, build(report).reportHash);
});
test('missing numbers stay null; unknown research remains unknown, not neutral/ready', () => {
  const result = build(); const row = result.coreEod.rows[0];
  assert.equal(row.evidence.recordCount, null); assert.equal(row.evidence.bytes, null);
  assert.equal(result.researchReadinessState, 'UNKNOWN'); assert.equal(result.coreEodState, 'UNKNOWN');
});
test('a missing required row remains UNKNOWN rather than disappearing from operational profile', () => {
  const report = fixture(); report.feeds = report.feeds.filter(f => !(f.datasetId === 'tx_best_quote' && f.session === 'DAY'));
  const result = build(report); const row = result.coreLive.rows.find(r => r.datasetId === 'tx_best_quote' && r.session === 'DAY');
  assert.equal(row.operationalState, 'UNKNOWN'); assert.equal(row.requiredAndDue, true); assert.equal(row.evidence, null);
});
test('unsafe, invalid-date, duplicate-row input is rejected', () => {
  let report = fixture(); report.safety.executionAuthorized = true; assert.throws(() => build(report), /UNSAFE_INPUT/);
  report = fixture(); report.tradeDate = '2026-02-30'; assert.throws(() => build(report), /TRADE_DATE_INVALID/);
  report = fixture(); report.feeds.push(report.feeds[0]); assert.throws(() => build(report), /DUPLICATE_FEED/);
});

function temporary(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cru52-offline-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const inputPath = path.join(folder, 'input.json'); fs.writeFileSync(inputPath, JSON.stringify(fixture()));
  return { inputPath, dataRoot: folder, outputRoot: path.join(folder, 'quality', 'daily-data-operations'),
    checkpointType: 'EOD_CHECKPOINT', generatedAt };
}
test('manual run persists deterministic history and separately attests actual job success', t => {
  const args = temporary(t); const first = runDailyDataOperations(args); const second = runDailyDataOperations(args);
  assert.equal(first.assessment.reportHash, second.assessment.reportHash);
  assert.equal(second.jobHealth.runMode, 'MANUAL_OFFLINE'); assert.equal(second.jobHealth.jobState, 'SUCCEEDED');
  assert.equal(second.assessment.acceptanceJobHealth.jobState, 'COMPUTED');
  assert.equal(fs.readdirSync(path.join(args.outputRoot, '2026-09-09', 'eod')).length, 1);
  assert.equal(fs.readdirSync(path.join(args.outputRoot, 'runs')).length, 2);
  assert.equal(second.jobHealth.lastFinalizedTradeDate, null);
});
test('acceptance job failure does not rewrite feed results or erase last successful run', t => {
  const args = temporary(t); const success = runDailyDataOperations(args);
  const prior = fs.readFileSync(path.join(args.outputRoot, 'latest.json'), 'utf8');
  fs.writeFileSync(args.inputPath, 'broken JSON');
  assert.throws(() => runDailyDataOperations(args));
  const health = JSON.parse(fs.readFileSync(path.join(args.outputRoot, 'job-health.json')));
  assert.equal(health.jobState, 'FAILED'); assert.equal(health.lastSuccessAt, success.jobHealth.lastSuccessAt);
  assert.equal(health.failureClass, 'ACCEPTANCE_JOB_FAILURE_NOT_FEED_FAILURE');
  assert.equal(fs.readFileSync(path.join(args.outputRoot, 'latest.json'), 'utf8'), prior);
});
test('later assessment keeps old immutable history; older invocation cannot regress checkpoint view', t => {
  const args = temporary(t); const first = runDailyDataOperations(args);
  const newer = runDailyDataOperations({ ...args, generatedAt: '2026-09-14T01:00:00Z' });
  runDailyDataOperations(args);
  assert.equal(fs.readdirSync(path.join(args.outputRoot, '2026-09-09', 'eod')).length, 2);
  assert.notEqual(first.assessment.reportHash, newer.assessment.reportHash);
  assert.equal(JSON.parse(fs.readFileSync(path.join(args.outputRoot, '2026-09-09', 'eod.json'))).reportHash, newer.assessment.reportHash);
});
test('output traversal, input collision, symlink/junction, and hardlink outputs are rejected', t => {
  const args = temporary(t);
  assert.throws(() => assertOperationsOutputRoot(args.dataRoot, path.join(args.outputRoot, '..', 'daily-collection-acceptance')), /NOT_GOVERNED/);
  assert.throws(() => assertOperationsOutputRoot(args.dataRoot, args.outputRoot, [path.join(args.outputRoot, 'input.json')]), /INPUT_COLLISION/);
  fs.mkdirSync(args.outputRoot, { recursive: true });
  const redirect = path.join(args.outputRoot, 'redirect'); fs.symlinkSync(args.dataRoot, redirect, 'junction');
  assert.throws(() => assertOperationsOutputRoot(args.dataRoot, redirect), /LINK_REJECTED/);
  fs.linkSync(args.inputPath, path.join(args.outputRoot, 'job-health.json'));
  assert.throws(() => runDailyDataOperations(args), /LINK_REJECTED/);
});
test('persisted tampered immutable revision cannot be overwritten', t => {
  const args = temporary(t); const { jobHealth } = runDailyDataOperations(args);
  const artifact = path.join(args.outputRoot, jobHealth.reportArtifactIdentity.file);
  fs.writeFileSync(artifact, 'tampered');
  assert.throws(() => runDailyDataOperations(args), /IMMUTABLE_HISTORY_CONFLICT/);
  assert.equal(fs.readFileSync(artifact, 'utf8'), 'tampered');
});

test('missing manual job is NOT_RUN; concurrent or abandoned guard preserves unknown owner', t => {
  const args = temporary(t);
  assert.equal(readManualJobHealth(args.dataRoot, args.outputRoot).jobState, 'NOT_RUN');
  fs.mkdirSync(args.outputRoot, { recursive: true });
  const guard = path.join(args.outputRoot, '.manual-run.guard'); fs.writeFileSync(guard, 'unknown-owner');
  assert.throws(() => runDailyDataOperations(args), /OUTPUT_BUSY_OR_ABANDONED_GUARD/);
  assert.equal(fs.readFileSync(guard, 'utf8'), 'unknown-owner');
  assert.equal(readManualJobHealth(args.dataRoot, args.outputRoot).jobState, 'NOT_RUN');
});
test('missing EOD row still obeys governed due and future pending rules', () => {
  const report = fixture(); report.feeds = report.feeds.filter(r => r.datasetId !== 'taifex_daily_market');
  let result = build(report, { dueRules: { taifex_daily_market: dueRule('taifex_daily_market') } });
  assert.equal(result.coreEod.rows[0].dueState, 'DUE'); assert.equal(result.coreEod.rows[0].requiredAndDue, true);
  assert.equal(result.coreEod.rows[0].operationalState, 'UNKNOWN');
  result = build(report, { dueRules: { taifex_daily_market: dueRule('taifex_daily_market', '2026-09-15T09:00:00Z') } });
  assert.equal(result.coreEod.rows[0].operationalState, 'PENDING'); assert.equal(result.coreEod.rows[0].requiredAndDue, false);
});
test('validator rejects rehashed skeleton, altered denominator, and fake job success', () => {
  const rehash = r => { delete r.reportHash; r.reportHash = operationsHash(r); return r; };
  const good = build();
  const skeleton = { schemaVersion: good.schemaVersion, tradeDate: good.tradeDate, checkpointType: good.checkpointType, generatedAt: good.generatedAt, safety: good.safety };
  assert.throws(() => validateDailyDataOperations(rehash(skeleton)), /IDENTITY_INVALID/);
  let altered = structuredClone(good); altered.requiredAndDueCount = 0;
  assert.throws(() => validateDailyDataOperations(rehash(altered)), /SUMMARY_INVALID/);
  altered = structuredClone(good); altered.acceptanceJobHealth.jobState = 'SUCCEEDED';
  assert.throws(() => validateDailyDataOperations(rehash(altered)), /JOB_HEALTH_INVALID/);
  altered = structuredClone(good); altered.coreLive.rows = []; altered.coreLive = { ...altered.coreLive, state: 'PASS' };
  assert.throws(() => validateDailyDataOperations(rehash(altered)), /PROFILE_ROWS_INVALID/);
});
test('success health sink failure leaves FAILED receipt, never immutable SUCCEEDED', t => {
  const args = temporary(t); const originalRename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (target.endsWith('job-health.json') && JSON.parse(fs.readFileSync(source)).jobState === 'SUCCEEDED') throw new Error('TEST_HEALTH_SINK_FAILURE');
    return originalRename(source, target);
  };
  try { assert.throws(() => runDailyDataOperations(args), /TEST_HEALTH_SINK_FAILURE/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(readManualJobHealth(args.dataRoot, args.outputRoot).jobState, 'FAILED');
  const receipts = fs.readdirSync(path.join(args.outputRoot, 'runs')).map(f => JSON.parse(fs.readFileSync(path.join(args.outputRoot, 'runs', f))));
  assert.ok(receipts.length > 0); assert.ok(receipts.every(r => r.jobState === 'FAILED'));
});

test('unbound session metadata cannot move DAY eligibility even when A1 report is unchanged', () => {
  const inputs = input();
  inputs.liveEvidence.ledgerFound = true;
  inputs.liveEvidence.feeds = { 'TX:futures_tick:DAY': { recordCount: 1, bytes: 10, contracts: ['TXFI6'], firstReceivedAt: '2026-09-09T01:00:00Z', lastReceivedAt: '2026-09-09T01:00:00Z' } };
  const report = buildDailyCollectionAcceptance(inputs);
  inputs.liveEvidence.sessionWindows.DAY = { sessionStart: '2000-01-01T00:45:00Z', sessionEnd: '2000-01-01T05:45:00Z' };
  assert.equal(operationsHash(report), operationsHash(buildDailyCollectionAcceptance(inputs)));
  const result = build(report, { acceptanceInputs: inputs, checkpointType: 'DAY_CHECKPOINT' });
  assert.equal(result.sessionEvaluation.DAY, 'UNKNOWN'); assert.equal(result.checkpointEligible, false);
  assert.equal(build(report, { acceptanceInputs: inputs, calendarJson: null, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' }).finalizationEligible, false);
});

test('bounded evidence of entirely missing ledgers may finalize UNKNOWN after sessions end', () => {
  const inputs = input(); inputs.liveEvidence.sourceArtifactIdentity.files = [];
  inputs.liveEvidence.sourceArtifactIdentity.missingFiles = ['2026-09-08.ndjson', '2026-09-09.ndjson'];
  const result = build(buildDailyCollectionAcceptance(inputs), { acceptanceInputs: inputs, checkpointType: 'FINAL_TRADEDATE_CHECKPOINT' });
  assert.equal(result.finalizationEligible, true); assert.equal(result.overallState, 'UNKNOWN');
  assert.equal(validateDailyDataOperations(result), true);
});
