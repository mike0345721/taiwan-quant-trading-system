import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';

// Fixed before any outcome read. New choices require a new version, never a tuned rerun.
export const ABLATION_SPEC=Object.freeze({version:'cru61-structure-cohort-ablation-v1',eventTypes:Object.freeze(['BOS','CHOCH','SWEEP_HIGH','SWEEP_LOW']),
  eventDefinition:'cru61-market-structure-v1:left2:right2:strict-close',entry:'FIRST_BAR_OPEN_AT_OR_AFTER_EVENT_AVAILABLE_AT',
  horizonBars:5,costPoints:4.11,profileFilter:'UP_AT_OR_ABOVE_VAH;DOWN_BELOW_VAL',cvdFilter:'EVENT_DELTA_SAME_DIRECTION_AND_COVERAGE_1',
  samplePolicy:'TRAINING_OR_FIXTURE_ONLY;NO_HOLDOUT_TUNING',portfolio:'INDEPENDENT_EVENTS;OVERLAP_NOT_A_CAPITAL_SIMULATION',...SAFETY});
export const ABLATION_SPEC_HASH=digest(stableJson(ABLATION_SPEC));

export function compareObservationAblations({events,bars,datasetRole,sourceIdentity,specHash=ABLATION_SPEC_HASH}={}){
  if(!['TRAINING','FIXTURE'].includes(datasetRole)||specHash!==ABLATION_SPEC_HASH||!sourceIdentity)throw Error('ABLATION_FROZEN_SCOPE_REQUIRED');
  if(!Array.isArray(events)||events.length>2000||!Array.isArray(bars)||bars.length>20000)throw Error('ABLATION_INPUT_BUDGET');
  const fields=['actualContract','tradeDate','session','continuityEpoch','sourceLedgerIdentity'];
  const identity=bars[0]?.identity??events[0]?.identity;
  if((events.length||bars.length)&&(!identity||fields.some(k=>!identity[k])))throw Error('ABLATION_IDENTITY_REQUIRED');
  const same=row=>fields.every(k=>row?.identity?.[k]===identity[k]);
  if(events.some(row=>!same(row))||bars.some(row=>!same(row)))throw Error('ABLATION_IDENTITY_MISMATCH');
  let width=null;
  for(let i=0;i<bars.length;i++){
    const bar=bars[i],start=Date.parse(bar.time),end=Date.parse(bar.endTime),available=Date.parse(bar.availableAt);
    if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(available)||end<=start||available<end||bar.closed!==true
      ||![bar.open,bar.high,bar.low,bar.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)
      ||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high)
      ||(i>0&&start<Date.parse(bars[i-1].endTime)))throw Error('ABLATION_BAR_INVALID');
    if(width!==null&&end-start!==width)throw Error('ABLATION_TIMEFRAME_MISMATCH');width=end-start;
  }
  const seen=new Set(),cohort=[];let pending=0;
  for(const event of events){
    if(!ABLATION_SPEC.eventTypes.includes(event.type))continue;
    if(!event.id||seen.has(event.id))throw Error('ABLATION_DUPLICATE_EVENT');seen.add(event.id);
    const available=Date.parse(event.confirmedAt),direction=event.direction==='UP'?1:event.direction==='DOWN'?-1:null;
    if(!Number.isFinite(available)||direction===null)throw Error('ABLATION_EVENT_INVALID');
    const start=bars.findIndex(bar=>Date.parse(bar.time)>=available),end=start+ABLATION_SPEC.horizonBars-1;
    if(start<0||end>=bars.length){pending++;continue;}
    const path=bars.slice(start,end+1);
    if(path.some((bar,i)=>![bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)
      ||(i>0&&path[i-1].endTime!==bar.time))){pending++;continue;}
    const gross=direction*(path.at(-1).close-path[0].open),net=gross-ABLATION_SPEC.costPoints;
    const location=event.location||{},delta=event.windows?.test;
    const profile=Number.isFinite(location.price)&&Number.isFinite(location.vah)&&Number.isFinite(location.val)
      &&(direction>0?location.price>=location.vah:location.price<location.val);
    const cvd=Number.isFinite(delta?.deltaCvd)&&delta.coverage===1&&delta.deltaCvd*direction>0;
    cohort.push({eventId:event.id,confirmedAt:event.confirmedAt,grossPoints:gross,netPoints:net,profile,cvd,
      mfePoints:Math.max(...path.map(bar=>direction>0?bar.high-path[0].open:path[0].open-bar.low)),
      maePoints:Math.min(...path.map(bar=>direction>0?bar.low-path[0].open:path[0].open-bar.high))});
  }
  cohort.sort((a,b)=>Date.parse(a.confirmedAt)-Date.parse(b.confirmedAt)||a.eventId.localeCompare(b.eventId));
  const variants={};
  for(const [name,predicate] of Object.entries({A:()=>true,B:r=>r.profile,C:r=>r.cvd,D:r=>r.profile&&r.cvd})){
    const retained=cohort.filter(predicate),removed=cohort.filter(row=>!predicate(row));let equity=0,peak=0,drawdown=0;
    for(const row of retained){equity+=row.netPoints;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
    variants[name]={sampleCount:retained.length,baselineCount:cohort.length,retention:cohort.length?retained.length/cohort.length:null,
      netExpectationPoints:retained.length?equity/retained.length:null,eventSequenceMaxDrawdownPoints:retained.length?drawdown:null,
      totalNetPoints:retained.length?equity:null,removedLosses:removed.filter(r=>r.netPoints<0).length,
      removedGoodOpportunities:removed.filter(r=>r.netPoints>0).length,removedBreakeven:removed.filter(r=>r.netPoints===0).length};
  }
  return {schemaVersion:'cru61-ablation-report-v1',spec:ABLATION_SPEC,specHash:ABLATION_SPEC_HASH,datasetRole,sourceIdentity,
    status:datasetRole==='FIXTURE'?'ENGINEERING_FIXTURE_NOT_PERFORMANCE':cohort.length?'TRAINING_DESCRIPTIVE_NOT_VALIDATED':'INSUFFICIENT_DATA',
    pendingOutcomes:pending,variants,cohort,limitations:['NO_EXECUTION_OR_SLIPPAGE_EVIDENCE','EVENT_SEQUENCE_DRAWDOWN_NOT_PORTFOLIO','NO_OOS_OR_STRATEGY_VALIDITY_CLAIM'],...SAFETY};
}
