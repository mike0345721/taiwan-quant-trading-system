// Research-only projections. Never mutate immutable ledger records or trade.
const invalid = (reason) => Object.freeze({
  schemaVersion: 'microstructure-l5-research-v1', state: 'UNAVAILABLE', reason,
  spreadTicks: null, bidDepth1: null, askDepth1: null, bidDepth5: null,
  askDepth5: null, imbalance5: null, sourceTime: null, availableAt: null,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
  orderRoutesEnabled: false,
});
const finite = value => value === null || value === undefined || value === ''
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const stamp = s => typeof s === 'string' && s.trim() && Number.isFinite(Date.parse(s))
  ? Date.parse(s) : null;
const validTradeDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
};
const five = (array, positive) => Array.isArray(array) && array.length === 5
  && array.every(x => { const n=finite(x); return n !== null && (positive ? n>0 : n>=0); });

export function projectGovernedL5(record, {
  asOfAvailableAt, actualContract, tradeDate, session, tickSize,
} = {}) {
  if (record?.kind !== 'futures_bidask'
      || record.executionAuthorized !== false || record.orderRoutesEnabled !== false)
    return invalid('SOURCE_CONTRACT_UNVERIFIED');
  const p = record.payload;
  if (p?.productFamily !== 'TX' || p?.actualContract !== actualContract
      || !actualContract || !validTradeDate(tradeDate)
      || !['DAY','NIGHT'].includes(session)) return invalid('IDENTITY_UNVERIFIED');
  if (p.simtrade === true || record.duplicate === true || record.sequenceGap === true)
    return invalid('SIMULATED_DUPLICATE_OR_SEQUENCE_GAP');
  const asOf = stamp(asOfAvailableAt), received = stamp(record.receivedAt),
    source = stamp(record.exchangeTimestamp);
  if (asOf === null || received === null || source === null
      || received > asOf || source > asOf || source > received + 5_000)
    return invalid('SOURCE_TIME_NOT_KNOWN_AS_OF');
  const skew=finite(record.clockSkewMs);
  if (skew === null || Math.abs(skew)>5_000) return invalid('SOURCE_CLOCK_UNVERIFIED');
  const tick=finite(tickSize);
  if (tick === null || tick<=0) return invalid('TICK_SIZE_UNVERIFIED');
  if (!five(p.bid_price,true)||!five(p.ask_price,true)
      ||!five(p.bid_volume,false)||!five(p.ask_volume,false))
    return invalid('FIVE_LEVEL_FIELDS_INCOMPLETE');
  const bid=p.bid_price.map(Number),ask=p.ask_price.map(Number);
  for(let i=1;i<5;i++){
    if(bid[i]>=bid[i-1]||ask[i]<=ask[i-1]) return invalid('BOOK_LEVEL_ORDER_INVALID');
  }
  const gap=ask[0]-bid[0],ticks=gap/tick;
  if(!(gap>0)||Math.abs(ticks-Math.round(ticks))>1e-6)
    return invalid('CROSSED_OR_OFF_TICK_BOOK');
  const bidDepth5=p.bid_volume.map(Number).reduce((a,b)=>a+b,0);
  const askDepth5=p.ask_volume.map(Number).reduce((a,b)=>a+b,0);
  const total=bidDepth5+askDepth5;
  if(total===0) return invalid('DEPTH_DENOMINATOR_ZERO');
  return Object.freeze({
    schemaVersion: 'microstructure-l5-research-v1',state:'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED',reason:null,
    actualContract,tradeDate,session,sourceTime:record.exchangeTimestamp,availableAt:record.receivedAt,
    sourceEventId:record.eventId||null,sourceRecordHash:record.recordHash||null,
    sequenceAvailable:record.sequence!==null&&record.sequence!==undefined,
    spreadTicks:Math.round(ticks),bidDepth1:Number(p.bid_volume[0]),askDepth1:Number(p.ask_volume[0]),
    bidDepth5,askDepth5,imbalance5:(bidDepth5-askDepth5)/total,
    // Depth is liquidity evidence, not a long/short recommendation.
    recommendation:false,formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false,
  });
}

export function freezeOutcomeCandidate({
  eventId, observationKind, actualContract, tradeDate, session,
  asOfAvailableAt, lastSourceAvailableAt, referencePrice, frozenRuleHash,
} = {}) {
  const asOf=stamp(asOfAvailableAt), source=stamp(lastSourceAvailableAt);
  if(!/^[A-Za-z0-9._:-]{8,120}$/.test(eventId||'')
      ||!['FLOW_RESPONSE','NO_CHASE_LIQUIDITY','MARKET_STATE'].includes(observationKind)
      ||!actualContract||!validTradeDate(tradeDate)
      ||!['DAY','NIGHT'].includes(session)
      ||asOf===null||source===null||source>asOf
      ||finite(referencePrice)===null||finite(referencePrice)<=0
      ||!(/^[a-f0-9]{64}$/i.test(frozenRuleHash||'')))
    return Object.freeze({state:'UNAVAILABLE',reason:'EVENT_AS_OF_OR_RULES_INVALID',researchOnly:true,executionAuthorized:false});
  return Object.freeze({
    schemaVersion:'research-outcome-candidate-v1',eventId,observationKind,
    actualContract,tradeDate,session,asOfAvailableAt,lastSourceAvailableAt,
    referencePrice:Number(referencePrice),frozenRuleHash,
    // A future outcome is written separately after the event; never mixed into the as-of feature record.
    outcomeStatus:'PENDING',mfe:null,mae:null,timeToMfe:null,timeToMae:null,
    netPoints:null,netR:null,ev:null,formalWeight:0,researchOnly:true,
    executionAuthorized:false,orderRoutesEnabled:false,
  });
}
