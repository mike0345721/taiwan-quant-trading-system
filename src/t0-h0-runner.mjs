import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateRvol20,
  calculateTradeCost,
  evaluateEntryGapThroughStop,
  evaluateEntryWindow,
  hashJson,
} from './t0-data-replay-gate.mjs';

export const T0_H0_FROZEN_HASHES = Object.freeze({
  t0SpecHash: 'c2baf6a63cf69407ae9e686af46bb5832adcebf9d859b170fe9096c8f7389253',
  costPolicyHash: 'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc',
  strictManifestHash: '87bbf9a01ccec29fcf29251f98ed71f55590ecab213693d6d3f95584b8d6f2ff',
  ownerBriefHash: '483ceb938af1d14345eeeec1843892fcb0d9a7a6e2f3ecb31b271bc059266946',
});

export const NATURAL_SMOKE_DATES = Object.freeze(['2026-01-02', '2026-01-21', '2026-01-22']);

export function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rel(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

export function loadAndVerifyFrozenInputs(root) {
  const files = {
    t0Spec: path.join(root, 'research/t0-v1/t0-final-spec.json'),
    costPolicy: path.join(root, 'research/t0-v1/cost-policy.json'),
    strictManifest: path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02/T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json'),
    ownerBrief: path.join(root, 'docs/research/T0_HISTORICAL_H0_RUN_OWNER_BRIEF.md'),
  };
  const t0Spec = readJson(files.t0Spec);
  const costPolicy = readJson(files.costPolicy);
  const strictManifest = readJson(files.strictManifest);
  const actual = {
    t0SpecHash: hashJson(t0Spec),
    costPolicyHash: hashJson(costPolicy),
    strictManifestHash: hashJson(strictManifest),
    ownerBriefHash: fileSha256(files.ownerBrief),
  };
  for (const [name, expected] of Object.entries(T0_H0_FROZEN_HASHES)) {
    if (actual[name] !== expected) throw new Error(`HARD_FAIL_FROZEN_HASH_MISMATCH:${name}:${actual[name]}`);
  }
  if (strictManifest.sessionCount !== 137 || strictManifest.sessions.length !== 137) throw new Error('HARD_FAIL_STRICT_MANIFEST_COUNT');
  if (t0Spec.authorization?.formalWeight !== 0 || t0Spec.authorization?.researchOnly !== true || t0Spec.authorization?.executionAuthorized !== false) throw new Error('HARD_FAIL_AUTHORIZATION_BOUNDARY');
  return { files, t0Spec, costPolicy, strictManifest, hashes: actual };
}

export function snapshotProtectedArtifacts(root) {
  const protectedFiles = new Set();
  const t0Dir = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02');
  const t0Run = readJson(path.join(t0Dir, 'RUN_MANIFEST.json'));
  for (const name of Object.keys(t0Run.outputHashes)) protectedFiles.add(path.join(t0Dir, name));
  protectedFiles.add(path.join(t0Dir, 'RUN_MANIFEST.json'));

  const phaseAStatus = readJson(path.join(root, 'data/research/full-historical-phase-a-v1/run-2026-07-30-a13-v2/RUN_STATUS.json'));
  protectedFiles.add(path.join(root, 'data/research/full-historical-phase-a-v1/run-2026-07-30-a13-v2/RUN_STATUS.json'));
  protectedFiles.add(phaseAStatus.immutable.snapshotPath);
  protectedFiles.add(phaseAStatus.immutable.specPath);
  protectedFiles.add(phaseAStatus.immutable.targetSpecPath);
  protectedFiles.add(phaseAStatus.immutable.featureSpecPath);
  for (const job of phaseAStatus.jobs.filter((row) => row.status === 'COMPLETED')) protectedFiles.add(job.outputPath);

  const pp1Root = path.join(root, 'data/pp1-market-semantics/run-2026-08-01-v3');
  const pp1Closeout = readJson(path.join(pp1Root, 'CLOSEOUT_MANIFEST.json'));
  protectedFiles.add(path.join(pp1Root, 'CLOSEOUT_MANIFEST.json'));
  for (const stage of Object.keys(pp1Closeout.stageOutputHashes)) protectedFiles.add(path.join(pp1Root, 'artifacts', `${stage}.json`));

  const reconciliationStatusFile = path.join(root, 'data/research/pp1-contract-reconciliation-v1/run-2026-08-01/RUN_STATUS.json');
  const reconciliation = readJson(reconciliationStatusFile);
  protectedFiles.add(reconciliationStatusFile);
  for (const artifact of reconciliation.artifacts) protectedFiles.add(artifact.path);

  protectedFiles.add(path.join(root, 'data/intraday/research/v3.10-wave3-forward/restricted-frozen-models.json'));
  protectedFiles.add(path.join(root, 'data/intraday/research/v3.10-wave3-forward/restricted-frozen-spec.json'));

  const hashes = {};
  for (const file of [...protectedFiles].sort()) {
    if (!fs.existsSync(file)) throw new Error(`HARD_FAIL_PROTECTED_ARTIFACT_MISSING:${file}`);
    hashes[rel(root, file)] = fileSha256(file);
  }
  return { artifactCount: Object.keys(hashes).length, combinedHash: hashJson(hashes), hashes };
}

export function compareProtectionSnapshots(before, after) {
  const changed = Object.keys(before.hashes).filter((name) => after.hashes[name] !== before.hashes[name]);
  const addedOrRemoved = Object.keys(after.hashes).filter((name) => !(name in before.hashes));
  return { pass: changed.length === 0 && addedOrRemoved.length === 0 && before.combinedHash === after.combinedHash, changed, addedOrRemoved, beforeCombinedHash: before.combinedHash, afterCombinedHash: after.combinedHash };
}

export function openingRange(bars) {
  const orBars = bars.filter((bar) => ['00:45:00.000Z', '00:50:00.000Z', '00:55:00.000Z'].some((suffix) => bar.timestamp.endsWith(suffix)));
  if (orBars.length !== 3 || orBars.some((bar) => bar.complete !== true)) return { qualityState: 'UNAVAILABLE', noSampleReason: 'OPENING_RANGE_INCOMPLETE' };
  return {
    qualityState: 'PASS',
    orHigh: Math.max(...orBars.map((bar) => bar.high)),
    orLow: Math.min(...orBars.map((bar) => bar.low)),
    orAvailableAt: `${bars[0].timestamp.slice(0, 10)}T01:00:00.000Z`,
    barTimestamps: orBars.map((bar) => bar.timestamp),
  };
}

export function validateH0Replay(replay, manifestRow) {
  const contractCode = replay.contract || replay.contractCode;
  const bars = Array.isArray(replay.bars) ? replay.bars : [];
  const expectedStart = `${manifestRow.tradeDate}T00:45:00.000Z`;
  const barsValid = bars.length >= 28 && bars.every((bar, index) => {
    const expected = new Date(Date.parse(expectedStart) + index * 300_000).toISOString();
    return bar.complete === true && bar.timestamp === expected
      && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
      && bar.high >= Math.max(bar.open, bar.close, bar.low)
      && bar.low <= Math.min(bar.open, bar.close, bar.high) && bar.volume >= 0;
  });
  return {
    pass: replay.product === 'TX' && replay.tradeDate === manifestRow.tradeDate
      && contractCode === manifestRow.actualReplayContractCode && barsValid,
    contractCode, barCount: bars.length, requiredThrough1100Complete: bars.length >= 28 && bars.slice(0, 28).every((bar) => bar.complete === true),
  };
}

export function firstBreakout(bars, orHigh, orLow) {
  const eligible = bars.filter((bar) => bar.complete === true && bar.timestamp >= `${bar.timestamp.slice(0, 10)}T01:00:00.000Z` && bar.timestamp <= `${bar.timestamp.slice(0, 10)}T01:55:00.000Z`);
  for (const bar of eligible) {
    if (bar.close > orHigh) return { direction: 'LONG', confirmationBar: bar };
    if (bar.close < orLow) return { direction: 'SHORT', confirmationBar: bar };
  }
  return null;
}

export function conservativeBarEvent({ direction, stopPrice, oneRPrice, bar }) {
  const stopTouched = direction === 'LONG' ? bar.low <= stopPrice : bar.high >= stopPrice;
  const oneRTouched = direction === 'LONG' ? bar.high >= oneRPrice : bar.low <= oneRPrice;
  if (stopTouched) return { event: 'STOP', sequencePolicy: oneRTouched ? 'STOP_FIRST' : 'OBSERVED_STOP', ambiguous: oneRTouched };
  if (oneRTouched) return { event: 'ONE_R', sequencePolicy: 'OBSERVED_ONE_R', ambiguous: false };
  return { event: null, sequencePolicy: 'NO_EVENT', ambiguous: false };
}

export function resolveOrderedTickEvent({ direction, stopPrice, oneRPrice, ticks }) {
  const ordered = [...ticks].filter((tick) => Number.isFinite(tick.price) && typeof tick.exchangeTimestamp === 'string')
    .sort((a, b) => a.exchangeTimestamp.localeCompare(b.exchangeTimestamp));
  for (let index = 0; index < ordered.length; index += 1) {
    const tick = ordered[index];
    const sameTime = ordered.filter((row) => row.exchangeTimestamp === tick.exchangeTimestamp);
    const stop = sameTime.some((row) => direction === 'LONG' ? row.price <= stopPrice : row.price >= stopPrice);
    const oneR = sameTime.some((row) => direction === 'LONG' ? row.price >= oneRPrice : row.price <= oneRPrice);
    if (stop) return { event: 'STOP', exchangeTimestamp: tick.exchangeTimestamp, sequencePolicy: oneR ? 'AMBIGUOUS_SEQUENCE_CONSERVATIVE' : 'TICK_TIME_ORDER', tickCount: ordered.length };
    if (oneR) return { event: 'ONE_R', exchangeTimestamp: tick.exchangeTimestamp, sequencePolicy: 'TICK_TIME_ORDER', tickCount: ordered.length };
    while (index + 1 < ordered.length && ordered[index + 1].exchangeTimestamp === tick.exchangeTimestamp) index += 1;
  }
  return { event: null, exchangeTimestamp: null, sequencePolicy: 'TICK_TIME_ORDER', tickCount: ordered.length };
}

export function referenceExitFromBars({ bars, entryIndex, direction, stopPrice, timeExitAt }) {
  for (let index = entryIndex; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.timestamp >= timeExitAt) return { sampleState: 'ELIGIBLE', exitReason: 'TIME_EXIT', exitAt: bar.timestamp, exitReferencePrice: bar.open, exitBarIndex: index, eventSequencePolicy: 'TIME_EXIT_AT_BAR_OPEN' };
    const stopTouched = direction === 'LONG' ? bar.low <= stopPrice : bar.high >= stopPrice;
    if (stopTouched) {
      const gap = direction === 'LONG' ? bar.open <= stopPrice : bar.open >= stopPrice;
      return { sampleState: 'ELIGIBLE', exitReason: 'STOP_EXIT', exitAt: bar.timestamp, exitReferencePrice: gap ? bar.open : stopPrice, exitBarIndex: index, eventSequencePolicy: gap ? 'FIRST_LEGAL_ADVERSE_BAR_OPEN' : 'OHLC_STOP_FIRST' };
    }
  }
  return { sampleState: 'NO_SAMPLE', noSampleReason: 'TIME_EXIT_PRICE_UNAVAILABLE' };
}

