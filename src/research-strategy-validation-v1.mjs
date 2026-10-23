// Research-only validation adapter inspired by Blave's cost/robustness gates.
// Independently implemented for existing governed TX evidence. No market, AI, or broker I/O.
import crypto from 'node:crypto';
import { evidenceTimestampMs, governedEventIdentity, validCalendarDate } from './research-evidence-contract-v1.mjs';

const SHA=/^[a-f0-9]{64}$/i;
const SID=/^[A-Za-z0-9_.:-]{8,128}$/;
const TX=/^TXF[A-L][0-9]$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=(state,reason,extra={})=>Object.freeze({
  schemaVersion:'tx-research-validation-v1',state,reason,
  researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false,
  positiveEvProven:false,readyForTrading:false,
  ...extra,
});
const blocked=reason=>safe('BLOCKED',reason,{
  grossPoints:null,costPoints:null,netPoints:null,winRate:null,
  expectancyPoints:null,profitFactor:null,maxDrawdownPoints:null,receiptSha256:null,
});

/**
 * Historical *descriptive* net points from separately completed, frozen replay outcomes.
 * All records must already have complete session/corpus evidence; a sampled future path
 * from PR #90 is deliberately refused. This is not a live fill or trading permission.
 */
export function auditCostedTxReplay({manifest,costs,trades,calendar}={}){
  if(manifest?.schemaVersion!=='tx-frozen-executable-outcome-corpus-v1'
    ||manifest.researchOnly!==true||manifest.executionAuthorized!==false
    ||manifest.orderRoutesEnabled!==false||manifest.origin!=='GOVERNED_REAL_TX_REPLAY'
    ||manifest.completeSessionCoverage!==true||manifest.asOfJoinVerified!==true
    ||manifest.continuityVerified!==true||!SHA.test(manifest.sourceSha256||'')
    ||!SHA.test(manifest.frozenRulesSha256||'')
    ||!SHA.test(manifest.costConventionSha256||'')
    ||!SHA.test(manifest.governedCalendarHash||'')
    ||manifest.governedCalendarHash!==calendar?.fileHash)
    return blocked('CORPUS_OR_FROZEN_SOURCE_UNVERIFIED');
  if(!costs||!finite(costs.feePointsPerSide)||costs.feePointsPerSide<=0
    ||!finite(costs.slippagePointsPerSide)||costs.slippagePointsPerSide<=0
    ||!finite(costs.taxPointsPerRoundTrip)||costs.taxPointsPerRoundTrip<0
    ||costs.conventionSha256!==manifest.costConventionSha256
    ||hash({feePointsPerSide:costs.feePointsPerSide,slippagePointsPerSide:costs.slippagePointsPerSide,taxPointsPerRoundTrip:costs.taxPointsPerRoundTrip})!==manifest.costConventionSha256)
    return blocked('COST_CONVENTION_UNVERIFIED');
  if(!Array.isArray(trades)||trades.length<24||trades.length>10000)
    return blocked('MINIMUM_24_UNCORRELATED_TRADE_DAYS_REQUIRED');
  const seen=new Set(),days=new Set(),sorted=[];
  for(const t of trades){
    if(!t||t.schemaVersion!=='tx-executable-outcome-v1'
      ||t.researchOnly!==true||t.executionAuthorized!==false
      ||t.orderRoutesEnabled!==false||t.quality!=='PASS'
      ||t.pathCoverage!=='COMPLETE_VERIFIED'
      ||t.sourceMode!=='GOVERNED_REAL_TX_REPLAY'
      ||t.simtrade!==false||t.duplicate!==false||t.sequenceGap!==0
      ||!SID.test(t.eventId||'')||seen.has(t.eventId)
      ||!validCalendarDate(t.tradeDate)||!TX.test(t.actualContract||'')
      ||!['DAY','NIGHT'].includes(t.session)||!['LONG','SHORT'].includes(t.side)
      ||t.sourceSha256!==manifest.sourceSha256
      ||t.frozenRulesSha256!==manifest.frozenRulesSha256
      ||t.governedCalendarHash!==manifest.governedCalendarHash
      ||!finite(t.entryPrice)||t.entryPrice<=0||!finite(t.exitPrice)||t.exitPrice<=0)
      return blocked('OUTCOME_RECORD_IDENTITY_OR_QUALITY_INVALID');
    const feature=evidenceTimestampMs(t.featureAvailableAt);
    const signal=evidenceTimestampMs(t.signalAvailableAt);
    const entry=evidenceTimestampMs(t.entryAt),exit=evidenceTimestampMs(t.exitAt);
    const outcome=evidenceTimestampMs(t.outcomeAvailableAt);
    const a=governedEventIdentity({exchangeTimestamp:t.entryAt,calendar,tradeDate:t.tradeDate,session:t.session});
    const b=governedEventIdentity({exchangeTimestamp:t.exitAt,calendar,tradeDate:t.tradeDate,session:t.session});
    if([feature,signal,entry,exit,outcome].some(x=>x===null)
      ||!(feature<=signal&&signal<=entry&&entry<exit&&exit<=outcome)
      ||!a||!b||a.sessionId!==b.sessionId||a.governedCalendarHash!==manifest.governedCalendarHash)
      return blocked('FUTURE_EVIDENCE_OR_SESSION_CROSSING');
    // V1 deliberately requires one pre-registered observation per trading date.
    if(days.has(t.tradeDate))return blocked('DEPENDENT_OR_DUPLICATED_TRADE_DATE');
    days.add(t.tradeDate);seen.add(t.eventId);
    sorted.push({...t,_entry:entry,_exit:exit});
  }
  sorted.sort((a,b)=>a._entry-b._entry);
  for(let i=1;i<sorted.length;i++){
    if(sorted[i]._entry<sorted[i-1]._exit)return blocked('OVERLAPPING_REPLAY_TRADES');
  }
  const roundtrip=2*(costs.feePointsPerSide+costs.slippagePointsPerSide)+costs.taxPointsPerRoundTrip;
  let gross=0,net=0,peak=0,equity=0,maxDrawdown=0,wins=0,gains=0,losses=0;
  for(const t of sorted){
    const points=(t.exitPrice-t.entryPrice)*(t.side==='LONG'?1:-1);
    const after=points-roundtrip;
    gross+=points;net+=after;equity+=after;
    peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
    if(after>0){wins++;gains+=after;}else if(after<0){losses-=after;}
  }
  const fixed={sourceSha256:manifest.sourceSha256,governedCalendarHash:manifest.governedCalendarHash,
    frozenRulesSha256:manifest.frozenRulesSha256,costConventionSha256:manifest.costConventionSha256,
    tradeCount:sorted.length,firstTradeDate:sorted[0].tradeDate,lastTradeDate:sorted.at(-1).tradeDate};
  return safe('HISTORICAL_DESCRIPTIVE_ONLY',null,{
    ...fixed, grossPoints:gross,costPoints:roundtrip*sorted.length,netPoints:net,
    winRate:wins/sorted.length,expectancyPoints:net/sorted.length,
    profitFactor:losses>0?gains/losses:null,maxDrawdownPoints:maxDrawdown,
    costBasis:'FROZEN_POINT_EQUIVALENT_ASSUMPTION_NOT_BROKER_FILLS',
    receiptSha256:hash({fixed,costs,results:{gross,net,maxDrawdown,gains,losses,wins}}),
  });
}

