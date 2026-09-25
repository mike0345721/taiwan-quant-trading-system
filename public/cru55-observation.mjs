// Presentation only: retain accepted numbers, identity and source eligibility.
import {windowPresentation,signed,fmt} from './cru55-presentation.mjs';
const finite=x=>Number.isFinite(x)?x:null;
const stamp=x=>typeof x==='string'&&x.trim()?finite(Date.parse(x)):null;
export function observationV1(data,frame,now=Date.now()) {
  const p=data?.chart,c=data?.context,r=data?.relationship,o=r?.current;
  const sourceTime=stamp(o?.anchorEventTime),availableAt=stamp(p?.lastTradeAvailableAt);
  const sourceAge=sourceTime===null?null:now-sourceTime,availableAge=availableAt===null?null:now-availableAt;
  const latencyMs=sourceAge===null||availableAge===null?null:Math.max(sourceAge,availableAge);
  const invalidClock=latencyMs===null||sourceAge<0||availableAge<0||availableAt<sourceTime;
  const missing=!p||!c||c.scope==='UNAVAILABLE'||finite(c.cumulativeCvd)===null||p.freshness?.state==='UNAVAILABLE';
  const pinned=p?.sourceMode?.startsWith('PINNED')||data?.publication?.scope==='VERIFIED_HISTORICAL_CUTOFF';
  const liveEligible=data?.kind==='GOVERNED_FRAGMENT'&&!pinned&&p?.freshness?.state==='LIVE'&&p?.quality==='READY'&&c?.evidence?.quality?.status==='READY';
  let state='UNAVAILABLE';
  if(!missing&&!invalidClock)state=latencyMs>60000?'STALE':latencyMs>30000?'DELAYED':latencyMs>10000?'DEGRADED':liveEligible?'LIVE':'HISTORICAL';
  // Never promote an explicit upstream failure/stale state because of a fresh clock.
  if(state!=='UNAVAILABLE'&&p?.freshness?.state==='STALE')state='STALE';
  if(['LIVE','HISTORICAL','DEGRADED'].includes(state)&&p?.freshness?.state==='DELAYED')state='DELAYED';
  const window=windowPresentation(data?.scan?.[frame]);
  return {state,latencyMs:invalidClock?null:latencyMs,sourceTime,availableAt,
    reason:missing?'CVD_EVIDENCE_UNAVAILABLE':invalidClock?'TIME_LINEAGE_UNKNOWN_OR_INVALID':liveEligible?'SOURCE_ELIGIBLE':'OBSERVATION_ONLY_NOT_LIVE',
    cumulativeCvd:finite(c?.cumulativeCvd),deltaCvd:finite(o?.current?.deltaCvd),window,
    scope:c?.scope??'UNAVAILABLE',session:p?.session??'UNKNOWN',tradeDate:p?.tradeDate??'UNKNOWN',actualContract:p?.actualContract??'UNKNOWN',
    origin:finite(c?.origin?.eventTimeMs),cutoff:p?.cutoff?.ledgerOrdinal??null,
    cutoffAvailableAt:stamp(p?.availableAt),quality:p?.quality??'UNKNOWN',windowQuality:o?.current?.quality?.status??'UNKNOWN',
    coverage:finite(c?.evidence?.pressure?.classifiedCoverage),continuityEpoch:p?.continuityEpoch??'UNKNOWN',captureCompleteness:c?.captureCompleteness??'UNKNOWN'};
}
const time=x=>x===null?'UNKNOWN':new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
export function renderObservation(host,data,frame,now=Date.now()) {
  const m=observationV1(data,frame,now),doc=host.ownerDocument;
  host.dataset.state=m.state;
  const rows=[
    ['CVD Observation V1',m.state],
    [m.scope==='SESSION_TO_NOW'?'本盤累積 CVD':'觀測累積 CVD（非完整盤別）',signed(m.cumulativeCvd)],
    [frame+' ΔCVD',signed(m.deltaCvd)+' · '+m.window.state],
    ['Price ↔ CVD / Pressure',m.window.label+' · '+m.window.code],
    ['Session / tradeDate / actualContract',m.session+' / '+m.tradeDate+' / '+m.actualContract],
    ['Accumulation origin',time(m.origin)+' · '+m.scope],
    ['Cutoff / availableAt','#'+(m.cutoff??'UNKNOWN')+' / '+time(m.cutoffAvailableAt)],
    ['Source time / trade availableAt',time(m.sourceTime)+' / '+time(m.availableAt)],
    ['觀測延遲（目前 − 最舊來源時鐘）',m.latencyMs===null?'UNKNOWN':fmt(m.latencyMs/1000)+' s'],
    ['Coverage / quality', (m.coverage===null?'UNKNOWN':fmt(m.coverage*100)+'%')+' / '+m.quality+' · window '+m.windowQuality],
    ['Continuity epoch / capture',m.continuityEpoch+' / '+m.captureCompleteness]
  ];
  const nodes=rows.map(([label,value])=>{const el=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=value;el.append(dt,dd);return el;});
  host.replaceChildren(...nodes);return m;
}
