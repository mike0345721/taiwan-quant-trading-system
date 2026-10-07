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
    timeframe:'5m',tradeDate:'2026-10-05',actualContract:'TXFJ6',lastPrice:108,availableAt:'2026-10-05T10:29:30.000Z',bars,
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
  assert.ok(r.levels.some(x=>x.id==='VWAP'));assert.equal(r.nextWatch.id,'VWAP');
  assert.equal(r.rankingMethod,'EVIDENCE_FIRST_STRUCTURAL_CONFLUENCE_REACTION_THEN_PROXIMITY');
  assert.notEqual(r.nextWatch.importanceBand,'CONTEXT');assert.ok(r.nextWatch.basisReasons.length>=3);
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
test('static level lifecycle distinguishes approaching testing breaking reclaimed lost accepted and rejected',()=>{
  const state=(closes,currentPrice)=>{
    const c=vwapOnly({closes,currentPrice});
    c.levels={...c.levels,vwap:{availability:'UNAVAILABLE'},previousClose:available(100,'2026-10-05T09:55:00.000Z')};
    const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z'});
    return r.levels.find(x=>x.id==='PRIOR_CLOSE')?.state;
  };
  assert.equal(state([90,92,94,96,105,106],112),'APPROACHING');
  assert.equal(state([90,92,94,96,102,103],103),'TESTING');
  assert.equal(state([90,92,94,96,99,102],102),'BREAKING');
  assert.equal(state([90,92,94,96,99,102],108),'RECLAIMED');
  assert.equal(state([110,108,106,104,101,98],92),'LOST');
  assert.equal(state([90,92,94,99,108,109],109),'ACCEPTED');
  assert.equal(state([90,92,94,99,108,99],99),'REJECTED');
});
test('dynamic VWAP never backfills reclaimed or lost from the current VWAP value',()=>{
  const r=buildDecisionLevelWatch({chart:vwapOnly({closes:[90,92,94,96,99,102],currentPrice:108}),snapshotTime:'2026-10-05T10:30:00.000Z'});
  const vwap=r.levels.find(x=>x.id==='VWAP');assert.ok(vwap);
  assert.ok(['MONITORING','APPROACHING','TESTING'].includes(vwap.state));
  assert.equal(vwap.lifecycleBasis,'CURRENT_DYNAMIC_VWAP_ONLY_NO_HISTORICAL_STATIC_BACKFILL');
});