export function calculateMaeMfeFromBars({ direction, entryPrice, bars }) {
  if (!bars.length) return { qualityState: 'UNAVAILABLE', maePoints: null, mfePoints: null };
  if (direction === 'LONG') return { qualityState: 'PASS', maePoints: Math.min(...bars.map((bar) => bar.low - entryPrice)), mfePoints: Math.max(...bars.map((bar) => bar.high - entryPrice)) };
  return { qualityState: 'PASS', maePoints: Math.min(...bars.map((bar) => entryPrice - bar.high)), mfePoints: Math.max(...bars.map((bar) => entryPrice - bar.low)) };
}

export function calculateExactVwap(ticks) {
  const valid = (ticks || []).filter((tick) => Number.isFinite(tick.price) && Number.isFinite(tick.volume) && tick.volume > 0);
  const volume = valid.reduce((sum, tick) => sum + tick.volume, 0);
  if (!(volume > 0)) return { value: null, qualityState: 'UNAVAILABLE', tickCount: 0 };
  return { value: valid.reduce((sum, tick) => sum + tick.price * tick.volume, 0) / volume, qualityState: 'PASS', tickCount: valid.length, volume };
}

export function falseBreakoutFromBars({ direction, entryPrice, stopPrice, orHigh, orLow, bars }) {
  if (!Array.isArray(bars) || bars.length < 3 || bars.slice(0, 3).some((bar) => bar.complete !== true)) return { falseBreakout: 'UNAVAILABLE', falseBreakoutQualityState: 'UNAVAILABLE', falseBreakoutReason: 'FALSE_BREAKOUT_PATH_UNAVAILABLE' };
  const oneR = Math.abs(entryPrice - stopPrice);
  const oneRPrice = direction === 'LONG' ? entryPrice + oneR : entryPrice - oneR;
  let reachedOneR = false;
  for (let index = 0; index < 3; index += 1) {
    const bar = bars[index];
    const event = conservativeBarEvent({ direction, stopPrice, oneRPrice, bar });
    if (event.event === 'STOP') return { falseBreakout: true, falseBreakoutQualityState: 'DEGRADED_CONSERVATIVE', falseBreakoutReason: 'STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW', observationBarNumber: index + 1, sequencePolicy: event.sequencePolicy };
    if (event.event === 'ONE_R') reachedOneR = true;
    const returned = direction === 'LONG' ? bar.close <= orHigh : bar.close >= orLow;
    if (returned) return reachedOneR
      ? { falseBreakout: false, falseBreakoutQualityState: 'DEGRADED_CONSERVATIVE', falseBreakoutReason: 'FAVORABLE_1R_REACHED_BEFORE_OR_RETURN', observationBarNumber: index + 1 }
      : { falseBreakout: true, falseBreakoutQualityState: 'DEGRADED_CONSERVATIVE', falseBreakoutReason: direction === 'LONG' ? 'RETURNED_BELOW_OR_HIGH_BEFORE_1R' : 'RETURNED_ABOVE_OR_LOW_BEFORE_1R', observationBarNumber: index + 1 };
  }
  return { falseBreakout: false, falseBreakoutQualityState: 'DEGRADED_CONSERVATIVE', falseBreakoutReason: reachedOneR ? 'FAVORABLE_1R_REACHED_WITHIN_WINDOW' : 'NO_OR_RETURN_WITHIN_THREE_BARS' };
}