/**
 * A Blave-inspired 3x3 neighbourhood plateau, selected strictly on training
 * statistics. OOS is displayed only AFTER selection and never selects a cell.
 */
export function selectTrainingPlateau({cells,provenance}={}){
  const fail=reason=>safe('BLOCKED',reason,{selection:null});
  if(!Array.isArray(cells)||cells.length<9||cells.length>400
      ||!SHA.test(provenance?.sourceSha256||'')
      ||!SHA.test(provenance?.costConventionSha256||'')
      ||!SHA.test(provenance?.frozenRulesSha256||'')
      ||provenance?.scoreBasis!=='NET_OF_FROZEN_COSTS')
    return fail('PLATEAU_INPUT_OR_COST_UNVERIFIED');
  const trainEnd=evidenceTimestampMs(provenance.trainEndAt);
  const testStart=evidenceTimestampMs(provenance.testStartAt);
  if(trainEnd===null||testStart===null||trainEnd>=testStart)
    return fail('PLATEAU_FUTURE_LEAKAGE');
  const xs=[...new Set(cells.map(c=>c?.x))].sort((a,b)=>a-b);
  const ys=[...new Set(cells.map(c=>c?.y))].sort((a,b)=>a-b);
  if(xs.length<3||ys.length<3||xs.length*ys.length!==cells.length
      ||xs.some(x=>!finite(x))||ys.some(y=>!finite(y)))return fail('PARAMETER_GRID_INCOMPLETE');
  const map=new Map();
  for(const c of cells){
    if(!finite(c.trainNetPointsPerTrade)||!finite(c.testNetPointsPerTrade)
      ||!Number.isSafeInteger(c.trainTrades)||c.trainTrades<24
      ||!Number.isSafeInteger(c.testTrades)||c.testTrades<24
      ||c.sourceSha256!==provenance.sourceSha256
      ||c.costConventionSha256!==provenance.costConventionSha256
      ||c.frozenRulesSha256!==provenance.frozenRulesSha256)
      return fail('PLATEAU_SCORE_OR_PROVENANCE_INVALID');
    const key=JSON.stringify([c.x,c.y]);
    if(map.has(key))return fail('PARAMETER_GRID_DUPLICATED');
    map.set(key,c);
  }
  let choice=null;
  for(let x=1;x<xs.length-1;x++)for(let y=1;y<ys.length-1;y++){
    const neighbours=[];
    for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)
      neighbours.push(map.get(JSON.stringify([xs[i],ys[j]])));
    if(neighbours.some(n=>!n))return fail('PARAMETER_GRID_INCOMPLETE');
    const score=neighbours.reduce((sum,n)=>sum+n.trainNetPointsPerTrade,0)/9;
    if(!choice||score>choice.trainingNeighbourhoodMean)
      choice={x:xs[x],y:ys[y],trainingNeighbourhoodMean:score,
        neighboursPositive:neighbours.filter(n=>n.trainNetPointsPerTrade>0).length,
        trainNetPointsPerTrade:map.get(JSON.stringify([xs[x],ys[y]])).trainNetPointsPerTrade,
        testNetPointsPerTrade:map.get(JSON.stringify([xs[x],ys[y]])).testNetPointsPerTrade};
  }
  return safe('TRAIN_SELECTED_OOS_DESCRIPTIVE_ONLY',null,{
    selection:Object.freeze(choice),
    selectionRule:'THREE_BY_THREE_TRAIN_ONLY_PLATEAU',
    freshForwardHoldoutVerified:false,
    inputSha256:hash({provenance,cells:[...cells].sort((a,b)=>a.x-b.x||a.y-b.y)}),
  });
}

