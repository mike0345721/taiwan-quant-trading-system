// Offline synthetic load only. No listener, broker, collector or official DB.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCru34LiveCheckpoint,cru34LiveCanonicalJson} from '../src/cru34-live-checkpoint.mjs';
import {readMarketObservationProducer,clearMarketObservationProducerCache} from '../src/market-observation-producer.mjs';
import {marketObservationSnapshot} from '../src/market-observation-core.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {SAFETY,stableJson,digest} from '../src/cvd-observation-core.mjs';

const [rootArg,batchArg='8000',restartArg='0',totalArg='1008000']=process.argv.slice(2);
if(!rootArg||!path.isAbsolute(rootArg))throw Error('ABSOLUTE_ISOLATED_OUTPUT_REQUIRED');
const root=path.resolve(rootArg),batch=Number(batchArg),restartAt=Number(restartArg),total=Number(totalArg);
if(!Number.isInteger(batch)||batch<4||batch>16000||batch%4||!Number.isInteger(total)||total%4)throw Error('LOAD_ARGUMENTS_INVALID');
fs.mkdirSync(root,{recursive:true});
const summaryPath=path.join(root,'summary.json');
if(fs.existsSync(summaryPath)||fs.existsSync(path.join(root,'private')))throw Error('FRESH_OUTPUT_REQUIRED');
const source='sha256:'+digest('CRU61 synthetic 14h 20 events/sec, 3 quotes / trade, no native sequence'),
  start=Date.parse('2026-11-04T07:00:00.000Z'),calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const checkpointPath=path.join(root,'synthetic.checkpoint.json'),cacheRoot=path.join(root,'private');
let hash='GENESIS',canonicalState=null,retained=[],count=0,restarted=false,last=null;
const began=new Date().toISOString(),wall=performance.now(),requests=[],samples=[],snapshots=[],oracle={buy:0,sell:0,unknown:0,total:0,bins:{}};
let maxRss=0,maxHeap=0,maxExternal=0,maxRequestMs=0;
function measure(fn,label){const at=performance.now(),value=fn(),elapsedMs=performance.now()-at,m=process.memoryUsage();
  maxRequestMs=Math.max(maxRequestMs,elapsedMs);maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);maxExternal=Math.max(maxExternal,m.external);
  requests.push({label,ordinal:count,elapsedMs,reason:value?.reason??null,sourceProgress:value?.sourceProgress??null});
  assert.ok(elapsedMs<8000,`${label} exceeded existing 8 second request budget: ${elapsedMs}`);return value;}
function save(final=false,error=null){const result={evidenceType:'ISOLATED_SYNTHETIC_NOT_LIVE',began,ended:new Date().toISOString(),elapsedSeconds:(performance.now()-wall)/1000,
  status:error?'FAIL':final?'PASS':'RUNNING',error:error?String(error.stack):null,scope:{eventsPerSecond:20,quotePerTrade:3,totalEvents:total,
    syntheticDurationSeconds:total/20,batch,restartAt,physicalOrdinal:count,sourceIdentity:source,tradeDate:'2026-11-05',session:'NIGHT',actualContract:'TXFK6',
    singleContinuousSyntheticLedger:true,crossCalendarRawLedgerJoinProven:false},budgets:{requestMs:8000,nodeOldSpaceMiB:256},
  measurements:{maxRequestMs,maxRss,maxHeap,maxExternal,requestCount:requests.length},oracle,samples,snapshots,...SAFETY};
  fs.writeFileSync(summaryPath,JSON.stringify(result,null,2));return result;}
