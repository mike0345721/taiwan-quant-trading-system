import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDailyCollectionAcceptance } from '../src/daily-collection-acceptance.mjs';
import { buildDailyDataOperations } from '../src/daily-data-operations.mjs';
import { readDailyBatchEvidence } from '../src/daily-collection-batch-evidence.mjs';
import { projectDataOperations } from '../src/dashboard-data-operations.mjs';

const context = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/data-operations.js', import.meta.url), 'utf8'), context);
const ui = context.DataOperations;
const cutoff = '2026-09-09T10:00:00.000Z';
function fixture({ batch = {}, live = {} } = {}) {
  const report = structuredClone(buildDailyCollectionAcceptance({ calendarDate: '2026-09-09', tradeDate: '2026-09-09',
    generatedAt: cutoff, marketDayState: 'TRADING_DAY', sessions: ['DAY', 'NIGHT'], registry: { datasets: [] },
    liveEvidence: { ledgerFound: false, feeds: {} } }));
  Object.assign(report.feeds.find(f => f.datasetId === 'taifex_daily_market'), batch);
  Object.assign(report.feeds.find(f => f.datasetId === 'tx_actual_trade' && f.session === 'DAY'), live);
  return buildDailyDataOperations({ acceptanceReport: report, checkpointType: 'EOD_CHECKPOINT', generatedAt: cutoff });
}
function row(view, id = 'taifex_daily_market', session = 'EOD') {
  return view.rows.find(r => r.datasetId === id && r.session === session);
}
const knownBatch = { sourceDate: '2026-09-09', availableAt: '2026-09-09T07:10:00Z', observedAt: '2026-09-09T08:12:00Z',
  captureState: 'PASS', persistenceState: 'PASS', integrityState: 'PASS', sourceArtifactIdentity: { sha256: 'a'.repeat(64) },
  reasonCodes: [], stageEvidence: { key: 'taifex', ok: true, completedAt: '2026-09-09T08:00:00Z', privatePath: 'private-test-path' } };

test('projection retains distinct source times and whitelists stage evidence without mutating the artifact', () => {
  const report = fixture({ batch: knownBatch }), before = JSON.stringify(report);
  const view = projectDataOperations(report), actual = row(view);
  for (const key of ['sourceDate', 'availableAt', 'observedAt']) assert.equal(actual[key], knownBatch[key], key);
  assert.deepEqual(actual.stageEvidence, { key: 'taifex', ok: true, completedAt: '2026-09-09T08:00:00Z' });
  assert.equal(actual.sourceMode, 'OFFICIAL_BATCH');
  assert.equal(actual.sourceArtifactKnown, true);
  assert.equal(JSON.stringify(view).includes('private-test-path'), false);
  assert.equal(JSON.stringify(report), before);
});

test('projection retains live trade date and first/last receipt without inventing a source publication time', () => {
  const view = projectDataOperations(fixture({ live: { firstReceivedAt: '2026-09-09T01:00:00Z', lastReceivedAt: '2026-09-09T05:40:00Z' } }));
  const actual = row(view, 'tx_actual_trade', 'DAY');
  assert.equal(actual.tradeDate, '2026-09-09'); assert.equal(actual.sourceMode, 'LIVE_EVENT');
  assert.equal(actual.firstReceivedAt, '2026-09-09T01:00:00Z'); assert.equal(actual.lastReceivedAt, '2026-09-09T05:40:00Z');
  assert.equal(actual.sourceDate, null); assert.equal(actual.availableAt, null); assert.equal(actual.observedAt, null);
});

test('missing per-row evidence stays null despite successful acceptance job', () => {
  const actual = row(projectDataOperations(fixture(), { jobState: 'SUCCEEDED', lastSuccessAt: cutoff }));
  for (const key of ['sourceDate', 'availableAt', 'observedAt', 'firstReceivedAt', 'lastReceivedAt', 'stageEvidence']) {
    assert.equal(actual[key], null, key);
  }
  assert.equal(actual.sourceArtifactKnown, false);
});

