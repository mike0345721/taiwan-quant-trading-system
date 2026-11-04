import test from 'node:test';import assert from 'node:assert/strict';
import {compareObservationAblations,ABLATION_SPEC_HASH} from '../src/market-observation-ablation.mjs';
const time=i=>new Date(Date.UTC(2026,10,4,1,i)).toISOString();
const identity={actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',continuityEpoch:'TX:1',sourceLedgerIdentity:'sha256:'+'a'.repeat(64)};
const bars=Array.from({length:12},(_,i)=>({time:time(i),endTime:time(i+1),availableAt:time(i+1),closed:true,identity,open:100,high:120,low:90,close:i<6?110:95}));
const event=(id,i,profile,cvd)=>({id,identity,type:'BOS',direction:'UP',confirmedAt:time(i),location:{price:profile?111:100,vah:110,val:95},windows:{test:{deltaCvd:cvd?10:-10,coverage:1}}});
test('fixed same cohort A/B/C/D accounts costs, drawdown and both discarded winners/losses',()=>{
 const report=compareObservationAblations({events:[event('a',0,true,true),event('b',6,false,false)],bars,datasetRole:'FIXTURE',sourceIdentity:'synthetic'});
 assert.equal(report.variants.A.sampleCount,2);assert.ok(Math.abs(report.variants.A.netExpectationPoints+1.61)<1e-12);
 assert.equal(report.variants.A.eventSequenceMaxDrawdownPoints,9.11);assert.equal(report.variants.D.sampleCount,1);
 assert.equal(report.variants.D.removedLosses,1);assert.equal(report.variants.D.retention,.5);assert.equal(report.specHash,ABLATION_SPEC_HASH);
 const lost=compareObservationAblations({events:[event('a',0,false,false),event('b',6,true,true)],bars,datasetRole:'FIXTURE',sourceIdentity:'synthetic'});
 assert.equal(lost.variants.D.removedGoodOpportunities,1);assert.ok(lost.variants.D.netExpectationPoints<0);
});
test('no holdout access, parameter changes, duplicate cohort or incomplete future outcomes disguised as pass',()=>{
 for(const datasetRole of ['OOS','HOLDOUT','LIVE'])assert.throws(()=>compareObservationAblations({events:[],bars,datasetRole,sourceIdentity:'x'}),/SCOPE/);
 assert.throws(()=>compareObservationAblations({events:[],bars,datasetRole:'TRAINING',sourceIdentity:'x',specHash:'tuned'}),/SCOPE/);
 const r=compareObservationAblations({events:[event('late',11,true,true)],bars,datasetRole:'TRAINING',sourceIdentity:'x'});
 assert.equal(r.pendingOutcomes,1);assert.equal(r.variants.A.netExpectationPoints,null);assert.equal(r.status,'INSUFFICIENT_DATA');
 const input={events:[event('one',0,true,true)],bars,datasetRole:'TRAINING',sourceIdentity:'x'};
 assert.throws(()=>compareObservationAblations({...input,events:[...input.events,...input.events]}),/DUPLICATE/);
 assert.throws(()=>compareObservationAblations({...input,events:[{...input.events[0],identity:{...identity,session:'NIGHT'}}]}),/IDENTITY/);
 assert.throws(()=>compareObservationAblations({...input,bars:[bars[1],bars[0]]}),/BAR_INVALID/);
 assert.throws(()=>compareObservationAblations({...input,bars:[{...bars[0],closed:false}]}),/BAR_INVALID/);
});
