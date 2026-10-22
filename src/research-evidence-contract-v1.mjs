// Strict evidence parsing shared by research-only observables.
// Naive *exchange* timestamps are Taiwan-local; receipt/as-of must be zoned.
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';

export function numericScalar(value, {integer=false, nonNegative=false, positive=false}={}) {
  const primitive = typeof value==='number'
    ? value : typeof value==='string' && value===value.trim()
      && /^[+-]?(?:\d+)(?:\.\d+)?$/.test(value) ? Number(value) : null;
  if (primitive===null || !Number.isFinite(primitive) || (integer && !Number.isSafeInteger(primitive))
      || (nonNegative && primitive<0) || (positive && primitive<=0)) return null;
  return primitive;
}
export function validCalendarDate(value) {
  if (typeof value!=='string'|| !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function evidenceTimestampMs(value,{taipeiNaive=false}={}) {
  if(typeof value!=='string'||value!==value.trim())return null;
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/i.exec(value);
  if(!m || !validCalendarDate(m[1]))return null;
  const hh=Number(m[2]),mm=Number(m[3]),ss=Number(m[4]);
  if(hh>23||mm>59||ss>59)return null;
  const zone=m[6];
  if(!zone && !taipeiNaive)return null;
  if(zone && zone.toUpperCase()!=='Z'){
    const zh=Number(zone.slice(1,3)),zm=Number(zone.slice(4,6));
    if(zh>14||zm>59||(zh===14&&zm!==0))return null;
  }
  const iso=value.replace(/\.\d{1,9}/,(s)=>'.'+s.slice(1).padEnd(3,'0').slice(0,3))
    +(zone?'':'+08:00');
  const parsed=Date.parse(iso);
  if(!Number.isFinite(parsed))return null;
  // Do not trust Date.parse's normalization of an impossible clock/calendar tuple.
  return parsed;
}
export function governedEventIdentity({exchangeTimestamp,calendar,tradeDate,session}={}) {
  const ms=evidenceTimestampMs(exchangeTimestamp,{taipeiNaive:true});
  if(ms===null||!calendar||typeof tradeDate!=='string'||typeof session!=='string'
      ||!validCalendarDate(tradeDate))return null;
  try {
    const x=classifyTxChartSession(new Date(ms).toISOString(),calendar);
    if(x.tradeDate!==tradeDate||x.session!==session)return null;
    return Object.freeze({tradeDate,session,sessionId:x.sessionId,
      governedCalendarHash:typeof calendar.fileHash==='string'?calendar.fileHash:null});
  }catch{return null;}
}
