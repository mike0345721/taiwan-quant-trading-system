import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectIntradayStrategyCandidates,
  evaluateIntradayStrategies,
  writeIntradayStrategyEngineeringReport,
} from '../src/intraday-strategy-engine.mjs';

function makeRows(tradeDate = '2026-07-14', contract = '202607') {
  const start = Date.parse(`${tradeDate}T00:45:00.000Z`);
  return Array.from({ length: 60 }, (_, barIndex) => ({
    schemaVersion: '1.0.0',
    datasetVersion: 'test',
    rowType: 'bar_feature',
    tradeDate,
    timestamp: new Date(start + barIndex * 300_000).toISOString(),
    featureAvailableAt: new Date(start + (barIndex + 1) * 300_000).toISOString(),
    product: 'TX',
    contract,
    session: 'day',
    timeframe: '5m',
    barIndex,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100 + barIndex,
    vwapProxyHlc3: 100,
    rvol20SameSlot: null,
    rvol20SampleDays: 0,
    rvol20Ready: false,
    sourceAuditState: 'passed_with_scope_warning',
    researchOnly: true,
    executionAuthorized: false,
  }));
}

function setBar(rows, index, values) {
  rows[index] = { ...rows[index], ...values };
}

function setVwaps(rows, values) {
  Object.entries(values).forEach(([index, value]) => {
    rows[Number(index)] = { ...rows[Number(index)], vwapProxyHlc3: value };
  });
}

test('ORB forms on a completed bar, enters at the next open, and a same-bar double touch stops first', () => {
  const rows = makeRows();
  setBar(rows, 3, { open: 100, high: 103, low: 100, close: 102 });
  setBar(rows, 4, { open: 102, high: 106, low: 99, close: 103 });
  const report = evaluateIntradayStrategies(rows);
  const event = report.events.find((row) => row.strategy === 'opening_range_breakout'
    && row.direction === 'long' && row.signalBarIndex === 3);
  assert.equal(event.state, 'triggered');
  assert.equal(event.signalTimestamp, rows[3].timestamp);
  assert.equal(event.entryTimestamp, rows[4].timestamp);
  assert.equal(event.entryPrice, 102);
  assert.equal(event.initialStop, 100);
  assert.equal(event.riskPoints, 2);
  assert.equal(event.targetPrice, 105);
  assert.equal(event.executionAuthorized, false);

  const outcome = report.outcomes.find((row) => row.eventId === event.eventId && row.horizonMinutes === 30);
  assert.equal(outcome.state, 'complete');
  assert.equal(outcome.exitReason, 'stop');
  assert.equal(outcome.sameBarDoubleTouch, true);
  assert.equal(outcome.grossPoints, -2);
  assert.equal(outcome.mfePoints, 4);
  assert.equal(outcome.maePoints, -3);
  assert.deepEqual(outcome.costScenarios.map((item) => [item.roundTripCostPoints, item.netPoints]), [
    [4, -6], [8, -10], [16, -18],
  ]);
});

test('future bars cannot change an already-formed candidate snapshot', () => {
  const rows = makeRows();
  setBar(rows, 3, { open: 100, high: 103, low: 100, close: 102 });
  const before = detectIntradayStrategyCandidates(rows)
    .find((row) => row.strategy === 'opening_range_breakout' && row.direction === 'long' && row.signalIndex === 3);
  setBar(rows, 20, { open: 20, high: 999, low: 1, close: 888, volume: 99_999 });
  const after = detectIntradayStrategyCandidates(rows)
    .find((row) => row.strategy === 'opening_range_breakout' && row.direction === 'long' && row.signalIndex === 3);
  assert.deepEqual(after, before);
});

test('insufficient 30, 60 and 120 minute paths remain unavailable and null', () => {
  const rows = makeRows();
  setBar(rows, 57, { open: 100, high: 103, low: 100, close: 102 });
  setBar(rows, 58, { open: 102, high: 103, low: 100, close: 101 });
  setBar(rows, 59, { open: 100, high: 101, low: 99, close: 100 });
  const report = evaluateIntradayStrategies(rows);
  const event = report.events.find((row) => row.strategy === 'opening_range_breakout'
    && row.direction === 'long' && row.signalBarIndex === 57);
  assert.equal(event.state, 'triggered');
  const outcomes = report.outcomes.filter((row) => row.eventId === event.eventId);
  assert.equal(outcomes.length, 3);
  outcomes.forEach((outcome) => {
    assert.equal(outcome.state, 'unavailable');
    assert.equal(outcome.reason, 'session_boundary_insufficient_bars');
    assert.equal(outcome.exitPrice, null);
    assert.equal(outcome.grossPoints, null);
    assert.equal(outcome.mfePoints, null);
    assert.equal(outcome.maePoints, null);
    assert.equal(outcome.costScenarios.every((item) => item.netPoints === null), true);
  });
});

