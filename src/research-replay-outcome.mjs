// Offline TX event study. Never orders, actual fills, or proof of market completeness.
import crypto from 'node:crypto';
import {evidenceTimestampMs as ms, evidenceTimestampNs as ns, governedEventIdentity} from './research-evidence-contract-v1.mjs';

export const safety = Object.freeze({researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false});
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v==='object'
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])) : v;
export const digest = v => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
export const finite = n => typeof n==='number' && Number.isFinite(n);
const isoNs=n=>new Date(Number(n/1000000n)).toISOString().replace(/\.\d{3}Z$/,'.'+(n%1000000000n).toString().padStart(9,'0')+'Z');
const sha = s => typeof s==='string' && /^[a-f0-9]{64}$/.test(s);
export function verifyFrozen(value) {
  if(!value || !sha(value.sha256))return false;
  const {sha256,...body}=value;return digest(body)===sha256;
}
const blocked = (eventId,reason) => ({schemaVersion:'research-full-outcome-v1',eventId,state:'BLOCKED',reason,
  mfePoints:null,maePoints:null,maxNetLiquidationPoints:null,minNetLiquidationPoints:null,
  netEndpointPoints:null,netExitPoints:null,realizedPnl:null,failureReasons:null,...safety});

export function validReplayRules(r) {
  return verifyFrozen(r) && r.schemaVersion==='tx-replay-rules-v1' && ms(r.frozenAt)!==null
    && Number.isSafeInteger(r.horizonMs)&&r.horizonMs>=1000&&r.horizonMs<=3600000
    && Number.isSafeInteger(r.maxGapMs)&&r.maxGapMs>0&&r.maxGapMs<=5000
    && finite(r.stopPoints)&&r.stopPoints>0&&finite(r.targetPoints)&&r.targetPoints>0
    && finite(r.feeTwdPerSide)&&r.feeTwdPerSide>0&&r.pointValueTwd===200
    && Number.isSafeInteger(r.slippageTicksPerSide)&&r.slippageTicksPerSide>=1&&r.tickSize===1
    && r.taxRatePerSide===0.00002 && r.taxRounding==='CEIL_TWD_PER_SIDE'
    && typeof r.costSource==='string'&&r.costSource.length>=8;
}

// Tax rounds conservatively upward per side; the chosen assumption is hashed.
export function costedMove(entry,exit,side,r) {
  const sign=side==='LONG'?1:-1;
  const slip=r.slippageTicksPerSide*r.tickSize;
  const entryFill=entry+sign*slip,exitFill=exit-sign*slip;
  if(Math.min(entryFill,exitFill)<=0)throw Error('FILL_PRICE_INVALID');
  const feePoints=2*r.feeTwdPerSide/r.pointValueTwd;
  const taxPoints=(Math.ceil(entryFill*r.pointValueTwd*r.taxRatePerSide)
    +Math.ceil(exitFill*r.pointValueTwd*r.taxRatePerSide))/r.pointValueTwd;
  const grossPoints=sign*(exit-entry),slippagePoints=2*slip;
  return {grossPoints,feePoints,taxPoints,slippagePoints,totalCostPoints:feePoints+taxPoints+slippagePoints,
    netPoints:grossPoints-feePoints-taxPoints-slippagePoints,entryFill,exitFill};
}

/** Input is an exact, immutable captured tick slice plus externally audited coverage.
 * Hashes bind evidence, not its authenticity. Missing capture audit blocks full metrics.
 * Entry/stop/target use first later observed trade, never a guaranteed executable price.
 */
