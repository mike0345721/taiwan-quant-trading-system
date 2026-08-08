import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateOutcome, v34CandidateSignals } from '../src/v3-4-forward.mjs';

test('V3.4 reversal candidates use frozen mirror directions', () => {
  const history = Array.from({ length: 20 }, (_, index) => ({ foreignShortDelta3d: index }));
  const signals = v34CandidateSignals(history, { txReturn1d: 1, marketOiDelta1d: 10, foreignShortDelta3d: 20 });
  assert.equal(signals[0].signal, -1); assert.equal(signals[1].signal, 1);
});

test('V3.4 outcome refuses contract rollover', () => {
  const signal = { strategyKey: 'x', signalDate: '2026-01-01', signal: 1, horizonDays: 2 };
  const row = { txContract: '202601', futureBars: [{ tradeDate: 'a', txContract: '202601', open: 100, close: 101 }, { tradeDate: 'b', txContract: '202602', open: 101, close: 102 }] };
  assert.equal(resolveCandidateOutcome(signal, row), null);
});
