import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOptionsSmartRadar } from '../src/options-smart-radar.mjs';

const selected = { tradeDate: '2026-07-20', contract: '202607W4', contractType: 'weekly', daysToExpiry: 2 };

test('options radar ranks anomalies but does not invent direction or dealer exposure', () => {
  const radar = buildOptionsSmartRadar({
    selected,
    underlying: 23000,
    volatility: { atmIv: 0.28, skew25d: 0.06, ivRvSpread: 0.04, qualityStatus: 'clean' },
    previousVolatility: { atmIv: 0.22 },
    strikes: [
      { strike: 23000, callVolume: 3000, callVolumeMa20: 800, callVolumeSampleDays: 20, callOi: 5200, callOiDelta1d: 1800,
        callClose: 120, callPreviousClose: 70, putVolume: 500, putVolumeMa20: 450, putVolumeSampleDays: 20, putOi: 3000,
        putOiDelta1d: 100, putClose: 90, putPreviousClose: 88 },
      { strike: 23200, callVolume: 200, callVolumeMa20: 220, callVolumeSampleDays: 20, callOi: 1000, callOiDelta1d: 20,
        callClose: 50, callPreviousClose: 48, putVolume: 150, putVolumeMa20: 180, putVolumeSampleDays: 20, putOi: 900,
        putOiDelta1d: -10, putClose: 170, putPreviousClose: 168 },
    ],
  });
  assert.equal(radar.available, true);
  assert.equal(radar.updateMode, 'end_of_day');
  assert.equal(radar.direction, 'unconfirmed');
  assert.equal(radar.topCalls[0].strike, 23000);
  assert.ok(radar.topCalls[0].score > radar.topCalls[1].score);
  assert.ok(radar.topCalls[0].tags.includes('Call爆量'));
  assert.equal(radar.safeguards.dealerExposureEstimated, false);
  assert.equal(radar.safeguards.orderEndpointPresent, false);
});

test('options radar preserves missing inputs instead of converting them to bullish or bearish confidence', () => {
  const radar = buildOptionsSmartRadar({ selected, strikes: [{ strike: 23000, callOi: 100, putOi: 100 }] });
  assert.equal(radar.direction, 'unconfirmed');
  assert.ok(radar.topCalls[0].dataCoveragePct < 100);
  assert.match(radar.scoreMeaning, /不是勝率/);
  assert.ok(radar.pendingInputs.includes('逐筆成交方向'));
});

test('options radar stays unavailable without contract strike data', () => {
  assert.deepEqual(buildOptionsSmartRadar({ selected, strikes: [] }), {
    available: false,
    state: 'insufficient_data',
    reason: '沒有可用的契約或履約價資料',
    liveConnected: false,
  });
});