test('target and time-limit exits use fixed 1.5R and exact 30-minute bar boundaries', () => {
  const targetRows = makeRows();
  setBar(targetRows, 3, { open: 100, high: 103, low: 100, close: 102 });
  setBar(targetRows, 4, { open: 102, high: 105, low: 101, close: 104 });
  const targetReport = evaluateIntradayStrategies(targetRows);
  const targetEvent = targetReport.events.find((row) => row.strategy === 'opening_range_breakout'
    && row.direction === 'long' && row.signalBarIndex === 3);
  const targetOutcome = targetReport.outcomes.find((row) => row.eventId === targetEvent.eventId && row.horizonMinutes === 30);
  assert.equal(targetOutcome.exitReason, 'target');
  assert.equal(targetOutcome.exitPrice, 105);
  assert.equal(targetOutcome.grossPoints, 3);
  assert.equal(targetOutcome.grossR, 1.5);
  assert.equal(targetOutcome.costScenarios.find((item) => item.roundTripCostPoints === 4).netPoints, -1);

  const timedRows = makeRows('2026-07-16');
  setBar(timedRows, 3, { open: 100, high: 103, low: 100, close: 102 });
  for (let index = 4; index <= 9; index += 1) {
    setBar(timedRows, index, { open: 102, high: 104, low: 101, close: index === 9 ? 104 : 102 });
  }
  const timedReport = evaluateIntradayStrategies(timedRows);
  const timedEvent = timedReport.events.find((row) => row.strategy === 'opening_range_breakout'
    && row.direction === 'long' && row.signalBarIndex === 3);
  const timedOutcome = timedReport.outcomes.find((row) => row.eventId === timedEvent.eventId && row.horizonMinutes === 30);
  assert.equal(timedOutcome.exitReason, 'time_limit');
  assert.equal(timedOutcome.exitBarIndex, 9);
  assert.equal(timedOutcome.heldBars, 6);
  assert.equal(timedOutcome.heldMinutes, 30);
  assert.equal(timedOutcome.exitPrice, 104);
  assert.equal(timedOutcome.grossPoints, 2);
});

test('VWAP continuation requires a prior same-direction ORB and a past-only slope', () => {
  const rows = makeRows();
  setVwaps(rows, { 2: 100, 3: 100.2, 4: 100.5, 5: 100.7 });
  setBar(rows, 3, { open: 100, high: 103, low: 100.5, close: 102 });
  setBar(rows, 4, { open: 102, high: 102, low: 100.4, close: 101, vwapProxyHlc3: 100.5 });
  setBar(rows, 5, { open: 101, high: 102, low: 100.8, close: 101.5, vwapProxyHlc3: 100.7 });
  const candidates = detectIntradayStrategyCandidates(rows);
  const pullback = candidates.find((row) => row.strategy === 'vwap_pullback_continuation'
    && row.direction === 'long' && row.signalIndex === 4);
  assert.ok(pullback);
  assert.equal(pullback.details.prerequisiteBreakoutIndex, 3);
  assert.ok(Math.abs(pullback.signalFeatures.vwapSlopePoints - 0.3) < 1e-12);
  assert.equal(candidates.some((row) => row.strategy === 'vwap_pullback_continuation' && row.signalIndex === 3), false);
});