export function auditPurgedWalkForward(result,{minimumOosDays=24}={}){
  if(!result||!Array.isArray(result.folds)||result.folds.length<3
    ||!Number.isSafeInteger(minimumOosDays)||minimumOosDays<24
    ||!Array.isArray(result.predictions)||result.predictions.length<minimumOosDays)
    return safe('BLOCKED','MINIMUM_OOS_EVIDENCE_MISSING',{forwardGatePassed:false});
  const valid=result.folds.every(f=>f&&validCalendarDate(f.trainLastDate)
      &&validCalendarDate(f.purgedDate)&&validCalendarDate(f.testFirstDate)
      &&validCalendarDate(f.testLastDate)
      &&f.trainLastDate<f.purgedDate&&f.purgedDate<f.testFirstDate
      &&f.testFirstDate<=f.testLastDate&&Number.isSafeInteger(f.testDays)&&f.testDays>0);
  const fail=reason=>safe('BLOCKED',reason,{forwardGatePassed:false});
  if(!valid)return fail('PURGED_FOLD_CHRONOLOGY_INVALID');
  const folds=[...result.folds].sort((a,b)=>a.testFirstDate.localeCompare(b.testFirstDate));
  if(folds.some((f,i)=>i>0&&f.testFirstDate<=folds[i-1].testLastDate))
    return fail('OVERLAPPING_OOS_FOLDS');
  const seen=new Set(),counts=folds.map(()=>0);
  for(const prediction of result.predictions){
    if(!prediction||!validCalendarDate(prediction.tradeDate)
      ||![prediction.actual,prediction.baseline,prediction.candidate].every(finite)
      ||seen.has(prediction.tradeDate))return fail('OOS_PREDICTION_INVALID_OR_DUPLICATED');
    const index=folds.findIndex(f=>f.testFirstDate<=prediction.tradeDate&&prediction.tradeDate<=f.testLastDate);
    if(index<0)return fail('OOS_PREDICTION_OUTSIDE_FOLDS');
    seen.add(prediction.tradeDate);counts[index]++;
  }
  if(counts.some((count,i)=>count!==folds[i].testDays))return fail('OOS_FOLD_COUNT_MISMATCH');
  return safe('OOS_STRUCTURE_CHECK_ONLY',null,{forwardGatePassed:true,
      oosPredictions:result.predictions.length,foldCount:result.folds.length,
      futureHoldoutNeeded:true});
}
