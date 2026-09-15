export const LABELS=Object.freeze({ALIGNED:'力價同步中',ALIGNED_BUT_WEAKENING:'同向但轉弱',PRESSURE_RESPONSE_MISMATCH:'力價不同步',OPPOSITE_DIVERGENCE:'力價反方向',MIXED_OR_QUALITY_LIMITED:'證據有分歧',UNAVAILABLE:'暫無法判讀'});
export const FRAMES=['1m','5m','15m','30m','1h','4h'];
export const FLOW={positive:'#23E0A5',negative:'#FF5F76',neutral:'#718395'};
export const fmt=x=>x==null?'不可用':Number(x).toLocaleString('zh-TW',{maximumFractionDigits:3});
export const signed=x=>x==null?'不可用':`${x>0?'+':''}${fmt(x)}`;
export const timelineTime=event=>event?.lineage?.availableAtMs??null;
export const scopeLabel=scope=>scope==='SESSION_TO_NOW'?'本盤累積':scope==='OBSERVED_SEGMENT_TO_NOW'?'觀測累積':'UNAVAILABLE';
// One presentation model shared by Fast Scan and Explain; never a second classifier.
export function windowPresentation(row) {
  const o=row?.current,e=o?.current,code=o?.relationship?.code||'UNAVAILABLE';
  let state='AVAILABLE',tone='neutral';
  if(!e || code==='UNAVAILABLE' || e.available===false)state='UNAVAILABLE';
  else if(e.quality?.status==='WARMING_UP')state='WARMING';
  else if(!e.complete)state='PARTIAL';
  else if(code==='MIXED_OR_QUALITY_LIMITED')state='PARTIAL';
  else if(code==='ALIGNED_BUT_WEAKENING' || code==='PRESSURE_RESPONSE_MISMATCH')tone='warning';
  else if(code==='OPPOSITE_DIVERGENCE')tone='negative';
  else if(code==='ALIGNED')tone=e.deltaCvd>0?'positive':e.deltaCvd<0?'negative':'neutral';
  if(state==='WARMING')tone='warning';
  if(state==='PARTIAL'||state==='UNAVAILABLE')tone='neutral';
  return {code,label:LABELS[code]||LABELS.UNAVAILABLE,state,tone,delta:e?.deltaCvd??null,response:e?.response?.displacementPoints??null,path:e?.pathEfficiency?.value??null,span:e?.observedSpanMs??null,pressure:e?.pressure?.pressureRatio??null,coverage:e?.pressure?.classifiedCoverage??null};
}
// Original Dashboard's 9-cell pressure display, not a new strength score.
// Partial/warming/unavailable windows retain their raw evidence but no direction.
export function pressureCells(ratio,state='AVAILABLE') {
  if(state!=='AVAILABLE'||!Number.isFinite(ratio)||Math.abs(ratio)>1)return {cells:0,direction:'neutral'};
  const a=Math.abs(ratio),cells=a<.1?0:a<.325?1:a<.55?2:a<.775?3:4;
  return {cells,direction:cells===0?'neutral':ratio>0?'positive':'negative'};
}
export function evidenceDirection(value,state) {
  if(state!=='AVAILABLE'||!Number.isFinite(value))return {symbol:'—',direction:'neutral'};
  return value>0?{symbol:'▲',direction:'positive'}:value<0?{symbol:'▼',direction:'negative'}:{symbol:'＝',direction:'neutral'};
}
export function cvdChunks(projection) {
  const chunks=[];
  for(const segment of projection.segments) {
    let data=[],last=null;const flush=()=>{if(data.length)chunks.push({segment:segment.index,data});data=[];};
    for(const p of segment.points) {
      if(p.time==null||p.value==null){flush();last=null;continue;}
      if(last!=null&&p.time<last){flush();last=null;}
      const d={time:p.time,value:p.value};if(p.time===last)data[data.length-1]=d;else data.push(d);last=p.time;
    }flush();
  }return chunks;
}
export function deltaChunks(p,r) {
  return p.segments.map(segment=>{
    const data=[];let last=-Infinity;
    for(const o of r.observations.filter(o=>o.segment===segment.index)) {
      const t=o.lineage.availableAtMs==null?null:o.lineage.availableAtMs/1000;
      if(t==null||t<last)continue;
      const d=o.deltaCvd==null?{time:t}:{time:t,value:o.deltaCvd,color:o.deltaCvd>0?FLOW.positive:o.deltaCvd<0?FLOW.negative:FLOW.neutral};
      if(t===last)data[data.length-1]=d;else data.push(d);last=t;
    }return {segment:segment.index,data};
  });
}
