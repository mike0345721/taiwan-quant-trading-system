import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSingleAxisLinkage, buildAlignmentManifest, buildOutcomeRows } from '../src/market-state-outcome-linkage.mjs';

function ticks(date) {
  const values = [100, 101, 102, 99, 103];
  return values.map((price, index) => ({ exchangeTimestamp: new Date(Date.parse(`${date}T00:45:00.000Z`) + index * 30 * 60_000).toISOString(), price, contractCode: '202601' }));
}
test('outcome replay uses actual contract day ticks and leaves ungoverned opening gap unavailable', async () => {
  const rows = await buildOutcomeRows({ sessions: [{ tradeDate: '2026-01-02', sessionId: '2026-01-02-DAY', actualReplayContractCode: '202601', settlementClass: 'NORMAL_SESSION', rollSession: false }], readTicks: async () => { const dayTicks = ticks('2026-01-02'); return { sourceState: 'AVAILABLE', ticks: dayTicks, bars: dayTicks.map((tick) => ({ timestamp: tick.exchangeTimestamp, close: tick.price })), source: { sourceClass: 'TEST', zipPath: 'x.zip', zipSha256: 'abc' } }; } });
  assert.equal(rows.length, 5);
  assert.equal(rows.find((row) => row.outcomeFamily === 'LARGE_MOVE_CONTINUOUS').outcomeState, 'AVAILABLE');
  assert.equal(rows.find((row) => row.outcomeFamily === 'OPENING_GAP').unavailableReason, 'PRIOR_NIGHT_CLOSE_SAME_CONTRACT_NOT_GOVERNED');
  assert.ok(rows.every((row) => row.actualContractCode === '202601' && row.executionAuthorized === false));
});

test('alignment is single-axis and all state groups remain present', () => {
  const states = Array.from({ length: 60 }, (_, index) => ({ tradeDate: `2026-01-${String(index + 1).padStart(2, '0')}`, schemaVersion: 'v1', availableAt: '2026-01-01T00:00:00Z', state: { trend: index < 30 ? 'TREND_UP' : 'TREND_DOWN', direction: index < 30 ? 'BULLISH' : 'BEARISH', volatility: index < 30 ? 'HIGH' : 'LOW' }, globalAlignment: index < 30 ? 'TAILWIND' : 'HEADWIND', riskResearchContext: index < 30 ? 'ELEVATED' : 'NORMAL' }));
  const outcomes = states.map((state, index) => ({ tradeDate: state.tradeDate, sessionId: `${state.tradeDate}-DAY`, session: 'DAY', actualContractCode: '202601', outcomeFamily: 'LARGE_MOVE_CONTINUOUS', outcomeState: 'AVAILABLE', unavailableReason: null, values: { upExcursionBps: index, downExcursionBps: index, maxExcursionBps: index, sessionReturnBps: index }, availableAt: '2026-01-01T06:00:00Z', sourceLineage: { sourceHash: 'x' } }));
  const alignment = buildAlignmentManifest({ marketStateRecords: states, outcomeRows: outcomes, marketStateDigest: 'm', outcomeDigest: 'o' });
  const analysis = analyzeSingleAxisLinkage(alignment);
  assert.deepEqual(analysis.sampleTables.direction, { BEARISH: 30, BULLISH: 30 });
  assert.equal(analysis.primaryContrasts.direction.find((row) => row.family === 'LARGE_MOVE_CONTINUOUS').confidenceInterval95.iterations, 2000);
  assert.equal(analysis.multiAxisSearchPerformed, false);
  assert.equal(analysis.pnlAnalysisPerformed, false);
});
