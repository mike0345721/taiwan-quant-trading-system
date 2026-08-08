import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSnapshot } from '../src/derived-metrics.mjs';

function snapshot(date, foreignNetE, foreignFuturesNet, oi, tx = 100, spot = 98) {
  return {
    dataMode: 'live', asOfDate: date,
    spotInstitutional: { dataDate: date, data: { foreignNetE, trustNetE: 1, dealerTotalNetE: -1 } },
    futuresInstitutional: { dataDate: date, data: { foreignNet: foreignFuturesNet } },
    futuresMarket: { data: { txDay: { close: tx }, txNext: { close: tx + 2 } } },
    marketOverview: { data: { twii: { price: spot } } },
    largeTraders: { data: { marketOi: oi, top5Long: 50, top5Short: 40 } },
    options: { data: { contract: '202607F2', totalCallOi: 100, totalPutOi: 110 } },
  };
}

test('derived metrics require history and calculate deltas safely', () => {
  const previous = snapshot('2026-07-08', 10, -100, 200);
  const current = snapshot('2026-07-09', 20, -80, 230);
  previous.options.data.contracts = [{ contract: '202608', callOi: 400, putOi: 900, oiPcRatio: 2.25, strikes: [{ strike: 90, callOi: 20, putOi: 100 }] }];
  current.options.data.contracts = [{ contract: '202608', callOi: 450, putOi: 1_200, oiPcRatio: 2.67, strikes: [{ strike: 90, callOi: 25, putOi: 260 }] }];
  enrichSnapshot(current, [previous]);
  assert.equal(current.derived.market.basis, 2);
  assert.equal(current.derived.market.calendarSpread, 2);
  assert.equal(current.derived.futures.foreignNetDelta, 20);
  assert.equal(current.derived.futures.openInterestDelta, 30);
  assert.equal(current.derived.spot.foreign5dE, null);
  assert.equal(current.derived.options.contractChanges[0].putOiDelta, 300);
  assert.deepEqual(current.derived.options.contractChanges[0].topPutOiIncreases[0], { strike: 90, callOiDelta: 5, putOiDelta: 160 });
});
