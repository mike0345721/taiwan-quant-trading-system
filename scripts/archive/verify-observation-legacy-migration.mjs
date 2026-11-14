// Private legacy-cache preparation and bounded migration/restart; no official writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildCru34LiveCheckpoint, cru34LiveCanonicalJson } from '../src/cru34-live-checkpoint.mjs';
import { readMarketObservationProducer, clearMarketObservationProducerCache } from '../src/market-observation-producer.mjs';
import { marketObservationSnapshot } from '../src/market-observation-core.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { SAFETY, digest, stableJson } from '../src/cvd-observation-core.mjs';
const [root,mode='prepare'] = process.argv.slice(2);
if(!path.isAbsolute(root||''))throw Error('ABSOLUTE_OUTPUT_REQUIRED');
const checkpointPath=path.join(root,'2026-11-04.checkpoint.json'),cacheRoot=path.join(root,'private');
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const options={checkpointPath,cacheRoot,calendar,asOf:'2026-11-04T14:00:00Z'};
if(mode==='prepare'){
  if(fs.existsSync(root))throw Error('FRESH_OUTPUT_REQUIRED');fs.mkdirSync(root,{recursive:true});
  let hash='GENESIS',canonicalState=null,events=[],result,cacheBytes=0;
  const source='sha256:'+digest('legacy migration resource evidence'),start=Date.parse('2026-11-04T07:00:00Z');
  for(let offset=0;offset<48000;offset+=4000){
    const rows=[];
    for(let n=offset;n<offset+4000;n++){
      const at=new Date(start+n*500).toISOString(),tick=n%2===1,price=20000+Math.floor(n/2)%80;
      const row=buildLiveEventRecord({kind:tick?'futures_tick':'futures_bidask',code:'TXFK6',receivedAt:at,...SAFETY,
        payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-05',session:'NIGHT',eventTime:at,
          ...(tick?{close:price,volume:1,tick_type:1}:{bid_price:[price-1],ask_price:[price]})}},hash);
      rows.push(row);hash=row.recordHash;
    }
    const c=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source,ledgerOrdinalOffset:offset,initialState:canonicalState});canonicalState=c.terminalState;
    events=events.concat(c.events.map(({rawRecord,eventTime,...e})=>e)).slice(-20000);
    const checkpoint=buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:offset+4000,lastVerifiedRecordHash:hash,
      lastVerifiedStartByteOffset:(offset+4000)*700,lastVerifiedEndByteOffset:(offset+4000)*700+699,canonicalState,
      lastVerifiedAvailableAt:rows.at(-1).receivedAt,rollingCanonicalEvents:events});
    fs.writeFileSync(checkpointPath,cru34LiveCanonicalJson(checkpoint)+'\n');result=readMarketObservationProducer(options);
    const file=fs.readdirSync(path.join(cacheRoot,'market-observation')).find(n=>n.endsWith('.producer-fragment'));
    cacheBytes=fs.statSync(path.join(cacheRoot,'market-observation',file)).size;
    console.log(JSON.stringify({ordinal:offset+4000,cacheBytes}));
    if(cacheBytes>=56*1024*1024)break;
  }
  const prefixes=[.25,.5,.75,1].map(fraction=>{
    const cvd=result.state.fragmentSemantic.series,n=Math.floor(cvd.length*fraction)-1,cutoff=cvd[n].availableAt;
    return {cutoff,hash:digest(stableJson(marketObservationSnapshot(result.state,{cutoff,timeframe:'1m'})))};
  });
  fs.writeFileSync(path.join(root,'expected.json'),JSON.stringify({cacheBytes,prefixes}));clearMarketObservationProducerCache();
}else{
  const receiptPath=path.join(root,mode+'-receipt.json');if(fs.existsSync(receiptPath))throw Error('FRESH_RECEIPT_REQUIRED');
  const expected=JSON.parse(fs.readFileSync(path.join(root,'expected.json'),'utf8'));
  const file=path.join(cacheRoot,'market-observation',fs.readdirSync(path.join(cacheRoot,'market-observation')).find(n=>n.endsWith('.producer-fragment')));
  const originalHash=digest(fs.readFileSync(file)),calls=[],began=new Date().toISOString(),wall=performance.now();
  let result,peakRss=0,peakHeap=0,restarted=false,status='FAIL',failure=null;
  try{
    for(let n=0;n<1000;n++){
      const at=performance.now();result=readMarketObservationProducer({...options,persistentHistory:true,staged:true});const elapsedMs=performance.now()-at;
      calls.push({n,elapsedMs,reason:result.reason,progress:result.sourceProgress});peakRss=Math.max(peakRss,process.memoryUsage().rss);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
      assert.ok(elapsedMs<8000,`migration request exceeded8s: ${elapsedMs}`);
      if(result.reason==='LEGACY_CACHE_MIGRATION_PENDING'&&result.sourceProgress?.index>0&&!restarted){clearMarketObservationProducerCache();restarted=true;}
      if(result.state)break;
    }
    assert.ok(result.state);assert.ok(restarted);
    for(const prefix of expected.prefixes)assert.equal(digest(stableJson(marketObservationSnapshot(result.state,{cutoff:prefix.cutoff,timeframe:'1m',history:result.history}))),prefix.hash);
    assert.equal(digest(fs.readFileSync(file)),originalHash);status='PASS';
  }catch(error){failure=String(error.stack);process.exitCode=1;}
  finally{clearMarketObservationProducerCache();const receipt={status,failure,evidenceType:'SYNTHETIC_LEGACY_MIGRATION_NOT_LIVE',began,ended:new Date().toISOString(),elapsedSeconds:(performance.now()-wall)/1000,
    cacheBytes:expected.cacheBytes,originalHash,peakRss,peakHeap,restarted,calls};fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status,failure,peakRss,peakHeap,calls:calls.length}));}
}
