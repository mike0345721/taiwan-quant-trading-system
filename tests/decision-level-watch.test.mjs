import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';

const available=(value,availableAt='2026-10-05T10:29:00.000Z')=>({availability:'AVAILABLE',value,source:'TEST_LEVEL',availableAt,qualityStatus:'PASS'});
function chart(overrides={}){
  const bars=[
    ['10:00',96,101,94,98],
    ['10:05',98,103,96,101],
    ['10:10',101,106,99,104],
    ['10:15',104,108,100,102],
    ['10:20',102,104,96,99],
    ['10:25',99,110,98,108],
  ].map(([hm,open,high,low,close])=>({time:`2026-10-05T${hm}:00.000Z`,open,high,low,close,availableAt:`2026-10-05T${hm}:59.000Z`,qualityStatus:'PASS'}));
  return {
    timeframe:'5m',lastPrice:108,availableAt:'2026-10-05T10:29:30.000Z',bars,
    levels:{
      vwap:available(100),openingRangeHigh:available(115),openingRangeLow:available(85),
      currentDayHigh:available(120),currentDayLow:available(80),
      nightHigh:{availability:'UNAVAILABLE'},nightLow:{availability:'UNAVAILABLE'},
      previousDayHigh:available(125),previousDayLow:available(75),previousClose:available(95),
    },
    openingRange:{status:'READY',high:115,low:85,availableAt:'2026-10-05T10:20:00.000Z'},
    vwapSession:'DAY',session:'DAY',qualityStatus:'PASS',
    ...overrides,
  };
}

