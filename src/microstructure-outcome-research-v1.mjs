// Research only. No mutating source ledgers, broker calls or trade authorization.
import {numericScalar, evidenceTimestampMs, evidenceTimestampNs, governedEventIdentity}
  from './research-evidence-contract-v1.mjs';

const unqualified = (reason) => Object.freeze({
  schemaVersion:'microstructure-l5-research-v1',state:'UNAVAILABLE',reason,
  spreadTicks:null,bidDepth1:null,askDepth1:null,bidDepth5:null,
  askDepth5:null,imbalance5:null,sourceTime:null,availableAt:null,
  formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false,
});
const fivePrices = xs => Array.isArray(xs)&&xs.length===5
  && xs.every(x=>numericScalar(x,{positive:true})!==null);
const fiveVolumes = xs => Array.isArray(xs)&&xs.length===5
  && xs.every(x=>numericScalar(x,{integer:true,nonNegative:true})!==null);
const onTick = (price,tick) => Math.abs(price/tick-Math.round(price/tick))<1e-6;

export function projectGovernedL5(record,{
  asOfAvailableAt,actualContract,tradeDate,session,tickSize,calendar,
}={}) {
  if(record?.kind!=='futures_bidask'||record.executionAuthorized!==false
      ||record.orderRoutesEnabled!==false)return unqualified('SOURCE_CONTRACT_UNVERIFIED');
  const p=record.payload;
  if(typeof actualContract!=='string'||!/^TX[A-Z0-9]{2,12}$/.test(actualContract)
      ||p?.productFamily!=='TX'||p.actualContract!==actualContract)
    return unqualified('IDENTITY_UNVERIFIED');
  const classified=governedEventIdentity({
    exchangeTimestamp:record.exchangeTimestamp,calendar,tradeDate,session,
  });
  if(!classified)return unqualified('GOVERNED_SESSION_OR_DATE_MISMATCH');
  // The *actual* ledger uses an integer number of missing sequences, not Boolean.
  if(p.simtrade!==false||record.duplicate!==false
      ||!Number.isSafeInteger(record.sequenceGap)||record.sequenceGap!==0)
    return unqualified('SIMULATED_DUPLICATE_OR_SEQUENCE_GAP');
  const asOf=evidenceTimestampNs(asOfAvailableAt);
  const available=evidenceTimestampNs(record.receivedAt);
  const source=evidenceTimestampNs(record.exchangeTimestamp,{taipeiNaive:true});
  if(asOf===null||available===null||source===null
      ||source>available||available>asOf||asOf-source>5_000_000_000n)
    return unqualified('SOURCE_TIME_NOT_KNOWN_AS_OF');
  const skew=numericScalar(record.clockSkewMs);
  if(skew===null||Math.abs(skew)>5_000)return unqualified('SOURCE_CLOCK_UNVERIFIED');
  const tick=numericScalar(tickSize,{positive:true});
  if(tick===null)return unqualified('TICK_SIZE_UNVERIFIED');
  if(!fivePrices(p.bid_price)||!fivePrices(p.ask_price)
      ||!fiveVolumes(p.bid_volume)||!fiveVolumes(p.ask_volume))
    return unqualified('FIVE_LEVEL_FIELDS_INCOMPLETE');
  const bid=p.bid_price.map(Number),ask=p.ask_price.map(Number);
  if([...bid,...ask].some(price=>!onTick(price,tick)))
    return unqualified('OFF_TICK_BOOK');
  for(let i=1;i<5;i++){
    if(bid[i]>=bid[i-1]||ask[i]<=ask[i-1])
      return unqualified('BOOK_LEVEL_ORDER_INVALID');
  }
  const gap=ask[0]-bid[0],ticks=gap/tick;
  if(!(gap>0)||!onTick(gap,tick))return unqualified('CROSSED_OR_OFF_TICK_BOOK');
  const bidDepth5=p.bid_volume.map(Number).reduce((a,b)=>a+b,0);
  const askDepth5=p.ask_volume.map(Number).reduce((a,b)=>a+b,0);
  const total=bidDepth5+askDepth5;
  if(!Number.isSafeInteger(bidDepth5)||!Number.isSafeInteger(askDepth5)
      ||!Number.isSafeInteger(total)||total===0)
    return unqualified('DEPTH_DENOMINATOR_INVALID');
  return Object.freeze({
    schemaVersion:'microstructure-l5-research-v1',
    state:'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED',reason:null,
    actualContract,tradeDate,session,sessionId:classified.sessionId,
    governedCalendarHash:classified.governedCalendarHash,
    sourceTime:record.exchangeTimestamp,availableAt:record.receivedAt,
    sourceEventId:typeof record.eventId==='string'?record.eventId:null,
    sourceRecordHash:typeof record.recordHash==='string'?record.recordHash:null,
    sequenceAvailable:Number.isSafeInteger(record.sequence),
    spreadTicks:Math.round(ticks),
    bidDepth1:Number(p.bid_volume[0]),askDepth1:Number(p.ask_volume[0]),
    bidDepth5,askDepth5,imbalance5:(bidDepth5-askDepth5)/total,
    recommendation:false,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}

export function freezeOutcomeCandidate({
  eventId,observationKind,actualContract,tradeDate,session,
  eventExchangeTimestamp,asOfAvailableAt,lastSourceAvailableAt,
  referencePrice,frozenRuleHash,calendar,
}={}) {
  const asOf=evidenceTimestampNs(asOfAvailableAt);
  const source=evidenceTimestampNs(lastSourceAvailableAt);
  const exchange=evidenceTimestampNs(eventExchangeTimestamp,{taipeiNaive:true});
  const classified=governedEventIdentity({
    exchangeTimestamp:eventExchangeTimestamp,calendar,tradeDate,session,
  });
  const price=numericScalar(referencePrice,{positive:true});
  if(typeof eventId!=='string'||!/^[A-Za-z0-9._:-]{8,120}$/.test(eventId)
      ||!['FLOW_RESPONSE','NO_CHASE_LIQUIDITY','MARKET_STATE'].includes(observationKind)
      ||typeof actualContract!=='string'||!/^TX[A-Z0-9]{2,12}$/.test(actualContract)
      ||!classified||asOf===null||source===null||exchange===null
      ||source>asOf||exchange>source||price===null
      ||typeof frozenRuleHash!=='string'||!/^[a-f0-9]{64}$/i.test(frozenRuleHash))
    return Object.freeze({state:'UNAVAILABLE',reason:'EVENT_AS_OF_OR_RULES_INVALID',
      researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false});
  return Object.freeze({
    schemaVersion:'research-outcome-candidate-v1',eventId,observationKind,
    actualContract,tradeDate,session,sessionId:classified.sessionId,
    governedCalendarHash:classified.governedCalendarHash,
    eventExchangeTimestamp,asOfAvailableAt,lastSourceAvailableAt,
    referencePrice:price,frozenRuleHash,
    outcomeStatus:'PENDING',mfe:null,mae:null,timeToMfe:null,timeToMae:null,
    netPoints:null,netR:null,ev:null,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}
