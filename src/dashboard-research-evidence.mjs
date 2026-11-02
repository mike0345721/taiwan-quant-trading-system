import fs from 'node:fs';
import path from 'node:path';
import {buildLiveEventRecord} from './live-event-ledger.mjs';
import {parseVerifiedResearchLiveEventWire} from './research-live-event-wire.mjs';
import {projectGovernedL5} from './microstructure-outcome-research-v1.mjs';
import {classifyTxChartSession} from './dashboard-tx-chart.mjs';
import {evidenceTimestampMs as ms,evidenceTimestampNs as ns} from './research-evidence-contract-v1.mjs';
import {verifyFrozen,safety,finite} from './research-replay-outcome.mjs';

const unavailable=reason=>({state:'UNAVAILABLE',reason,value:null,validUntil:null});
// Bounded read, promptly closed. No writes, locks, collector, or broker interaction.
export function readLatestResearchQuote(dataRoot,now=new Date()) {
  let fd;
  try{
    const asOf=ns(now.toISOString());if(asOf===null)return null;
    const date=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
    const filename=path.join(dataRoot,'live-events',date+'.ndjson');
    fd=fs.openSync(filename,'r');const size=fs.fstatSync(fd).size;
    const start=Math.max(0,size-1024*1024),buffer=Buffer.alloc(size-start);
    const read=fs.readSync(fd,buffer,0,buffer.length,start);
    const bytes=buffer.subarray(0,read);
    const first=start>0?bytes.indexOf(10)+1:0,last=bytes.lastIndexOf(10);
    if((start>0&&first===0)||last<first)return null;
    // Trim incomplete byte-boundary lines before strict UTF-8 decoding.
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(first,last));
    const lines=text.split('\n');
    for(let i=lines.length-1;i>=0;i--){
      if(!lines[i].includes('futures_bidask'))continue;
      let r;try{r=JSON.parse(lines[i]);}catch{return null;}
      if(r.kind!=='futures_bidask'||r.payload?.productFamily!=='TX')continue;
      r=parseVerifiedResearchLiveEventWire(lines[i]);
      const {recordHash,...body}=r;
      // Keep all existing identity/time/execution/sensitive-field validation.
      // Return the original verified row, never the JS re-hashed result.
      buildLiveEventRecord(body,body.previousHash);
      const available=ns(r.receivedAt);if(available===null)return null;
      // A live writer can append after the request freezes its cutoff. Skip only
      // receipts not yet known then; never skip an arrived quote's quality failure.
      if(available>asOf)continue;
      return r;
    }
  }catch{return null;}finally{if(fd!==undefined)fs.closeSync(fd);}
  return null;
}
export function readResearchResult(filename) {
  try{
    if(fs.statSync(filename).size>16*1024*1024)return null;
    const result=JSON.parse(fs.readFileSync(filename,'utf8'));
    return result.schemaVersion==='research-replay-run-v1'&&verifyFrozen(result)
      &&result.executionAuthorized===false&&result.orderRoutesEnabled===false&&result.researchOnly===true
      &&result.formalWeight===0?result:null;
  }catch{return null;}
}
export function buildResearchEvidence({flow,quote,calendar,now=new Date(),result=null}={}) {
  const servedAt=now.toISOString(),stamp=now.getTime();
  let current;try{current=classifyTxChartSession(servedAt,calendar);}catch{current=null;}
  let depth=unavailable('NO_FRESH_VERIFIED_FIVE_LEVEL_QUOTE');
  if(current?.session&&current?.tradeDate&&quote){
    const p=projectGovernedL5(quote,{asOfAvailableAt:servedAt,actualContract:quote.payload?.actualContract,
      tradeDate:current.tradeDate,session:current.session,tickSize:1,calendar});
    if(p.state==='FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED')depth={state:'READY',reason:null,
      value:{...p,bids:quote.payload.bid_price.map((price,i)=>({price:Number(price),volume:Number(quote.payload.bid_volume[i])})),
        asks:quote.payload.ask_price.map((price,i)=>({price:Number(price),volume:Number(quote.payload.ask_volume[i])}))},
      validUntil:new Date(ms(p.sourceTime,{taipeiNaive:true})+5000).toISOString()};
    else depth=unavailable(p.reason);
  }
  const available=ms(flow?.source?.availableAt),until=ms(flow?.source?.validUntil);
  const availableNs=ns(flow?.source?.availableAt),stampNs=ns(servedAt),untilNs=ns(flow?.source?.validUntil);
  const flowLive=flow?.sourceState==='LIVE'&&flow.source?.sourceMode==='LIVE'
    &&availableNs!==null&&untilNs!==null&&availableNs<=stampNs&&stampNs-availableNs<=5000000000n&&stampNs<=untilNs
    &&flow.identity?.tradeDate===current?.tradeDate&&flow.identity?.session===current?.session;
  if(depth.state==='READY'&&flowLive&&depth.value.actualContract!==flow.identity.actualContract)
    depth=unavailable('QUOTE_FLOW_CONTRACT_MISMATCH');
  const windows=Object.entries(flow?.windows||{}).map(([key,w])=>{
    const live=flowLive&&w.status==='READY'&&(!w.truthState||w.truthState==='LIVE');
    const pressure=live&&w.pressure?.status==='READY'&&w.pressure.classifiedCoverage===1
      &&finite(w.pressure.pressureRatio)&&Math.abs(w.pressure.pressureRatio)<=1;
    const response=live&&w.response?.status==='READY'&&w.pathEfficiency?.status==='READY'
      &&finite(w.response.displacementPoints)&&finite(w.pathEfficiency.value)
      &&w.pathEfficiency.value>=0&&w.pathEfficiency.value<=1;
    const validUntil=flowLive?new Date(Math.min(until,available+5000)).toISOString():null;
    return {key,label:w.label,classifiedCoverage:finite(w.pressure?.classifiedCoverage)?w.pressure.classifiedCoverage:null,
      pressure:pressure?{state:'READY',value:w.pressure.pressureRatio,validUntil}:
        unavailable(flowLive?(w.pressure?.unavailableReason||'FLOW_QUALITY_INSUFFICIENT'):'FLOW_STALE_OR_SESSION_UNAVAILABLE'),
      response:response?{state:'READY',value:{displacementPoints:w.response.displacementPoints,efficiency:w.pathEfficiency.value},validUntil}:
        unavailable(flowLive?'RESPONSE_QUALITY_INSUFFICIENT':'RESPONSE_STALE_OR_SESSION_UNAVAILABLE')};
  });
  return {schemaVersion:'dashboard-research-evidence-v1',servedAt,depth,windows,
    sourceIdentity:flow?.identity||null,sourceAvailableAt:flow?.source?.availableAt||null,
    outcomes:result?.outcomes||[],comparison:result?.comparison||{state:'BLOCKED',reason:'QUALIFIED_OUTCOME_CORPUS_MISSING',metrics:null},
    researchResultSha256:result?.sha256||null,...safety};
}
