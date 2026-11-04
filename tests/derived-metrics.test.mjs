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

test('missing OI and institutional values remain unknown in totals, contracts, strikes and concentration', () => {
  for (const [before,after,expected] of [[null,250,null],[100,null,null],[null,null,null],[0,250,250],[100,0,-100],[0,0,0]]) {
    const previous=snapshot('2026-07-08',10,before,100),current=snapshot('2026-07-09',10,after,150);
    for (const [row,n] of [[previous,before],[current,after]]) {
      row.futuresInstitutional.data.foreignShort=n;
      row.options.data.totalCallOi=n;row.options.data.totalPutOi=n;
      row.options.data.contracts=[{contract:'202608',callOi:n,putOi:n,strikes:[{strike:90,callOi:n,putOi:n}]}];
    }
    current.largeTraders.data.top5Long=after;current.largeTraders.data.top10Short=after;
    enrichSnapshot(current,[previous]);
    assert.equal(current.derived.futures.foreignNetDelta,expected);
    assert.equal(current.derived.futures.foreignShortDelta,expected);
    assert.equal(current.derived.options.callOiDelta,expected);
    assert.equal(current.derived.options.putOiDelta,expected);
    const changes=current.derived.options.contractChanges[0];
    assert.equal(changes.callOiDelta,expected);assert.equal(changes.putOiDelta,expected);
    assert.equal(changes.topCallOiIncreases.length,expected>0?1:0);
    assert.equal(changes.topPutOiIncreases.length,expected>0?1:0);
    assert.equal(current.derived.futures.top5LongConcentration,after==null?null:after/150*100);
    assert.equal(current.derived.futures.top10ShortConcentration,after==null?null:after/150*100);
  }
});

test('OI comparison records actual current and previous source, retaining zero and missing history', () => {
  const previous=snapshot('2026-07-08',10,0,null),current=snapshot('2026-07-09',10,0,0);
  previous.futuresMarket={ok:true,dataDate:'2026-07-08',fetchedAt:'2026-07-08T08:00:00Z',data:{txDay:{openInterest:100}}};
  current.futuresMarket.data.txDay.openInterest=900;
  enrichSnapshot(current,[previous]);
  assert.equal(current.derived.futures.openInterestDelta,null);
  assert.equal(current.derived.futures.openInterestComparisonReason,'OI_SOURCE_SCOPE_MISMATCH');
  assert.equal(current.derived.futures.openInterestSources.current,'largeTraders');
  assert.deepEqual(current.derived.futures.openInterestSources.previous,{
    key:'futuresMarket',dataDate:'2026-07-08',sourceTime:null,lastSuccessfulAt:'2026-07-08T08:00:00Z',lastAttemptAt:'2026-07-08T08:00:00Z',ok:true,reason:null});
  current.largeTraders.data.marketOi=null;enrichSnapshot(current,[]);
  assert.equal(current.derived.futures.openInterestSources.current,'futuresMarket');
  assert.equal(current.derived.futures.openInterestSources.previous.ok,false);
  assert.equal(current.derived.futures.openInterestDelta,null);
});

test('OI comparisons reject contract rollover and concentration cannot borrow a different denominator', () => {
  const previous=snapshot('2026-07-08',10,0,null),current=snapshot('2026-07-09',10,0,null);
  previous.futuresMarket.data.txDay={contract:'202607',openInterest:100};
  current.futuresMarket.data.txDay={contract:'202608',openInterest:150};
  enrichSnapshot(current,[previous]);
  assert.equal(current.derived.futures.openInterestDelta,null);
  assert.equal(current.derived.futures.openInterestComparisonReason,'OI_CONTRACT_CHANGED');
  assert.equal(current.derived.futures.top5LongConcentration,null);
  current.futuresMarket.data.txDay.contract='202607';enrichSnapshot(current,[previous]);
  assert.equal(current.derived.futures.openInterestDelta,50);
  delete previous.futuresMarket.data.txDay.contract;enrichSnapshot(current,[previous]);
  assert.equal(current.derived.futures.openInterestComparisonReason,'OI_CONTRACT_IDENTITY_MISSING');
});
