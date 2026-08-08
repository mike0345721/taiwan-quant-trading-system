import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooHistory } from '../src/global-context.mjs';

test('Yahoo global history parser keeps dates, closes and daily returns', () => {
  const payload = { chart: { result: [{
    meta: { exchangeTimezoneName: 'America/New_York' },
    timestamp: [1_720_000_000, 1_720_086_400, 1_720_172_800],
    indicators: { quote: [{ close: [100, 102, null] }] },
  }] } };
  const rows = parseYahooHistory(payload);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].previousClose, null);
  assert.ok(Math.abs(rows[1].returnPct - 2) < 1e-9);
});
