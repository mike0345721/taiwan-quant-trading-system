import { createHash } from 'node:crypto';

// Price geometry only. Confirmation and lifecycle records never rewrite anchors.
export const MARKET_STRUCTURE_VERSION = 'cru61-market-structure-v1';
const SAFETY = Object.freeze({ researchOnly: true, formalWeight: 0, executionAuthorized: false, orderRoutesEnabled: false });
const WIDTHS = Object.freeze({ '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000 });
const KEYS = ['actualContract', 'tradeDate', 'session', 'continuityEpoch', 'sourceLedgerIdentity'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
const timestamp = x => typeof x === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const key = x => JSON.stringify(KEYS.map(k => x?.[k]));
const fail = code => { throw new Error(code); };
function identity(value) {
  if (!value || !KEYS.every(k => value[k] !== null && value[k] !== undefined && value[k] !== '')
      || !['DAY','NIGHT'].includes(value.session) || !/^\d{4}-\d{2}-\d{2}$/.test(value.tradeDate)
      || !/^sha256:[a-f0-9]{64}$/.test(value.sourceLedgerIdentity)) fail('SMC_IDENTITY_REQUIRED');
  return Object.fromEntries(KEYS.map(k => [k, value[k]]));
}

export function createMarketStructureState({ identity: input, timeframe = '1m', left = 2, right = 2, obLookback = 12, maxBars = 20000 } = {}) {
  if (!WIDTHS[timeframe] || !Number.isSafeInteger(left) || left < 1 || left > 10 || !Number.isSafeInteger(right) || right < 1 || right > 10
      || !Number.isSafeInteger(obLookback) || obLookback < 1 || obLookback > 100
      || !Number.isSafeInteger(maxBars) || maxBars < 1 || maxBars > 20000) fail('SMC_PARAMETERS_INVALID');
  return { schemaVersion: MARKET_STRUCTURE_VERSION, identity: identity(input), timeframe, left, right, obLookback, maxBars,
    bars: [], events: [], zones: [], lastHigh: null, lastLow: null, trend: 'UNDETERMINED', activeBreaks: [], segmentStart: 0, ...SAFETY };
}
function validate(state) {
  if (state?.schemaVersion !== MARKET_STRUCTURE_VERSION || !Array.isArray(state.bars) || state.bars.length > state.maxBars
      || !Array.isArray(state.events) || !Array.isArray(state.zones) || !Array.isArray(state.activeBreaks)
      || !WIDTHS[state.timeframe] || Object.entries(SAFETY).some(([k,v]) => state[k] !== v)) fail('SMC_STATE_INVALID');
  identity(state.identity);
}
function emit(state, type, bar, values = {}) {
  const record = { type, anchorTime: values.anchorTime ?? bar.time, confirmedTime: bar.endTime, availableAt: bar.availableAt,
    barIndex: state.bars.length - 1, identity: structuredClone(state.identity), timeframe: state.timeframe, ...values };
  record.id = createHash('sha256').update(JSON.stringify([key(state.identity),state.timeframe,type,record.anchorTime,
    record.confirmedTime,record.level ?? null,record.zoneId ?? null,record.pivotId ?? null])).digest('hex').slice(0,24);
  state.events.push(record);
  if (state.events.length > state.maxBars * 16) fail('SMC_EVENT_BUDGET');
  return record;
}
function addZone(state, type, direction, low, high, anchor, bar, extra = {}) {
  if (state.zones.length >= 256) fail('SMC_ACTIVE_ZONE_BUDGET');
  const event = emit(state, type, bar, { direction, lower: low, upper: high, anchorTime: anchor.time, ...extra });
  state.zones.push({ id: event.id, type, direction, lower: low, upper: high, anchorTime: anchor.time,
    confirmedTime: bar.endTime, availableAt: bar.availableAt, status: 'ACTIVE' });
}
function endZone(state, zone, bar, status, reason) {
  emit(state, 'ZONE_' + status, bar, { zoneId: zone.id, direction: zone.direction, lower: zone.lower, upper: zone.upper,
    anchorTime: zone.anchorTime, reason });
  zone.status = status;
}
function processBar(state, bar) {
  const index = state.bars.length - 1, previous = state.bars[index-1];
  if (previous && timestamp(bar.time) !== timestamp(previous.endTime)) {
    for (const zone of state.zones) if (zone.status === 'ACTIVE') endZone(state, zone, bar, 'UNAVAILABLE', 'BAR_CONTINUITY_GAP');
    for (const active of state.activeBreaks) emit(state,'BREAK_UNAVAILABLE',bar,{breakId:active.id,level:active.level,direction:active.direction,reason:'BAR_CONTINUITY_GAP'});
    emit(state, 'STRUCTURE_RESET', bar, { reason: 'BAR_CONTINUITY_GAP' });
    state.lastHigh = null; state.lastLow = null; state.trend = 'UNDETERMINED'; state.activeBreaks = []; state.segmentStart = index;
  }
  for (const zone of state.zones) {
    if (zone.status !== 'ACTIVE') continue;
    const invalid = zone.direction === 'UP' ? bar.close < zone.lower : bar.close > zone.upper;
    const filled = zone.type === 'FVG' && (zone.direction === 'UP' ? bar.low <= zone.lower : bar.high >= zone.upper);
    if (invalid) endZone(state, zone, bar, 'INVALIDATED', 'CLOSE_BEYOND_FAR_EDGE');
    else if (filled) endZone(state, zone, bar, 'FILLED', 'WICK_REACHED_FAR_EDGE');
  }
  // Terminal zones live in the append-only event history, not the active scan.
  state.zones = state.zones.filter(zone => zone.status === 'ACTIVE');
  state.activeBreaks = state.activeBreaks.filter(active => {
    const failed = active.direction === 'UP' ? bar.close < active.level : bar.close > active.level;
    if (failed) emit(state, 'BREAK_FAILED', bar, { breakId: active.id, direction: active.direction, level: active.level,
      anchorTime: active.anchorTime, reason: 'CLOSE_RECLAIMED_BROKEN_LEVEL' });
    return !failed;
  });
  const pivotIndex = index - state.right;
  if (pivotIndex - state.left >= state.segmentStart) {
    const candidate = state.bars[pivotIndex];
    const neighbors = state.bars.slice(pivotIndex-state.left,pivotIndex).concat(state.bars.slice(pivotIndex+1,index+1));
    for (const [type, field, compare] of [['SWING_HIGH','high',(a,b)=>a>b],['SWING_LOW','low',(a,b)=>a<b]]) {
      if (!neighbors.every(other => compare(candidate[field],other[field]))) continue;
      const event = emit(state,type,bar,{anchorTime:candidate.time,level:candidate[field],confirmationBars:state.right});
      state[type === 'SWING_HIGH' ? 'lastHigh' : 'lastLow'] = { ...event, broken: false };
    }
  }
  for (const [field, direction] of [['lastHigh','UP'],['lastLow','DOWN']]) {
    const pivot = state[field];
    if (!pivot || pivot.broken) continue;
    const broken = direction === 'UP' ? bar.close > pivot.level : bar.close < pivot.level;
    const swept = direction === 'UP' ? bar.high > pivot.level && bar.close <= pivot.level : bar.low < pivot.level && bar.close >= pivot.level;
    if (broken) {
      const type = state.trend !== 'UNDETERMINED' && state.trend !== direction ? 'CHOCH' : 'BOS';
      const event = emit(state,type,bar,{direction,level:pivot.level,pivotId:pivot.id,anchorTime:pivot.anchorTime,
        previousStructure:state.trend,structure:direction,rule:'CLOSED_BAR_STRICT_BREAK'});
      if (state.activeBreaks.length >= 256) fail('SMC_ACTIVE_BREAK_BUDGET');
      state.trend = direction; pivot.broken = true; state.activeBreaks.push(event);
      const lower = Math.max(state.segmentStart,index-state.obLookback);
      for (let j=index-1;j>=lower;j--) {
        const other=state.bars[j], opposite=direction==='UP'?other.close<other.open:other.close>other.open;
        if (opposite) { addZone(state,'ORDER_BLOCK',direction,other.low,other.high,other,bar,{breakId:event.id}); break; }
      }
    } else if (swept) emit(state,direction==='UP'?'SWEEP_HIGH':'SWEEP_LOW',bar,{direction:direction==='UP'?'DOWN':'UP',
      level:pivot.level,pivotId:pivot.id,anchorTime:bar.time,pivotAnchorTime:pivot.anchorTime,rule:'WICK_BEYOND_CLOSE_RECLAIM'});
  }
  if (index-state.segmentStart >= 2) {
    const first = state.bars[index-2];
    if (bar.low > first.high) addZone(state,'FVG','UP',first.high,bar.low,first,bar,{rule:'THREE_CLOSED_BARS_STRICT_WICK_GAP'});
    if (bar.high < first.low) addZone(state,'FVG','DOWN',bar.high,first.low,first,bar,{rule:'THREE_CLOSED_BARS_STRICT_WICK_GAP'});
  }
}

export function appendMarketStructureBars(before, bars, { cutoff } = {}) {
  validate(before);
  const cutoffMs = cutoff === undefined ? Infinity : timestamp(cutoff);
  if (!Array.isArray(bars) || bars.length > 20000 || before.bars.length + bars.length > before.maxBars || cutoffMs === null) fail('SMC_INPUT_BUDGET_OR_CUTOFF');
  const state = structuredClone(before);
  for (const raw of bars) {
    const barIdentity = raw?.identity || raw;
    if (key(barIdentity) !== key(state.identity)) fail('SMC_IDENTITY_MISMATCH');
    const start=timestamp(raw.time),end=timestamp(raw.endTime),available=timestamp(raw.availableAt);
    if (raw.closed !== true || ![raw.open,raw.high,raw.low,raw.close].every(v=>finite(v)&&v>0)
        || raw.high < Math.max(raw.open,raw.close,raw.low) || raw.low > Math.min(raw.open,raw.close,raw.high)
        || start===null || end===null || available===null || end-start!==WIDTHS[state.timeframe] || available<end || available>cutoffMs) fail('SMC_BAR_INELIGIBLE');
    const previous=state.bars.at(-1);
    if (previous && (start < timestamp(previous.endTime) || available < timestamp(previous.availableAt))) fail('SMC_BAR_ORDER_INVALID');
    const bar={time:raw.time,endTime:raw.endTime,availableAt:raw.availableAt,open:raw.open,high:raw.high,low:raw.low,close:raw.close};
    state.bars.push(bar); processBar(state,bar);
  }
  return state;
}

export function marketStructureSnapshot(state, { cutoff = state?.bars?.at(-1)?.availableAt ?? null } = {}) {
  validate(state);
  const at=cutoff===null?null:timestamp(cutoff);
  if (cutoff!==null && at===null) fail('SMC_CUTOFF_INVALID');
  const events=state.events.filter(event=>at!==null&&timestamp(event.availableAt)<=at&&timestamp(event.confirmedTime)<=at);
  const bars=state.bars.filter(bar=>at!==null&&timestamp(bar.availableAt)<=at&&timestamp(bar.endTime)<=at);
  const zones=[],zoneById=new Map();
  let structure='UNDETERMINED';
  for(const event of events){
    if(event.type==='BOS'||event.type==='CHOCH')structure=event.direction;
    if(event.type==='STRUCTURE_RESET')structure='UNDETERMINED';
    if(event.type==='FVG'||event.type==='ORDER_BLOCK'){
      const zone={id:event.id,type:event.type,direction:event.direction,lower:event.lower,upper:event.upper,
        anchorTime:event.anchorTime,confirmedTime:event.confirmedTime,availableAt:event.availableAt,
        status:'ACTIVE',invalidatedAt:null,filledAt:null,unavailableAt:null};
      zones.push(zone);zoneById.set(zone.id,zone);
    }
    if(event.type.startsWith('ZONE_')){
      const zone=zoneById.get(event.zoneId);
      if(zone){zone.status=event.type.slice(5);zone[zone.status==='FILLED'?'filledAt':zone.status==='UNAVAILABLE'?'unavailableAt':'invalidatedAt']=event.availableAt;}
    }
  }
  return {schemaVersion:MARKET_STRUCTURE_VERSION,identity:structuredClone(state.identity),timeframe:state.timeframe,cutoff,
    state:bars.length?'OBSERVATION_CANDIDATE':'UNAVAILABLE',structure,closedBarCount:bars.length,
    observedStart:bars[0]?.time??null,observedEnd:bars.at(-1)?.endTime??null,availableAt:bars.at(-1)?.availableAt??null,
    parameters:{left:state.left,right:state.right,obLookback:state.obLookback,break:'STRICT_CLOSE',pivotTie:'NO_PIVOT',
      fvgInvalidation:'CLOSE_BEYOND_FAR_EDGE',fvgFill:'WICK_REACHED_FAR_EDGE',orderBlockInvalidation:'CLOSE_BEYOND_FAR_EDGE'},
    events:events.map(event=>({...structuredClone(event),confirmedAt:event.confirmedTime,price:event.level??null})),
    zones:zones.map(zone=>({...zone,kind:zone.type,low:zone.lower,high:zone.upper,confirmedAt:zone.confirmedTime})),
    limitations:['PRICE_GEOMETRY_NOT_INSTITUTION_IDENTITY','FVG_DOES_NOT_PROVE_NO_TRADES','ORDER_BLOCK_DOES_NOT_PROVE_RESTING_ORDERS',
      'SWEEP_DOES_NOT_MEASURE_STOP_VOLUME','CONFIRMATION_DELAY_EXPLICIT','CAPTURE_COMPLETENESS_UNPROVEN'],...SAFETY};
}