test('false breakout is recognized only when the close returns inside within the next three complete bars', () => {
  const within = makeRows();
  setBar(within, 3, { open: 100, high: 104, low: 100, close: 102 });
  setBar(within, 4, { open: 102, high: 103, low: 99.5, close: 100 });
  const withinCandidate = detectIntradayStrategyCandidates(within)
    .find((row) => row.strategy === 'opening_range_false_break_reversion' && row.direction === 'short');
  assert.ok(withinCandidate);
  assert.equal(withinCandidate.signalIndex, 4);
  assert.equal(withinCandidate.initialStop, 104);
  assert.equal(withinCandidate.details.barsAfterBreakout, 1);

  const late = makeRows('2026-07-15');
  setBar(late, 3, { open: 100, high: 104, low: 100, close: 102 });
  for (const index of [4, 5, 6]) setBar(late, index, { open: 102, high: 103, low: 101.5, close: 102 });
  setBar(late, 7, { open: 102, high: 102, low: 99.5, close: 100 });
  assert.equal(detectIntradayStrategyCandidates(late)
    .some((row) => row.strategy === 'opening_range_false_break_reversion' && row.direction === 'short'), false);
});

test('overlapping candidates are logged as not entered and never cross a day or contract boundary', () => {
  const firstDay = makeRows('2026-07-14', '202607');
  for (let index = 3; index < firstDay.length; index += 1) {
    setBar(firstDay, index, { open: 102, high: 103, low: 101.5, close: 102 });
  }
  const secondDay = makeRows('2026-07-15', '202608');
  setBar(secondDay, 59, { open: 100, high: 103, low: 100, close: 102 });
  const report = evaluateIntradayStrategies([...firstDay, ...secondDay]);
  const firstEvent = report.events.find((row) => row.tradeDate === '2026-07-14'
    && row.strategy === 'opening_range_breakout' && row.direction === 'long');
  assert.equal(firstEvent.state, 'triggered');
  assert.equal(report.events.some((row) => row.tradeDate === '2026-07-14'
    && row.strategy === 'opening_range_breakout' && row.direction === 'long'
    && row.state === 'not_entered' && row.blockedByEventId === firstEvent.eventId), true);
  const lastBarEvent = report.events.find((row) => row.tradeDate === '2026-07-15'
    && row.strategy === 'opening_range_breakout' && row.direction === 'long');
  assert.equal(lastBarEvent.state, 'cancelled');
  assert.equal(lastBarEvent.reason, 'no_next_bar_open_before_session_boundary');
  assert.equal(lastBarEvent.entryTimestamp, null);
  assert.equal(report.outcomes.some((row) => row.eventId === lastBarEvent.eventId), false);
  assert.equal(report.summary.lookaheadAndBoundaryAudit.crossContractAllowed, false);
});

test('a next-open gap through the stop cancels the event and generates no result', () => {
  const rows = makeRows();
  setBar(rows, 3, { open: 100, high: 103, low: 100, close: 102 });
  setBar(rows, 4, { open: 99, high: 101, low: 98, close: 100 });
  const report = evaluateIntradayStrategies(rows);
  const event = report.events.find((row) => row.strategy === 'opening_range_breakout'
    && row.direction === 'long' && row.signalBarIndex === 3);
  assert.equal(event.state, 'cancelled');
  assert.equal(event.reason, 'next_open_gapped_through_initial_stop');
  assert.equal(report.outcomes.some((row) => row.eventId === event.eventId), false);
});

test('engineering output is stable, split into event/outcome files, and never authorizes a performance claim', () => {
  const rows = makeRows();
  setBar(rows, 3, { open: 100, high: 103, low: 100, close: 102 });
  const report = evaluateIntradayStrategies(rows, { gates: { formalResearchReady: false } });
  assert.equal(report.summary.researchOnly, true);
  assert.equal(report.summary.executionAuthorized, false);
  assert.equal(report.summary.performanceClaimAuthorized, false);
  assert.equal(report.summary.sampleGate.formalResearchReady, false);
  assert.equal(report.summary.sampleGate.aggregatePerformanceStatisticsSuppressed, true);
  assert.equal(Object.hasOwn(report.summary, 'profitFactor'), false);
  assert.equal(report.events.some((row) => /outcome|gross|net/i.test(Object.keys(row).join(','))), false);

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-strategy-report-'));
  try {
    const files = writeIntradayStrategyEngineeringReport(folder, report);
    const first = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
    const rebuilt = evaluateIntradayStrategies(rows, { gates: { formalResearchReady: false } });
    assert.deepEqual(rebuilt, report);
    writeIntradayStrategyEngineeringReport(folder, rebuilt);
    const second = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
    assert.deepEqual(second, first);
    assert.equal(JSON.parse(first.summary).executionAuthorized, false);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