test('swing pivot becomes available only after the confirming next five-minute bar completes',()=>{
  const unavailable={availability:'UNAVAILABLE'};
  const bars=[
    {time:'2026-10-05T10:00:00.000Z',open:95,high:100,low:90,close:97,volume:100,availableAt:'2026-10-05T10:04:59.000Z'},
    {time:'2026-10-05T10:05:00.000Z',open:97,high:120,low:95,close:110,volume:120,availableAt:'2026-10-05T10:09:59.000Z'},
    {time:'2026-10-05T10:10:00.000Z',open:110,high:112,low:96,close:101,volume:110,availableAt:'2026-10-05T10:14:59.000Z'},
    {time:'2026-10-05T10:15:00.000Z',open:101,high:108,low:98,close:105,volume:90,availableAt:'2026-10-05T10:19:59.000Z'},
  ];
  const c={timeframe:'5m',availableAt:'2026-10-05T10:19:59.000Z',lastPrice:105,tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY',qualityStatus:'PASS',bars,
    levels:{vwap:unavailable,openingRangeHigh:unavailable,openingRangeLow:unavailable,currentDayHigh:unavailable,currentDayLow:unavailable,nightHigh:unavailable,nightLow:unavailable,previousDayHigh:unavailable,previousDayLow:unavailable,previousClose:unavailable},
    openingRange:{status:'FORMING'}};
  c.bars=c.bars.map(bar=>({...bar,qualityStatus:'PASS'}));
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:20:00.000Z'});
  const swing=r.levels.find(x=>x.id==='SWING_HIGH');assert.ok(swing);
  assert.equal(swing.label,'近期5分K局部高點');
  assert.equal(swing.availableAt,'2026-10-05T10:15:00.000Z');
  assert.equal(swing.importanceBand,'CONTEXT');
});
test('nearby swing cannot outrank a lawful structural level only because it is closer',()=>{
  const c=chart({lastPrice:108,openingRange:{status:'FORMING'},levels:{
    ...chart().levels,
    vwap:available(100,'2026-10-05T09:55:00.000Z'),
    openingRangeHigh:{availability:'UNAVAILABLE'},openingRangeLow:{availability:'UNAVAILABLE'},
    currentDayHigh:{availability:'UNAVAILABLE'},currentDayLow:{availability:'UNAVAILABLE'},
    previousDayHigh:{availability:'UNAVAILABLE'},previousDayLow:{availability:'UNAVAILABLE'},previousClose:{availability:'UNAVAILABLE'},
  }});
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z',maxVisible:1});
  assert.equal(r.levels[0].id,'VWAP');
  assert.notEqual(r.levels[0].importanceBand,'CONTEXT');
});
test('current Flow and RVOL are exposed as confirmation basis only when the level is nearby',()=>{
  const c=vwapOnly({currentPrice:102});
  c.bars=c.bars.map((b,i)=>({...b,volume:100+i*10}));
  const observedFlow={identity:{actualContract:'TXFJ6',tradeDate:'2026-10-05',session:'DAY'},sourceState:'LIVE',source:{availableAt:'2026-10-05T10:29:30.000Z'},researchQuality:{status:'PASS'},windows:{primary60s:{pressure:{pressureRatio:.4},response:{displacementPoints:6}}}};
  const marketPulse={rvol:{state:'READY',ratio:1.4,percentile:80,sampleDays:20}};
  const r=buildDecisionLevelWatch({chart:c,observedFlow,marketPulse,snapshotTime:'2026-10-05T10:30:00.000Z'});
  const vwap=r.levels.find(x=>x.id==='VWAP');assert.ok(vwap);
  assert.equal(vwap.basis.currentConfirmation.observedFlow.directionRelation,'SAME_DIRECTION');
  assert.equal(vwap.basis.currentConfirmation.participation.rvolRatio,1.4);
  assert.match(vwap.basisReasons.join(' '),/成交反應/);
  assert.match(vwap.basisReasons.join(' '),/RVOL 1\.40/);
});
test('repeated post-formation reactions elevate a static reference without claiming predictive win rate',()=>{
  const unavailable={availability:'UNAVAILABLE'};
  const bars=[
    {time:'2026-10-05T10:00:00.000Z',open:99,high:102,low:98,close:100,volume:100,availableAt:'2026-10-05T10:04:59.000Z'},
    {time:'2026-10-05T10:05:00.000Z',open:100,high:116,low:110,close:115,volume:120,availableAt:'2026-10-05T10:09:59.000Z'},
    {time:'2026-10-05T10:10:00.000Z',open:105,high:106,low:99,close:101,volume:110,availableAt:'2026-10-05T10:14:59.000Z'},
    {time:'2026-10-05T10:15:00.000Z',open:101,high:116,low:110,close:114,volume:130,availableAt:'2026-10-05T10:19:59.000Z'},
    {time:'2026-10-05T10:20:00.000Z',open:114,high:115,low:108,close:110,volume:90,availableAt:'2026-10-05T10:24:59.000Z'},
  ];
  const c={timeframe:'5m',availableAt:'2026-10-05T10:24:59.000Z',lastPrice:110,tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY',qualityStatus:'PASS',bars,
    levels:{vwap:unavailable,openingRangeHigh:unavailable,openingRangeLow:unavailable,currentDayHigh:unavailable,currentDayLow:unavailable,nightHigh:unavailable,nightLow:unavailable,previousDayHigh:unavailable,previousDayLow:unavailable,previousClose:available(100,'2026-10-05T09:55:00.000Z')},
    openingRange:{status:'FORMING'}};
  c.bars=c.bars.map(bar=>({...bar,qualityStatus:'PASS'}));
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:25:00.000Z'});
  const ref=r.levels.find(x=>x.id==='PRIOR_CLOSE');assert.ok(ref);
  assert.ok(ref.basis.reaction.testEpisodes>=2);
  assert.ok(ref.basis.reaction.meaningfulReactionCount>=1);
  assert.match(ref.basisReasons.join(' '),/不是勝率統計/);
});

test('scenario watch treats a nearby VWAP as a bidirectional decision node with separate lawful targets',()=>{
  const c=chart({lastPrice:102});
  const r=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.equal(r.schemaVersion,'decision-level-watch-v3');
  assert.ok(r.scenarioWatch);
  assert.equal(r.scenarioWatch.directionState,'BIDIRECTIONAL_TEST');
  assert.equal(r.scenarioWatch.node.id,'VWAP');
  assert.equal(r.scenarioWatch.long.confirmationThreshold,100+r.zonePoints);
  assert.equal(r.scenarioWatch.short.confirmationThreshold,100-r.zonePoints);
  assert.ok(r.scenarioWatch.long.target?.price>r.scenarioWatch.long.confirmationThreshold);
  assert.ok(r.scenarioWatch.short.target?.price<r.scenarioWatch.short.confirmationThreshold);
  assert.notEqual(r.scenarioWatch.long.target?.importanceBand,'CONTEXT');
  assert.notEqual(r.scenarioWatch.short.target?.importanceBand,'CONTEXT');
  assert.equal(r.scenarioWatch.long.rr.state,'AVAILABLE');
  assert.equal(r.scenarioWatch.short.rr.state,'AVAILABLE');
  assert.equal(r.scenarioWatch.long.rr.riskPoints,r.zonePoints*2);
  assert.equal(r.scenarioWatch.short.rr.riskPoints,r.zonePoints*2);
  assert.equal(r.scenarioWatch.recommendation,false);
  assert.equal(r.systemDirectionalSignal,false);
});

