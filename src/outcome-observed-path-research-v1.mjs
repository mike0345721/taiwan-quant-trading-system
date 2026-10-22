// Separate post-event observed-path evidence; never append it to the as-of feature event.
// This is an incomplete observational bound, NOT certified trade MFE/MAE or net PnL.
import {numericScalar,evidenceTimestampMs,evidenceTimestampNs,governedEventIdentity}
  from './research-evidence-contract-v1.mjs';

const allowHorizon=new Set([1,3,5,15,30,60]);
const unavailable=(reason,eventId=null)=>Object.freeze({
  schemaVersion:'outcome-observed-path-v1',eventId,
  state:'UNAVAILABLE',reason,pathCoverage:'UNVERIFIED',
  mfeLowerBoundPoints:null,maeLowerBoundPoints:null,
  timeToObservedMfeMs:null,timeToObservedMaeMs:null,
  netPoints:null,netR:null,ev:null,tradeFailureCause:null,
  formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false,
});

export function observePostEventPricePath({
  event,calendar,direction,horizonMinutes,ticks,
}={}) {
  const id=typeof event?.eventId==='string'?event.eventId:null;
  if(!event||event.schemaVersion!=='research-outcome-candidate-v1'
      ||event.outcomeStatus!=='PENDING'||!Object.isFrozen(event)
      ||event.executionAuthorized!==false||event.orderRoutesEnabled!==false
      ||!['BUY_HYPOTHESIS','SELL_HYPOTHESIS'].includes(direction)
      ||!allowHorizon.has(horizonMinutes)
      ||!Array.isArray(ticks)||ticks.length===0||ticks.length>10000)
    return unavailable('OUTCOME_RULES_OR_SOURCE_INVALID',id);
  const asOf=evidenceTimestampMs(event.asOfAvailableAt);
  const start=governedEventIdentity({
    exchangeTimestamp:event.eventExchangeTimestamp,calendar,
    tradeDate:event.tradeDate,session:event.session,
  });
  if(asOf===null||!start||start.sessionId!==event.sessionId
      ||start.governedCalendarHash!==event.governedCalendarHash)
    return unavailable('EVENT_GOVERNANCE_NOT_VERIFIED',id);
  const horizonEnd=asOf+horizonMinutes*60_000;
  const side=direction==='BUY_HYPOTHESIS'?1:-1;
  let best=0,worst=0,timeToBest=null,timeToWorst=null,lastTime=-Infinity;
  let lastAvailable=-Infinity,count=0,lastObservedMs=null,lastPrice=null;
  let lastExchangeNs=null;
  const seenIdentities=new Set();
  const ref=numericScalar(event.referencePrice,{positive:true});
  if(ref===null)return unavailable('ENTRY_REFERENCE_INVALID',id);
  for(const tick of ticks) {
    if(tick?.kind!=='futures_tick'||tick.actualContract!==event.actualContract
        ||tick.executionAuthorized!==false||tick.orderRoutesEnabled!==false
        ||tick.simtrade!==false||tick.duplicate!==false
        ||!Number.isSafeInteger(tick.sequenceGap)||tick.sequenceGap!==0)
      return unavailable('POST_EVENT_TICK_IDENTITY_OR_GAP',id);
    const classified=governedEventIdentity({
      exchangeTimestamp:tick.exchangeTimestamp,calendar,
      tradeDate:event.tradeDate,session:event.session,
    });
    if(!classified||classified.sessionId!==event.sessionId)
      return unavailable('POST_EVENT_SESSION_MISMATCH',id);
    const exchange=evidenceTimestampMs(tick.exchangeTimestamp,{taipeiNaive:true});
    const exchangeNs=evidenceTimestampNs(tick.exchangeTimestamp,{taipeiNaive:true});
    const available=evidenceTimestampMs(tick.availableAt);
    const price=numericScalar(tick.price,{positive:true});
    const identity=typeof tick.recordHash==='string'&&/^[a-f0-9]{64}$/i.test(tick.recordHash)
      ? tick.recordHash:typeof tick.eventId==='string'&&tick.eventId.length>=8
        ? tick.eventId:null;
    if(exchange===null||exchangeNs===null||available===null||price===null
        ||available<=asOf||exchangeNs<=BigInt(asOf)*1_000_000n
        ||exchangeNs>BigInt(horizonEnd)*1_000_000n||exchange>available
        ||available-exchange>5000||available<lastAvailable
        ||(lastExchangeNs!==null&&exchangeNs<lastExchangeNs))
      return unavailable('POST_EVENT_TIME_OR_PRICE_INVALID',id);
    // High-frequency distinct trades may share a millisecond or exact exchange
    // timestamp. Accept a tie only when their ledger identities are distinct.
    if(lastExchangeNs!==null&&exchangeNs===lastExchangeNs && !identity)
      return unavailable('POST_EVENT_TIED_TIMESTAMP_IDENTITY_MISSING',id);
    if(identity&&seenIdentities.has(identity))
      return unavailable('POST_EVENT_DUPLICATED_LEDGER_IDENTITY',id);
    if(identity)seenIdentities.add(identity);
    const signed=side*(price-ref);
    if(signed>best){best=signed;timeToBest=Number(exchangeNs-BigInt(asOf)*1_000_000n)/1_000_000;}
    if(-signed>worst){worst=-signed;timeToWorst=Number(exchangeNs-BigInt(asOf)*1_000_000n)/1_000_000;}
    lastTime=exchange;lastExchangeNs=exchangeNs;
    lastAvailable=available;lastObservedMs=exchange;
    lastPrice=price;count++;
  }
  // Ordered sampled ticks supply LOWER bounds on extrema; no continuous
  // tick coverage / executable fill / cost/stop policy has been proven.
  const observedEnd=lastObservedMs===null?null:new Date(lastObservedMs).toISOString();
  return Object.freeze({
    schemaVersion:'outcome-observed-path-v1',eventId:id,
    state:'OBSERVED_PATH_BOUNDS_ONLY',reason:'HORIZON_CONTINUITY_NOT_CERTIFIED',
    startAsOfAvailableAt:event.asOfAvailableAt,
    directionHypothesis:direction,horizonMinutes,
    observedTicks:count,observedThroughExchangeTime:observedEnd,
    sourceTimeEndLessThanHorizon:lastObservedMs<horizonEnd,
    pathCoverage:'UNVERIFIED',mfeLowerBoundPoints:best,
    maeLowerBoundPoints:worst,timeToObservedMfeMs:timeToBest,
    timeToObservedMaeMs:timeToWorst,
    lastObservedPrice:lastPrice,finalNetPoints:null,
    // No trading rule or fill observed: do not print net PnL, win rate or EV.
    netPoints:null,netR:null,ev:null,tradeFailureCause:null,
    futureLabelCertified:false,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}
