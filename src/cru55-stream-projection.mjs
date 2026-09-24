import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { validateStreamCheckpoint, streamCurrent } from './cru55-stream-core.mjs';
import { classifyRelationship, compareEqualWindow } from './cvd-relationship-projection.mjs';
import { proveHandoffPair, classifyHandoff } from './cvd-handoff-projection.mjs';
import { buildOneMinuteBars, aggregateChartBars, classifyTxChartSession } from './dashboard-tx-chart.mjs';

// Candidate reducer over hash-addressed store facts. The caller must validate the
// expected page head and verify the original raw prefix before publishing; this
// job hash is a resumable-state binding, NOT frozen semanticHash or raw evidence.
// Memory is independent of history length: 13 scalar accumulators, <=840 minute
// bars, <=200 display buckets and one physical predecessor. Total scan is O(N).
// Historical relationships retain up to 256 verified publication endpoints;
// immutable artifacts retain full prior publications. This bounded display is
// not a claim of per-point timeline equivalence.
export const PROJECTION_LIMITS = Object.freeze({ pageFacts:128, pageBytes:2*1024*1024, jobBytes:2*1024*1024, minuteBuckets:840, displayBuckets:200 });
const frames = {'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000};
const equal=(a,b)=>stableJson(a)===stableJson(b);
const identity=e=>[e.actualContract,e.tradeDate,e.session,e.continuityEpoch];
const lineage=e=>({sourceLedgerIdentity:e.sourceLedgerIdentity,cutoffLedgerOrdinal:e.ledgerOrdinal,cutoffRecordHash:e.recordHash,availableAt:e.availableAt,availableAtMs:e.availableMs,availabilityLineageStatus:e.availabilityLineageStatus});
const fail=s=>{throw Error(s);};
const positive=x=>x!==null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
function accumulator(){return {n:0,buy:0,sell:0,unknown:0,total:0,qbuy:0,qsell:0,inside:0,unavailable:0,matched:0,conflicts:0,delta:0,classified:0,nullGap:false,badIdentity:false,badAvailability:false,badPrice:false,badVolume:false,first:null,last:null,path:0,maxGap:0,pathReason:null};}
function accumulate(a,e,p,prior,pressure){
  a.n++; a.badIdentity ||= e.identityStatus!=='USABLE';a.badAvailability ||= e.availabilityLineageStatus!=='USABLE';
  const price=positive(e.payload?.price??e.payload?.close),volume=positive(e.payload?.executedVolume??e.payload?.volume);
  a.badPrice ||= price===null;a.badVolume ||= volume===null;
  a.nullGap ||= (p.value===null&&p.reason!=='NO_CLASSIFIED_VOLUME')||Boolean(prior&&prior.value===null&&prior.reason!=='NO_CLASSIFIED_VOLUME');
  a.delta+=(p.buyProxyVolume-p.sellProxyVolume)-(prior?prior.buyProxyVolume-prior.sellProxyVolume:0);
  a.classified+=(p.buyProxyVolume+p.sellProxyVolume)-(prior?prior.buyProxyVolume+prior.sellProxyVolume:0);
  if(pressure){for(const [key,field] of Object.entries({buy:'buyProxyVolume',sell:'sellProxyVolume',unknown:'unknownVolume',total:'totalExecutedVolume'}))a[key]+=pressure[field]??0;
    const q=pressure.bestQuoteCrossCheck; if(q){a.qbuy+=q.buyProxyVolume;a.qsell+=q.sellProxyVolume;a.inside+=q.insideSpreadVolume;a.unavailable+=q.unavailableVolume;a.matched+=q.matchedTicks;}a.conflicts+=pressure.conflict?.count??0;}
  const endpoint={price,eventMs:e.eventMs,availableAt:e.availableAt,eventTime:e.eventTime,ledgerOrdinal:e.ledgerOrdinal,recordHash:e.recordHash};
  if(a.last&&!a.pathReason){const gap=e.eventMs-a.last.eventMs;if(gap<0)a.pathReason='QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION';else{a.maxGap=Math.max(a.maxGap,gap);if(gap>30000)a.pathReason='QUALITY_INSUFFICIENT_LONG_GAP';else a.path+=Math.abs(price-a.last.price);}}
  a.first??=endpoint;a.last=endpoint;
}
function publicWindow(a,windowMs){
  const coverage=a.total?(a.buy+a.sell)/a.total:null,ratio=a.buy+a.sell?(a.buy-a.sell)/(a.buy+a.sell):null;
  const pressureReason=!a.n?'NO_ELIGIBLE_TICKS':a.badIdentity||a.badAvailability?'TICK_LINEAGE_UNUSABLE':a.badPrice||a.badVolume?'TICK_PRICE_OR_VOLUME_INVALID':null;
  const pressure=pressureReason?{status:!a.n?'UNAVAILABLE':'QUALITY_INSUFFICIENT',unavailableReason:pressureReason,windowMs,pressureRatio:null,direction:'UNAVAILABLE',relativeIntensity:'RESEARCH_PENDING',controlObservationState:'RESEARCH_PENDING'}:
    {status:coverage===1?'READY':'QUALITY_INSUFFICIENT',unavailableReason:coverage===1?null:'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',windowMs,tickCount:a.n,totalExecutedVolume:a.total,buyProxyVolume:a.buy,sellProxyVolume:a.sell,unknownVolume:a.unknown,classifiedVolume:a.buy+a.sell,netAggressiveFlowProxy:a.buy-a.sell,pressureRatio:ratio,direction:coverage!==1?'UNAVAILABLE':ratio>0?'BUY_SIDE':ratio<0?'SELL_SIDE':'BALANCED',classifiedCoverage:coverage,bestQuoteCrossCheck:{buyProxyVolume:a.qbuy,sellProxyVolume:a.qsell,insideSpreadVolume:a.inside,unavailableVolume:a.unavailable,matchedCoverage:(a.qbuy+a.qsell)/a.total,matchedTicks:a.matched},conflict:{count:a.conflicts,rate:a.matched?a.conflicts/a.matched:null},relativeIntensity:'RESEARCH_PENDING',controlObservationState:'RESEARCH_PENDING'};
  const responseReason=a.badIdentity?'TICK_IDENTITY_UNUSABLE':a.badAvailability?'TICK_AVAILABILITY_LINEAGE_UNUSABLE':a.badPrice?'TICK_PRICE_INVALID':null;
  const displacement=a.n&&!responseReason?a.last.price-a.first.price:null;
  const response={status:a.n&&!responseReason?'READY':'UNAVAILABLE',startPrice:displacement===null?null:a.first.price,endPrice:displacement===null?null:a.last.price,displacementPoints:displacement,displacementTicks:displacement,directionRelation:displacement===null?'PRESSURE_UNAVAILABLE':displacement===0?'FLAT_PRICE':!Number.isFinite(pressure.pressureRatio)||pressure.pressureRatio===0?'PRESSURE_UNAVAILABLE':Math.sign(displacement)===Math.sign(pressure.pressureRatio)?'SAME_DIRECTION':'OPPOSITE_DIRECTION'};
  const pathReason=a.badIdentity?'QUALITY_INSUFFICIENT_IDENTITY':a.badAvailability?'QUALITY_INSUFFICIENT_AVAILABILITY_LINEAGE':a.badPrice?'QUALITY_INSUFFICIENT_PRICE':a.n<3?'INSUFFICIENT_OBSERVATIONS':a.pathReason||(!a.path?'UNAVAILABLE_ZERO_PATH':null);
  const pathEfficiency=pathReason?{status:pathReason.startsWith('QUALITY_INSUFFICIENT_')?'QUALITY_INSUFFICIENT':'UNAVAILABLE',value:null,unavailableReason:pathReason,tickCount:a.n,maxObservedGapMs:responseReason||a.n<3?null:a.maxGap,maxAllowedGapMs:30000}:{status:'READY',value:Math.min(1,Math.abs(displacement)/a.path),unavailableReason:null,tickCount:a.n,pathLengthPoints:a.path,netDisplacementPoints:Math.abs(displacement),maxObservedGapMs:a.maxGap,maxAllowedGapMs:30000};
  const reasons=[];if(pressure.status==='QUALITY_INSUFFICIENT')reasons.push(pressure.unavailableReason);if(pressure.classifiedCoverage!=null&&pressure.classifiedCoverage<1)reasons.push('PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');if(responseReason)reasons.push(responseReason);if(pathEfficiency.status==='QUALITY_INSUFFICIENT')reasons.push(pathEfficiency.unavailableReason);
  const quality={status:reasons.length?'QUALITY_INSUFFICIENT':!a.n?'UNAVAILABLE':pressure.status!=='READY'||pressure.pressureRatio===null||response.status!=='READY'||pathEfficiency.status!=='READY'?'PARTIAL':'READY',reasons:[...new Set(reasons)],classifiedCoverage:pressure.classifiedCoverage??null,bestQuoteMatchedCoverage:pressure.bestQuoteCrossCheck?.matchedCoverage??null,classificationConflictRate:pressure.conflict?.rate??null,unknownVolume:pressure.unknownVolume??null};
  return {pressure,response,pathEfficiency,quality,unavailableReason:quality.reasons[0]||pressure.unavailableReason||responseReason||pathEfficiency.unavailableReason||null};
}
function seal(job){delete job.jobHash;const text=stableJson(job);if(Buffer.byteLength(text)>PROJECTION_LIMITS.jobBytes)fail('STREAM_PROJECTION_JOB_BUDGET');return {...job,jobHash:digest(text)};}
function validate(job){const {jobHash,...body}=job;if(jobHash!==digest(stableJson(body))||job.schemaVersion!=='cru55-stream-projection-job-v1')fail('STREAM_PROJECTION_JOB_INVALID');if(Buffer.byteLength(stableJson(job))>PROJECTION_LIMITS.jobBytes)fail('STREAM_PROJECTION_JOB_BUDGET');return structuredClone(body);}
// Shared primitives for the exact indexed candidate. The full-scan entry points
// below remain the semantic oracle; no aggregate arithmetic is substituted here.
export const projectionPrimitives = Object.freeze({ accumulator, accumulate, seal, validate });
export function createProjectionJob({checkpoint,sourceKind,generationHash,calendar}){
  const s=validateStreamCheckpoint(checkpoint);if(!calendar||!['SYNTHETIC_FIXTURE','GOVERNED_FRAGMENT'].includes(sourceKind)||!/^[a-f0-9]{64}$/.test(generationHash||''))fail('STREAM_PROJECTION_INPUT_INVALID');
  calendar={...calendar,tradingDates:[...calendar.tradingDates],nonTradingDates:[...calendar.nonTradingDates],exceptions:[...calendar.exceptions]};
  const end=Date.parse(s.lastPoint?.eventTime),start=Date.parse(s.activeSegment?.observedStart);
  return seal({schemaVersion:'cru55-stream-projection-job-v1',checkpoint,sourceKind,generationHash,calendar,nextOrdinal:1,terminalHash:'GENESIS',pageHash:null,previousPoint:null,cutoffEvent:null,contextInvalid:false,displayClockInvalid:false,windows:Object.fromEntries(Object.keys(frames).map(f=>[f,[accumulator(),accumulator()]])),context:accumulator(),minutes:{},priceViolations:0,firstPrice:null,lastPrice:null,display:{},pointCount:0,startMs:Number.isFinite(start)?start:null,endMs:Number.isFinite(end)?end:null});
}
function contextPriceTick(job,e,calendar){
  const price=positive(e.payload?.price??e.payload?.close),volume=positive(e.payload?.executedVolume??e.payload?.volume);
  if(price!==null&&volume!==null&&e.availableMs>=e.eventMs&&e.identityStatus==='USABLE'&&e.availabilityLineageStatus==='USABLE'){
    let governed;try{governed=classifyTxChartSession(e.eventTime,calendar);}catch{}
    if(governed&&governed.session===e.session&&governed.tradeDate===e.tradeDate){const endpoint={price,eventTime:e.eventTime,eventMs:e.eventMs,lineage:lineage(e)};job.firstPrice??=endpoint;job.lastPrice=endpoint;}
  }
}
function priceRecord(job,record,calendar,onPrice){
  const s=job.checkpoint.state;
  const normalized=buildOneMinuteBars([record],{calendar,asOf:s.snapshotAvailableAt??s.cutoffReceivedAt});job.priceViolations+=normalized.timeLineageViolationCount;
  onPrice?.(normalized);
  const t=normalized.ticks[0],b=normalized.internalBars[0];if(!t||!b||!equal([t.actualContract,t.sessionTradeDate??t.tradeDate,t.session],s.activeIdentity?.slice(0,3)))return;
  const key=b.time,order=[t.exchangeMs,t.availableMs,t.eventId],cmp=(a,c)=>a[0]-c[0]||a[1]-c[1]||String(a[2]).localeCompare(String(c[2]));
  let bucket=job.minutes[key];if(!bucket){if(Object.keys(job.minutes).length>=PROJECTION_LIMITS.minuteBuckets)fail('STREAM_PRICE_BUCKET_BUDGET');job.minutes[key]={bar:b,first:order,last:order};}else{const x=bucket.bar;x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.volume+=b.volume;x._priceVolume+=b._priceVolume;x.eventCount++;x.sequenceGapCount+=b.sequenceGapCount;if(b.qualityStatus!=='PASS')x.qualityStatus='QUALITY_INSUFFICIENT';if(b.availableAt>x.availableAt)x.availableAt=b.availableAt;if(cmp(order,bucket.first)<0){bucket.first=order;x.open=b.open;x.firstEventTime=b.firstEventTime;}if(cmp(order,bucket.last)>0){bucket.last=order;x.close=b.close;x.lastEventTime=b.lastEventTime;}}
}
export function consumeProjectionPage(input,page){
  const batch=beginProjectionBatch(input);batch.consume(page);return batch.finish();
}
// One bounded pipeline cycle owns this private mutable reducer. Validate and
// clone the resumable input once, then seal once at its durable boundary. Every
// page/record/checkpoint binding is still checked in physical order.
export function beginProjectionBatch(input,{onPoint,onPrice}={}){
  const job=validate(input),calendar={...job.calendar,tradingDates:new Set(job.calendar.tradingDates),nonTradingDates:new Set(job.calendar.nonTradingDates),exceptions:new Map(job.calendar.exceptions)};
  let closed=false;
  return {
    consume(page){if(closed)fail('STREAM_PROJECTION_BATCH_CLOSED');try{consumePage(job,page,calendar,{onPoint,onPrice});}catch(e){closed=true;throw e;}},
    finish(){if(closed)fail('STREAM_PROJECTION_BATCH_CLOSED');closed=true;return seal(job);}
  };
}
function consumePage(job,page,calendar,{onPoint,onPrice}={}){
  const s=job.checkpoint.state;
  if(!page||page.schemaVersion!=='cru55-stream-page-v1'||!Array.isArray(page.facts)||page.facts.length>PROJECTION_LIMITS.pageFacts||Buffer.byteLength(stableJson(page))>PROJECTION_LIMITS.pageBytes||page.startOrdinal!==job.nextOrdinal||page.endOrdinal>s.ordinal||page.sourceLedgerIdentity!==s.sourceLedgerIdentity||page.resolverIdentity!==s.resolverIdentity||page.previousTerminalHash!==job.terminalHash||page.previousPageHash!==job.pageHash)fail('STREAM_PROJECTION_PAGE_BINDING_INVALID');
  if(page.facts.length!==page.endOrdinal-page.startOrdinal+1||page.records.length!==page.facts.length)fail('STREAM_PROJECTION_PAGE_FACTS_INVALID');
  for(let i=0;i<page.facts.length;i++){
    const fact=page.facts[i],record=page.records[i],{recordHash,...body}=record;
    if(fact.ordinal!==job.nextOrdinal||fact.recordHash!==recordHash||record.previousHash!==job.terminalHash||digest(`${job.terminalHash}\n${stableJson(body)}`)!==recordHash)fail('STREAM_PROJECTION_RECORD_INVALID');
    job.nextOrdinal++;job.terminalHash=recordHash;
    // Price is the whole physical prefix's matching contract/date/session,
    // independent of semantic CVD continuity segments. Normalize raw records
    // using the accepted clock/duplicate/simtrade rules before bucket merging.
    priceRecord(job,record,calendar,onPrice);
    const e=fact.event,p=fact.point;if(e&&(e.ledgerOrdinal!==fact.ordinal||e.recordHash!==recordHash||e.sourceLedgerIdentity!==s.sourceLedgerIdentity))fail('STREAM_PROJECTION_EVENT_INVALID');
    if(!e||!p||p.segment!==s.segmentCount-1)continue;
    if(!equal(identity(e),s.activeSegment.identity)||p.ledgerOrdinal!==e.ledgerOrdinal||p.recordHash!==e.recordHash||p.eventTime!==e.eventTime||p.availableAt!==e.availableAt)fail('STREAM_PROJECTION_POINT_INVALID');
    const prior=job.previousPoint;job.previousPoint=p;job.pointCount++;
    onPoint?.(e,p,prior,fact.pressure);
    // Chart clock is AVAILABLE_AT only. A late event can invalidate context/path
    // while retaining a lawful monotonically available CVD display.
    if(!Number.isFinite(e.availableMs)||(prior&&e.availableMs<Date.parse(prior.availableAt)))job.displayClockInvalid=true;
    if(e.ledgerOrdinal===s.lastPoint.ledgerOrdinal)job.cutoffEvent=e;
    if(e.identityStatus!=='USABLE'||e.availabilityLineageStatus!=='USABLE'||!Number.isFinite(e.eventMs)||!Number.isFinite(e.availableMs)||e.availableMs>Date.parse(s.lastPoint.availableAt)||(prior&&e.eventMs<Date.parse(prior.eventTime))||(p.value===null&&p.reason!=='NO_CLASSIFIED_VOLUME'))job.contextInvalid=true;
    if(e.availableMs<=Date.parse(s.lastPoint.availableAt)&&e.ledgerOrdinal<=s.lastPoint.ledgerOrdinal){
      if(!onPoint){
        for(const [frame,W]of Object.entries(frames))for(let previous=0;previous<2;previous++){const upper=job.endMs-previous*W;if(e.eventMs>upper-W&&e.eventMs<=upper)accumulate(job.windows[frame][previous],e,p,prior,fact.pressure);}
        if(e.eventMs>=job.startMs&&e.eventMs<=job.endMs)accumulate(job.context,e,p,prior,fact.pressure);
      }
      contextPriceTick(job,e,calendar);
    }
    if(onPoint)continue;
    const d={time:e.availableMs/1000,value:p.value,ledgerOrdinal:p.ledgerOrdinal,recordHash:p.recordHash,availableAt:p.availableAt,eventTime:p.eventTime,reason:p.reason};
    const span=Math.max(1,s.lastPoint.ledgerOrdinal-s.activeSegment.startOrdinal+1),bin=Math.min(PROJECTION_LIMITS.displayBuckets-1,Math.floor((p.ledgerOrdinal-s.activeSegment.startOrdinal)*PROJECTION_LIMITS.displayBuckets/span));
    const b=job.display[bin];if(!b)job.display[bin]={first:d,last:d,min:d,max:d,gap:p.value===null?d:null};else{b.last=d;if(p.value===null)b.gap??=d;if(p.value!==null&&(b.min.value===null||p.value<b.min.value))b.min=d;if(p.value!==null&&(b.max.value===null||p.value>b.max.value))b.max=d;}
  }
  if(page.checkpoint?.state?.terminalHash!==job.terminalHash||page.checkpoint?.state?.ordinal!==page.endOrdinal)fail('STREAM_PROJECTION_PAGE_TERMINAL_INVALID');
  validateStreamCheckpoint(page.checkpoint);
  if(page.endOrdinal===s.ordinal&&!equal(page.checkpoint,job.checkpoint))fail('STREAM_PROJECTION_FINAL_CHECKPOINT_MISMATCH');
  job.pageHash=digest(stableJson(page));
}
function evidence(job,frame,previous){const W=frames[frame],a=job.windows[frame][previous],e=job.cutoffEvent,s=job.checkpoint.state,pub=publicWindow(a,W),upper=e.eventMs-previous*W,required=W*(previous+1),span=Math.max(0,Math.min(e.eventMs-job.startMs,e.availableMs-Date.parse(s.activeSegment.startAvailableAt))),complete=span>=required;
  const out={status:complete?'OBSERVED_WINDOW':'PARTIAL',complete,reason:complete?pub.unavailableReason:'WINDOW_INCOMPLETE',windowMs:W,lowerExclusiveMs:upper-W,upperInclusiveMs:upper,observedSpanMs:Math.min(span,required),requiredSpanMs:required,originEventMs:job.startMs,originAvailableMs:Date.parse(s.activeSegment.startAvailableAt),baseline:previous?'PREVIOUS_EQUAL_WINDOW_AS_OF_CURRENT_CUTOFF':'CURRENT_WINDOW_AS_OF_CUTOFF',lineage:lineage(e),identity:s.activeIdentity,segment:s.lastPoint.segment,deltaCvd:null,observedVolume:pub.pressure.totalExecutedVolume??null,unknownVolume:pub.pressure.unknownVolume??null,pressure:pub.pressure,response:pub.response,pathEfficiency:pub.pathEfficiency,quality:pub.quality,parity:'UNAVAILABLE',captureCompleteness:'UNPROVEN',sessionStartProven:false};
  if(!a.n)return {...out,status:'UNAVAILABLE',reason:'NO_OBSERVED_TICKS_IN_WINDOW'};if(a.nullGap)return {...out,status:'UNAVAILABLE',reason:'ACCEPTED_CVD_NULL_GAP'};if(!a.classified)return {...out,reason:'NO_CLASSIFIED_VOLUME'};if(!Number.isFinite(pub.pressure.netAggressiveFlowProxy))return {...out,status:'UNAVAILABLE',reason:pub.pressure.unavailableReason||'PRESSURE_UNAVAILABLE'};if(a.delta!==pub.pressure.netAggressiveFlowProxy)fail('STREAM_WINDOW_PARITY_MISMATCH');return {...out,deltaCvd:a.delta,parity:'EXACT',reason:out.reason||'CAPTURE_COMPLETENESS_UNPROVEN'};
}
export function finishProjectionJob(input,{prior=null,previousPublication=prior}={}){
  const job=validate(input),s=validateStreamCheckpoint(job.checkpoint),current=streamCurrent(job.checkpoint);
  if(job.nextOrdinal!==s.ordinal+1||job.terminalHash!==s.terminalHash||!equal(job.previousPoint,s.lastPoint))fail('STREAM_PROJECTION_INCOMPLETE');
  const handoffPrior=prior??previousPublication;
  const projectionHash=digest(stableJson({schema:'cru55-stream-projection-v1',jobHash:input.jobHash,priorProjectionHash:handoffPrior?.projectionHash??null,previousPublicationHash:previousPublication?.projectionHash??null}));
  const binding={...SAFETY,generationHash:job.generationHash,projectionHash,projectionHashType:'STREAM_PAGE_REDUCER_V1',evidenceKind:job.sourceKind,sourceMode:'PINNED_STREAM_CANDIDATE_GENERATION'};
  const cutoff={sourceLedgerIdentity:s.sourceLedgerIdentity,ledgerOrdinal:s.ordinal,recordHash:s.terminalHash};
  const origin=s.activeSegment?{eventTime:s.activeSegment.observedStart,eventTimeMs:job.startMs,availableAt:s.activeSegment.startAvailableAt,availableAtMs:Date.parse(s.activeSegment.startAvailableAt),ledgerOrdinal:s.activeSegment.startOrdinal}:null;
  // Physical publication may end with a quote or an unrelated record. Retain
  // accepted last-trade evidence unless the kernel reports a real boundary.
  // sourceCutoff/availableAt describe the publication; window lineage and
  // freshness remain pinned to the last accepted trade, never the quote tail.
  const boundary=Boolean(s.pendingSegment||s.snapshotInvalid||s.canonicalState?.epochLineageInvalid);
  const valid=Boolean(job.cutoffEvent&&!boundary&&(current.value!==null||current.currentReason==='NO_CLASSIFIED_VOLUME'));
  const points=Object.values(job.display).flatMap(b=>[b.first,b.min,b.max,b.gap,b.last].filter(Boolean)).filter((p,i,a)=>a.findIndex(q=>q.ledgerOrdinal===p.ledgerOrdinal)===i).sort((a,b)=>a.ledgerOrdinal-b.ledgerOrdinal);
  const minuteBars=Object.values(job.minutes).map(v=>v.bar).sort((a,b)=>a.time.localeCompare(b.time));let volume=0,pv=0;const vwap=minuteBars.map(b=>{volume+=b.volume;pv+=b._priceVolume;return {time:Date.parse(b.time)/1000,value:volume?pv/volume:null,availableAt:b.availableAt};});
  const charts={},relationships={},handoffs={};
  for(const [frame,W]of Object.entries(frames)){
    const bars=aggregateChartBars(minuteBars,frame).bars.map(b=>({...b,time:Date.parse(b.time)/1000,tradeDate:b.sessionTradeDate}));
    const segmentIdentity=s.activeSegment?.identity;
    const segment={index:s.segmentCount-1,identity:segmentIdentity,actualContract:segmentIdentity?.[0],tradeDate:segmentIdentity?.[1],session:segmentIdentity?.[2],continuityEpoch:segmentIdentity?.[3],origin,sessionStartProven:false,scope:'OBSERVED_FRAGMENT',captureCompleteness:'UNPROVEN',quality:s.lastPoint?.quality??'UNAVAILABLE',reason:current.currentReason,clockInvalid:job.displayClockInvalid,terminalInvalid:boundary,inputPointCount:job.pointCount,points:job.displayClockInvalid?[]:points};
    charts[frame]={schemaVersion:'cru55-stream-chart-v1',...binding,timeframe:frame,cutoff,identity:s.activeIdentity??[],actualContract:s.activeIdentity?.[0],tradeDate:s.activeIdentity?.[1],session:s.activeIdentity?.[2],continuityEpoch:s.activeIdentity?.[3],segmentIndex:s.segmentCount-1,origin,sessionStartProven:false,scope:'OBSERVED_FRAGMENT',captureCompleteness:'UNPROVEN',currentCvd:valid?current.value:null,availableAt:current.availableAt,lastTradeAvailableAt:current.lastTradeAvailableAt,lastTradeAvailableAtMs:Date.parse(current.lastTradeAvailableAt),quality:s.lastPoint?.quality??'UNAVAILABLE',reason:boundary?'NO_LAWFUL_PHYSICAL_CUTOFF':current.currentReason,classifiedCoverage:s.lastPoint?.classifiedCoverage??null,summary:Object.fromEntries(['buyProxyVolume','sellProxyVolume','unknownVolume','totalExecutedVolume'].map(k=>[k,s.lastPoint?.[k]??null])),segments:s.lastPoint?[segment]:[],bars,vwap,priceReason:bars.length?'LAWFUL_OBSERVED_PRICE':'NO_LAWFUL_PRICE_BARS',priceTimeLineageViolationCount:job.priceViolations,display:{cvdTime:'AVAILABLE_AT',priceTime:'EXCHANGE_BAR_START',selection:'FIXED_ORDINAL_BUCKET_MINMAX_WITH_NULL_GAPS',inputPoints:job.pointCount,outputPoints:job.displayClockInvalid?0:points.length,maxPoints:1024,maxBars:840,endpoint:valid?current.value:null,currentPlotAvailable:valid&&current.value!==null&&!job.displayClockInvalid,historyLastCvd:s.lastPoint?.value??null,boundaryAtCutoff:boundary}};
    const cur=valid?evidence(job,frame,0):null,prev=valid?evidence(job,frame,1):null;
    const comparable=cur?.complete&&prev?.complete&&cur.status!=='UNAVAILABLE'&&prev.status!=='UNAVAILABLE';
    const comparisons=comparable?{volume:compareEqualWindow(cur.observedVolume,prev.observedVolume),deltaCvd:compareEqualWindow(cur.deltaCvd,prev.deltaCvd),response:compareEqualWindow(cur.response.displacementPoints,prev.response.displacementPoints),path:compareEqualWindow(cur.pathEfficiency.value,prev.pathEfficiency.value)}:Object.fromEntries(['volume','deltaCvd','response','path'].map(k=>[k,'前窗不可比較']));
    const observation={segment:s.segmentCount-1,identity:s.activeIdentity,lineage:job.cutoffEvent?lineage(job.cutoffEvent):null,anchorEventTime:s.lastPoint?.eventTime,cumulativeCvd:valid?current.value:null,current:cur,previous:prev,comparisons,relationship:classifyRelationship(cur,prev)};
    relationships[frame]={schemaVersion:'cru55-stream-relationship-v1',...binding,timeframe:frame,windowMs:W,sourceCutoff:cutoff,current:observation,observations:valid?[{segment:observation.segment,identity:s.activeIdentity,lineage:observation.lineage,anchorEventTime:observation.anchorEventTime,cumulativeCvd:observation.cumulativeCvd,relationship:observation.relationship,deltaCvd:cur.deltaCvd,complete:cur.complete,observedSpanMs:cur.observedSpanMs,requiredSpanMs:W}]:[],timeline:[],markers:[],history:{scope:'CURRENT_PUBLICATION_ENDPOINT_ONLY',sampling:'PUBLICATION_ENDPOINT_NOT_PER_POINT_HISTORY',snapshotCount:valid?1:0,initialStateIsTransition:false},method:{decisionClock:'CUTOFF_AVAILABLE_AT',windowClock:'CUTOFF_EVENT_TIME',cvd:'ACCEPTED_PER_PHYSICAL_CUMULATIVE_DIFFERENCES',pressureIndependentVote:false,captureCompleteness:'UNPROVEN',formalDirectionPromoted:false}};
  }
  for(const frame of Object.keys(frames)){
    const r=relationships[frame],p=previousPublication?.relationships?.[frame],c=previousPublication?.charts?.[frame];
    // Only same-source, same-identity chronological publication endpoints may
    // appear in this display. Original immutable pages/publications stay intact.
    if(p&&c&&p.schemaVersion==='cru55-stream-relationship-v1'&&p.projectionHash===previousPublication.projectionHash&&p.projectionHash===c.projectionHash&&p.generationHash===c.generationHash&&p.evidenceKind===job.sourceKind&&equal(p.sourceCutoff,c.cutoff)&&p.sourceCutoff.sourceLedgerIdentity===s.sourceLedgerIdentity&&p.sourceCutoff.ledgerOrdinal<s.ordinal&&equal(c.identity,s.activeIdentity)&&Object.entries(SAFETY).every(([k,v])=>p[k]===v&&c[k]===v)){
      const earlier=(p.observations??[]).slice(-256).filter(o=>equal(o.identity,s.activeIdentity)&&o.segment===s.segmentCount-1&&o.lineage?.sourceLedgerIdentity===s.sourceLedgerIdentity&&o.lineage.cutoffLedgerOrdinal<=p.sourceCutoff.ledgerOrdinal&&o.lineage.availableAtMs<=Date.parse(s.lastPoint?.availableAt));
      r.observations=[...earlier,...r.observations].slice(-256);
    }
    r.history={scope:'BOUNDED_PUBLICATION_ENDPOINTS',sampling:'PUBLICATION_ENDPOINT_NOT_PER_POINT_HISTORY',snapshotCount:r.observations.length,maxSnapshots:256,initialStateIsTransition:false,immutableHistoryRetained:true};
  }
  const pub=publicWindow(job.context,job.endMs-job.startMs+1),contextReason=!valid?'NO_LAWFUL_PHYSICAL_CUTOFF':s.segmentCount!==1?'CONTEXT_SINGLE_SEGMENT_REQUIRED':job.contextInvalid?'CONTEXT_LINEAGE_OR_CONTINUITY_INVALID':null;
  if(!contextReason&&['buyProxyVolume','sellProxyVolume','unknownVolume','totalExecutedVolume'].some(k=>pub.pressure[k]!==s.lastPoint[k]))fail('STREAM_CONTEXT_PRESSURE_PARITY_MISMATCH');
  const contextEvidence=contextReason?null:{status:'OBSERVED_CONTEXT',complete:true,reason:pub.unavailableReason,observedSpanMs:job.endMs-job.startMs,requiredSpanMs:null,originEventMs:job.startMs,upperInclusiveMs:job.endMs,baseline:'ACCEPTED_SEGMENT_PRE_FIRST_TRADE',deltaCvd:current.value,observedVolume:s.lastPoint.totalExecutedVolume,unknownVolume:s.lastPoint.unknownVolume,pressure:pub.pressure,response:pub.response,pathEfficiency:pub.pathEfficiency,quality:pub.quality,parity:current.value===null?'NO_CLASSIFIED_VOLUME':'EXACT',priceDelta:job.firstPrice&&job.lastPrice?job.lastPrice.price-job.firstPrice.price:null,priceReason:job.firstPrice&&job.lastPrice?'LAWFUL_OBSERVED_ENDPOINTS':'CONTEXT_LAWFUL_PRICE_UNAVAILABLE',captureCompleteness:'UNPROVEN',sessionStartProven:false};
  const sessionContext={schemaVersion:'cru55-stream-session-context-v1',...binding,sourceCutoff:cutoff,identity:s.activeIdentity,session:s.activeIdentity?.[2],tradeDate:s.activeIdentity?.[1],actualContract:s.activeIdentity?.[0],continuityEpoch:s.activeIdentity?.[3],segment:s.segmentCount-1,origin,cutoff:job.cutoffEvent?lineage(job.cutoffEvent):null,observedSpanMs:contextEvidence?.observedSpanMs??null,scope:contextReason?'UNAVAILABLE':'OBSERVED_SEGMENT_TO_NOW',label:contextReason?'暫無法判讀':s.activeIdentity[2]+'｜觀測累積',sessionStartProven:false,captureCompleteness:'UNPROVEN',relationship:classifyRelationship(contextEvidence,null),evidence:contextEvidence,cumulativeCvd:contextReason?null:current.value,originCumulativeBaseline:contextReason?null:0,firstPrice:job.firstPrice,lastPrice:job.lastPrice,reason:contextReason||pub.unavailableReason||'CAPTURE_COMPLETENESS_UNPROVEN'};
  const governedCalendar={...job.calendar,tradingDates:new Set(job.calendar.tradingDates),nonTradingDates:new Set(job.calendar.nonTradingDates),exceptions:new Map(job.calendar.exceptions)};
  const side=(context,chart)=>{
    if(!context)return null;
    let reason=context.scope==='UNAVAILABLE'?'SESSION_CONTEXT_UNAVAILABLE':null,session=null;
    if(context.schemaVersion!=='cru55-stream-session-context-v1'||!chart||!context.projectionHash||context.projectionHash!==chart.projectionHash||context.generationHash!==chart.generationHash||!equal(context.sourceCutoff,chart.cutoff)||Object.entries(SAFETY).some(([k,v])=>context[k]!==v||chart[k]!==v))reason='SIDE_BINDING_INVALID';
    try{session=classifyTxChartSession(context.origin?.eventTime,governedCalendar);}catch{reason??='GOVERNED_SESSION_UNAVAILABLE';}
    return {evidenceKind:context.evidenceKind,generationHash:context.generationHash,projectionHash:context.projectionHash,sourceCutoff:context.sourceCutoff,identity:context.identity,lineage:context.cutoff,relationship:context.relationship,evidence:context.evidence,cumulativeCvd:context.cumulativeCvd,firstPrice:context.firstPrice,lastPrice:context.lastPrice,sessionContext:session,contextScope:context.scope,sessionStartProven:false,reason};
  };
  for(const frame of Object.keys(frames)){
    const priorSide=side(handoffPrior?.sessionContext,handoffPrior?.charts?.[frame]),currentSide=side(sessionContext,charts[frame]);
    const pairing=proveHandoffPair(priorSide,currentSide,governedCalendar);
    let gap={state:'UNAVAILABLE',points:null,reason:pairing.reason,scope:'OBSERVED_FRAGMENT_ENDPOINT_PRICES_ONLY',label:'觀測片段端點差',openingBoundaryProven:false,officialCloseProven:false};
    if(pairing.state==='COMPARABLE'){const p=priorSide.lastPrice,c=currentSide.firstPrice;const reason=!p?'PRIOR_LAWFUL_PRICE_MISSING':!c?'CURRENT_LAWFUL_PRICE_MISSING':p.lineage.availableAtMs>currentSide.lineage.availableAtMs?'PRIOR_PRICE_NOT_AVAILABLE_AT_CURRENT_CUTOFF':p.eventMs>=c.eventMs?'PRICE_ENDPOINT_ORDER_INVALID':null;gap={...gap,state:reason?'UNAVAILABLE':'AVAILABLE',reason,points:reason?null:c.price-p.price};}
    let handoff=classifyHandoff(priorSide,currentSide,pairing,gap);if(handoff.code==='PRIOR_SESSION_REJECTED')handoff={code:'UNCONFIRMED_OR_CONFLICT',reason:'OFFICIAL_OPEN_CLOSE_BOUNDARIES_UNPROVEN'};
    handoffs[frame]={schemaVersion:'cru55-stream-handoff-v1',...binding,timeframe:frame,sourceCutoff:cutoff,availableAt:currentSide.lineage?.availableAt??null,prior:priorSide,current:currentSide,pairing,gap,handoff,primaryEvidence:'SESSION_CONTEXT',recentChange:{prior:handoffPrior?.relationships?.[frame]?.current?.current??null,current:relationships[frame].current.current},method:{pressureIndependentVote:false,crossGapCvdArithmetic:false,crossGapPath:false,closedGapInterpolation:false,formalDirectionPromoted:false,openingRejectionRequiresBothBoundaries:true}};
  }
  return {schemaVersion:'cru55-stream-projection-v1',...binding,charts,relationships,sessionContext,handoffs,kind:job.sourceKind};
}