try{
while(count<total){
  const end=Math.min(total,count+batch),rows=[];
  for(let n=count;n<end;n++){
    const receivedAt=new Date(start+n*50).toISOString(),trade=Math.floor(n/4),isTrade=n%4===3;
    const close=20000+Math.round(30*Math.sin(trade/1250)+10*Math.sin(trade/101)),tick_type=trade%3,volume=1+trade%4;
    const row=buildLiveEventRecord({kind:isTrade?'futures_tick':'futures_bidask',code:'TXFK6',receivedAt,...SAFETY,
      payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-05',session:'NIGHT',eventTime:receivedAt,
        ...(isTrade?{close,volume,tick_type}:{bid_price:[close-1],ask_price:[close],bid_volume:[10],ask_volume:[10]})}},hash);
    hash=row.recordHash;rows.push(row);
    if(isTrade){oracle.total+=volume;oracle[tick_type===1?'buy':tick_type===2?'sell':'unknown']+=volume;oracle.bins[close]=(oracle.bins[close]??0)+volume;}
  }
  const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source,ledgerOrdinalOffset:count,initialState:canonicalState});
  canonicalState=canonical.terminalState;count=end;
  retained=retained.concat(canonical.events.map(({eventTime,rawRecord,...event})=>event)).slice(-16000);
  const checkpoint=buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:count,lastVerifiedRecordHash:hash,
    lastVerifiedStartByteOffset:count*700,lastVerifiedEndByteOffset:count*700+699,canonicalState,
    lastVerifiedAvailableAt:rows.at(-1).receivedAt,rollingCanonicalEvents:retained});
  fs.writeFileSync(checkpointPath,cru34LiveCanonicalJson(checkpoint)+'\n');
  const options={checkpointPath,cacheRoot,calendar,asOf:rows.at(-1).receivedAt,staged:true,persistentHistory:true};
  for(let poll=0;poll<2000;poll++){
    last=measure(()=>readMarketObservationProducer(options),'producer');
    if(last.state&&last.complete)break;
    if(poll===1999)throw Error('LOAD_CATCHUP_DID_NOT_FINISH');
  }
  const snapshot=measure(()=>marketObservationSnapshot(last.state,{history:last.history,cutoff:options.asOf,timeframe:'1m'}),'snapshot');
  const combinedRequestMs=requests.at(-1).elapsedMs+requests.at(-2).elapsedMs;
  assert.ok(combinedRequestMs<8000,`final derivation + snapshot exceeded 8s: ${combinedRequestMs}`);
  assert.equal(snapshot.cvd.value,oracle.buy-oracle.sell);assert.equal(snapshot.cvd.unknownVolume,oracle.unknown);
  assert.equal(snapshot.profile.totalVolume,oracle.total);assert.equal(snapshot.profile.tradeCount,count/4);
  assert.equal(last.history.getMeta('checkpoint').fragment.state.originOrdinal,1,'origin must not silently reset');
  assert.ok(!snapshot.reasonCodes.some(r=>/BUDGET|LIMIT|TIMEOUT/.test(r)),snapshot.reasonCodes.join(','));
  if(count===total||count%(batch*10)===0){
    const sample={ordinal:count,availableAt:options.asOf,cvd:snapshot.cvd.value,unknownVolume:snapshot.cvd.unknownVolume,
      totalVolume:snapshot.profile.totalVolume,tradeCount:snapshot.profile.tradeCount,bars:snapshot.price.bars.length,
      curvePoints:snapshot.cvd.series.length,origin:last.history.getMeta('checkpoint').fragment.state.originOrdinal,
      dbBytes:fs.statSync(last.history.file).size,memory:process.memoryUsage()};samples.push(sample);save();process.stdout.write(JSON.stringify(sample)+'\n');
  }
  if(restartAt&&!restarted&&count>=restartAt){
    const before=digest(stableJson(snapshot));clearMarketObservationProducerCache();restarted=true;
    let polls=0;
    do{last=measure(()=>readMarketObservationProducer(options),'restart');if(++polls>2000)throw Error('RESTART_DID_NOT_FINISH');}while(!last.state||!last.complete);
    const after=measure(()=>marketObservationSnapshot(last.state,{history:last.history,cutoff:options.asOf,timeframe:'1m'}),'restart-snapshot');
    assert.equal(digest(stableJson(after)),before);snapshots.push({kind:'restart-equality',ordinal:count,hash:before,polls});
  }
}
for(const fraction of [0.25,0.5,0.75,1]){
  const ordinal=Math.floor(total*fraction/4)*4,cutoff=new Date(start+(ordinal-1)*50).toISOString();
  const s=measure(()=>marketObservationSnapshot(last.state,{history:last.history,cutoff,timeframe:'1m'}),'historical-prefix');
  snapshots.push({kind:'historical-prefix',ordinal,hash:digest(stableJson(s)),snapshot:s});
}
assert.equal(last.history.statement('SELECT COUNT(*) AS n FROM quotes').get().n,total*3/4);
assert.equal(last.history.statement('SELECT COUNT(*) AS n FROM points').get().n,total/4);
assert.equal(last.history.statement('SELECT COUNT(*) AS n FROM trades').get().n,total/4);
save(true);fs.writeFileSync(path.join(root,'requests.json'),JSON.stringify(requests));
}catch(error){save(false,error);fs.writeFileSync(path.join(root,'requests.json'),JSON.stringify(requests));process.exitCode=1;}
finally{clearMarketObservationProducerCache();}
