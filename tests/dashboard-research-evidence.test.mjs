import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildResearchEvidence,readLatestResearchQuote,readResearchResult} from '../src/dashboard-research-evidence.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {calendar,seal} from './research-replay-fixtures.mjs';
import {projectGovernedL5,freezeOutcomeCandidate} from '../src/microstructure-outcome-research-v1.mjs';
export const inputs=()=>({calendar,now:new Date('2026-10-22T02:00:01Z'),quote:buildLiveEventRecord({kind:'futures_bidask',code:'TXFK6',
 exchangeTimestamp:'2026-10-22T02:00:00Z',receivedAt:'2026-10-22T02:00:00.200Z',clockSkewMs:200,duplicate:false,sequenceGap:0,
 executionAuthorized:false,orderRoutesEnabled:false,payload:{productFamily:'TX',actualContract:'TXFK6',simtrade:false,
 bid_price:[10000,9999,9998,9997,9996],ask_price:[10001,10002,10003,10004,10005],bid_volume:[10,20,30,40,50],ask_volume:[10,20,30,40,50]}}),
 flow:{sourceState:'LIVE',source:{sourceMode:'LIVE',availableAt:'2026-10-22T02:00:00.200Z',validUntil:'2026-10-22T02:00:05Z'},
 identity:{actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY'},windows:{primary60s:{label:'1分',status:'READY',
 pressure:{status:'READY',pressureRatio:.3,classifiedCoverage:1},response:{status:'READY',displacementPoints:2},pathEfficiency:{status:'READY',value:.5}}}}});
test('qualified same-session source reaches UI contract with actual levels, Flow and response',()=>{
 const x=inputs(),r=buildResearchEvidence(x);assert.equal(r.depth.state,'READY');assert.equal(r.depth.value.bids.length,5);
 assert.equal(r.windows[0].pressure.value,.3);assert.equal(r.windows[0].response.value.displacementPoints,2);assert.equal(r.comparison.metrics,null);
});
test('stale, unknown coverage, future receipt and contract mismatch clear numbers',()=>{
 const stale=inputs();stale.now=new Date('2026-10-22T02:00:06Z');let r=buildResearchEvidence(stale);
 assert.equal(r.depth.value,null);assert.equal(r.windows[0].pressure.value,null);
 const bad=inputs();bad.flow.windows.primary60s.pressure.classifiedCoverage=.99;r=buildResearchEvidence(bad);
 assert.equal(r.windows[0].pressure.value,null);assert.equal(r.windows[0].response.state,'READY');
 const future=inputs();future.quote.exchangeTimestamp='2026-10-22T02:00:01Z';r=buildResearchEvidence(future);assert.equal(r.depth.value,null);
 const mismatch=inputs();mismatch.flow.identity.actualContract='TXFJ6';assert.equal(buildResearchEvidence(mismatch).depth.value,null);
});
test('L5 direct gate refuses old quote or source after receipt, even within former skew tolerance',()=>{
 const x=inputs(),context={calendar,asOfAvailableAt:x.now.toISOString(),actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',tickSize:1};
 assert.equal(projectGovernedL5(x.quote,{...context,asOfAvailableAt:'2026-10-22T02:01:00Z'}).state,'UNAVAILABLE');
 x.quote.exchangeTimestamp='2026-10-22T02:00:00.300Z';assert.equal(projectGovernedL5(x.quote,context).state,'UNAVAILABLE');
});
test('bounded ledger reader closes file, checks record hash, and never falls back from invalid newest quote',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-read-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'live-events'));const file=path.join(dir,'live-events','2026-10-22.ndjson'),x=inputs();
 fs.writeFileSync(file,JSON.stringify(x.quote)+'\n');assert.equal(readLatestResearchQuote(dir,x.now).recordHash,x.quote.recordHash);
 const broken=structuredClone(x.quote);broken.payload.bid_volume[0]=999;fs.appendFileSync(file,JSON.stringify(broken)+'\n');
 assert.equal(readLatestResearchQuote(dir,x.now),null);fs.renameSync(file,file+'.closed');
});
test('research result missing or content hash changed is unavailable',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-result-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'result.json');assert.equal(readResearchResult(file),null);
 fs.writeFileSync(file,JSON.stringify(seal({schemaVersion:'research-replay-run-v1',researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false,outcomes:[]})));
 assert.ok(readResearchResult(file));const changed=JSON.parse(fs.readFileSync(file));changed.outcomes=[{netExitPoints:1000}];fs.writeFileSync(file,JSON.stringify(changed));assert.equal(readResearchResult(file),null);
});
test('microsecond future source cannot reach READY or a frozen candidate',()=>{
 const x=inputs();x.quote.exchangeTimestamp='2026-10-22T02:00:00.200900Z';x.quote.receivedAt='2026-10-22T02:00:00.200100Z';
 assert.equal(buildResearchEvidence(x).depth.state,'UNAVAILABLE');
 const e=freezeOutcomeCandidate({calendar,eventId:'SYNTHETIC:001',observationKind:'FLOW_RESPONSE',actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
  eventExchangeTimestamp:x.quote.exchangeTimestamp,lastSourceAvailableAt:x.quote.receivedAt,asOfAvailableAt:x.now.toISOString(),referencePrice:10000,frozenRuleHash:'a'.repeat(64)});
 assert.equal(e.state,'UNAVAILABLE');
 const y=inputs();y.now=new Date('2026-10-22T02:00:00.200Z');y.flow.source.availableAt='2026-10-22T02:00:00.200900Z';
 assert.equal(buildResearchEvidence(y).windows[0].pressure.value,null);
});

