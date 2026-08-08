import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShioajiReadiness } from '../src/shioaji-readiness.mjs';

test('Shioaji readiness remains read-only even when market data is ready', () => {
  const result = buildShioajiReadiness({
    pythonAvailable: true,
    packageInstalled: true,
    serverReachable: true,
    futuresAccount: true,
    futuresApiSigned: true,
  });
  assert.equal(result.readyForLocalMarketDataTest, true);
  assert.equal(result.readyForTxResearch, true);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.orderRoutesEnabled, false);
});

test('broker secrets in dashboard process fail readiness closed', () => {
  const result = buildShioajiReadiness({
    pythonAvailable: true,
    packageInstalled: true,
    serverReachable: true,
    projectHasApiKey: true,
  });
  assert.equal(result.secretsIsolatedFromDashboard, false);
  assert.equal(result.readyForLocalMarketDataTest, false);
  assert.ok(result.blockers.includes('broker_secret_present_in_dashboard_process'));
});

test('stock-only onboarding does not claim TX research readiness', () => {
  const result = buildShioajiReadiness({
    pythonAvailable: true,
    packageInstalled: true,
    serverReachable: true,
  });
  assert.equal(result.readyForLocalMarketDataTest, true);
  assert.equal(result.readyForTxResearch, false);
  assert.ok(result.blockers.includes('futures_account_not_confirmed'));
  assert.ok(result.blockers.includes('futures_api_not_signed'));
});

