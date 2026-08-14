import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGovernedTradingCalendar, resolvePreviousGovernedTradingDate } from '../src/market-state-forward-shadow-calendar.mjs';
import { materializeForwardDecisionDate } from '../src/market-state-forward-shadow-collector.mjs';
import { explainForwardShadowStatus } from '../src/forward-shadow-status-explanation.mjs';
import { governedPremarketDecisionAt, premarketDecisionWaitMs, waitForPremarketDecisionBoundary } from '../src/market-state-forward-shadow-premarket.mjs';

const root = path.resolve('.');

test('2026-08-12 resolves the immediately previous governed trading date', () => {
  const calendar = loadGovernedTradingCalendar(path.join(root, 'config', 'taifex-official-calendar-2026.json'));
  assert.equal(resolvePreviousGovernedTradingDate(calendar, '2026-08-12'), '2026-08-11');
});

test('forward-only materialization creates a current decision identity from the exact governed prior date', () => {
  const raw = { marketRows: [{ trade_date: '2026-08-11', tx_close: 22000 }], spotRows: [] };
  const result = materializeForwardDecisionDate(raw, { tradeDate: '2026-08-12', priorTradeDate: '2026-08-11' });
  assert.equal(result.state, 'MATERIALIZED_PREMARKET_DECISION_DATE');
  assert.deepEqual(result.raw.marketRows.map((row) => row.trade_date), ['2026-08-11', '2026-08-12']);
  assert.equal(result.raw.marketRows[1].tx_close, 22000);
  assert.equal(raw.marketRows.length, 1);

  const unavailable = materializeForwardDecisionDate(raw, { tradeDate: '2026-08-13', priorTradeDate: '2026-08-12' });
  assert.equal(unavailable.state, 'UNAVAILABLE');
  assert.equal(unavailable.unavailableReason, 'PREVIOUS_GOVERNED_TRADE_DATE_SOURCE_MISSING');
});

test('08:25 scheduler start waits for the frozen 08:30 decision boundary without moving the 08:45 deadline', async () => {
  assert.equal(governedPremarketDecisionAt('2026-08-12'), '2026-08-12T08:30:00+08:00');
  assert.equal(premarketDecisionWaitMs({ tradeDate: '2026-08-12', now: '2026-08-12T08:25:00+08:00' }), 300_000);
  let observedWait = null;
  const result = await waitForPremarketDecisionBoundary(
    { tradeDate: '2026-08-12', now: '2026-08-12T08:25:00+08:00' },
    async (ms) => { observedWait = ms; },
  );
  assert.equal(observedWait, 300_000);
  assert.equal(result.decisionAt, '2026-08-12T08:30:00+08:00');
});

test('official MISSED evidence is explained without guessing historical scheduler state', () => {
  const explanation = explainForwardShadowStatus({
    stateRecord: {
      recordType: 'SESSION_STATUS', tradeDate: '2026-08-12', qualityStatus: 'MISSED',
      missedReason: 'NO_LEGAL_PREMARKET_SNAPSHOT', scheduledAt: '2026-08-12T08:25:00+08:00', recordedAt: '2026-08-12T00:27:15.177Z',
    },
    dailyStatus: { lifecycle: ['PRECHECK', 'TRADING_DAY_CHECK', 'INPUT_AVAILABILITY_CHECK', 'APPEND_SESSION_STATUS'] },
    stateTask: { enabled: false },
    outcomeTask: { enabled: false },
  });
  assert.equal(explanation.status, 'MISSED');
  assert.equal(explanation.reasonCode, 'NO_LEGAL_PREMARKET_SNAPSHOT');
  assert.equal(explanation.lastSuccessfulStage, 'TRADING_DAY_CHECK');
  assert.equal(explanation.failedStage, 'INPUT_AVAILABILITY_CHECK');
  assert.equal(explanation.schedulerReadiness.currentState, 'UNAVAILABLE');
  assert.equal(explanation.schedulerReadiness.historicalStateAtTradeDate, 'UNKNOWN');

  const unknown = explainForwardShadowStatus();
  assert.equal(unknown.status, 'UNKNOWN');
  assert.equal(unknown.reasonCode, 'UNKNOWN_INSUFFICIENT_EVIDENCE');

  const missingReason = explainForwardShadowStatus({ stateRecord: { recordType: 'SESSION_STATUS', qualityStatus: 'MISSED', tradeDate: '2026-08-13' } });
  assert.equal(missingReason.status, 'MISSED');
  assert.equal(missingReason.reasonCode, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
  assert.equal(missingReason.dataTrust, 'UNAVAILABLE');

  const complete = explainForwardShadowStatus({ stateRecord: { recordType: 'STATE', qualityStatus: 'CLEAN', tradeDate: '2026-08-13' } });
  assert.equal(complete.status, 'CLEAN');
  assert.equal(complete.reasonCode, null);
  assert.equal(complete.failedStage, null);

  const malformed = explainForwardShadowStatus({ stateRecord: { recordType: 'STATE' } });
  assert.equal(malformed.status, 'UNAVAILABLE');
  assert.equal(malformed.dataTrust, 'UNAVAILABLE');
});

test('observer, dashboard and installer expose the governed fix without activating execution', () => {
  const observer = fs.readFileSync(path.join(root, 'scripts', 'run-market-state-forward-shadow-observer.mjs'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-market-state-forward-shadow-automation.ps1'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(observer, /resolvePreviousGovernedTradingDate/);
  assert.match(observer, /waitForPremarketDecisionBoundary/);
  assert.match(observer, /unavailableReason: snapshot\.unavailableReason/);
  assert.match(installer, /PERSISTED_AND_VERIFIED/);
  assert.match(installer, /TASK_MANIFEST_BINDING_MISMATCH/);
  assert.doesNotMatch(installer, /executionAuthorized\s*=\s*\$true/i);
  assert.match(html, /dw-forward-status-value/);
  assert.match(app, /forwardShadowStatus/);
  assert.match(app, /dw-forward-reason-code/);
});