function quoteWithTimes(quote,receivedAt,exchangeTimestamp=quote.exchangeTimestamp){
 const {recordHash,...body}=quote;
 return buildLiveEventRecord({...structuredClone(body),receivedAt,exchangeTimestamp},body.previousHash);
}
function quoteLedger(t,quotes){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-asof-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'live-events'));
 const file=path.join(dir,'live-events','2026-10-22.ndjson');
 fs.writeFileSync(file,quotes.map(q=>JSON.stringify(q)).join('\n')+'\n');return {dir,file};
}
test('quotes appended after the frozen cutoff cannot displace the newest quote known at that cutoff',t=>{
 const x=inputs(),later=quoteWithTimes(x.quote,'2026-10-22T02:00:01.006Z','2026-10-22T02:00:01.001Z');
 const {dir}=quoteLedger(t,[x.quote,later]);
 const selected=readLatestResearchQuote(dir,x.now);
 assert.equal(selected.recordHash,x.quote.recordHash);
 assert.equal(buildResearchEvidence({...x,quote:selected}).depth.state,'READY');
 assert.equal(readLatestResearchQuote(dir,new Date('2026-10-22T02:00:01.007Z')).recordHash,later.recordHash);
 assert.equal(later.receivedAt,'2026-10-22T02:00:01.006Z');
});
test('as-of selection keeps exact receipt equality and rejects a receipt one nanosecond later',t=>{
 const x=inputs(),cutoff=new Date('2026-10-22T02:00:00.200Z');
 const exact=quoteWithTimes(x.quote,'2026-10-22T02:00:00.200000000Z');
 const future=quoteWithTimes(x.quote,'2026-10-22T02:00:00.200000001Z');
 const {dir,file}=quoteLedger(t,[exact,future]);
 assert.equal(readLatestResearchQuote(dir,cutoff).recordHash,exact.recordHash);
 fs.writeFileSync(file,JSON.stringify(future)+'\n');assert.equal(readLatestResearchQuote(dir,cutoff),null);
});
test('hash failure in a later receipt remains unavailable instead of selecting an older valid quote',t=>{
 const x=inputs(),later=quoteWithTimes(x.quote,'2026-10-22T02:00:01.006Z');later.payload.bid_volume[0]=999;
 const {dir}=quoteLedger(t,[x.quote,later]);assert.equal(readLatestResearchQuote(dir,x.now),null);
});
test('source clock error in the newest arrived quote remains visible instead of falling back',t=>{
 const x=inputs(),bad=quoteWithTimes(x.quote,'2026-10-22T02:00:00.300Z','2026-10-22T02:00:00.301Z');
 const {dir}=quoteLedger(t,[x.quote,bad]);const selected=readLatestResearchQuote(dir,x.now);
 assert.equal(selected.recordHash,bad.recordHash);
 assert.equal(buildResearchEvidence({...x,quote:selected}).depth.reason,'SOURCE_TIME_NOT_KNOWN_AS_OF');
});
test('waiting for an eligible quote does not renew stale source time or hide malformed receipt time',t=>{
 const x=inputs();x.now=new Date('2026-10-22T02:00:06Z');
 const future=quoteWithTimes(x.quote,'2026-10-22T02:00:06.001Z','2026-10-22T02:00:05.999Z');
 const {dir,file}=quoteLedger(t,[x.quote,future]);const selected=readLatestResearchQuote(dir,x.now);
 assert.equal(selected.recordHash,x.quote.recordHash);
 assert.equal(buildResearchEvidence({...x,quote:selected}).depth.state,'UNAVAILABLE');
 const unzoned=quoteWithTimes(x.quote,'2026-10-22T02:00:00.300');
 fs.writeFileSync(file,[x.quote,unzoned].map(q=>JSON.stringify(q)).join('\n')+'\n');
 assert.equal(readLatestResearchQuote(dir,x.now),null);
});