test('conditional structural RR fails closed when there is no evidence-qualified directional target',()=>{
  const r=buildDecisionLevelWatch({chart:vwapOnly({currentPrice:102}),snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.ok(r.scenarioWatch);
  assert.equal(r.scenarioWatch.long.target,null);
  assert.equal(r.scenarioWatch.short.target,null);
  assert.equal(r.scenarioWatch.long.rr.state,'UNAVAILABLE');
  assert.equal(r.scenarioWatch.short.rr.state,'UNAVAILABLE');
  assert.equal(r.scenarioWatch.long.rr.reason,'NO_EVIDENCE_QUALIFIED_TARGET');
  assert.equal(r.scenarioWatch.short.rr.reason,'NO_EVIDENCE_QUALIFIED_TARGET');
});

test('scenario Flow confirmation remains descriptive and does not become a system direction',()=>{
  const c=chart({lastPrice:102});
  c.bars=c.bars.map((bar,i)=>({...bar,volume:100+i*5}));
  const observedFlow={identity:{actualContract:'TXFJ6',tradeDate:'2026-10-05',session:'DAY'},sourceState:'LIVE',source:{availableAt:'2026-10-05T10:29:30.000Z'},researchQuality:{status:'PASS'},windows:{primary60s:{pressure:{pressureRatio:.5},response:{displacementPoints:8}}}};
  const r=buildDecisionLevelWatch({chart:c,observedFlow,snapshotTime:'2026-10-05T10:30:00.000Z'});
  assert.equal(r.scenarioWatch.long.flowConfirmationState,'ALIGNED');
  assert.equal(r.scenarioWatch.short.flowConfirmationState,'CONTRARY');
  assert.equal(r.scenarioWatch.long.recommendation,false);
  assert.equal(r.scenarioWatch.short.recommendation,false);
  assert.equal(r.recommendation,false);
  assert.equal(r.executionAuthorized,false);
  assert.equal(r.orderRoutesEnabled,false);
});

const snapshotTime='2026-10-05T10:30:00.000Z';
const watch=c=>buildDecisionLevelWatch({chart:c,snapshotTime});
function targetChart(){
  const c=vwapOnly({currentPrice:102});
  c.openingRange={status:'READY'};
  c.levels.openingRangeHigh=available(150);
  c.levels.openingRangeLow=available(50);
  return c;
}
test('missing, malformed, future and mismatched levels cannot provide targets or confluence',()=>{
  for(const patch of [{availableAt:null},{availableAt:'bad-time'},{availableAt:'2026-10-05T11:00:00Z'},
    {actualContract:'TXFK6'},{session:'NIGHT'},{tradeDate:'2026-10-06'},{source:null}]){
    const c=targetChart();c.levels.openingRangeHigh={...available(150),...patch};
    const r=watch(c);assert.equal(r.scenarioWatch.long.target,null,JSON.stringify(patch));
    assert.equal(r.scenarioWatch.long.rr.state,'UNAVAILABLE');
    assert.equal(r.levels.some(x=>x.id==='OR_HIGH'),false);
  }
  const c=targetChart();c.levels.previousDayHigh={...available(160),actualContract:'TXFJ6',tradeDate:'2026-10-02',session:'DAY'};
  c.levels.openingRangeHigh={availability:'UNAVAILABLE'};
  assert.equal(watch(c).scenarioWatch.long.target.id,'PRIOR_HIGH');
});
test('target importance follows structure before confluence and is independent of alert distance',()=>{
  const c=targetChart();c.levels.currentDayHigh=available(120);c.levels.previousDayHigh=available(125);
  const r=watch(c);assert.equal(r.scenarioWatch.long.target.id,'OR_HIGH');
  assert.equal(r.scenarioWatch.short.target.id,'OR_LOW');
  c.lastPrice=121;
  const later=watch(c);assert.equal(later.scenarioWatch.long.target.id,'OR_HIGH');
  assert.equal(r.scenarioWatch.long.target.importanceBand,later.scenarioWatch.long.target.importanceBand);
});
test('unknown or insufficient source quality cannot become a target or hide a nearby clean target',()=>{
  for(const qualityStatus of ['UNKNOWN','QUALITY_INSUFFICIENT',null]){
    const c=targetChart();c.levels.openingRangeHigh={...available(150),qualityStatus};
    let r=watch(c);assert.equal(r.scenarioWatch.long.target,null);
    c.levels.currentDayHigh=available(152);
    r=watch(c);assert.equal(r.scenarioWatch.long.target.id,'SESSION_HIGH');
    assert.equal(r.scenarioWatch.long.target.qualityStatus,'PASS');
  }
});
test('limited node quality preserves unknown thresholds and structural RR',()=>{
  const r=watch({...targetChart(),qualityStatus:'QUALITY_INSUFFICIENT'});
  for(const side of ['long','short']){
    assert.equal(r.scenarioWatch[side].state,'UNAVAILABLE');
    assert.equal(r.scenarioWatch[side].confirmationThreshold,null);
    assert.equal(r.scenarioWatch[side].invalidationThreshold,null);
    assert.equal(r.scenarioWatch[side].rr.state,'UNAVAILABLE');
    assert.equal(r.scenarioWatch[side].rr.ratio,null);
    assert.equal(r.scenarioWatch[side].rr.riskPoints,null);
  }
  const c={...targetChart(),qualityStatus:'QUALITY_INSUFFICIENT'};
  c.levels.previousDayHigh=available(160);c.levels.previousDayLow=available(40);
  const prior=watch(c);assert.equal(prior.nextWatch.qualityStatus,'PASS');
  assert.equal(prior.scenarioWatch.short.rr.state,'UNAVAILABLE');
});
test('missing or non-five-minute range evidence never invents a zone or RR',()=>{
  for(const patch of [{bars:[]},{timeframe:'1m'},{bars:targetChart().bars.map(b=>({...b,qualityStatus:'UNKNOWN'}))}]){
    const r=watch({...targetChart(),...patch});
    assert.equal(r.reason,'OBSERVATION_ZONE_UNAVAILABLE');assert.equal(r.zonePoints,null);assert.equal(r.scenarioWatch,null);
  }
});
test('conditional geometry is symmetric and uses confirmation-to-target distances',()=>{
  const r=watch(targetChart());
  for(const side of ['long','short']){
    const s=r.scenarioWatch[side];
    assert.equal(s.rr.riskPoints,12);assert.equal(s.rr.rewardPoints,44);
    assert.equal(s.rr.ratio,44/12);assert.equal(s.rr.state,'AVAILABLE');
  }
});
test('Flow confirmation fails closed on absent quality, identity mismatch or future time',()=>{
  const source={sourceState:'LIVE',identity:{actualContract:'TXFJ6',tradeDate:'2026-10-05',session:'DAY'},source:{availableAt:snapshotTime},researchQuality:{status:'PASS'},windows:{primary60s:{pressure:{pressureRatio:.4},response:{displacementPoints:5}}}};
  for(const patch of [{researchQuality:null},{identity:{...source.identity,session:'NIGHT'}},{source:{availableAt:'2026-10-05T11:00:00Z'}},{source:{availableAt:null}}]){
    const r=buildDecisionLevelWatch({chart:targetChart(),snapshotTime,observedFlow:{...source,...patch}});
    assert.ok(['UNAVAILABLE','QUALITY_INSUFFICIENT'].includes(r.scenarioWatch.long.flowConfirmationState));
  }
});
test('formation bar cannot supply its own post-formation reaction or accepted lifecycle',()=>{
  const c=vwapOnly({closes:[90,92,94,99,108,109],currentPrice:109});
  c.openingRange={status:'READY'};c.levels.vwap={availability:'UNAVAILABLE'};c.levels.openingRangeHigh=available(100,'2026-10-05T10:29:59Z');
  const r=watch(c);
  assert.equal(r.nextWatch.basis.reaction.testEpisodes,0);
  assert.equal(r.nextWatch.state,'APPROACHING');
});
test('completed pivots require adjacent bars and all three bars to pass quality',()=>{
  const c=vwapOnly({closes:[90,100,90,90,90,90],currentPrice:100});
  c.levels.vwap={availability:'UNAVAILABLE'};
  assert.ok(watch(c).levels.some(x=>x.id==='SWING_HIGH'));
  c.bars[2].qualityStatus='QUALITY_INSUFFICIENT';
  assert.equal(watch(c).levels.some(x=>x.id==='SWING_HIGH'),false);
  c.bars.splice(2,1);
  assert.equal(watch(c).levels.some(x=>x.id==='SWING_HIGH'),false);
});
test('delayed pivot input timestamps and confirmation close both bound availability',()=>{
  const c=vwapOnly({closes:[90,100,90,90,90,90],currentPrice:100});
  c.levels.vwap={availability:'UNAVAILABLE'};
  c.bars[1].availableAt='2026-10-05T10:17:00Z';
  const r=watch(c);assert.equal(r.levels.find(x=>x.id==='SWING_HIGH').availableAt,'2026-10-05T10:17:00.000Z');
});
