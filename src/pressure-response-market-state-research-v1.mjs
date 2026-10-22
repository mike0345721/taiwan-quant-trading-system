// Frozen-as-of RESEARCH candidates only. No buy/sell execution signals.
import {createHash} from 'node:crypto';
import {numericScalar,evidenceTimestampMs,governedEventIdentity}
  from './research-evidence-contract-v1.mjs';

const RULE_KEYS=Object.freeze([
 'strongPressureMin','weakPressureMax','moveMinPoints','flatMaxPoints',
 'highEfficiencyMin','trendEfficiencyMin','rangeEfficiencyMax',
 'maxChaseSpreadTicks','minDepth5','maxAgeMs','maxRealizedVolPoints',
]);
const fail=(reason)=>Object.freeze({state:'UNAVAILABLE',reason,
  recommendation:false,formalWeight:0,researchOnly:true,
  executionAuthorized:false,orderRoutesEnabled:false});
const hashBody=body=>createHash('sha256')
  .update('research-scenario-thresholds-v1\n'+JSON.stringify(body)).digest('hex');

export function sealResearchThresholds(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)
      ||Object.keys(input).length!==RULE_KEYS.length
      ||Object.keys(input).some(k=>!RULE_KEYS.includes(k)))return null;
  const n=Object.fromEntries(RULE_KEYS.map(k=>[k,
    numericScalar(input[k],{positive:k!=='weakPressureMax'&&k!=='flatMaxPoints'&&k!=='rangeEfficiencyMax',
      nonNegative:true,integer:['maxChaseSpreadTicks','minDepth5','maxAgeMs'].includes(k)})]));
  if(Object.values(n).some(x=>x===null))return null;
  if(!(n.weakPressureMax<n.strongPressureMin&&n.strongPressureMin<=1
      &&n.flatMaxPoints<n.moveMinPoints
      &&n.highEfficiencyMin<=1&&n.rangeEfficiencyMax<n.trendEfficiencyMin
      &&n.trendEfficiencyMin<=1
      &&n.minDepth5>=1&&n.maxAgeMs<=600_000))return null;
  const sha256=hashBody(n);
  return Object.freeze({schemaVersion:'research-scenario-thresholds-v1',...n,sha256,
    calibrated:false,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false});
}

function validEvent(event,rules,calendar,kind) {
  if(event?.schemaVersion!=='research-outcome-candidate-v1'
      ||event.outcomeStatus!=='PENDING'||event.observationKind!==kind
      ||event.executionAuthorized!==false||event.orderRoutesEnabled!==false
      ||!rules||rules.schemaVersion!=='research-scenario-thresholds-v1'
      ||rules.sha256!==event.frozenRuleHash
      ||!Object.isFrozen(rules)||!Object.isFrozen(event))return null;
  const numeric=Object.fromEntries(RULE_KEYS.map(k=>[k,rules[k]]));
  if(hashBody(numeric)!==rules.sha256)return null;
  const classification=governedEventIdentity({
    exchangeTimestamp:event.eventExchangeTimestamp,
    calendar,tradeDate:event.tradeDate,session:event.session,
  });
  if(!classification||classification.sessionId!==event.sessionId
      ||classification.governedCalendarHash!==event.governedCalendarHash)return null;
  return evidenceTimestampMs(event.asOfAvailableAt);
}
function validSource(source,event,asOf,calendar,maxAgeMs) {
  if(!source||source.status!=='READY'
      ||source.actualContract!==event.actualContract
      ||source.tradeDate!==event.tradeDate||source.session!==event.session)return false;
  const classification=governedEventIdentity({
    exchangeTimestamp:source.exchangeTimestamp,calendar,
    tradeDate:event.tradeDate,session:event.session,
  });
  if(!classification||classification.sessionId!==event.sessionId)return false;
  const time=evidenceTimestampMs(source.availableAt);
  const exchange=evidenceTimestampMs(source.exchangeTimestamp,{taipeiNaive:true});
  return time!==null && exchange!==null && time<=asOf
    && asOf-time<=maxAgeMs && Math.abs(time-exchange)<=maxAgeMs;
}