export function costViewsForTrade({ direction, entryReferencePrice, exitReferencePrice }, costPolicy) {
  const sign = direction === 'LONG' ? 1 : -1;
  const multiplier = costPolicy.instruments.TX.contractMultiplier;
  return costPolicy.costViews.map((view) => {
    if (view.viewId === 'GROSS') {
      const grossPnl = (exitReferencePrice - entryReferencePrice) * sign * multiplier;
      return { viewId: view.viewId, slippageTicksPerSide: 0, actualEntryFillIndex: entryReferencePrice, actualExitFillIndex: exitReferencePrice, grossPnl, entryCommission: 0, exitCommission: 0, entryTax: 0, exitTax: 0, entrySlippage: 0, exitSlippage: 0, totalCost: 0, netPnl: grossPnl, accountingEquivalent: true };
    }
    const result = calculateTradeCost({ instrument: 'TX', entryIndex: entryReferencePrice, exitIndex: exitReferencePrice, direction, slippageTicksPerSide: view.slippageTicksPerSide }, costPolicy);
    const actualFillPnl = (result.actualExitFillIndex - result.actualEntryFillIndex) * sign * multiplier;
    const actualFillNet = actualFillPnl - result.entryCommission - result.exitCommission - result.entryTax - result.exitTax;
    return { viewId: view.viewId, slippageTicksPerSide: view.slippageTicksPerSide, ...result, actualFillPnl, actualFillNet, accountingEquivalent: actualFillNet === result.netPnl };
  });
}