test('level watch is bounded to three lawful levels and keeps safety closed',()=>{
  const r=buildDecisionLevelWatch({chart:chart(),snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.equal(r.state,'READY');assert.ok(r.levels.length>=1&&r.levels.length<=3);
  assert.ok(r.levels.some(x=>x.id==='VWAP'));assert.equal(r.nextWatch.id,'SWING_HIGH');
  assert.ok(r.nextWatch.absoluteDistancePoints<=Math.min(...r.levels.map(x=>x.absoluteDistancePoints)));
  assert.equal(r.formalWeight,0);assert.equal(r.researchOnly,true);assert.equal(r.recommendation,false);
  assert.equal(r.executionAuthorized,false);assert.equal(r.orderRoutesEnabled,false);
  assert.ok(r.nextWatch.why.length>10);assert.match(r.nextWatch.confirm,/價格/);
});
test('opening range levels are excluded until the range is frozen READY',()=>{
  const c=chart({openingRange:{status:'FORMING',reason:'OPENING_RANGE_FORMING'},levels:{...chart().levels,openingRangeHigh:available(109),openingRangeLow:available(91)}});
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.equal(r.levels.some(x=>x.family==='OPENING_RANGE'),false);
});
test('forming five minute bar cannot create a recent swing level',()=>{
  const c=chart();
  c.bars=[...c.bars,{time:'2026-10-05T10:30:00.000Z',open:108,high:160,low:107,close:159,availableAt:'2026-10-05T10:31:00.000Z',qualityStatus:'PASS'}];
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:32:00.000Z',maxVisible:3});
  assert.equal(r.levels.some(x=>x.family==='RECENT_SWING'&&x.price===160),false);
});
test('testing state is deterministic inside the observation zone',()=>{
  const c=chart({lastPrice:102});
  c.bars=c.bars.slice(0,-2).concat([{time:'2026-10-05T10:20:00.000Z',open:102,high:104,low:99,close:101,availableAt:'2026-10-05T10:24:59.000Z',qualityStatus:'PASS'},{time:'2026-10-05T10:25:00.000Z',open:101,high:104,low:99,close:102,availableAt:'2026-10-05T10:29:00.000Z',qualityStatus:'PASS'}]);
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z'});
  const vwap=r.levels.find(x=>x.id==='VWAP');assert.ok(vwap);assert.equal(vwap.state,'TESTING');
  assert.ok(vwap.absoluteDistancePoints<=r.zonePoints);
});
test('upper boundary watch explains breakout acceptance from below instead of bearish continuation',()=>{
  const base=chart();
  const levels={...base.levels,vwap:{availability:'UNAVAILABLE'},openingRangeHigh:{availability:'UNAVAILABLE'},openingRangeLow:{availability:'UNAVAILABLE'},currentDayHigh:available(120),currentDayLow:{availability:'UNAVAILABLE'},previousDayHigh:{availability:'UNAVAILABLE'},previousDayLow:{availability:'UNAVAILABLE'},previousClose:{availability:'UNAVAILABLE'}};
  const r=buildDecisionLevelWatch({chart:chart({lastPrice:118,openingRange:{status:'UNAVAILABLE'},levels}),snapshotTime:'2026-10-05T10:30:00.000Z'});
  const high=r.levels.find(x=>x.id==='SESSION_HIGH');assert.ok(high);assert.match(high.confirm,/站上價位|上方/);assert.match(high.invalidate,/跌回價位下方/);assert.doesNotMatch(high.confirm,/維持價位下方/);
});
test('unavailable current price fails closed instead of inventing levels',()=>{
  const r=buildDecisionLevelWatch({chart:chart({lastPrice:null}),snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.equal(r.state,'UNAVAILABLE');assert.equal(r.nextWatch,null);assert.deepEqual(r.levels,[]);
});

function vwapOnly({closes,currentPrice=102,qualityStatus='PASS',futureAvailableAt=false}={}){
  const sourceCloses=closes||[92,94,96,98,99,101];
  const bars=sourceCloses.map((close,i)=>{
    const minute=i*5;
    const hh=10+Math.floor(minute/60), mm=minute%60;
    const time=`2026-10-05T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00.000Z`;
    const availableAt=futureAvailableAt&&i===sourceCloses.length-2?'2026-10-05T11:00:00.000Z':new Date(Date.parse(time)+299000).toISOString();
    return {time,open:close-1,high:close+5,low:close-5,close,availableAt,qualityStatus:'PASS',tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY'};
  });
  const unavailable={availability:'UNAVAILABLE'};
  return {
    timeframe:'5m',lastPrice:currentPrice,tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY',
    availableAt:'2026-10-05T10:30:00.000Z',bars,qualityStatus,
    levels:{vwap:available(100),openingRangeHigh:unavailable,openingRangeLow:unavailable,currentDayHigh:unavailable,currentDayLow:unavailable,nightHigh:unavailable,nightLow:unavailable,previousDayHigh:unavailable,previousDayLow:unavailable,previousClose:unavailable},
    openingRange:{status:'FORMING',reason:'OPENING_RANGE_FORMING'},vwapSession:'DAY',
  };
}
test('completed-bar evidence is availability-time safe and inherits chart quality',()=>{
  const c=vwapOnly({futureAvailableAt:true,qualityStatus:'QUALITY_INSUFFICIENT',currentPrice:102});
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z'});
  const vwap=r.levels.find(x=>x.id==='VWAP');assert.ok(vwap);assert.equal(vwap.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(r.levels.some(x=>x.family==='RECENT_SWING'&&x.availableAt==='2026-10-05T11:00:00.000Z'),false);
});
test('level lifecycle distinguishes approaching testing breaking reclaimed lost accepted and rejected',()=>{
  const state=(closes,currentPrice)=>{
    const r=buildDecisionLevelWatch({chart:vwapOnly({closes,currentPrice}),snapshotTime:'2026-10-05T10:30:00.000Z'});
    return r.levels.find(x=>x.id==='VWAP')?.state;
  };
  assert.equal(state([90,92,94,96,105,106],112),'APPROACHING');
  assert.equal(state([90,92,94,96,102,103],103),'TESTING');
  assert.equal(state([90,92,94,96,99,102],102),'BREAKING');
  assert.equal(state([90,92,94,96,99,102],108),'RECLAIMED');
  assert.equal(state([110,108,106,104,101,98],92),'LOST');
  assert.equal(state([90,92,94,99,108,109],109),'ACCEPTED');
  assert.equal(state([90,92,94,99,108,99],99),'REJECTED');
});
