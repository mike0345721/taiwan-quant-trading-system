import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveV3Outcomes, validOhlcBar } from '../src/v3-forward-outcomes.mjs';

const row = {
  tradeDate: '2026-07-14', txContract: '202607', txClose: 100,
  futureBars: [
    { tradeDate: '2026-07-15', txContract: '202607', open: 101, high: 104, low: 99, close: 103 },
    { tradeDate: '2026-07-16', txContract: '202607', open: 103, high: 106, low: 102, close: 105 },
  ],
};

test('uses only latest decision version for each signal date', () => {
  const decisions = [
    { version: '3.1.0', dataDate: '2026-07-14', generatedAt: '2026-07-14T10:00:00Z', directionBias: '偏空' },
    { version: '3.1.1', dataDate: '2026-07-14', generatedAt: '2026-07-14T11:00:00Z', directionBias: '偏多' },
  ];
  const result = resolveV3Outcomes(decisions, [row]);
  assert.equal(result.outcomes.length, 2);
  assert.ok(result.outcomes.every((item) => item.decisionVersion === '3.1.1'));
  assert.equal(result.outcomes[0].directionCorrect, true);
});

test('does not resolve a horizon across contract rollover', () => {
  const changed = { ...row, futureBars: [row.futureBars[0], { ...row.futureBars[1], txContract: '202608' }] };
  const result = resolveV3Outcomes([{ version: '3.2.0', dataDate: row.tradeDate, generatedAt: new Date().toISOString() }], [changed]);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].horizonDays, 1);
  assert.equal(result.pending.length, 1);
});

test('strict OHLC validation rejects zero and internally inconsistent bars', () => {
  assert.equal(validOhlcBar({ open: 100, high: 104, low: 0, close: 103 }), false);
  assert.equal(validOhlcBar({ open: 100, high: 99, low: 98, close: 101 }), false);
  assert.equal(validOhlcBar({ open: 100, high: 104, low: 102, close: 101 }), false);
  assert.equal(validOhlcBar({ open: 100, high: 104, low: 98, close: 103 }), true);

  const contaminated = { ...row, futureBars: [row.futureBars[0], { ...row.futureBars[1], low: 0 }] };
  const result = resolveV3Outcomes([
    { version: '3.4.0', dataDate: row.tradeDate, generatedAt: new Date().toISOString() },
  ], [contaminated]);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].horizonDays, 1);
});