export function resolveResearchOutcome({signal,rules,tape,coverage,calendar}={}) {
  const id=typeof signal?.eventId==='string'?signal.eventId:null;
  const fail=reason=>blocked(id,reason);
  if(!validReplayRules(rules)||!id||!/^TXF[A-L][0-9]$/.test(signal.actualContract||'')
    ||!['LONG','SHORT'].includes(signal.side)||signal.rulesSha256!==rules.sha256
    ||signal.researchOnly!==true||signal.executionAuthorized!==false||signal.orderRoutesEnabled!==false)
    return fail('FROZEN_SIGNAL_OR_RULES_INVALID');
  const at=ms(signal.signalAvailableAt),feature=ns(signal.featureAvailableAt),signalNs=ns(signal.signalAvailableAt);
  const end=at+rules.horizonMs;
  const endNs=signalNs===null?null:signalNs+BigInt(rules.horizonMs)*1000000n;
  const startIdentity=governedEventIdentity({exchangeTimestamp:signal.signalAvailableAt,calendar,tradeDate:signal.tradeDate,session:signal.session});
  const endIdentity=Number.isFinite(end)?governedEventIdentity({exchangeTimestamp:new Date(end).toISOString(),calendar,tradeDate:signal.tradeDate,session:signal.session}):null;
  if(signalNs===null||feature===null||!startIdentity||!endIdentity||startIdentity.sessionId!==endIdentity.sessionId
    ||feature>signalNs||signalNs-feature>BigInt(rules.maxGapMs)*1000000n||ns(rules.frozenAt)>=signalNs)
    return fail('SIGNAL_TIME_SESSION_OR_FREEZE_INVALID');
  if(!Array.isArray(tape)||tape.length<3||tape.length>100000||!verifyFrozen(coverage)
    ||coverage.schemaVersion!=='tx-captured-path-audit-v1'||coverage.sourceMode!=='REAL_CAPTURE'
    ||coverage.captureStatus!=='COMPLETE_VERIFIED'||coverage.timestampViolations!==0
    ||coverage.sequenceGaps!==0||coverage.droppedEvents!==0||coverage.hashFailures!==0
    ||!sha(coverage.sourceSha256)||!sha(coverage.auditReceiptSha256)
    ||coverage.calendarSha256!==calendar.fileHash||coverage.tapeSha256!==digest(tape)
    ||coverage.signalSha256!==digest(signal)||coverage.rulesSha256!==rules.sha256
    ||ns(coverage.startAt)===null||ns(coverage.endAt)===null
    ||ns(coverage.startAt)>signalNs||ns(coverage.endAt)<endNs)
    return fail('COMPLETE_CAPTURE_AUDIT_MISSING_OR_MISMATCH');
  let prevNs=null,prevAvailable=null,maxGap=0;
  const seen=new Set(),rows=[];
  for(const t of tape){
    const time=ms(t.exchangeTimestamp,{taipeiNaive:true}),nano=ns(t.exchangeTimestamp,{taipeiNaive:true});
    const available=ns(t.availableAt);
    const identity=governedEventIdentity({exchangeTimestamp:t.exchangeTimestamp,calendar,tradeDate:signal.tradeDate,session:signal.session});
    if(!identity||identity.sessionId!==startIdentity.sessionId||t.actualContract!==signal.actualContract
      ||!sha(t.recordHash)||seen.has(t.recordHash)||t.simtrade!==false||t.duplicate!==false||t.sequenceGap!==0
      ||!finite(t.price)||t.price<=rules.slippageTicksPerSide||!Number.isInteger(t.price/rules.tickSize)
      ||nano===null||available===null||nano>available||available-nano>BigInt(rules.maxGapMs)*1000000n
      ||(prevNs!==null&&nano<prevNs)||(prevAvailable!==null&&available<prevAvailable))
      return fail('PATH_TICK_IDENTITY_TIME_OR_QUALITY_INVALID');
    if(prevNs!==null)maxGap=Math.max(maxGap,Number(nano-prevNs)/1000000);
    seen.add(t.recordHash);prevNs=nano;prevAvailable=available;
    rows.push({...t,time,nano});
  }
  if(rows[0].nano>signalNs||rows.at(-1).nano<endNs||maxGap>rules.maxGapMs)
    return fail('PATH_BOUNDARY_OR_CONTINUITY_GAP');
  const later=rows.filter(t=>t.nano>signalNs&&t.nano<=endNs);
  if(!later.length||Number(later[0].nano-signalNs)/1000000>rules.maxGapMs||Number(endNs-later.at(-1).nano)/1000000>rules.maxGapMs)
    return fail('ENTRY_OR_ENDPOINT_MISSING');
  const entry=later[0],endpoint=later.at(-1),sign=signal.side==='LONG'?1:-1;
  let mfe=0,mae=0,mfeAt=entry.exchangeTimestamp,maeAt=mfeAt,exit=endpoint,exitReason='HORIZON_END',touched=false;
  let tradeMfe=0,tradeMae=0;
  let maxNet=-Infinity,minNet=Infinity;
  for(const t of later){
    const move=sign*(t.price-entry.price);
    const net=costedMove(entry.price,t.price,signal.side,rules).netPoints;
    maxNet=Math.max(maxNet,net);minNet=Math.min(minNet,net);
    if(move>mfe){mfe=move;mfeAt=t.exchangeTimestamp;}
    if(-move>mae){mae=-move;maeAt=t.exchangeTimestamp;}
    if(!touched){
      tradeMfe=Math.max(tradeMfe,move);tradeMae=Math.max(tradeMae,-move);
      if(move<=-rules.stopPoints||move>=rules.targetPoints){exit=t;exitReason=move<=-rules.stopPoints?'STOP_HIT':'TARGET_HIT';touched=true;}
    }
  }
  const endpointCost=costedMove(entry.price,endpoint.price,signal.side,rules);
  const exitCost=costedMove(entry.price,exit.price,signal.side,rules);
  const failureReasons=[];
  if(exitReason==='STOP_HIT')failureReasons.push('STOP_HIT');
  if(exitCost.grossPoints>0&&exitCost.netPoints<=0)failureReasons.push('COST_ERASED_GROSS_GAIN');
  if(exitCost.grossPoints<=0)failureReasons.push('ADVERSE_OR_FLAT_EXIT');
  if(exitReason==='HORIZON_END')failureReasons.push('TARGET_NOT_REACHED_WITHIN_HORIZON');
  const body={schemaVersion:'research-full-outcome-v1',eventId:id,state:'CAPTURE_AUDITED_REPLAY',
    reason:null,tradeDate:signal.tradeDate,actualContract:signal.actualContract,session:signal.session,side:signal.side,
    signalSha256:digest(signal),rulesSha256:rules.sha256,tapeSha256:coverage.tapeSha256,coverageSha256:coverage.sha256,
    signalAvailableAt:signal.signalAvailableAt,featureAvailableAt:signal.featureAvailableAt,
    entryAt:entry.exchangeTimestamp,entryReferencePrice:entry.price,endpointAt:endpoint.exchangeTimestamp,
    horizonEndAt:isoNs(endNs),outcomeAvailableAt:rows.at(-1).availableAt,
    exitAt:exit.exchangeTimestamp,exitReferencePrice:exit.price,exitReason,
    mfePoints:mfe,maePoints:mae,mfeAt,maeAt,timeToMfeMs:Number(ns(mfeAt,{taipeiNaive:true})-entry.nano)/1000000,
    timeToMaeMs:Number(ns(maeAt,{taipeiNaive:true})-entry.nano)/1000000,tradeMfePoints:tradeMfe,tradeMaePoints:tradeMae,
    endpointCost,exitCost,netEndpointPoints:endpointCost.netPoints,netExitPoints:exitCost.netPoints,
    netExitTwd:exitCost.netPoints*rules.pointValueTwd,sizeContracts:1,realizedPnl:null,
    maxNetLiquidationPoints:maxNet,minNetLiquidationPoints:minNet,
    failureReasons,failureInterpretation:'RULE_OUTCOME_TAGS_NOT_CAUSAL_DIAGNOSIS',
    fillModel:'NEXT_OBSERVED_TRADE_PLUS_FROZEN_ADVERSE_SLIPPAGE',
    evidenceLimit:'AUDITED_CAPTURE_IS_NOT_EXCHANGE_COMPLETE_OR_BROKER_FILL_PROOF',
    observedTicks:later.length,maxObservedGapMs:maxGap,positiveEvProven:false,...safety};
  return {...body,sha256:digest(body)};
}
