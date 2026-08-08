import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PAPER_EVENT_SPECIFICATION,
  appendPaperEvent,
  auditPaperEventLedger,
  createPaperEvent,
  paperSpecificationHash,
  readPaperEventLedger,
} from '../src/paper-event-ledger.mjs';
import { intradayStrategyEngineConstants } from '../src/intraday-strategy-engine.mjs';

const bar1 = '2026-07-16T00:45:00.000Z';
const bar2 = '2026-07-16T00:50:00.000Z';
const now = new Date('2026-07-18T12:00:00.000Z');

function evidence({ source = 'historical_replay', auditState = 'passed_with_scope_warning', cursor = 1 } = {}) {
  const payload = {
    schemaVersion: '1.0.0', source, provider: 'TAIFEX official 30-day tick file',
    product: 'TX', contract: '202608', session: 'day', timeframe: '5m', tradeDate: '2026-07-16',
    bars: [
      { timestamp: bar1, open: 98, high: 101, low: 97, close: 100, volume: 10 },
      { timestamp: bar2, open: 100, high: 120, low: 95, close: 115, volume: 20 },
    ],
  };
  return {
    source: payload,
    audit: { state: auditState, generatedAt: '2026-07-18T10:00:00.000Z', tradeDate: '2026-07-16', contract: '202608', executionAuthorized: false },
    cursor,
    observedThrough: payload.bars[cursor - 1]?.timestamp,
  };
}

function base(eventType, virtualTime = bar1) {
  return { eventType, candidateId: 'demo-20260716-1', tradeDate: '2026-07-16', contract: '202608', session: 'day', virtualTime };
}

function candidate() {
  return {
    ...base('candidate'), setupKey: 'opening_range_breakout', direction: 'long',
    thesis: 'paper observation only', triggerCondition: 'close above frozen level',
    invalidationCondition: 'close below frozen level', intendedStopPoints: 10, intendedTargetR: 1.5, horizonMinutes: 60,
  };
}

test('paper specification hash is stable and frozen cost assumptions are included', () => {
  assert.match(paperSpecificationHash(), /^[a-f0-9]{64}$/);
  assert.equal(PAPER_EVENT_SPECIFICATION.costAssumptions.totalRoundTripPoints, 8);
  assert.equal(PAPER_EVENT_SPECIFICATION.executionAuthorized, false);
  for (const strategy of Object.values(intradayStrategyEngineConstants.strategies)) {
    assert.ok(PAPER_EVENT_SPECIFICATION.allowedSetupKeys.includes(strategy));
  }
});

test('append-only paper ledger records candidate, trigger, exit and derived outcome', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-paper-events-'));
  const ledger = path.join(folder, 'events.jsonl');
  try {
    appendPaperEvent(ledger, candidate(), evidence(), { now });
    appendPaperEvent(ledger, { ...base('trigger', bar2), entryPrice: 100, stopPrice: 90, targetPrice: 115 }, evidence({ cursor: 2 }), { now });
    appendPaperEvent(ledger, { ...base('exit', bar2), exitPrice: 115, exitReason: 'frozen target reached' }, evidence({ cursor: 2 }), { now });
    appendPaperEvent(ledger, { ...base('outcome', bar2), outcomeNote: 'paper close review' }, evidence({ cursor: 2 }), { now });
    const rows = readPaperEventLedger(ledger);
    assert.deepEqual(rows.map((row) => row.eventType), ['candidate', 'trigger', 'exit', 'outcome']);
    assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3, 4]);
    assert.equal(rows[1].previousRecordHash, rows[0].recordHash);
    assert.equal(rows[3].grossPoints, 15);
    assert.equal(rows[3].costPoints, 8);
    assert.equal(rows[3].netPoints, 7);
    assert.equal(rows[3].maePoints, -5);
    assert.equal(rows[3].mfePoints, 20);
    assert.deepEqual(rows[3].netPointsByCost, { 4: 11, 8: 7, 16: -1 });
    assert.equal(rows.every((row) => row.executionAuthorized === false && row.researchOnly === true), true);
    assert.deepEqual(auditPaperEventLedger(rows, { now }).errors, []);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('candidate may be cancelled but terminal candidate cannot be reopened', () => {
  const first = createPaperEvent(candidate(), evidence(), [], { now });
  const cancelled = createPaperEvent({ ...base('cancel'), cancelReason: 'condition expired' }, evidence(), [first], { now });
  assert.equal(cancelled.eventType, 'cancel');
  assert.throws(
    () => createPaperEvent({ ...base('trigger', bar2), entryPrice: 100, stopPrice: 90, targetPrice: 115 }, evidence({ cursor: 2 }), [first, cancelled], { now }),
    /TRANSITION_INVALID/,
  );
});

