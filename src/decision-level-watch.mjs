const finite = value => value == null || value === '' || typeof value === 'boolean' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const iso = value => { const n=Date.parse(value); return Number.isFinite(n)?new Date(n).toISOString():null; };
const freezeRows = rows => Object.freeze(rows.map(row=>Object.freeze(row)));

function availableLevel(level){
  return level?.availability==='AVAILABLE' && finite(level.value)!=null;
}
function levelRow(level,{id,family,label,priority,why,qualityStatus=null}){
  if(!availableLevel(level))return null;
  return {
    id,family,label,price:finite(level.value),priority,
    sourceId:level.source||level.sourceId||family,
    availableAt:iso(level.availableAt),
    qualityStatus:qualityStatus||level.qualityStatus||'UNKNOWN',
    why,
  };
}
function median(values){
  const rows=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return null;
  const m=Math.floor(rows.length/2);
  return rows.length%2?rows[m]:(rows[m-1]+rows[m])/2;
}
function completedBars(chart,asOf){
  const ms=Date.parse(asOf||chart?.asOf||chart?.availableAt||'');
  return (chart?.bars||[]).filter(bar=>{
    const start=Date.parse(bar?.time);
    const availableMs=bar?.availableAt?Date.parse(bar.availableAt):start+5*60_000;
    const identityOk=(!bar?.tradeDate||!chart?.tradeDate||bar.tradeDate===chart.tradeDate)
      &&(!bar?.actualContract||!chart?.actualContract||bar.actualContract===chart.actualContract)
      &&(!bar?.session||!chart?.session||bar.session===chart.session);
    return Number.isFinite(start)&&Number.isFinite(ms)&&Number.isFinite(availableMs)
      &&start+5*60_000<=ms&&availableMs<=ms&&identityOk
      && [bar.open,bar.high,bar.low,bar.close].every(v=>finite(v)!=null);
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
function recentSwings(bars){
  const recent=bars.slice(-30); let high=null,low=null;
  for(let i=1;i<recent.length-1;i++){
    const a=recent[i-1],b=recent[i],c=recent[i+1];
    if(finite(b.high)>finite(a.high)&&finite(b.high)>=finite(c.high)) high={bar:b,price:finite(b.high)};
    if(finite(b.low)<finite(a.low)&&finite(b.low)<=finite(c.low)) low={bar:b,price:finite(b.low)};
  }
  return {high,low};
}
function eventState(level,bars,currentPrice,zone){
  const closes=bars.slice(-4).map(b=>finite(b.close)).filter(v=>v!=null);
  const last=bars.at(-1), prior=bars.at(-2), two=bars.at(-3);
  const price=level.price, distance=currentPrice-price;
  const abs=Math.abs(distance);
  const touch=last && finite(last.low)<=price && finite(last.high)>=price;
  const priorClose=finite(prior?.close),lastClose=finite(last?.close),twoClose=finite(two?.close);
  const crossedUp=priorClose!=null&&lastClose!=null&&priorClose<=price&&lastClose>price;
  const crossedDown=priorClose!=null&&lastClose!=null&&priorClose>=price&&lastClose<price;
  const acceptedAbove=twoClose!=null&&priorClose!=null&&lastClose!=null&&twoClose<=price&&priorClose>price+zone&&lastClose>price+zone;
  const acceptedBelow=twoClose!=null&&priorClose!=null&&lastClose!=null&&twoClose>=price&&priorClose<price-zone&&lastClose<price-zone;
  const rejectedAbove=twoClose!=null&&priorClose!=null&&lastClose!=null&&twoClose<=price&&priorClose>price+zone&&lastClose<price;
  const rejectedBelow=twoClose!=null&&priorClose!=null&&lastClose!=null&&twoClose>=price&&priorClose<price-zone&&lastClose>price;
  let state='MONITORING',side=distance>=0?'ABOVE':'BELOW';
  if(rejectedAbove||rejectedBelow) state='REJECTED';
  else if(acceptedAbove||acceptedBelow) state='ACCEPTED';
  else if(crossedUp&&distance>=zone) state='RECLAIMED';
  else if(crossedDown&&distance<=-zone) state='LOST';
  else if(crossedUp||crossedDown) state='BREAKING';
  else if(touch||abs<=zone) state='TESTING';
  else if(abs<=zone*2) state='APPROACHING';
  const movingToward=closes.length>=2?Math.abs(closes.at(-2)-price)>Math.abs(closes.at(-1)-price):null;
  return {state,side,distancePoints:distance,absoluteDistancePoints:abs,movingToward};
}
function responseContract(level,state){
  const above=state.side==='ABOVE';
  const base=level.family==='VWAP'
    ? '不要只看穿越；觀察成交壓力出現後，價格能否在 VWAP 附近站穩並持續離開。'
    : level.family==='OPENING_RANGE'
      ? '觀察突破／跌破後能否離開開盤區間，而不是穿越後立刻收回。'
      : '觀察觸及或突破後，成交壓力是否得到同方向價格延伸；推不動本身就是反證。';
  return {
    watchFor:base,
    expectedResponse:above
      ? '若上方接受成立，後續價格應能維持在價位上方；買方壓力增加時應伴隨向上價格反應。'
      : '若下方接受成立，後續價格應能維持在價位下方；賣方壓力增加時應伴隨向下價格反應。',
    confirm:above
      ? '價格維持價位上方，且同向成交壓力出現時價格能繼續往上離開。'
      : '價格維持價位下方，且同向成交壓力出現時價格能繼續往下離開。',
    invalidate:above
      ? '買方壓力增加但價格推不動，或快速跌回價位下方。'
      : '賣方壓力增加但價格跌不動，或快速收回價位上方。',
  };
}
function dedupe(rows,zone){
  const out=[];
  for(const row of rows){
    const hit=out.find(x=>Math.abs(x.price-row.price)<=Math.max(3,zone*.35));
    if(!hit)out.push(row);
    else if(row.priority>hit.priority){
      row.aliases=Object.freeze([...(hit.aliases||[]),hit.label]);
      Object.assign(hit,row);
    }else hit.aliases=Object.freeze([...(hit.aliases||[]),row.label]);
  }
  return out;
}
export function buildDecisionLevelWatch({chart,observedFlow=null,snapshotTime=new Date().toISOString(),maxVisible=3}={}){
  const currentPrice=finite(chart?.lastPrice);
  if(currentPrice==null)return Object.freeze({schemaVersion:'decision-level-watch-v1',state:'UNAVAILABLE',reason:'CURRENT_PRICE_UNAVAILABLE',levels:Object.freeze([]),nextWatch:null,zonePoints:null,formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false});
  const bars=completedBars(chart,snapshotTime);
  const ranges=bars.slice(-12).map(b=>finite(b.high)-finite(b.low)).filter(Number.isFinite);
  const med=median(ranges);
  const zone=clamp(Math.round((med||24)*.35),6,30);
  const L=chart?.levels||{}; const rows=[];
  const currentQuality=chart?.qualityStatus||'UNKNOWN';
  const push=x=>{if(x)rows.push(x);};
  push(levelRow(L.vwap,{id:'VWAP',family:'VWAP',label:(chart?.vwapSession||chart?.session||'Session')+' VWAP',priority:100,qualityStatus:currentQuality,why:'目前交易時段的成交均價參考；重點是價格測試後的實際反應，不是單純站上或跌破。'}));
  if(chart?.openingRange?.status==='READY'){
    push(levelRow(L.openingRangeHigh,{id:'OR_HIGH',family:'OPENING_RANGE',label:'OR High',priority:96,qualityStatus:currentQuality,why:'已凍結的開盤區間上緣；可觀察突破後是否真正被市場接受。'}));
    push(levelRow(L.openingRangeLow,{id:'OR_LOW',family:'OPENING_RANGE',label:'OR Low',priority:96,qualityStatus:currentQuality,why:'已凍結的開盤區間下緣；可觀察跌破後是否真正被市場接受。'}));
  }
  const day=availableLevel(L.currentDayHigh)||availableLevel(L.currentDayLow);
  push(levelRow(day?L.currentDayHigh:L.nightHigh,{id:'SESSION_HIGH',family:'SESSION_EXTREME',label:day?'DAY High':'NIGHT High',priority:91,qualityStatus:currentQuality,why:'目前交易時段已形成的高點；再次接近時可檢查突破是否有價格延伸。'}));
  push(levelRow(day?L.currentDayLow:L.nightLow,{id:'SESSION_LOW',family:'SESSION_EXTREME',label:day?'DAY Low':'NIGHT Low',priority:91,qualityStatus:currentQuality,why:'目前交易時段已形成的低點；再次接近時可檢查跌破是否有價格延伸。'}));
  const swings=recentSwings(bars);
  const swingQuality=bar=>currentQuality!=='PASS'?currentQuality:(bar?.qualityStatus||currentQuality);
  if(swings.high)push({id:'SWING_HIGH',family:'RECENT_SWING',label:'近期 Swing High',price:swings.high.price,priority:86,sourceId:'COMPLETED_5M_SWING',availableAt:iso(swings.high.bar.availableAt||chart?.availableAt),qualityStatus:swingQuality(swings.high.bar),why:'由已完成 5 分 K 的局部高點推導；只作價格反應觀察，不是自動壓力判定。'});
  if(swings.low)push({id:'SWING_LOW',family:'RECENT_SWING',label:'近期 Swing Low',price:swings.low.price,priority:86,sourceId:'COMPLETED_5M_SWING',availableAt:iso(swings.low.bar.availableAt||chart?.availableAt),qualityStatus:swingQuality(swings.low.bar),why:'由已完成 5 分 K 的局部低點推導；只作價格反應觀察，不是自動支撐判定。'});
  push(levelRow(L.previousDayHigh,{id:'PRIOR_HIGH',family:'PRIOR_REFERENCE',label:'前一日盤高',priority:70,why:'前一交易日合法高點參考；優先級低於當前時段結構。'}));
  push(levelRow(L.previousDayLow,{id:'PRIOR_LOW',family:'PRIOR_REFERENCE',label:'前一日盤低',priority:70,why:'前一交易日合法低點參考；優先級低於當前時段結構。'}));
  push(levelRow(L.previousClose,{id:'PRIOR_CLOSE',family:'PRIOR_REFERENCE',label:'前一日盤收',priority:66,why:'前一交易日收盤參考；不等同即時支撐或壓力。'}));
  const unique=dedupe(rows.filter(Boolean),zone).map(level=>{
    const ev=eventState(level,bars,currentPrice,zone);
    const contract=responseContract(level,ev);
    const proximity=Math.max(0,60-Math.min(60,ev.absoluteDistancePoints/Math.max(zone,1)*8));
    const score=level.priority+proximity;
    return {...level,...ev,...contract,score,zonePoints:zone};
  }).sort((a,b)=>b.score-a.score||a.absoluteDistancePoints-b.absoluteDistancePoints);
  const selected=unique.slice(0,Math.max(1,Math.min(3,maxVisible)));
  const next=[...selected].sort((a,b)=>a.absoluteDistancePoints-b.absoluteDistancePoints||b.priority-a.priority)[0]||null;
  const flow={
    sourceState:observedFlow?.sourceState||'UNAVAILABLE',
    quality:observedFlow?.researchQuality?.status||null,
    pressure60:finite(observedFlow?.windows?.primary60s?.pressure?.pressureRatio),
    response60:finite(observedFlow?.windows?.primary60s?.response?.displacementPoints),
    availableAt:iso(observedFlow?.source?.availableAt),
    formalDirection:'NOT_PROMOTED',
  };
  return Object.freeze({
    schemaVersion:'decision-level-watch-v1',state:selected.length?'READY':'UNAVAILABLE',reason:selected.length?null:'NO_LAWFUL_LEVELS',
    currentPrice,zonePoints:zone,zoneMethod:'35%_RECENT_COMPLETED_5M_MEDIAN_RANGE_CLAMP_6_30_OBSERVATION_ONLY',
    levels:freezeRows(selected),nextWatch:next?Object.freeze({...next}):null,observedFlow:Object.freeze(flow),
    formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false,
  });
}
