import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('Market State collector contains market-data operations only', () => {
  const collector = read('broker/market_state_readonly_collector.py');
  assert.match(collector, /api\.subscribe\(/);
  assert.match(collector, /api\.contracts\.options/);
  assert.match(collector, /subscribe_trade\s*=\s*False/);
  assert.match(collector, /executionAuthorized[^\n]*False/);
  assert.match(collector, /orderRoutesEnabled[^\n]*False/);
  assert.doesNotMatch(collector, /api\.(place_order|update_order|cancel_order|list_positions|list_profit_loss|account_balance|margin|settlements?)\s*\(/i);
  assert.doesNotMatch(collector, /activate_ca|set_default_account/i);
});

test('Market State scheduler is isolated from P0 automation', () => {
  const installer = read('scripts/install-market-state-collection.ps1');
  const runner = read('scripts/run-market-state-collector-hidden.ps1');
  assert.match(installer, /TwChipDashboard-MarketStateCollection/);
  assert.match(installer, /08:35/);
  assert.match(installer, /run-market-state-collector-hidden\.ps1/);
  assert.doesNotMatch(installer, /TwChipDashboard-P0ForwardPaper|run-p0-forward-paper/i);
  assert.doesNotMatch(runner, /run-p0-forward-paper|run-t0|place_order|cancel_order/i);
});

test('Market State collection config remains research-only and bounded', () => {
  const config = JSON.parse(read('config/market-state-forward-collection.json'));
  assert.equal(config.researchOnly, true);
  assert.equal(config.executionAuthorized, false);
  assert.equal(config.orderRoutesEnabled, false);
  const planned = config.leadership.codes.length
    + config.options.expiryCount * (2 * config.options.strikesPerSide + 1) * 2;
  assert.ok(planned <= config.limits.collectorSubscriptionSafetyCap);
  assert.ok(config.limits.collectorSubscriptionSafetyCap < config.limits.shioajiPublishedSubscriptionLimit);
});