export function executeNaturalSession({ manifestRow, replay, costPolicy, referenceSessions = [] }) {
  const replayAudit = validateH0Replay(replay, manifestRow);
  const base = {
    schemaVersion: 't0-h0-session-result-v1', fixtureOnly: false, officialResearchEligible: false, synthetic: false,
    tradeDate: manifestRow.tradeDate, sessionId: manifestRow.sessionId, contractCode: manifestRow.actualReplayContractCode,
    settlementClass: manifestRow.settlementClass, rollSession: manifestRow.rollSession,
    eligibilityClass: manifestRow.eligibilityClass, replayResolution: 'FIVE_MINUTE_OHLC', pathQuality: 'DEGRADED_CONSERVATIVE',
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  if (!replayAudit.pass) return { ...base, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE', noSampleReason: replayAudit.contractCode !== manifestRow.actualReplayContractCode ? 'MANIFEST_CONTRACT_MISMATCH' : 'REPLAY_QUALITY_FAILED' };
  const or = openingRange(replay.bars);
  if (or.qualityState !== 'PASS') return { ...base, ...or, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE' };
  const breakout = firstBreakout(replay.bars, or.orHigh, or.orLow);
  if (!breakout) return { ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'NO_TRADE', noTradeReason: 'NO_BREAKOUT_WITHIN_ENTRY_WINDOW', breakoutDirection: null };
  const confirmationIndex = replay.bars.indexOf(breakout.confirmationBar);
  const entryBar = replay.bars[confirmationIndex + 1];
  if (!entryBar || entryBar.timestamp > `${manifestRow.tradeDate}T02:00:00.000Z`) return { ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'NO_TRADE', noTradeReason: 'ENTRY_WINDOW_EXPIRED', breakoutDirection: breakout.direction, breakoutConfirmedAt: breakout.confirmationBar.timestamp };
  const stopPrice = breakout.direction === 'LONG' ? or.orLow : or.orHigh;
  const gap = evaluateEntryGapThroughStop({ direction: breakout.direction, entryOpen: entryBar.open, stopPrice });
  if (gap.tradeState === 'NO_TRADE') return { ...base, ...or, sampleState: 'ELIGIBLE', ...gap, breakoutConfirmedAt: breakout.confirmationBar.timestamp, entryAt: null, stopPrice };
  const timeExitAt = new Date(Date.parse(entryBar.timestamp) + 60 * 60_000).toISOString();
  const exit = referenceExitFromBars({ bars: replay.bars, entryIndex: confirmationIndex + 1, direction: breakout.direction, stopPrice, timeExitAt });
  if (exit.sampleState === 'NO_SAMPLE') return { ...base, ...or, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE', noSampleReason: exit.noSampleReason, breakoutDirection: breakout.direction };
  const pathBars = replay.bars.slice(confirmationIndex + 1, exit.exitBarIndex + 1);
  const maeMfe = calculateMaeMfeFromBars({ direction: breakout.direction, entryPrice: entryBar.open, bars: pathBars });
  const oneR = Math.abs(entryBar.open - stopPrice);
  const falseBreakout = falseBreakoutFromBars({ direction: breakout.direction, entryPrice: entryBar.open, stopPrice, orHigh: or.orHigh, orLow: or.orLow, bars: replay.bars.slice(confirmationIndex + 1, confirmationIndex + 4) });
  const cumulativeVolume = replay.bars.slice(0, confirmationIndex + 2).reduce((sum, bar) => sum + bar.volume, 0);
  const rvol20 = calculateRvol20({ currentTradeDate: manifestRow.tradeDate, currentSessionId: manifestRow.sessionId, currentSessionType: 'DAY', timeBucket: entryBar.timestamp.slice(11, 16), currentCumulativeVolume: cumulativeVolume, referenceSessions });
  const costs = costViewsForTrade({ direction: breakout.direction, entryReferencePrice: entryBar.open, exitReferencePrice: exit.exitReferencePrice }, costPolicy);
  return {
    ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'TRADE', noTradeReason: null,
    breakoutDirection: breakout.direction, breakoutConfirmedAt: breakout.confirmationBar.timestamp,
    entryAt: entryBar.timestamp, entryReferencePrice: entryBar.open, initialStopPrice: stopPrice,
    exitAt: exit.exitAt, exitReferencePrice: exit.exitReferencePrice, exitReason: exit.exitReason,
    eventSequencePolicy: exit.eventSequencePolicy, timeExitAt, maePoints: maeMfe.maePoints, mfePoints: maeMfe.mfePoints,
    maeR: oneR > 0 ? maeMfe.maePoints / oneR : null, mfeR: oneR > 0 ? maeMfe.mfePoints / oneR : null,
    falseBreakout, vwapContext: { value: null, qualityState: 'UNAVAILABLE', reason: 'EXACT_TICK_VWAP_NOT_AVAILABLE_IN_NATURAL_SMOKE' },
    rvol20Context: rvol20, costViews: costs,
  };
}

export function summarizeEngineeringResults(results, { fixture = false } = {}) {
  const counts = {
    manifestSessionCount: fixture ? 0 : results.length,
    processedSessionCount: fixture ? 0 : results.length,
    researchEligibleSessionCount: fixture ? 0 : results.filter((row) => row.tradeState !== 'NO_SAMPLE').length,
    tradeCount: fixture ? 0 : results.filter((row) => row.tradeState === 'TRADE').length,
    noTradeCount: fixture ? 0 : results.filter((row) => row.tradeState === 'NO_TRADE').length,
    noSampleCount: fixture ? 0 : results.filter((row) => row.tradeState === 'NO_SAMPLE').length,
    fixtureCount: fixture ? results.length : 0,
  };
  return {
    schemaVersion: 't0-h0-smoke-summary-v1', summaryType: fixture ? 'SYNTHETIC_ENGINEERING_FIXTURE_ONLY' : 'NATURAL_ENGINEERING_SMOKE_ONLY',
    counts, performanceSummaryProduced: false, diagnosticWarningOnly: true, promotionGate: false,
    sampleExclusionRule: false, tradingRule: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

export function buildSyntheticFixtures(costPolicy) {
  const longCosts = costViewsForTrade({ direction: 'LONG', entryReferencePrice: 20_000, exitReferencePrice: 20_010 }, costPolicy);
  const shortCosts = costViewsForTrade({ direction: 'SHORT', entryReferencePrice: 20_010, exitReferencePrice: 20_000 }, costPolicy);
  const fixtures = [
    { fixtureId: 'LONG_TIME_EXIT', purpose: 'Long與Time Exit', outcome: { direction: 'LONG', exitReason: 'TIME_EXIT', costViews: longCosts } },
    { fixtureId: 'SHORT_TIME_EXIT', purpose: 'Short與Time Exit', outcome: { direction: 'SHORT', exitReason: 'TIME_EXIT', costViews: shortCosts } },
    { fixtureId: 'ENTRY_GAP_THROUGH_STOP', purpose: 'Entry gap-through形成NO_TRADE', outcome: evaluateEntryGapThroughStop({ direction: 'LONG', entryOpen: 99, stopPrice: 100 }) },
    { fixtureId: 'ENTRY_WINDOW_EXPIRED', purpose: 'Entry Window逾時形成NO_TRADE', outcome: evaluateEntryWindow({ confirmationBarStart: '2026-01-01T10:00:00+08:00', confirmationBarEnd: '2026-01-01T10:05:00+08:00', entryTimestamp: '2026-01-01T10:05:00+08:00' }) },
    { fixtureId: 'OHLC_STOP_FIRST', purpose: 'OHLC同棒Stop與1R採STOP_FIRST', outcome: conservativeBarEvent({ direction: 'LONG', stopPrice: 90, oneRPrice: 110, bar: { high: 111, low: 89 } }) },
    { fixtureId: 'STOP_GAP_THROUGH', purpose: '持倉後價格跳越Stop使用第一個合法不利開盤價', outcome: referenceExitFromBars({ bars: [{ timestamp: '2026-01-01T01:05:00.000Z', open: 88, high: 92, low: 87, close: 90, complete: true }], entryIndex: 0, direction: 'LONG', stopPrice: 90, timeExitAt: '2026-01-01T02:00:00.000Z' }) },
    { fixtureId: 'AMBIGUOUS_SEQUENCE_CONSERVATIVE', purpose: '無法排序採保守不利路徑', outcome: { sequencePolicy: 'AMBIGUOUS_SEQUENCE_CONSERVATIVE', chosenEvent: 'STOP' } },
    { fixtureId: 'TICK_ORDERING', purpose: '完整Tick按時間順序優先', outcome: { replayResolution: 'TICK', ...resolveOrderedTickEvent({ direction: 'LONG', stopPrice: 90, oneRPrice: 110, ticks: [{ exchangeTimestamp: '2026-01-01T01:00:00.000Z', price: 110 }, { exchangeTimestamp: '2026-01-01T01:00:01.000Z', price: 89 }] }) } },
    { fixtureId: 'FALSE_BREAKOUT_THREE_BARS', purpose: '三棒False Breakout診斷', outcome: falseBreakoutFromBars({ direction: 'LONG', entryPrice: 105, stopPrice: 95, orHigh: 103, orLow: 95, bars: [{ high: 108, low: 102, close: 103, complete: true }, { high: 105, low: 101, close: 102, complete: true }, { high: 104, low: 100, close: 101, complete: true }] }) },
    { fixtureId: 'FALSE_BREAKOUT_UNAVAILABLE', purpose: '診斷路徑不足', outcome: falseBreakoutFromBars({ direction: 'LONG', entryPrice: 105, stopPrice: 95, orHigh: 103, orLow: 95, bars: [] }) },
    { fixtureId: 'NO_SAMPLE_BRANCH', purpose: 'NO_SAMPLE與NO_TRADE分離', outcome: { tradeState: 'NO_SAMPLE', noSampleReason: 'TIME_EXIT_PRICE_UNAVAILABLE' } },
    { fixtureId: 'EXACT_VWAP', purpose: '逐筆VWAP診斷', outcome: calculateExactVwap([{ price: 100, volume: 2 }, { price: 103, volume: 1 }]) },
    { fixtureId: 'RVOL20_PAST_ONLY', purpose: 'RVOL20只使用過去資料', outcome: calculateRvol20({ currentTradeDate: '2026-02-01', currentSessionId: 'CURRENT', currentSessionType: 'DAY', timeBucket: '09:30', currentCumulativeVolume: 2000, referenceSessions: Array.from({ length: 20 }, (_, index) => ({ tradeDate: `2026-01-${String(index + 2).padStart(2, '0')}`, sessionId: `R${index}`, sessionType: 'DAY', timeBucket: '09:30', cumulativeVolume: 1000, isSettlementSession: false, rollSession: false })) }) },
    { fixtureId: 'HARD_BACKSTOP_NOT_TIME_EXIT', purpose: 'Safety Backstop不得替代Time Exit', outcome: { hardBackstopIsNormalExit: false, timeExitFallbackForbidden: true } },
  ];
  return fixtures.map((fixture) => ({ schemaVersion: 't0-h0-engineering-fixture-v1', fixtureOnly: true, officialResearchEligible: false, synthetic: true, formalWeight: 0, researchOnly: true, executionAuthorized: false, ...fixture }));
}

export function initializeOrResumeRun({ root, runDir, runId, mode, jobs, frozenHashes, resume = false }) {
  const manifestFile = path.join(runDir, 'RUN_MANIFEST.json');
  if (fs.existsSync(manifestFile)) {
    if (!resume) throw new Error('HARD_FAIL_RUN_EXISTS_USE_RESUME');
    const manifest = readJson(manifestFile);
    if (manifest.runId !== runId || manifest.mode !== mode || hashJson(manifest.frozenHashes) !== hashJson(frozenHashes)) throw new Error('HARD_FAIL_RESUME_FINGERPRINT_MISMATCH');
    for (const job of manifest.jobs.filter((row) => row.status === 'COMPLETED')) {
      if (!fs.existsSync(job.outputPath) || fileSha256(job.outputPath) !== job.outputHash) throw new Error(`HARD_FAIL_COMPLETED_OUTPUT_HASH:${job.jobId}`);
    }
    return manifest;
  }
  const manifest = {
    schemaVersion: 't0-h0-smoke-run-manifest-v1', runId, mode, status: 'PENDING', frozenHashes,
    jobs: jobs.map((job) => ({ jobId: job.jobId, status: 'PENDING', outputPath: path.join(runDir, 'jobs', `${job.jobId}.json`), outputHash: null, error: null })),
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  atomicJson(manifestFile, manifest);
  return manifest;
}

export function commitJob({ runDir, manifest, jobId, output }) {
  const job = manifest.jobs.find((row) => row.jobId === jobId);
  if (!job) throw new Error(`HARD_FAIL_UNKNOWN_JOB:${jobId}`);
  if (job.status === 'COMPLETED') throw new Error(`HARD_FAIL_COMPLETED_JOB_OVERWRITE:${jobId}`);
  atomicJson(job.outputPath, output);
  job.outputHash = fileSha256(job.outputPath);
  job.status = 'COMPLETED';
  job.error = null;
  atomicJson(path.join(runDir, 'RUN_MANIFEST.json'), manifest);
  return job;
}

export function finalizeRun({ runDir, manifest, summary }) {
  const summaryFile = path.join(runDir, 'SUMMARY.json');
  atomicJson(summaryFile, summary);
  const logicalInputs = {
    jobs: manifest.jobs.map((job) => ({ jobId: job.jobId, outputHash: job.outputHash })),
    summaryHash: fileSha256(summaryFile),
  };
  manifest.status = manifest.jobs.every((job) => job.status === 'COMPLETED') ? 'COMPLETED' : 'PENDING';
  manifest.summaryPath = summaryFile;
  manifest.summaryHash = logicalInputs.summaryHash;
  manifest.logicalOutputHash = hashJson(logicalInputs);
  atomicJson(path.join(runDir, 'RUN_MANIFEST.json'), manifest);
  return manifest;
}
