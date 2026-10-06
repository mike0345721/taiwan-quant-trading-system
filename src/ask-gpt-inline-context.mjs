// A bounded derivative of the canonical immutable snapshot; never accepts a client snapshot.
import { createHash } from 'node:crypto';
import { validateDecisionSnapshot, discussionSnapshot } from './dashboard-decision-workspace.mjs';
import { PlanError } from './chatgpt-plan-auth.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value?.[k]??null]));
const AVAIL=['availability','value','sourceId','availableAt','reason'];
const row=r=>pick(r,['name','categoryName','points']);
const smallValue=v=>{
 if(v==null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))return v;
 if(typeof v==='string'&&v.length<=1000)return v;
 throw new PlanError('CONTEXT_VALUE_INVALID');
};
function validateTree(value,depth=0){
 if(depth>14)throw new PlanError('CONTEXT_DEPTH_EXCEEDED');
 if(value==null||typeof value!=='object'){smallValue(value);return;}
 if(Array.isArray(value)){if(value.length>60)throw new PlanError('CONTEXT_ARRAY_LIMIT');for(const x of value)validateTree(x,depth+1);return;}
 for(const[k,v]of Object.entries(value)){
  if(/(?:password|credential|access.?token|refresh.?token|api.?key|cookie|private.?key|^__proto__$)/i.test(k))throw new PlanError('CONTEXT_SECRET_FIELD_REJECTED');
  validateTree(v,depth+1);
 }
}
export function buildInlineContext(snapshot,{now=Date.now()}={}){
 validateDecisionSnapshot(snapshot);
 const time=Date.parse(snapshot.snapshotTime);
 if(!Number.isFinite(time)||time>now||now-time>120000)throw new PlanError('SNAPSHOT_DISPATCH_TIME_INVALID');
 const d=discussionSnapshot(snapshot);
 const evidence=(d.evidenceConflict?.evidence||[]).slice(0,12).map(r=>({...pick(r,['family','availabilityState','qualityState','promotionState','eligibleDirectionalEvidence','eventTime','availableAt','sourceId','sourceMode','sourceTradeDate']),qualityReasons:(r.qualityReasons||[]).slice(0,8),descriptiveValues:(r.descriptiveValues||[]).slice(0,10).map(v=>pick(v,['label','value','unit']))}));
 const flow=d.observedFlow||{};
 const fi=flow.identity;const flowMismatch=fi&&d.identityState==='AVAILABLE'&&(fi.actualContract!==d.contract||fi.tradeDate!==d.tradeDate||fi.session!==d.session);
 const marketPulse={
  rvol:pick(d.marketPulse?.rvol,['state','reason','ratio','percentile','sampleDays','slot','session','tradeDate','actualContract','completedBarAvailableAt','completedBarTime']),
  basis:pick(d.marketPulse?.basis,['state','reason','label','points','pct','referenceMode','futuresPrice','spotPrice','futuresAvailableAt','spotAvailableAt','futuresEventTime','spotEventTime','tradeDate','session','actualContract']),
 };
 const watch=d.levelWatch||{};
 const safeBasis=b=>b?{
  importanceBand:b.importanceBand||null,
  structuralSource:smallValue(b.structuralSource),
  confluence:pick(b.confluence,['count','labels','prices','tolerancePoints']),
  reaction:pick(b.reaction,['method','testEpisodes','meaningfulReactionCount','meaningfulThresholdPoints','lastTouchAt','maxDeparturePoints','medianDeparturePoints']),
  currentConfirmation:{
   nearObservationZone:Boolean(b.currentConfirmation?.nearObservationZone),
   observedFlow:pick(b.currentConfirmation?.observedFlow,['sourceState','quality','pressure60','response60','directionRelation','availableAt']),
   participation:pick(b.currentConfirmation?.participation,['completedBarVolumeRatio','rvolState','rvolRatio','rvolPercentile','rvolSampleDays']),
  },
 }:null;
 const safeLevel=r=>({...pick(r,['id','family','label','price','state','side','distancePoints','absoluteDistancePoints','movingToward','zonePoints','sourceId','availableAt','formedAt','qualityStatus','importanceBand']),basisReasons:(r?.basisReasons||[]).slice(0,7).map(smallValue),basis:safeBasis(r?.basis),why:smallValue(r?.why),watchFor:smallValue(r?.watchFor),expectedResponse:smallValue(r?.expectedResponse),confirm:smallValue(r?.confirm),invalidate:smallValue(r?.invalidate)});
 const levelWatch={...pick(watch,['state','reason','currentPrice','zonePoints','zoneMethod','rankingMethod']),levels:(watch.levels||[]).slice(0,3).map(safeLevel),nextWatch:watch.nextWatch?safeLevel(watch.nextWatch):null,observedFlow:pick(watch.observedFlow,['sourceState','quality','pressure60','response60','directionRelation','availableAt']),participation:pick(watch.participation,['completedBarVolumeRatio','rvolState','rvolRatio','rvolPercentile','rvolSampleDays'])};
 const context={schemaVersion:'ask-gpt-inline-context-v1',...pick(d,['snapshotHash','snapshotTime','tradeDate','contract','session','identityState','identityReason','identitySource','decisionReadiness']),
  selection:'CURRENT_LIVE_WORKSPACE_NOT_LOCKED_OR_REPLAY_SELECTION',
  price:pick(d.price,AVAIL),OR:pick(d.OR,AVAIL),VWAP:pick(d.VWAP,AVAIL),marketPulse,levelWatch,
  marketState:pick(d.marketState,['availability','direction','globalAlignment','risk','reason','decisionAt','availableAt']),
  observedFlow:flowMismatch?{sourceState:'UNAVAILABLE',unavailableReason:'SNAPSHOT_IDENTITY_MISMATCH',excludedIdentity:pick(fi,['actualContract','tradeDate','session'])}:{...pick(flow,['sourceState','sourceMode','availableAt','unavailableReason','formalDirection']),identity:pick(fi,['actualContract','tradeDate','session']),primary60s:pick(flow.primary60s,['pressureRatio','classifiedCoverage','responsePoints','pathEfficiency']),context300s:pick(flow.context300s,['pressureRatio','classifiedCoverage','responsePoints','pathEfficiency']),quality:pick(flow.researchQuality,['status','reason','reasons'])},
  options:{...pick(d.options,['availability','sourceId','availableAt','reason']),value:pick(d.options?.value,['contract','oiPcRatio','callWall','putWall','maxPain']),mode:'EOD_BACKGROUND_NOT_INTRADAY'},
  leadershipSource:pick(d.leadershipSource,['state','sourceMode','sourceTradeDate','quality','lastAvailableAt','eventTime','availableAt','freshnessState','reason']),
  leadership:{topPositive:(d.indexLeadership?.topPositive||[]).slice(0,5).map(row),topNegative:(d.indexLeadership?.topNegative||[]).slice(0,5).map(row),industry:(d.industryLeadership?.rows||[]).slice(0,5).map(row),coverage:'BOUNDED_PROVIDER_RANKINGS_NOT_FULL_MARKET',displayedLimitPerGroup:5},
  evidence: { ...pick(d.evidenceConflict,['conflictState','coverageState','dataTrustState']),families:evidence},
  dataHealthWarnings:(d.dataHealthWarnings||[]).slice(0,30).map(r=>pick(r,['sourceId','freshness','quality','availableAt','reasonCode','readiness'])),
  governedMarketChanges:(d.governedMarketChanges||[]).slice(0,5).map(r=>pick(r,['eventId','eventType','observedAt','summary','dataTrust'])),
  formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false,NOT_PROMOTED:true,NOT_A_TRADING_SIGNAL:true,
 };
 validateTree(context);const input=JSON.stringify(context);
 if(Buffer.byteLength(input)>40000)throw new PlanError('CONTEXT_SIZE_LIMIT');
 return{context:JSON.parse(input),contextHash:hash(input),inputBytes:Buffer.byteLength(input),snapshotHash:d.snapshotHash,snapshotTime:d.snapshotTime};
}
