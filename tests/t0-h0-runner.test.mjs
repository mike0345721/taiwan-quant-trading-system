import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NATURAL_SMOKE_DATES,
  buildSyntheticFixtures,
  calculateExactVwap,
  commitJob,
  compareProtectionSnapshots,
  conservativeBarEvent,
  costViewsForTrade,
  executeNaturalSession,
  falseBreakoutFromBars,
  finalizeRun,
  firstBreakout,
  initializeOrResumeRun,
  loadAndVerifyFrozenInputs,
  openingRange,
  referenceExitFromBars,
  resolveOrderedTickEvent,
  snapshotProtectedArtifacts,
  summarizeEngineeringResults,
  validateH0Replay,
} from '../src/t0-h0-runner.mjs';

const root = path.resolve('.');
const frozen = loadAndVerifyFrozenInputs(root);

function bar(timestamp, open, high, low, close, volume = 10) {
  return { timestamp, open, high, low, close, volume, complete: true };
}

test('四個Frozen Hash與137日Strict Manifest全部通過', () => {
  assert.equal(frozen.strictManifest.sessions.length, 137);
  assert.equal(frozen.hashes.t0SpecHash, 'c2baf6a63cf69407ae9e686af46bb5832adcebf9d859b170fe9096c8f7389253');
  assert.equal(frozen.hashes.costPolicyHash, 'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc');
  assert.equal(frozen.hashes.strictManifestHash, '87bbf9a01ccec29fcf29251f98ed71f55590ecab213693d6d3f95584b8d6f2ff');
  assert.equal(frozen.hashes.ownerBriefHash, '483ceb938af1d14345eeeec1843892fcb0d9a7a6e2f3ecb31b271bc059266946');
});

test('Opening Range固定三根且availableAt為09:00台北時間', () => {
  const bars = [
    bar('2026-01-02T00:45:00.000Z', 100, 105, 99, 102),
    bar('2026-01-02T00:50:00.000Z', 102, 106, 101, 103),
    bar('2026-01-02T00:55:00.000Z', 103, 104, 98, 100),
  ];
  assert.deepEqual(openingRange(bars), { qualityState: 'PASS', orHigh: 106, orLow: 98, orAvailableAt: '2026-01-02T01:00:00.000Z', barTimestamps: bars.map((row) => row.timestamp) });
});

test('Breakout只鎖定第一個合法完整收盤突破', () => {
  const bars = [
    bar('2026-01-02T01:00:00.000Z', 100, 107, 99, 106),
    bar('2026-01-02T01:05:00.000Z', 106, 109, 105, 108),
    bar('2026-01-02T01:10:00.000Z', 108, 109, 95, 96),
  ];
  const found = firstBreakout(bars, 106, 98);
  assert.equal(found.direction, 'LONG');
  assert.equal(found.confirmationBar.timestamp, bars[1].timestamp);
});

test('OHLC同棒Stop與1R固定STOP_FIRST', () => {
  assert.deepEqual(conservativeBarEvent({ direction: 'LONG', stopPrice: 90, oneRPrice: 110, bar: { high: 111, low: 89 } }), { event: 'STOP', sequencePolicy: 'STOP_FIRST', ambiguous: true });
  assert.deepEqual(conservativeBarEvent({ direction: 'SHORT', stopPrice: 110, oneRPrice: 90, bar: { high: 111, low: 89 } }), { event: 'STOP', sequencePolicy: 'STOP_FIRST', ambiguous: true });
});

test('Tick順序優先且同timestamp歧義採保守Stop', () => {
  const ordered = resolveOrderedTickEvent({ direction: 'LONG', stopPrice: 90, oneRPrice: 110, ticks: [
    { exchangeTimestamp: '2026-01-01T01:00:01.000Z', price: 89 },
    { exchangeTimestamp: '2026-01-01T01:00:00.000Z', price: 110 },
  ] });
  assert.equal(ordered.event, 'ONE_R');
  const ambiguous = resolveOrderedTickEvent({ direction: 'LONG', stopPrice: 90, oneRPrice: 110, ticks: [
    { exchangeTimestamp: '2026-01-01T01:00:00.000Z', price: 110 },
    { exchangeTimestamp: '2026-01-01T01:00:00.000Z', price: 89 },
  ] });
  assert.equal(ambiguous.event, 'STOP');
  assert.equal(ambiguous.sequencePolicy, 'AMBIGUOUS_SEQUENCE_CONSERVATIVE');
});

