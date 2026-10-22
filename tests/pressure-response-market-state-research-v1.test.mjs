import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {projectGovernedL5,freezeOutcomeCandidate} from '../src/microstructure-outcome-research-v1.mjs';
import {sealResearchThresholds,describeFlowPriceResponse,describeMarketStateNoTrade}
 from '../src/pressure-response-market-state-research-v1.mjs';

const calendar=loadGovernedTradingCalendar(fileURLToPath(
  new URL('../config/taifex-official-calendar-2026.json',import.meta.url)));
const rules=sealResearchThresholds({
 strongPressureMin:.5,weakPressureMax:.15,moveMinPoints:3,flatMaxPoints:.5,
 highEfficiencyMin:.65,trendEfficiencyMin:.7,rangeEfficiencyMax:.3,
 maxChaseSpreadTicks:3,minDepth5:70,maxAgeMs:30_000,maxRealizedVolPoints:40,
});
const event=(kind)=>freezeOutcomeCandidate({
 eventId:'EVENT:TXFK6:001',observationKind:kind,actualContract:'TXFK6',
 tradeDate:'2026-10-22',session:'DAY',calendar,
 eventExchangeTimestamp:'2026-10-22T02:00:00.000Z',
 asOfAvailableAt:'2026-10-22T02:00:01.000Z',
 lastSourceAvailableAt:'2026-10-22T02:00:00.200Z',referencePrice:46767,
 frozenRuleHash:rules.sha256,
});
const baseSource=()=>({
 status:'READY',actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
 exchangeTimestamp:'2026-10-22T02:00:00.000Z',
 availableAt:'2026-10-22T02:00:00.300Z',
});
const p=(ratio=.6)=>({...baseSource(),pressureRatio:ratio,classifiedCoverage:1});
const a=(move=5,eff=.7)=>({...baseSource(),displacementPoints:move,pathEfficiency:eff});
const m=(eff=.8,vol=20)=>({...baseSource(),pathEfficiency:eff,realizedVolPoints:vol});
const raw=()=>({
 kind:'futures_bidask',executionAuthorized:false,orderRoutesEnabled:false,
 exchangeTimestamp:'2026-10-22T02:00:00.000Z',
 receivedAt:'2026-10-22T02:00:00.200Z',clockSkewMs:200,
 duplicate:false,sequenceGap:0,sequence:null,recordHash:'a'.repeat(64),
 payload:{productFamily:'TX',actualContract:'TXFK6',simtrade:false,
  bid_price:[100,99,98,97,96],ask_price:[101,102,103,104,105],
  bid_volume:[50,40,30,20,10],ask_volume:[20,20,20,20,20]},
});
const quote=()=>projectGovernedL5(raw(),{
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
 calendar,asOfAvailableAt:'2026-10-22T02:00:01.000Z',tickSize:1,
});
const flow=(pressure,response,opts={})=>describeFlowPriceResponse({
 event:event('FLOW_RESPONSE'),rules,calendar,pressure,response,...opts,
});
const market=(input,book=quote(),opts={})=>describeMarketStateNoTrade({
 event:event('MARKET_STATE'),rules,calendar,market:input,quote:book,...opts,
});
test('thresholds require explicit complete validated immutable rules, not model defaults',()=>{
 assert.ok(rules&&Object.isFrozen(rules));
 assert.equal(rules.calibrated,false);
 assert.equal(sealResearchThresholds(null),null);
 assert.equal(sealResearchThresholds({...rules,unknown:1}),null);
 assert.equal(sealResearchThresholds({
  ...Object.fromEntries(Object.keys(rules).filter(k=>k in {
    strongPressureMin:1,weakPressureMax:1,moveMinPoints:1,flatMaxPoints:1,
    highEfficiencyMin:1,trendEfficiencyMin:1,rangeEfficiencyMax:1,
    maxChaseSpreadTicks:1,minDepth5:1,maxAgeMs:1,maxRealizedVolPoints:1
  }).map(k=>[k,rules[k]])),strongPressureMin:false}),null);
});
test('Pressure + price response: push / blocked / mismatch / efficient low-pressure are only candidates',()=>{
 const cases=[
  [.6,5,.8,'BUY_PROGRESS_CANDIDATE'],
  [.6,.1,.8,'BUY_PRESSURE_BLOCKED_CANDIDATE'],
  [-.6,-5,.8,'SELL_PROGRESS_CANDIDATE'],
  [-.6,-.1,.8,'SELL_PRESSURE_BLOCKED_CANDIDATE'],
  [.6,-5,.8,'PRESSURE_PRICE_MISMATCH_CANDIDATE'],
  [.1,5,.85,'LOW_PRESSURE_UPMOVE_CANDIDATE'],
  [-.1,-5,.85,'LOW_PRESSURE_DOWNMOVE_CANDIDATE'],
  [.3,1,.45,'UNCERTAIN'],
 ];
 for(const [ratio,move,eff,label] of cases){
  const out=flow(p(ratio),a(move,eff));
  assert.equal(out.label,label);
  assert.equal(out.state,'DESCRIPTIVE_ONLY_NOT_VALIDATED');
  assert.equal(out.recommendation,false);assert.equal(out.outcomeStatus,'PENDING');
  assert.equal(out.executionAuthorized,false);assert.equal('netEV' in out,false);
 }
});
test('Flow candidate rejects unavailable coverage, stale, future, cross-contract and corrupted rules',()=>{
 const invalid=[
  [p(.6),{...a(),availableAt:'2026-10-22T02:00:02.000Z'}],
  [{...p(.6),classifiedCoverage:.7},a()],
  [{...p(.6),status:'PARTIAL'},a()],
  [{...p(.6),tradeDate:'2026-10-21'},a()],
  [{...p(.6),exchangeTimestamp:'2026-02-30T02:00:00Z'},a()],
  [p(.6),{...a(),actualContract:'TXFM6'}],
  [p(.6),{...a(),pathEfficiency:2}],
 ];
 for(const [pressure,response] of invalid)assert.equal(
  flow(pressure,response).state,'UNAVAILABLE');
 const wrongRule=sealResearchThresholds({
  strongPressureMin:.6,weakPressureMax:.15,moveMinPoints:3,flatMaxPoints:.5,
  highEfficiencyMin:.65,trendEfficiencyMin:.7,rangeEfficiencyMax:.3,
  maxChaseSpreadTicks:3,minDepth5:70,maxAgeMs:30_000,maxRealizedVolPoints:40,
 });
 assert.equal(flow(p(),a(),{rules:wrongRule}).state,'UNAVAILABLE');
});
test('Market State and NO_CHASE separate contemporaneous state from candidate skip reasons',()=>{
 const good=market(m());assert.equal(good.marketState,'TREND_CANDIDATE');
 assert.equal(good.noTradeCandidate,'NONE_PROPOSED');
 assert.equal(good.outcomeStatus,'PENDING');assert.equal(good.executionAuthorized,false);
 const range=market(m(.2));assert.equal(range.marketState,'RANGE_CANDIDATE');
 const uncertain=market(m(.5));assert.equal(uncertain.marketState,'UNCERTAIN');
 const hiVol=market(m(.8,45));assert.equal(hiVol.noTradeCandidate,'HIGH_VOLATILITY_SKIP_CANDIDATE');
 const thinRaw=raw();thinRaw.payload.ask_volume=[5,5,5,5,5];
 const thin=projectGovernedL5(thinRaw,{
  calendar,actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
  asOfAvailableAt:'2026-10-22T02:00:01.000Z',tickSize:1,
 });
 assert.equal(market(m(.8),thin).noTradeCandidate,'NO_CHASE_LIQUIDITY_CANDIDATE');
 const spreadRaw=raw();spreadRaw.payload.ask_price=[104,105,106,107,108];
 const wide=projectGovernedL5(spreadRaw,{
  calendar,actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
  asOfAvailableAt:'2026-10-22T02:00:01.000Z',tickSize:1,
 });
 assert.equal(market(m(.8),wide).noTradeCandidate,'NO_CHASE_LIQUIDITY_CANDIDATE');
});
test('Market State requires real as-of quote and market; missing data never becomes NONE_PROPOSED',()=>{
 const data=m(),q=quote();
 for(const [mkt,book] of [
  [{...data,status:'PARTIAL'},q],[{...data,availableAt:'2026-10-22T02:00:03Z'},q],
  [{...data,exchangeTimestamp:'2026-10-22T04:00:00Z'},q],
  [{...data,pathEfficiency:null},q],[{...data,realizedVolPoints:null},q],
  [{...data,realizedVolPoints:-1},q],
  [data,null],[data,{...q,availableAt:'2026-10-22T02:00:02Z'}],
  [data,{...q,tradeDate:'2026-10-21'}],[data,{...q,spreadTicks:null}],
 ])assert.equal(market(mkt,book).state,'UNAVAILABLE');
});
test('Market State event calendar must match; future outcomes and financial recommendations absent',()=>{
 assert.equal(market(m(),quote(),{calendar:null}).state,'UNAVAILABLE');
 assert.equal(market(m(),quote(),{event:event('FLOW_RESPONSE')}).state,'UNAVAILABLE');
 const x=market(m());assert.equal(x.researchOnly,true);
 assert.equal(x.formalWeight,0);assert.equal(x.recommendation,false);
 assert.equal('mfe' in x,false);assert.equal('mae' in x,false);assert.equal('winRate' in x,false);
});
