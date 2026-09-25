// Presentation only: retain accepted numbers, identity and source eligibility.
import {windowPresentation,signed,fmt} from './cru55-presentation.mjs';
const finite=x=>Number.isFinite(x)?x:null;
const stamp=x=>typeof x==='string'&&x.trim()?finite(Date.parse(x)):null;
export const observationStateLabel=state=>({LIVE:'即時',HISTORICAL:'歷史觀測',DEGRADED:'資料稍舊',DELAYED:'資料延遲',STALE:'資料過期',UNAVAILABLE:'不可用',AVAILABLE:'可用',PARTIAL:'部分窗口',WARMING:'暖機中'})[state]||'未知';
export const observationReasonLabel=reason=>({
  CVD_EVIDENCE_UNAVAILABLE:'缺少可用的 CVD 證據，無法判讀。',
  TRADE_CLOCK_MISSING:'最後成交的來源時間或可用時間缺失／無效，無法計算資料年齡。',
  TRADE_CLOCK_IN_FUTURE:'最後成交時間晚於目前時鐘，資料年齡不可用。',
  TRADE_CLOCK_ORDER_INVALID:'成交可用時間早於來源時間，時間順序異常。',
  SOURCE_ELIGIBLE:'來源與品質符合既有即時資格。',
  OBSERVATION_ONLY_NOT_LIVE:'已驗證的觀測片段，不代表即時或完整盤別。'
})[reason]||'原因未知，請查看資料明細。';
export function observationV1(data,frame,now=Date.now()) {
  const p=data?.chart,c=data?.context,r=data?.relationship,o=r?.current;
  const sourceTime=stamp(o?.anchorEventTime),availableAt=stamp(p?.lastTradeAvailableAt);
  const sourceAge=sourceTime===null?null:now-sourceTime,availableAge=availableAt===null?null:now-availableAt;
  const observationAgeMs=sourceAge===null||availableAge===null?null:Math.max(sourceAge,availableAge);
  const invalidClock=observationAgeMs===null||sourceAge<0||availableAge<0||availableAt<sourceTime;
  const missing=!p||!c||c.scope==='UNAVAILABLE'||finite(c.cumulativeCvd)===null||p.freshness?.state==='UNAVAILABLE';
  const pinned=p?.sourceMode?.startsWith('PINNED')||data?.publication?.scope==='VERIFIED_HISTORICAL_CUTOFF';
  const liveEligible=data?.kind==='GOVERNED_FRAGMENT'&&!pinned&&p?.freshness?.state==='LIVE'&&p?.quality==='READY'&&c?.evidence?.quality?.status==='READY';
  let state='UNAVAILABLE';
  if(!missing&&!invalidClock)state=observationAgeMs>60000?'STALE':observationAgeMs>30000?'DELAYED':observationAgeMs>10000?'DEGRADED':liveEligible?'LIVE':'HISTORICAL';
  // Never promote an explicit upstream failure/stale state because of a fresh clock.
  if(state!=='UNAVAILABLE'&&p?.freshness?.state==='STALE')state='STALE';
  if(['LIVE','HISTORICAL','DEGRADED'].includes(state)&&p?.freshness?.state==='DELAYED')state='DELAYED';
  const window=windowPresentation(data?.scan?.[frame]);
  return {state,observationAgeMs:invalidClock?null:observationAgeMs,sourceTime,availableAt,
    reason:!p||!c?'CVD_EVIDENCE_UNAVAILABLE':sourceTime===null||availableAt===null?'TRADE_CLOCK_MISSING':sourceAge<0||availableAge<0?'TRADE_CLOCK_IN_FUTURE':availableAt<sourceTime?'TRADE_CLOCK_ORDER_INVALID':missing?'CVD_EVIDENCE_UNAVAILABLE':liveEligible?'SOURCE_ELIGIBLE':'OBSERVATION_ONLY_NOT_LIVE',
    cumulativeCvd:finite(c?.cumulativeCvd),deltaCvd:finite(o?.current?.deltaCvd),window,
    scope:c?.scope??'UNAVAILABLE',session:p?.session??'UNKNOWN',tradeDate:p?.tradeDate??'UNKNOWN',actualContract:p?.actualContract??'UNKNOWN',
    origin:finite(c?.origin?.eventTimeMs),cutoff:p?.cutoff?.ledgerOrdinal??null,
    cutoffAvailableAt:stamp(p?.availableAt),quality:p?.quality??'UNKNOWN',windowQuality:o?.current?.quality?.status??'UNKNOWN',
    coverage:finite(c?.evidence?.pressure?.classifiedCoverage),continuityEpoch:p?.continuityEpoch??'UNKNOWN',captureCompleteness:c?.captureCompleteness??'UNKNOWN'};
}
const time=x=>x===null?'未知':new Date(x).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
export function renderObservation(host,data,frame,now=Date.now()) {
  const m=observationV1(data,frame,now),doc=host.ownerDocument;
  host.dataset.state=m.state;
  host.dataset.observationAgeMs=String(m.observationAgeMs);host.dataset.reason=m.reason;
  const rows=[
    ['CVD 觀測 V1',observationStateLabel(m.state),m.state],
    [m.scope==='SESSION_TO_NOW'?'本盤累積 CVD':'觀測累積 CVD（非完整盤別）',signed(m.cumulativeCvd)],
    [frame+' ΔCVD',signed(m.deltaCvd)+' · '+observationStateLabel(m.window.state),m.window.state],
    ['價格 ↔ CVD／主動成交壓力',m.window.label,m.window.code],
    ['盤別／交易日／實際契約',m.session+' / '+m.tradeDate+' / '+m.actualContract],
    ['累積起點／範圍',time(m.origin)+' · '+(m.scope==='SESSION_TO_NOW'?'本盤累積':m.scope==='OBSERVED_SEGMENT_TO_NOW'?'觀測片段':'不可用'),m.scope],
    ['發布截止筆序／可用時間','#'+(m.cutoff??'UNKNOWN')+' / '+time(m.cutoffAvailableAt)],
    ['最後成交來源時間／可用時間',time(m.sourceTime)+' / '+time(m.availableAt)],
    ['距最後成交／觀測資料年齡',m.observationAgeMs===null?'未知':fmt(m.observationAgeMs/1000)+' 秒'],
    ['本次處理延遲','未量測（資料年齡不是處理耗時）'],
    ['狀態說明',observationReasonLabel(m.reason),m.reason],
    ['分類覆蓋率／證據品質', (m.coverage===null?'UNKNOWN':fmt(m.coverage*100)+'%')+' / '+m.quality+' · window '+m.windowQuality],
    ['連續性區段／捕捉完整性',m.continuityEpoch+' / '+m.captureCompleteness]
  ];
  const nodes=rows.map(([label,value,code])=>{const el=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=value;if(code)dd.title=code;el.append(dt,dd);return el;});
  host.replaceChildren(...nodes);return m;
}