export function describeFlowPriceResponse({
  event,rules,calendar,pressure,response,
}={}) {
  const asOf=validEvent(event,rules,calendar,'FLOW_RESPONSE');
  if(asOf===null)return fail('EVENT_RULES_OR_GOVERNANCE_INVALID');
  if(!validSource(pressure,event,asOf,calendar,rules.maxAgeMs)
      ||!validSource(response,event,asOf,calendar,rules.maxAgeMs))
    return fail('FLOW_OR_RESPONSE_UNAVAILABLE_AS_OF');
  const ratio=numericScalar(pressure.pressureRatio),
    coverage=numericScalar(pressure.classifiedCoverage),
    displacement=numericScalar(response.displacementPoints),
    efficiency=numericScalar(response.pathEfficiency);
  if(ratio===null||Math.abs(ratio)>1||coverage!==1
      ||displacement===null||efficiency===null||efficiency<0||efficiency>1)
    return fail('FLOW_RESPONSE_FIELDS_UNQUALIFIED');
  let label='UNCERTAIN';
  const oriented=ratio===0?0:Math.sign(ratio);
  if(Math.abs(ratio)>=rules.strongPressureMin){
    if(displacement*oriented>=rules.moveMinPoints)label=oriented>0
      ?'BUY_PROGRESS_CANDIDATE':'SELL_PROGRESS_CANDIDATE';
    else if(Math.abs(displacement)<=rules.flatMaxPoints)label=oriented>0
      ?'BUY_PRESSURE_BLOCKED_CANDIDATE':'SELL_PRESSURE_BLOCKED_CANDIDATE';
    else if(displacement*oriented<=-rules.moveMinPoints)label='PRESSURE_PRICE_MISMATCH_CANDIDATE';
  }else if(Math.abs(ratio)<=rules.weakPressureMax
      && Math.abs(displacement)>=rules.moveMinPoints
      && efficiency>=rules.highEfficiencyMin){
    label=displacement>0?'LOW_PRESSURE_UPMOVE_CANDIDATE':'LOW_PRESSURE_DOWNMOVE_CANDIDATE';
  }
  return Object.freeze({
    state:'DESCRIPTIVE_ONLY_NOT_VALIDATED',label,
    observedPressureRatio:ratio,observedDisplacementPoints:displacement,
    observedPathEfficiency:efficiency,
    asOfAvailableAt:event.asOfAvailableAt,sourceQuality:'READY_AS_OF',
    outcomeStatus:'PENDING',recommendation:false,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}

export function describeMarketStateNoTrade({
  event,rules,calendar,market,quote,
}={}) {
  const asOf=validEvent(event,rules,calendar,'MARKET_STATE');
  if(asOf===null)return fail('EVENT_RULES_OR_GOVERNANCE_INVALID');
  if(!validSource(market,event,asOf,calendar,rules.maxAgeMs))
    return fail('MARKET_STATE_INPUT_NOT_KNOWN_AS_OF');
  const eff=numericScalar(market.pathEfficiency),
    volatility=numericScalar(market.realizedVolPoints);
  if(eff===null||eff<0||eff>1||volatility===null||volatility<0)
    return fail('MARKET_STATE_FIELDS_UNQUALIFIED');
  if(quote?.state!=='FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED'
      ||quote.actualContract!==event.actualContract
      ||quote.tradeDate!==event.tradeDate
      ||quote.session!==event.session||quote.sessionId!==event.sessionId
      ||quote.governedCalendarHash!==event.governedCalendarHash)
    return fail('LIQUIDITY_QUOTE_UNQUALIFIED');
  const quoteTime=evidenceTimestampMs(quote.availableAt);
  if(quoteTime===null||quoteTime>asOf||asOf-quoteTime>rules.maxAgeMs)
    return fail('LIQUIDITY_QUOTE_NOT_KNOWN_AS_OF');
  const spread=numericScalar(quote.spreadTicks,{integer:true,positive:true});
  const bid=numericScalar(quote.bidDepth5,{integer:true,nonNegative:true});
  const ask=numericScalar(quote.askDepth5,{integer:true,nonNegative:true});
  if(spread===null||bid===null||ask===null)
    return fail('LIQUIDITY_FIELDS_INVALID');
  const state=eff>=rules.trendEfficiencyMin?'TREND_CANDIDATE'
    :eff<=rules.rangeEfficiencyMax?'RANGE_CANDIDATE':'UNCERTAIN';
  const noChase=spread>rules.maxChaseSpreadTicks
    ||Math.min(bid,ask)<rules.minDepth5;
  const highVol=volatility>rules.maxRealizedVolPoints;
  return Object.freeze({
    state:'DESCRIPTIVE_ONLY_NOT_VALIDATED',
    marketState:state,
    noTradeCandidate:noChase?'NO_CHASE_LIQUIDITY_CANDIDATE':
      highVol?'HIGH_VOLATILITY_SKIP_CANDIDATE':'NONE_PROPOSED',
    observedSpreadTicks:spread,observedBidDepth5:bid,
    observedAskDepth5:ask,observedPathEfficiency:eff,
    observedRealizedVolPoints:volatility,
    asOfAvailableAt:event.asOfAvailableAt,
    outcomeStatus:'PENDING',recommendation:false,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}