test('real absent-artifact batch evidence keeps its requested date distinct from a known data date', () => {
  const batchEvidence = readDailyBatchEvidence({ tradeDate: '2026-09-09', generatedAt: cutoff });
  const acceptance = buildDailyCollectionAcceptance({ calendarDate: '2026-09-09', tradeDate: '2026-09-09',
    generatedAt: cutoff, marketDayState: 'TRADING_DAY', sessions: ['DAY', 'NIGHT'], registry: { datasets: [] }, batchEvidence,
    liveEvidence: { ledgerFound: false, feeds: {} } });
  const report = buildDailyDataOperations({ acceptanceReport: acceptance, checkpointType: 'EOD_CHECKPOINT', generatedAt: cutoff });
  const view = projectDataOperations(report, { jobState: 'SUCCEEDED', lastSuccessAt: cutoff });
  const actual = row(view);
  assert.equal(actual.sourceDate, '2026-09-09');
  assert.equal(actual.observedAt, null);
  const html = ui.render({ ...view, rows: [actual], gaps: [actual] });
  assert.match(html, /資料日期：未知/);
  assert.match(html, /待驗目標日：2026-09-09/);
  assert.equal(html.includes('資料日期：2026-09-09'), false);
  assert.equal(actual.sourceArtifactKnown, false);
  assert.match(html, /ARTIFACT_IDENTITY_MISSING/);
});

test('unverified or mismatched artifact identities cannot promote the requested date to a data date', () => {
  for (const batch of [
    { ...knownBatch, sourceArtifactIdentity: {} },
    { ...knownBatch, sourceArtifactIdentity: { sha256: 'invalid' } },
    { ...knownBatch, sourceArtifactIdentity: { sha256: 123 } },
    { ...knownBatch, sourceDate: '2026-09-08' },
  ]) {
    const actual = row(projectDataOperations(fixture({ batch })));
    assert.equal(actual.sourceArtifactKnown, false);
    const html = ui.render({ rows: [actual] });
    assert.match(html, /資料日期：未知/);
    assert.match(html, /待驗目標日：2026-09-0[89]/);
  }
});

test('UI shows source date, availability and observation separately; neither batch nor acceptance success invents source update success', () => {
  const view = projectDataOperations(fixture({ batch: knownBatch }), { jobState: 'SUCCEEDED', lastSuccessAt: cutoff });
  const html = ui.render(view);
  assert.match(html, /資料日期：2026-09-09/);
  assert.match(html, /來源可用時間：2026-09-09 07:10:00 UTC/);
  assert.match(html, /資料觀測時間：2026-09-09 08:12:00 UTC/);
  assert.match(html, /最後成功資料更新：未知/);
  assert.match(html, /批次階段：成功/);
  assert.match(html, /批次完成：2026-09-09 08:00:00 UTC/);
  assert.match(html, /批次完成不代表此資料源最後成功更新/);
  assert.equal(/最後成功資料更新：2026/.test(html), false);
});

test('UI shows live receipt bounds and keeps trade date separate from unknown batch source date', () => {
  const html = ui.render(projectDataOperations(fixture({ live: { firstReceivedAt: '2026-09-09T01:00:00Z', lastReceivedAt: '2026-09-09T05:40:00Z' } })));
  assert.match(html, /資料日期：2026-09-09（交易日）/);
  assert.match(html, /首次收到：2026-09-09 01:00:00 UTC/);
  assert.match(html, /最後收到：2026-09-09 05:40:00 UTC/);
  assert.match(html, /資料日期：未知/);
});

test('failed batch stage remains failure and preserves source failure reasons visibly', () => {
  const view = projectDataOperations(fixture({ batch: { stageEvidence: { key: 'taifex', ok: false, completedAt: '2026-09-09T08:00:00Z' },
    reasonCodes: ['BATCH_EVIDENCE_UNREADABLE', 'TIMESTAMP_LINEAGE_INSUFFICIENT'] } }));
  const html = ui.render(view);
  assert.match(html, /批次階段：失敗/);
  assert.match(html, /BATCH_EVIDENCE_UNREADABLE/);
  assert.match(html, /批次資料證據無法讀取/);
  assert.match(html, /最後成功資料更新：未知/);
});

test('row time UI escapes labels and treats invalid/absent timestamps as unknown', () => {
  const view = projectDataOperations(fixture()), actual = row(view);
  actual.sourceDate = '<img src=x onerror=alert(1)>';
  actual.availableAt = 123; actual.observedAt = 'not-a-time';
  actual.stageEvidence = { key: '<script>x</script>', ok: 'true', completedAt: 'not-a-time' };
  const html = ui.render(view);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /來源可用時間：未知/);
  assert.match(html, /資料觀測時間：未知/);
  assert.match(html, /批次階段：未知/);
  assert.equal(html.includes('Invalid Date'), false);
});

