import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, validateCvdCheckpoint, stableJson, digest, SAFETY } from './cvd-observation-core.mjs';
import { materializeTxCanonicalObservations, timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';
import { createVolumeProfileState, appendVolumeProfileTrades, volumeProfileSnapshot } from './volume-profile-core.mjs';
import { createMarketStructureState, appendMarketStructureBars, marketStructureSnapshot } from './market-structure-core.mjs';

export const OBSERVATION_VERSION = 'cru61-market-observation-v1';
export const OBSERVATION_RULES = Object.freeze({ version: OBSERVATION_VERSION, pivotLeft:2,pivotRight:2,
  binSize:1,valueAreaFraction:0.7,approachBars:3,confirmationBars:3,outcomeBars:5,costPoints:4.11,
  maxTrades:250000,maxBars:2000,...SAFETY });
const ms = timestampMs;
const identityOf = e => Object.fromEntries(['actualContract','tradeDate','session','continuityEpoch','sourceLedgerIdentity'].map(k=>[k,e[k]]));
const key = e => stableJson(identityOf(e));
const finitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const decimal = x => typeof x==='number'?x:typeof x==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(x.trim())?Number(x):null;
const LINEAGE_REASON='CONTINUITY_OR_LINEAGE_AWAITING_VALID_SEGMENT';
const LINEAGE_HISTORY_LIMIT=2000;

function lineageTimeline(state,mode) {
  if(state.lineageTimeline){const timeline=state.lineageTimeline;timeline.quarantinedEpochs??=[];
    if(!timeline.knowledgeFences){timeline.knowledgeFences=[];timeline.legacyKnowledgeFenceUnknown=true;}
    return timeline;}
  const timeline={mode,intervals:[],open:null,highWaterMs:null,epoch:null,activeIdentity:null,lastWitnessMs:null,quarantinedEpochs:[],knowledgeFences:[]};
  const oldSemantic=state.fragmentSemantic??(state.cvd?cvdSemanticResult(state.cvd).semantic:null);
  if(oldSemantic?.cutoffLedgerOrdinal>0){
    // Older private caches did not retain physical invalid episodes. Keep their
    // accumulator, but do not certify a historical interval we cannot rebuild.
    const until=ms(oldSemantic.lastTradeAvailableAt);
    if(until!==null)timeline.intervals.push({startMs:null,endMs:until,startInclusive:true,reason:'LEGACY_LINEAGE_HISTORY_UNPROVEN'});
    timeline.highWaterMs=state.knowledgeHighWaterMs??ms(oldSemantic.cutoffReceivedAt);
    timeline.lastWitnessMs=timeline.highWaterMs;
    if(oldSemantic.currentReason===LINEAGE_REASON)timeline.open={startMs:state.lineageInvalidNotBefore??timeline.highWaterMs,
      endMs:null,startInclusive:true,reason:LINEAGE_REASON};
  }
  delete state.knowledgeHighWaterMs;delete state.lineageInvalidNotBefore;
  state.lineageTimeline=timeline;return timeline;
}
function observePhysicalKnowledge(timeline,at,ordinal){
  const witness=timeline.lastWitnessMs;
  if(!Number.isSafeInteger(ordinal)||ordinal<1||witness===null||(at!==null&&at>=witness))return;
  // Quote-only witnesses matter too. Record only regression episodes, not every
  // quote, so this bound remains part of the existing finite lineage history.
  const fences=timeline.knowledgeFences,last=fences.at(-1);
  if(last?.knownNotBeforeMs===witness){last.startOrdinal=Math.min(last.startOrdinal,ordinal);return;}
  if(fences.length>=LINEAGE_HISTORY_LIMIT)throw Error('OBSERVATION_LINEAGE_HISTORY_BUDGET');
  fences.push({startOrdinal:ordinal,knownNotBeforeMs:witness});
}
function beginInvalid(timeline,startMs,reason=LINEAGE_REASON,startInclusive=true){
  if(!timeline.open)timeline.open={startMs,endMs:null,startInclusive,reason};
}
function recoverLineage(timeline,at){
  if(!timeline.open||at===null)return;
  if(timeline.intervals.length>=LINEAGE_HISTORY_LIMIT)throw Error('OBSERVATION_LINEAGE_HISTORY_BUDGET');
  // A backdated recovery is not evidence that an already known interval ended.
  if(timeline.open.startMs!==null&&at<timeline.open.startMs)return;
  timeline.intervals.push({...timeline.open,endMs:at});timeline.open=null;
}
function observeCanonicalLineage(timeline,event,{inferMissingBreak=false}={}){
  const at=ms(event.availableAt),epoch=event.continuityEpoch;
  observePhysicalKnowledge(timeline,at,event.ledgerOrdinal);
  if(timeline.epoch!==null&&epoch!==timeline.epoch){
    if(at!==null&&timeline.lastWitnessMs!==null&&at<timeline.lastWitnessMs){
      if(timeline.quarantinedEpochs.length>=LINEAGE_HISTORY_LIMIT)throw Error('OBSERVATION_LINEAGE_HISTORY_BUDGET');
      timeline.quarantinedEpochs.push({epoch,knownNotBeforeMs:timeline.lastWitnessMs});
      beginInvalid(timeline,timeline.lastWitnessMs,'BACKDATED_CONTINUITY_EPOCH_UNUSABLE',false);
    }
    if(inferMissingBreak&&!timeline.open&&timeline.lastWitnessMs!==null)
      beginInvalid(timeline,timeline.lastWitnessMs,'PRODUCER_NONCANONICAL_INTERVAL_UNPROVEN',false);
    timeline.highWaterMs=null;
  }
  timeline.epoch=epoch;
  const changed=timeline.activeIdentity!==null&&timeline.activeIdentity!==key(event);
  timeline.activeIdentity=key(event);
  if(changed&&event.kind==='futures_bidask')beginInvalid(timeline,at??timeline.highWaterMs);
  if(event.availabilityLineageStatus!=='USABLE')beginInvalid(timeline,timeline.highWaterMs??at);
  if(at!==null)timeline.highWaterMs=timeline.highWaterMs===null?at:Math.max(timeline.highWaterMs,at);
  const quarantined=timeline.quarantinedEpochs.some(item=>item.epoch===epoch);
  if(!quarantined&&event.kind==='futures_tick'&&event.availabilityLineageStatus==='USABLE'&&event.identityStatus==='USABLE')recoverLineage(timeline,at);
  if(at!==null)timeline.lastWitnessMs=timeline.lastWitnessMs===null?at:Math.max(timeline.lastWitnessMs,at);
}
function intervalAt(timeline,cutoff){
  return [...(timeline?.intervals??[]),...(timeline?.open?[timeline.open]:[])].find(interval=>
    (interval.startMs===null||(interval.startInclusive?cutoff>=interval.startMs:cutoff>interval.startMs))
    &&(interval.endMs===null||cutoff<interval.endMs));
}

export function createMarketObservationState(sourceLedgerIdentity, resolverIdentity) {
  const state={schemaVersion:OBSERVATION_VERSION,cvd:createCvdCheckpoint(sourceLedgerIdentity,resolverIdentity),segments:[],...SAFETY};
  lineageTimeline(state,'RAW_PHYSICAL_RECORDS');return state;
}

// Physical suffix only. A period selector is deliberately absent from the accumulator.
export function appendMarketObservationRecords(previous, records, options) {
  if(previous?.schemaVersion!==OBSERVATION_VERSION) throw Error('OBSERVATION_STATE_INVALID');
  const before=validateCvdCheckpoint(previous.cvd);
  const cvd=appendCvdRecords(previous.cvd,records,options);
  const canonical=materializeTxCanonicalObservations(records,{...options,initialState:before.canonicalState});
  const state=structuredClone(previous),timeline=lineageTimeline(state,'RAW_PHYSICAL_RECORDS');state.cvd=cvd;
  let physicalState=before.canonicalState;
  for(let i=0;i<records.length;i++){
    const record=records[i],at=ms(record.receivedAt);
    observePhysicalKnowledge(timeline,at,before.ordinal+i+1);
    const next=materializeTxCanonicalObservations([record],{...options,ledgerOrdinalOffset:before.ordinal+i,initialState:physicalState});
    if(physicalState&&next.terminalState.epoch!==physicalState.epoch)timeline.highWaterMs=null;
    const invalidClock=at===null||(timeline.highWaterMs!==null&&at<timeline.highWaterMs);
    if(invalidClock)beginInvalid(timeline,timeline.highWaterMs??at);
    if(next.terminalState.breakPending)beginInvalid(timeline,at??timeline.highWaterMs);
    if(next.terminalState.epochLineageInvalid)beginInvalid(timeline,timeline.highWaterMs??at);
    if(at!==null)timeline.highWaterMs=timeline.highWaterMs===null?at:Math.max(timeline.highWaterMs,at);
    for(const event of next.events)observeCanonicalLineage(timeline,event);
    if(at!==null)timeline.lastWitnessMs=timeline.lastWitnessMs===null?at:Math.max(timeline.lastWitnessMs,at);
    physicalState=next.terminalState;
  }
  const points=new Map(cvd.state.series.slice(before.series.length).map(p=>[p.ledgerOrdinal,p]));
  return accumulateObservationEvents(state,canonical.events,points,options.resolveSessionTradeDate);
}

export function appendMarketObservationCanonical(previous,fragment,{resolveSessionTradeDate=null,history=null}={}) {
  const state=!previous||fragment.resetReason?{schemaVersion:OBSERVATION_VERSION,segments:[],...SAFETY}:structuredClone(previous);
  const timeline=lineageTimeline(state,'RETAINED_CANONICAL_PRODUCER');
  state.fragmentSemantic=fragment.cvdSemantic;
  // Cold producer history lacks noncanonical records (including reconnect and
  // invalid-clock records). Only event witnesses and observed refresh episodes
  // are reconstructible. Epoch gaps are explicitly unavailable, not backfilled.
  for(const event of fragment.canonicalEvents)observeCanonicalLineage(timeline,event,{inferMissingBreak:true});
  const physicalTerminal=ms(fragment.cvdSemantic.cutoffReceivedAt);
  if(fragment.cvdSemantic.currentReason===LINEAGE_REASON)
    beginInvalid(timeline,physicalTerminal===null?timeline.highWaterMs:Math.max(physicalTerminal,timeline.highWaterMs??physicalTerminal));
  if(physicalTerminal!==null){
    timeline.highWaterMs=timeline.highWaterMs===null?physicalTerminal:Math.max(timeline.highWaterMs,physicalTerminal);
    timeline.lastWitnessMs=timeline.lastWitnessMs===null?physicalTerminal:Math.max(timeline.lastWitnessMs,physicalTerminal);
  }
  const points=history?{get:ordinal=>history.pointFor(ordinal)}:new Map(fragment.cvdSemantic.series.map(p=>[p.ledgerOrdinal,p]));
  return accumulateObservationEvents(state,fragment.canonicalEvents,points,resolveSessionTradeDate,history);
}

function accumulateObservationEvents(state,events,points,resolveSessionTradeDate,history=null) {
  const addReason=(segment,event,reason)=>{
    if(history){
      history.appendReason(segment,event,reason);
      const prior=segment.reasons.find(item=>item.reason===reason);
      if(prior){if(ms(event.availableAt)!==null&&(ms(prior.availableAt)===null||ms(event.availableAt)<ms(prior.availableAt)))prior.availableAt=event.availableAt;return;}
    }
    segment.reasons.push({reason,availableAt:event.availableAt,ledgerOrdinal:event.ledgerOrdinal});
  };
  const quarantinedEpochs=new Set((state.lineageTimeline?.quarantinedEpochs??[]).map(item=>item.epoch));
  for(const event of events) {
    if(event.kind!=='futures_tick') continue;
    // The accepted CVD accumulator remains untouched. Its backdated epoch is
    // quarantined as a whole: exposing its later cumulative count would silently
    // include trades that cannot lawfully enter price/profile/structure history.
    if(quarantinedEpochs.has(event.continuityEpoch))continue;
    const point=points.get(event.ledgerOrdinal);
    if(!point) continue;
    let segment=state.segments.at(-1);
    if(!segment || segment.key!==key(event) || segment.cvdSegment!==point.segment) {
      segment={key:key(event),identity:identityOf(event),cvdSegment:point.segment,startAvailableAt:event.availableAt,startOrdinal:event.ledgerOrdinal,trades:[],bars:[],pending:null,
        reasons:[],profile:null}; state.segments.push(segment);
    }
    // Existing CRU34/Shioaji wire uses decimal price strings and local exchange time.
    // Normalize at this adapter boundary while retaining the original hash and texts.
    const price=decimal(event.payload.price??event.payload.close),volume=decimal(event.payload.executedVolume??event.payload.volume);
    if(resolveSessionTradeDate){
      let governed=null;try{governed=resolveSessionTradeDate(event.eventTime,event.rawRecord);}catch{}
      if(governed?.session!==event.session||governed?.tradeDate!==event.tradeDate){
        addReason(segment,event,'GOVERNED_SESSION_BOUNDARY_INVALID');continue;
      }
    }
    if(event.identityStatus!=='USABLE'||event.availabilityLineageStatus!=='USABLE'
      ||!finitePositive(price)||!finitePositive(volume)||ms(event.eventTime)>ms(event.availableAt)) {
      addReason(segment,event,'INVALID_TRADE_OR_TIME_LINEAGE'); continue;
    }
    if(!history&&segment.trades.length>=OBSERVATION_RULES.maxTrades) throw Error('OBSERVATION_TRADE_BUDGET');
    const {rawRecord,...canonical}=event;
    const trade={...canonical,eventTime:new Date(ms(event.eventTime)).toISOString(),availableAt:new Date(ms(event.availableAt)).toISOString(),
      sourceEventTime:event.eventTime,sourceAvailableAt:event.availableAt,
      payload:{...event.payload,close:price,volume,sourcePrice:event.payload.price??event.payload.close,sourceVolume:event.payload.executedVolume??event.payload.volume}};
    if(history){
      history.appendTrade(segment,trade);
      segment.profile=appendVolumeProfileTrades(segment.profile??createVolumeProfileState({identity:segment.identity,retainTrades:false}),[trade],{mutatePrivateState:true});
    }else segment.trades.push(trade);
    const start=Math.floor(ms(event.eventTime)/60000)*60000;
    if(segment.pending && start<ms(segment.pending.time)) {
      addReason(segment,event,'LATE_TRADE_CLOSED_BAR_NOT_REWRITTEN'); continue;
    }
    if(segment.pending && start>ms(segment.pending.time)) {
      if(segment.bars.length>=OBSERVATION_RULES.maxBars) throw Error('OBSERVATION_BAR_BUDGET');
      // Finalization is only known on the later physical record; no wall-clock backdating.
      segment.bars.push({...segment.pending,availableAt:event.availableAt,closed:true}); segment.pending=null;
      if(history)history.saveProfile(segment,event.availableAt);
    }
    if(!segment.pending) segment.pending={time:new Date(start).toISOString(),endTime:new Date(start+60000).toISOString(),
      open:price,high:price,low:price,close:price,volume,availableAt:event.availableAt,closed:false,identity:segment.identity};
    else { const b=segment.pending;b.high=Math.max(b.high,price);b.low=Math.min(b.low,price);b.close=price;b.volume+=volume;b.availableAt=event.availableAt; }
  }
  if(!history)for(const segment of state.segments){
    const added=segment.trades.filter(t=>t.ledgerOrdinal>(segment.profile?.lastOrdinal??0));
    if(added.length)segment.profile=appendVolumeProfileTrades(segment.profile??createVolumeProfileState({identity:segment.identity}),added);
  }
  return state;
}

export function aggregateObservationBars(bars,timeframe,cutoff) {
  const size={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240}[timeframe];
  if(!size) throw Error('OBSERVATION_TIMEFRAME_UNSUPPORTED');
  const groups=new Map();
  for(const bar of bars) {
    if(ms(bar.availableAt)>ms(cutoff)) continue;
    const start=Math.floor(ms(bar.time)/(size*60000))*size*60000;
    let group=groups.get(start);
    if(!group){group={...bar,time:new Date(start).toISOString(),endTime:new Date(start+size*60000).toISOString(),count:0,volume:0};groups.set(start,group);}
    group.high=Math.max(group.high,bar.high);group.low=Math.min(group.low,bar.low);group.close=bar.close;
    group.availableAt=bar.availableAt;group.count++;group.volume+=bar.volume;
  }
  // No fabricated bars across missing minutes. Incomplete groups cannot confirm structure.
  return [...groups.values()].filter(b=>b.count===size&&ms(b.endTime)<=ms(cutoff)).map(({count,...b})=>b);
}

function windowEvidence(deltas,trades,start,end,knownAt) {
  const path=trades.filter(t=>ms(t.eventTime)>=start&&ms(t.eventTime)<end&&ms(t.availableAt)<=knownAt);
  const initial=path[0]?.payload.close??null,final=path.at(-1)?.payload.close??null;
  const rows=path.map(t=>deltas.get(t.ledgerOrdinal)).filter(Boolean);
  if(!rows.length) return {deltaCvd:null,priceDisplacement:null,coverage:null,unknownVolume:null,start:new Date(start).toISOString(),end:new Date(end).toISOString(),knownAt:new Date(knownAt).toISOString()};
  const buy=rows.reduce((n,p)=>n+p.buy,0),sell=rows.reduce((n,p)=>n+p.sell,0),total=rows.reduce((n,p)=>n+p.total,0),unknown=rows.reduce((n,p)=>n+p.unknown,0);
  return {deltaCvd:buy+sell>0&&rows.every(p=>p.valid)?buy-sell:null,priceDisplacement:initial!==null&&final!==null?final-initial:null,
    buyProxyVolume:buy,sellProxyVolume:sell,unknownVolume:unknown,coverage:total>0?(buy+sell)/total:null,
    start:new Date(start).toISOString(),end:new Date(end).toISOString(),knownAt:new Date(knownAt).toISOString(),interval:'EVENT_TIME_START_INCLUSIVE_END_EXCLUSIVE_AVAILABLE_BY_KNOWN_AT'};
}

export function unavailableObservation(reason,{timeframe='1m',mode='LIVE',cutoff=null}={}) {
  return {schemaVersion:OBSERVATION_VERSION,snapshotId:null,cutoff,timeframe,mode,status:'UNAVAILABLE',reasonCodes:[reason],identity:null,
    price:{bars:[]},cvd:{state:'UNAVAILABLE',value:null,series:[]},profile:{state:'UNAVAILABLE',bins:[],poc:null,vah:null,val:null},
    previousProfile:{state:'UNAVAILABLE',reason:'COMPLETE_SESSION_NOT_PROVEN'},structure:{state:'UNAVAILABLE',events:[],zones:[]},events:[],
    summary:{position:'未知',force:'未知',structure:'未確認',counterEvidence:'資料不足',dataStatus:reason},...SAFETY};
}

export function describeObservationScenario({direction,test,after,location,heldRetest=false,valueMigrated=false,alternating=false}) {
  if(test.deltaCvd>0&&test.priceDisplacement!==null&&test.priceDisplacement<=1&&after.priceDisplacement<0)
    return {code:'BUY_EFFORT_NO_EXTENSION',description:'積極買進增加但價格未延伸，後續反向；吸收／暫停候選'};
  if(test.deltaCvd<0&&test.priceDisplacement!==null&&test.priceDisplacement>=-1&&after.priceDisplacement>0&&direction==='UP')
    return {code:'SELL_EFFORT_RECLAIM',description:'積極賣出增加但不再破低，後續收復短線結構；吸收候選'};
  if(alternating&&location.price>location.val&&location.price<location.vah)
    return {code:'VALUE_AREA_ROTATION',description:'成交密集區中央反覆震盪；成交力道與小結構切換'};
  if(direction==='UP'&&test.deltaCvd>0&&location.price>=location.vah&&heldRetest&&valueMigrated)
    return {code:'BREAKOUT_RETEST_VALUE_MIGRATION',description:'上緣突破伴隨同向成交，回測守住且上方累積成交；延續候選'};
  return {code:'UNRESOLVED_STRUCTURE_TEST',description:'已確認結構事件；回測、成交反應與分布遷移仍待觀察'};
}

export function marketObservationSnapshot(state,{timeframe='1m',mode='REPLAY',cutoff,now=cutoff,sourceComplete=true,tradeDate=null,session=null,actualContract=null,history=null}={}) {
  const semantic=state.fragmentSemantic??cvdSemanticResult(state.cvd).semantic;
  if(ms(cutoff)==null) return unavailableObservation('CUTOFF_REQUIRED',{timeframe,mode});
  const timeline=state.lineageTimeline;
  const fence=timeline?.knowledgeFences?.find(item=>item.knownNotBeforeMs>ms(cutoff));
  const segmentKnowledgeBound=fence?fence.startOrdinal-1:Number.MAX_SAFE_INTEGER;
  const segment=[...state.segments].reverse().find(s=>{
    if(ms(s.startAvailableAt)>ms(cutoff)||ms(s.startAvailableAt)===null
      ||(tradeDate&&s.identity.tradeDate!==tradeDate)||(session&&s.identity.session!==session)
      ||(actualContract&&s.identity.actualContract!==actualContract))return false;
    if(segmentKnowledgeBound===Number.MAX_SAFE_INTEGER)return true;
    // Segment choice itself must be historical. A later identity-return cannot
    // displace an older lawful segment using a regressed startAvailableAt.
    const ordinal=Number.isSafeInteger(s.startOrdinal)?s.startOrdinal
      :history?history.segmentFirstOrdinal(s):semantic.series.find(p=>p.segment===s.cvdSegment)?.ledgerOrdinal;
    return Number.isSafeInteger(ordinal)&&ordinal>0&&ordinal<=segmentKnowledgeBound;
  });
  if(!segment) return unavailableObservation('NO_LAWFUL_TRADE',{timeframe,mode,cutoff});
  const trades=history?history.tradeEndpoints(segment,cutoff):segment.trades.filter(t=>ms(t.availableAt)<=ms(cutoff)&&ms(t.eventTime)<=ms(cutoff));
  const physicalSeries=history?null:semantic.series.filter(p=>p.segment===segment.cvdSegment);
  const futurePoint=physicalSeries?.find(p=>ms(p.availableAt)!==null&&ms(p.availableAt)>ms(cutoff));
  const legacyFenceUnknown=Boolean(timeline&&(!Array.isArray(timeline.knowledgeFences)||timeline.legacyKnowledgeFenceUnknown)
    &&[...(timeline.intervals??[]),...(timeline.open?[timeline.open]:[])].some(interval=>interval.startMs!==null&&interval.startMs>ms(cutoff)));
  const knowledgeBound=Math.min(futurePoint?futurePoint.ledgerOrdinal-1:Number.MAX_SAFE_INTEGER,
    legacyFenceUnknown?0:fence?fence.startOrdinal-1:Number.MAX_SAFE_INTEGER);
  const series=history?history.minuteSeries(segment,cutoff,knowledgeBound):physicalSeries.filter(p=>p.ledgerOrdinal<=knowledgeBound&&ms(p.availableAt)!==null&&ms(p.availableAt)<=ms(cutoff));
  const profileAt=at=>volumeProfileSnapshot(segment.profile??createVolumeProfileState({identity:segment.identity}),
    {cutoff:at,history:history?time=>history.profileAt(segment,time):null});
  const windowAt=(start,end,at)=>history?history.windowEvidence(segment,start,end,at):windowEvidence(deltas,trades,start,end,at);
  const deltas=new Map();let priorPoint=null;
  for(const p of series){deltas.set(p.ledgerOrdinal,{buy:p.buyProxyVolume-(priorPoint?.buyProxyVolume??0),sell:p.sellProxyVolume-(priorPoint?.sellProxyVolume??0),
    unknown:p.unknownVolume-(priorPoint?.unknownVolume??0),total:p.totalExecutedVolume-(priorPoint?.totalExecutedVolume??0),valid:p.value!==null});priorPoint=p;}
  const last=history?history.lastPoint(segment,cutoff,knowledgeBound):series.at(-1),price=trades.at(-1)?.payload.close??null;
  const reasonCodes=history?history.reasonCodesAt(segment,cutoff,knowledgeBound)
    :segment.reasons.filter(r=>(r.ledgerOrdinal==null||r.ledgerOrdinal<=knowledgeBound)&&ms(r.availableAt)!==null&&ms(r.availableAt)<=ms(cutoff)).map(r=>r.reason);
  const reasons=[...new Set(reasonCodes),'CAPTURE_COMPLETENESS_UNPROVEN'];
  if(legacyFenceUnknown)reasons.push('LEGACY_KNOWLEDGE_PREFIX_UNPROVEN');
  if(!sourceComplete) reasons.push('SOURCE_CATCHUP_PENDING');
  if(mode==='LIVE'&&(!last||ms(now)-ms(last.availableAt)>30000)) reasons.push('STALE');
  if(last?.classifiedCoverage!==1) reasons.push('CLASSIFIED_COVERAGE_INCOMPLETE');
  if(state.lineageTimeline?.mode==='RETAINED_CANONICAL_PRODUCER')reasons.push('PRODUCER_NONCANONICAL_HISTORY_NOT_RETAINED');
  if(state.lineageTimeline?.quarantinedEpochs.some(item=>ms(cutoff)>item.knownNotBeforeMs))reasons.push('BACKDATED_CONTINUITY_EPOCH_UNUSABLE');
  const invalidInterval=intervalAt(state.lineageTimeline,ms(cutoff));
  const terminalUnknown=Boolean(invalidInterval)||(!state.lineageTimeline&&semantic.currentReason===LINEAGE_REASON
    &&(semantic.availableAt===null||ms(semantic.availableAt)<=ms(cutoff)));
  if(terminalUnknown){reasons.push(LINEAGE_REASON);if(invalidInterval&&invalidInterval.reason!==LINEAGE_REASON)reasons.push(invalidInterval.reason);}
  let profile={state:'UNAVAILABLE',bins:[],poc:null,vah:null,val:null},structure={state:'UNAVAILABLE',events:[],zones:[]};
  let bars=[];
  try {
    profile=profileAt(cutoff);
  } catch(error){reasons.push(error.message);}
  try {
    bars=aggregateObservationBars(segment.bars,timeframe,cutoff);
    if(history)structure=history.structureSnapshot(segment,bars,timeframe,cutoff,OBSERVATION_RULES.maxBars);
    else{
      let s=createMarketStructureState({identity:segment.identity,timeframe,left:2,right:2,obLookback:12,maxBars:OBSERVATION_RULES.maxBars});
      s=appendMarketStructureBars(s,bars,{cutoff});structure=marketStructureSnapshot(s,{cutoff});
    }
  } catch(error){reasons.push(error.message);}
  const periods={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240},duration=(periods[timeframe]||1)*60000;
  const structuralEvents=(structure.events||[]).filter(e=>['BOS','CHOCH','CHoCH','SWEEP_HIGH','SWEEP_LOW','SWEEP'].includes(e.type));
  const events=structuralEvents.slice(-100).map((e,eventIndex)=>{
    const at=ms(e.availableAt),trigger=ms(bars[e.barIndex]?.time??e.confirmedTime)-0;
    const approach=windowAt(trigger-3*duration,trigger,at);
    const test=windowAt(trigger,ms(e.confirmedTime),at);
    const after=windowAt(at,Math.min(ms(cutoff),at+3*duration),ms(cutoff));
    let historicalProfile=null;
    try { historicalProfile=profileAt(new Date(at).toISOString()); } catch(error){if(history)throw error;}
    const direction=e.direction==='BEARISH'||e.direction==='DOWN'?-1:1;
    const sameForce=test.deltaCvd!==null&&test.deltaCvd*direction>0;
    const failed=after.priceDisplacement!==null&&after.priceDisplacement*direction<0;
    const title=failed&&sameForce?'同向積極成交後價格反向；吸收／突破失敗候選':sameForce?'結構突破伴隨同向成交；等待回測與分布遷移':'結構事件與成交力道不一致／不足';
    const location={price:e.price??e.level??null,poc:historicalProfile?.poc??null,vah:historicalProfile?.vah??null,val:historicalProfile?.val??null};
    const later=bars.filter(b=>ms(b.time)>=at&&ms(b.availableAt)<=Math.min(ms(cutoff),at+3*duration));
    const level=location.price;
    const heldRetest=Number.isFinite(level)&&later.some(b=>b.low<=level&&b.close>=level)&&later.every(b=>b.close>=level);
    const globalIndex=structuralEvents.indexOf(e),lastThree=structuralEvents.slice(Math.max(0,globalIndex-2),globalIndex+1);
    const alternating=lastThree.length===3&&lastThree[0].direction!==lastThree[1].direction&&lastThree[1].direction!==lastThree[2].direction;
    let afterProfile=null;
    try{afterProfile=profileAt(new Date(Math.min(ms(cutoff),at+3*duration)).toISOString());}catch(error){if(history)throw error;}
    const valueMigrated=historicalProfile?.poc!=null&&afterProfile?.poc>historicalProfile.poc;
    const scenario=describeObservationScenario({direction:e.direction,test,after,location,heldRetest,valueMigrated,alternating});
    return {...e,confirmedAt:e.availableAt,nominalCloseTime:e.confirmedTime,price:e.price??e.level,title,location,scenario,
      profileMigration:{initialPoc:historicalProfile?.poc??null,afterPoc:afterProfile?.poc??null,heldRetest,valueMigrated},
      structureState:e.type,deltaCvd:test.deltaCvd,priceResponse:test.priceDisplacement,windows:{approach,test,after},
      supportingEvidence:[`結構 ${e.type}`,sameForce?'事件期間同向分類成交增加':'沒有完整同向成交支持'],
      contraryEvidence:[failed?'確認後價格反向':'後續結果仍未確定','價格／成交資料共用，非三份獨立證據','吸收亦可能是暫停、流動性變化或分類誤差'],
      confirmationConditions:['後續已確認結構延續','回測守住且新區域累積成交'],invalidationConditions:['收盤回到事件位另一側','反向已確認結構','來源連續性失效'],
      quality:reasons,sourceTimes:{anchorTime:e.anchorTime,confirmedAt:e.availableAt,nominalCloseTime:e.confirmedTime,cutoff,sourceLedgerIdentity:segment.identity.sourceLedgerIdentity},
      hypothesisOnly:true,...SAFETY};
  });
  const semanticWithinKnowledge=knowledgeBound===Number.MAX_SAFE_INTEGER
    ||(Number.isSafeInteger(semantic.cutoffLedgerOrdinal)&&semantic.cutoffLedgerOrdinal<=knowledgeBound);
  const invalidCurrent=terminalUnknown||(semanticWithinKnowledge&&semantic.availableAt!==null&&ms(semantic.availableAt)<=ms(cutoff)&&semantic.value===null);
  const displayPoints=new Map();
  for(const point of series)displayPoints.set(Math.floor(ms(point.availableAt)/60000),point);
    const cvd={state:terminalUnknown?'UNAVAILABLE':reasons.includes('STALE')?'STALE':'OBSERVATION_CANDIDATE',value:invalidCurrent?null:last?.value??null,
    series:[...displayPoints.values()].slice(-2000).map(p=>({...p,coverage:p.classifiedCoverage})),observedStart:trades[0]?.eventTime??null,
    displayAggregation:'LAST_KNOWN_POINT_PER_MINUTE_MAX_2000; ACCUMULATOR_ORIGIN_UNCHANGED',
    classifiedCoverage:last?.classifiedCoverage??null,unknownVolume:last?.unknownVolume??null,resetReason:semantic.resetReason??'IDENTITY_OR_CONTINUITY_SEGMENT',
    source:'CRU50_ACCEPTED_CORE_VIA_CRU54_CRU34',qualityReasons:reasons};
  const body={schemaVersion:OBSERVATION_VERSION,timeframe,mode,cutoff,identity:segment.identity,status:'OBSERVATION_CANDIDATE',reasonCodes:[...new Set(reasons)],
    rules:OBSERVATION_RULES,price:{bars,last:price},cvd,profile,previousProfile:{state:'UNAVAILABLE',reason:'COMPLETE_SESSION_NOT_PROVEN'},structure,events,eventCount:structuralEvents.length,
    summary:{position:profile.poc==null?'成交位置未知':`成交量分布 POC ${profile.poc}；VA ${profile.val}–${profile.vah}`,
      force:cvd.value==null?'分類成交未知':`觀測 CVD ${cvd.value}；UNKNOWN ${cvd.unknownVolume}`,
      structure:events.at(-1)?.title??'等待已確認結構事件',counterEvidence:'共用價格與成交資料；不做三票表決',dataStatus:[...new Set(reasons)].join(' / ')},...SAFETY};
  return {...body,snapshotId:digest(stableJson(body))};
}
