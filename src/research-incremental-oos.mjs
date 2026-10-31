// Paired, date-blocked comparisons of pre-registered gates; no test-set selection.
import {digest,verifyFrozen,finite,safety} from './research-replay-outcome.mjs';
import {evidenceTimestampNs as ms,validCalendarDate} from './research-evidence-contract-v1.mjs';
const fail=reason=>({schemaVersion:'research-incremental-oos-v1',state:'BLOCKED',reason,
  sampleSize:0,metrics:null,comparisons:null,confidence:null,positiveEvProven:false,...safety});
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function metrics(a,kept) {
  let equity=0,peak=0,drawdown=0;
  for(const v of a){equity+=v;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
  const avg=mean(a),tail=[...a].sort((x,y)=>x-y).slice(0,Math.max(1,Math.ceil(a.length*.05)));
  return {calendarDays:a.length,trades:kept,coverage:kept/a.length,totalNetPoints:equity,
    meanNetPointsPerEligibleDay:avg,meanNetPointsPerTrade:kept?equity/kept:null,
    maxDrawdownPoints:drawdown,worstDayPoints:Math.min(...a),expectedShortfall5PctPoints:mean(tail),
    dailyStdPoints:Math.sqrt(a.reduce((s,v)=>s+(v-avg)**2,0)/(a.length-1)),
    returnPct:null,returnPctReason:'NO_PREREGISTERED_CAPITAL_DENOMINATOR'};
}
function intervals(deltas,seed,blockLength=5,draws=5000){
  let state=parseInt(seed.slice(0,8),16)||1;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  const samples=Array.from({length:draws},()=>{
    let sum=0,n=0;
    while(n<deltas.length){const start=Math.floor(random()*deltas.length);
      for(let j=0;j<blockLength&&n<deltas.length;j++,n++)sum+=deltas[(start+j)%deltas.length];}
    return sum/deltas.length;
  }).sort((a,b)=>a-b);
  // Five planned contrasts: 99% per-comparison percentile interval (Bonferroni 95% family).
  return {lower:samples[Math.floor(draws*.005)],upper:samples[Math.ceil(draws*.995)-1],
    method:'CIRCULAR_MOVING_DATE_BLOCK_BOOTSTRAP',draws,blockLength,seed,
    perComparisonConfidence:.99,familyConfidence:.95,plannedComparisons:5,
    assumptions:'DEPENDENCE_WITHIN_BLOCKS;_SMALL_SAMPLES_AND_REGIME_SHIFTS_LIMIT_COVERAGE'};
}

export function compareResearchVariants({protocol,rows}={}) {
  if(!verifyFrozen(protocol)||protocol.schemaVersion!=='tx-incremental-protocol-v1'
    ||ms(protocol.frozenAt)===null||!Array.isArray(protocol.folds)||protocol.folds.length<3
    ||protocol.blockLength!==5||protocol.bootstrapDraws!==5000
    ||!Number.isSafeInteger(protocol.horizonMs)||protocol.horizonMs<1000||protocol.horizonMs>3600000
    ||!Array.isArray(protocol.oosDates)||protocol.oosDates.length<24
    ||protocol.oosDates.some(d=>!validCalendarDate(d))||new Set(protocol.oosDates).size!==protocol.oosDates.length
    ||!Array.isArray(rows)||rows.length!==protocol.oosDates.length||rows.length>10000
    ||rows.some(r=>!r||typeof r!=='object')||protocol.folds.some(f=>!f||typeof f!=='object'))
    return fail('FROZEN_PROTOCOL_OR_MINIMUM_24_PAIRED_DATES_MISSING');
  const folds=[...protocol.folds].sort((a,b)=>ms(a?.testStartAt)<ms(b?.testStartAt)?-1:1);
  const foldIds=new Set();
  for(let i=0;i<folds.length;i++){
    const f=folds[i],times=[f.trainEndAt,f.trainOutcomeAvailableAt,f.frozenAt,f.testStartAt,f.testEndAt].map(x=>ms(x));
    const [train,labels,frozen,start,end]=times,g=f.gates;
    if(typeof f.id!=='string'||foldIds.has(f.id)||times.some(x=>x===null)
      ||!Number.isSafeInteger(f.embargoMs)||f.embargoMs<1||f.embargoMs<protocol.horizonMs
      ||!(train<=labels&&labels<=frozen&&frozen<start&&labels+BigInt(f.embargoMs)*1000000n<start&&start<=end)
      ||ms(protocol.frozenAt)>=start||(i&&start<=ms(folds[i-1].testEndAt))
      ||!g||!finite(g.minDirectionalImbalance)||g.minDirectionalImbalance<0||g.minDirectionalImbalance>1
      ||!finite(g.maxSpreadTicks)||g.maxSpreadTicks<=0||!finite(g.minDepth5)||g.minDepth5<0
      ||!finite(g.maxRealizedVolPoints)||g.maxRealizedVolPoints<=0)
      return fail('FOLD_PURGE_EMBARGO_FREEZE_OR_GATE_INVALID');
    foldIds.add(f.id);
  }
  const seenDays=new Set(),seenIds=new Set(),counts=new Map(folds.map(f=>[f.id,0]));
  const values={baseline:[],depth:[],filter:[],combined:[]},kept={baseline:0,depth:0,filter:0,combined:0},paired=[];
  let previousEnd=null;
  for(const row of [...rows].sort((a,b)=>ms(a?.signal?.signalAvailableAt)<ms(b?.signal?.signalAvailableAt)?-1:1)){
    const s=row.signal,o=row.outcome,f=folds.find(f=>f.id===row.foldId),t=ms(s?.signalAvailableAt);
    if(!s||!o||!f||t===null||!protocol.oosDates.includes(s.tradeDate)||seenDays.has(s.tradeDate)||seenIds.has(s.eventId)
      ||!verifyFrozen(o)||o.state!=='CAPTURE_AUDITED_REPLAY'||o.signalSha256!==digest(s)
      ||o.rulesSha256!==protocol.outcomeRulesSha256||o.rulesSha256!==s.rulesSha256
      ||!finite(o.netExitPoints)||o.researchOnly!==true||o.executionAuthorized!==false||o.orderRoutesEnabled!==false
      ||[o.signalAvailableAt,o.featureAvailableAt,o.horizonEndAt,o.outcomeAvailableAt].some(x=>ms(x)===null)
      ||ms(o.signalAvailableAt)!==t||ms(o.featureAvailableAt)!==ms(s.featureAvailableAt)
      ||ms(o.featureAvailableAt)>t||ms(o.outcomeAvailableAt)<ms(o.horizonEndAt)
      ||t<ms(f.testStartAt)||ms(o.horizonEndAt)>ms(f.testEndAt)||ms(o.outcomeAvailableAt)>ms(f.testEndAt)
      ||ms(o.horizonEndAt)-t!==BigInt(protocol.horizonMs)*1000000n
      ||(previousEnd!==null&&t<=previousEnd))return fail('PAIRED_EVENT_OUTCOME_OR_FOLD_MISMATCH');
    const q=s.features;
    if(!q||q.quality!=='READY'||q.classifiedCoverage!==1
      ||q.actualContract!==s.actualContract||q.tradeDate!==s.tradeDate||q.session!==s.session
      ||ms(q.availableAt)===null||ms(q.availableAt)>t||t-ms(q.availableAt)>5000000000n
      ||ms(q.availableAt)!==ms(s.featureAvailableAt)
      ||!finite(q.imbalance5)||Math.abs(q.imbalance5)>1
      ||!finite(q.spreadTicks)||q.spreadTicks<=0||!finite(q.bidDepth5)||q.bidDepth5<0
      ||!finite(q.askDepth5)||q.askDepth5<0||!finite(q.realizedVolPoints)||q.realizedVolPoints<0)
      return fail('PRE_SIGNAL_FEATURES_UNQUALIFIED_OR_FUTURE');
    const depth=q.imbalance5*(s.side==='LONG'?1:-1)>=f.gates.minDirectionalImbalance;
    const filter=q.spreadTicks<=f.gates.maxSpreadTicks&&Math.min(q.bidDepth5,q.askDepth5)>=f.gates.minDepth5
      &&q.realizedVolPoints<=f.gates.maxRealizedVolPoints;
    const decision={baseline:true,depth,filter,combined:depth&&filter};
    for(const key of Object.keys(values)){values[key].push(decision[key]?o.netExitPoints:0);kept[key]+=Number(decision[key]);}
    paired.push({eventId:s.eventId,tradeDate:s.tradeDate,foldId:f.id,netPoints:o.netExitPoints,retained:decision});
    seenDays.add(s.tradeDate);seenIds.add(s.eventId);counts.set(f.id,counts.get(f.id)+1);previousEnd=ms(o.horizonEndAt);
  }
  if([...counts.values()].some(n=>n<2))return fail('INSUFFICIENT_PER_FOLD_DATES');
  const summary=Object.fromEntries(Object.keys(values).map(k=>[k,metrics(values[k],kept[k])]));
  const contrasts=[['depth','baseline'],['filter','baseline'],['combined','baseline'],['combined','depth'],['combined','filter']];
  const comparisons=contrasts.map(([a,b])=>{
    const delta=values[a].map((v,i)=>v-values[b][i]),ci=intervals(delta,digest({protocol:protocol.sha256,a,b}));
    return {candidate:a,reference:b,meanDeltaPointsPerEligibleDay:mean(delta),confidenceInterval:ci,
      maxDrawdownDeltaPoints:summary[a].maxDrawdownPoints-summary[b].maxDrawdownPoints,
      tailDeltaPoints:summary[a].expectedShortfall5PctPoints-summary[b].expectedShortfall5PctPoints,
      interpretation:ci.lower>0?'POSITIVE_REPLAY_DIFFERENCE_REQUIRES_FORWARD_CONFIRMATION':
        ci.upper<0?'NEGATIVE_REPLAY_DIFFERENCE':'INCONCLUSIVE'};
  });
  const body={schemaVersion:'research-incremental-oos-v1',state:'PREREGISTERED_PAIRED_OOS_REPLAY',reason:null,
    protocolSha256:protocol.sha256,inputSha256:digest(rows),sampleSize:rows.length,foldCounts:Object.fromEntries(counts),
    metrics:summary,comparisons,paired,
    confidence:rows.length<60?'LOW_SMALL_SAMPLE':'LIMITED_BY_CAPTURE_AND_BLOCK_ASSUMPTIONS',
    missingDataPolicy:'BLOCK_WHOLE_COMPARISON;NEVER_TREAT_MISSING_AS_SKIPPED_TRADE',
    accounting:'SAME_ELIGIBLE_DATES;FILTERED_OUT_TRADE_IS_ZERO_PNL_NO_FEES',
    freshForwardHoldoutVerified:false,positiveEvProven:false,...safety};
  return {...body,sha256:digest(body)};
}