test('paper ledger rejects mock, unaudited, execution-enabled and future observations', () => {
  assert.throws(() => createPaperEvent(candidate(), evidence({ source: 'mock' }), [], { now }), /MOCK_FORBIDDEN|SOURCE_NOT_ALLOWED/);
  assert.throws(() => createPaperEvent(candidate(), evidence({ auditState: 'not_audited' }), [], { now }), /AUDIT_NOT_PASSED/);
  assert.throws(() => createPaperEvent({ ...candidate(), executionAuthorized: true }, evidence(), [], { now }), /EXECUTION_FORBIDDEN/);
  assert.throws(() => createPaperEvent(candidate(), evidence(), [], { now: new Date('2026-07-15T12:00:00.000Z') }), /FUTURE_TIME_FORBIDDEN/);
  assert.throws(
    () => createPaperEvent({ ...candidate(), virtualTime: bar2 }, evidence({ cursor: 1 }), [], { now }),
    /VIRTUAL_TIME_MUST_MATCH_CURSOR/,
  );
});

test('paper ledger rejects an event without candidate and detects hash tampering', () => {
  assert.throws(
    () => createPaperEvent({ ...base('trigger', bar2), entryPrice: 100, stopPrice: 90, targetPrice: 115 }, evidence({ cursor: 2 }), [], { now }),
    /CANDIDATE_REQUIRED/,
  );
  const record = createPaperEvent(candidate(), evidence(), [], { now });
  const tampered = { ...record, thesis: 'changed after append' };
  assert.ok(auditPaperEventLedger([tampered], { now }).errors.includes('row_1_record_hash_mismatch'));
});

test('same-bar stop and target touch is conservatively resolved as stop first', () => {
  const bothTouchEvidence = evidence({ cursor: 2 });
  bothTouchEvidence.source.bars[1] = { ...bothTouchEvidence.source.bars[1], high: 116, low: 89 };
  const first = createPaperEvent(candidate(), evidence(), [], { now });
  const trigger = createPaperEvent(
    { ...base('trigger', bar2), entryPrice: 100, stopPrice: 90, targetPrice: 115 },
    bothTouchEvidence,
    [first],
    { now },
  );
  const wrongExit = createPaperEvent(
    { ...base('exit', bar2), exitPrice: 115, exitReason: 'target reached' },
    bothTouchEvidence,
    [first, trigger],
    { now },
  );
  assert.throws(
    () => createPaperEvent({ ...base('outcome', bar2) }, bothTouchEvidence, [first, trigger, wrongExit], { now }),
    /SAME_BAR_DOUBLE_TOUCH_MUST_STOP/,
  );
  const stopExit = createPaperEvent(
    { ...base('exit', bar2), exitPrice: 90, exitReason: 'same_bar_double_touch_stop_first' },
    bothTouchEvidence,
    [first, trigger],
    { now },
  );
  const outcome = createPaperEvent({ ...base('outcome', bar2) }, bothTouchEvidence, [first, trigger, stopExit], { now });
  assert.equal(outcome.sameBarDoubleTouch, true);
  assert.equal(outcome.grossPoints, -10);
  assert.equal(outcome.netPoints, -18);
});

test('MAE and MFE are zero-bounded when price never visits one side of entry', () => {
  const oneSidedEvidence = evidence({ cursor: 2 });
  oneSidedEvidence.source.bars[1] = { ...oneSidedEvidence.source.bars[1], open: 100, high: 108, low: 100, close: 107 };
  const first = createPaperEvent(candidate(), evidence(), [], { now });
  const trigger = createPaperEvent(
    { ...base('trigger', bar2), entryPrice: 100, stopPrice: 90, targetPrice: 115 },
    oneSidedEvidence,
    [first],
    { now },
  );
  const exit = createPaperEvent(
    { ...base('exit', bar2), exitPrice: 107, exitReason: 'horizon close' },
    oneSidedEvidence,
    [first, trigger],
    { now },
  );
  const outcome = createPaperEvent({ ...base('outcome', bar2) }, oneSidedEvidence, [first, trigger, exit], { now });
  assert.equal(outcome.maePoints, 0);
  assert.equal(outcome.mfePoints, 8);
  assert.deepEqual(auditPaperEventLedger([first, trigger, exit, outcome], { now }).errors, []);
});