test('Stop在Time Exit前優先，Time Exit棒開盤不使用其後High Low', () => {
  const bars = [bar('2026-01-01T01:55:00.000Z', 100, 105, 89, 104), bar('2026-01-01T02:00:00.000Z', 103, 120, 80, 110)];
  const stopped = referenceExitFromBars({ bars, entryIndex: 0, direction: 'LONG', stopPrice: 90, timeExitAt: '2026-01-01T02:00:00.000Z' });
  assert.equal(stopped.exitReason, 'STOP_EXIT');
  const timed = referenceExitFromBars({ bars: [bars[1]], entryIndex: 0, direction: 'LONG', stopPrice: 90, timeExitAt: '2026-01-01T02:00:00.000Z' });
  assert.equal(timed.exitReason, 'TIME_EXIT');
  assert.equal(timed.exitReferencePrice, 103);
});

test('False Breakout三棒、Stop First與UNAVAILABLE分支固定', () => {
  const returned = falseBreakoutFromBars({ direction: 'LONG', entryPrice: 105, stopPrice: 95, orHigh: 103, orLow: 95, bars: [
    { high: 108, low: 102, close: 103, complete: true },
    { high: 106, low: 101, close: 102, complete: true },
    { high: 105, low: 100, close: 101, complete: true },
  ] });
  assert.equal(returned.falseBreakout, true);
  assert.equal(returned.falseBreakoutReason, 'RETURNED_BELOW_OR_HIGH_BEFORE_1R');
  const ambiguous = falseBreakoutFromBars({ direction: 'LONG', entryPrice: 105, stopPrice: 95, orHigh: 103, orLow: 95, bars: [
    { high: 116, low: 94, close: 110, complete: true },
    { high: 110, low: 100, close: 105, complete: true },
    { high: 108, low: 99, close: 103, complete: true },
  ] });
  assert.equal(ambiguous.falseBreakoutReason, 'STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW');
  assert.equal(falseBreakoutFromBars({ direction: 'LONG', entryPrice: 105, stopPrice: 95, orHigh: 103, orLow: 95, bars: [] }).falseBreakout, 'UNAVAILABLE');
});

test('精確VWAP使用成交價格乘成交量', () => {
  assert.deepEqual(calculateExactVwap([{ price: 100, volume: 2 }, { price: 103, volume: 1 }]), { value: 101, qualityState: 'PASS', tickCount: 2, volume: 3 });
});

test('Long與Short五種成本視圖無滑價重複扣除', () => {
  for (const direction of ['LONG', 'SHORT']) {
    const views = costViewsForTrade({ direction, entryReferencePrice: direction === 'LONG' ? 100 : 110, exitReferencePrice: direction === 'LONG' ? 110 : 100 }, frozen.costPolicy);
    assert.deepEqual(views.map((row) => row.slippageTicksPerSide), [0, 1, 2, 3, 5]);
    assert.equal(views.every((row) => row.accountingEquivalent), true);
    for (const row of views.slice(1)) assert.equal(row.actualFillNet, row.grossPnl - row.entrySlippage - row.exitSlippage - row.entryCommission - row.exitCommission - row.entryTax - row.exitTax);
  }
});

test('Natural Smoke固定一般日、結算日與換月日且只用OHLC保守重播', () => {
  const results = NATURAL_SMOKE_DATES.map((tradeDate) => {
    const row = frozen.strictManifest.sessions.find((candidate) => candidate.tradeDate === tradeDate);
    const selected = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02/selected-contract-replays', `${tradeDate}-${row.actualReplayContractCode}.json`);
    const replay = JSON.parse(fs.readFileSync(fs.existsSync(selected) ? selected : path.join(root, 'data/intraday/archive', `${tradeDate}-day.json`), 'utf8'));
    assert.equal(validateH0Replay(replay, row).pass, true);
    return executeNaturalSession({ manifestRow: row, replay, costPolicy: frozen.costPolicy, referenceSessions: [] });
  });
  assert.deepEqual(results.map((row) => row.settlementClass), ['NORMAL_SESSION', 'SETTLEMENT_FINAL_CONTRACT', 'NORMAL_SESSION']);
  assert.deepEqual(results.map((row) => row.rollSession), [false, false, true]);
  assert.equal(results.every((row) => row.replayResolution === 'FIVE_MINUTE_OHLC'), true);
  assert.equal(results.every((row) => row.executionAuthorized === false), true);
});

test('Natural統計使用manifest／processed／researchEligible新口徑', () => {
  const summary = summarizeEngineeringResults([{ tradeState: 'TRADE' }, { tradeState: 'NO_TRADE' }, { tradeState: 'NO_SAMPLE' }]);
  assert.deepEqual(summary.counts, { manifestSessionCount: 3, processedSessionCount: 3, researchEligibleSessionCount: 2, tradeCount: 1, noTradeCount: 1, noSampleCount: 1, fixtureCount: 0 });
});

test('Synthetic Fixture具隔離旗標且不進正式統計', () => {
  const fixtures = buildSyntheticFixtures(frozen.costPolicy);
  assert.equal(fixtures.every((row) => row.fixtureOnly && row.synthetic && row.officialResearchEligible === false), true);
  const summary = summarizeEngineeringResults(fixtures, { fixture: true });
  assert.equal(summary.counts.manifestSessionCount, 0);
  assert.equal(summary.counts.tradeCount, 0);
  assert.equal(summary.counts.fixtureCount, fixtures.length);
});

test('Resume只執行Pending且完成Job不得覆寫', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 't0-h0-resume-'));
  const frozenHashes = { spec: 'a', cost: 'b' };
  let manifest = initializeOrResumeRun({ root, runDir, runId: 'resume-test', mode: 'fixture-smoke', jobs: [{ jobId: 'A' }, { jobId: 'B' }], frozenHashes });
  const first = commitJob({ runDir, manifest, jobId: 'A', output: { value: 1 } });
  const firstHash = first.outputHash;
  manifest = initializeOrResumeRun({ root, runDir, runId: 'resume-test', mode: 'fixture-smoke', jobs: [], frozenHashes, resume: true });
  assert.equal(manifest.jobs.find((row) => row.jobId === 'A').outputHash, firstHash);
  assert.throws(() => commitJob({ runDir, manifest, jobId: 'A', output: { value: 2 } }), /COMPLETED_JOB_OVERWRITE/);
  commitJob({ runDir, manifest, jobId: 'B', output: { value: 2 } });
  const completed = finalizeRun({ runDir, manifest, summary: { counts: { fixtureCount: 2 } } });
  const logical = completed.logicalOutputHash;
  const resumed = initializeOrResumeRun({ root, runDir, runId: 'resume-test', mode: 'fixture-smoke', jobs: [], frozenHashes, resume: true });
  assert.equal(resumed.logicalOutputHash, logical);
});

test('Frozen Artifact保護快照可驗證零變更', () => {
  const before = snapshotProtectedArtifacts(root);
  const after = snapshotProtectedArtifacts(root);
  assert.equal(compareProtectionSnapshots(before, after).pass, true);
});

test('Hard Session Flat Deadline不是正常Exit', () => {
  assert.equal(frozen.t0Spec.baselineMechanics.sessionSafetyBackstop.normalT0ExitReason, false);
  assert.equal(frozen.t0Spec.baselineMechanics.timeExit.sessionCloseFallbackForbidden, true);
});
