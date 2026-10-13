import { hasSourceTimeGeometry, isStructureEligible } from './structural-eligibility.mjs';
import { explainScenarioTarget, observationOnlyGuidance } from './scenario-target-diagnostics.mjs';

const finite = value => value == null || value === '' || typeof value === 'boolean' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const iso = value => { const n=Date.parse(value); return Number.isFinite(n)?new Date(n).toISOString():null; };
const freezeRows = rows => Object.freeze(rows.map(row=>Object.freeze(row)));
const LIVE_SOURCE_FRESHNESS_MS = 120_000;

function availableLevel(level){
  return level?.availability==='AVAILABLE' && finite(level.value)!=null;
}
function levelRow(level,{id,family,label,priority,why,qualityStatus=null,formedAt=null}){
  if(!availableLevel(level)||!(level.source||level.sourceId))return null;
  const originalAvailableAt=iso(level.availableAt);
  const availableAt=hasSourceTimeGeometry(level)&&originalAvailableAt
    ? new Date(Math.max(Date.parse(originalAvailableAt),Date.parse(level.structureEligibility.availableAt))).toISOString()
    : originalAvailableAt;
  return {
    id,family,label,price:finite(level.value),priority,
    sourceId:level.source||level.sourceId,
    actualContract:level.actualContract||null,tradeDate:level.tradeDate||null,session:level.session||null,
    availableAt,
    formedAt:iso(formedAt||availableAt),
    qualityStatus:qualityStatus&&qualityStatus!=='PASS'?qualityStatus:level.qualityStatus||'UNKNOWN',
    qualityReasons:level.qualityReasons||[],
    structureEligibility:level.structureEligibility||null,
    why,
  };
}
function median(values){
  const rows=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return null;
  const m=Math.floor(rows.length/2);
  return rows.length%2?rows[m]:(rows[m-1]+rows[m])/2;
}
function barAvailableAt(bar){
  const start=Date.parse(bar?.time);
  const received=Date.parse(bar?.availableAt);
  const completion=Date.parse(bar?.structureEligibility?.completionAvailableAt);
  return Number.isFinite(start)&&Number.isFinite(received)?new Date(Math.max(start+5*60_000,received,Number.isFinite(completion)?completion:-Infinity)).toISOString():null;
}
function completedBars(chart,asOf){
  if(chart?.timeframe!=='5m')return [];
  const ms=Date.parse(asOf||chart?.asOf||chart?.availableAt||'');
  return (chart?.bars||[]).filter(bar=>{
    const start=Date.parse(bar?.time);
    const availableMs=Date.parse(barAvailableAt(bar)||'');
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
    if(Date.parse(b.time)-Date.parse(a.time)!==300000||Date.parse(c.time)-Date.parse(b.time)!==300000)continue;
    if([a,b,c].some(bar=>!isStructureEligible(bar)))continue;
    const confirmedAt=new Date(Math.max(...[a,b,c].map(bar=>Date.parse(barAvailableAt(bar))))).toISOString();
    if(finite(b.high)>finite(a.high)&&finite(b.high)>=finite(c.high)) high={bar:b,inputBars:[a,b,c],confirmBar:c,price:finite(b.high),confirmedAt};
    if(finite(b.low)<finite(a.low)&&finite(b.low)<=finite(c.low)) low={bar:b,inputBars:[a,b,c],confirmBar:c,price:finite(b.low),confirmedAt};
  }
  return {high,low};
}
function eventState(level,bars,currentPrice,zone){
  bars=bars.filter(bar=>isStructureEligible(bar)&&Date.parse(bar.time)>=Date.parse(level.formedAt));
  const closes=bars.slice(-4).map(b=>finite(b.close)).filter(v=>v!=null);
  const last=bars.at(-1), prior=bars.at(-2), two=bars.at(-3);
  const price=level.price, distance=currentPrice-price;
  const abs=Math.abs(distance);
  const touch=last && finite(last.low)<=price && finite(last.high)>=price;
  if(level.family==='VWAP'){
    const state=abs<=zone?'TESTING':abs<=zone*2?'APPROACHING':'MONITORING';
    const movingToward=null;
    return {state,side:distance>=0?'ABOVE':'BELOW',distancePoints:distance,absoluteDistancePoints:abs,movingToward,
      lifecycleBasis:'CURRENT_DYNAMIC_VWAP_ONLY_NO_HISTORICAL_STATIC_BACKFILL'};
  }
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
function levelRole(level){
  if (['OR_HIGH','SESSION_HIGH','SWING_HIGH','PRIOR_HIGH'].includes(level?.id)) return 'UPPER';
  if (['OR_LOW','SESSION_LOW','SWING_LOW','PRIOR_LOW'].includes(level?.id)) return 'LOWER';
  return 'REFERENCE';
}
function responseContract(level){
  const role=levelRole(level);
  if(role==='UPPER'){
    return {
      watchFor:'接近上緣時，先看是突破後被市場接受，還是碰高後遭拒絕；不要只看瞬間穿越。',
      expectedResponse:'若向上突破有效，價格應維持在價位上方，且買方壓力增加時能繼續向上離開；若只是測試失敗，價格會無法在上方停留並回落。',
      confirm:'站上價位後仍能維持，且買方壓力增加時價格繼續往上離開。',
      invalidate:'買方壓力增加但價格推不動，或穿越後快速跌回價位下方。',
    };
  }
  if(role==='LOWER'){
    return {
      watchFor:'接近下緣時，先看是跌破後被市場接受，還是探低後被承接；不要只看瞬間穿越。',
      expectedResponse:'若向下跌破有效，價格應維持在價位下方，且賣方壓力增加時能繼續向下離開；若只是測試失敗，價格會無法在下方停留並收回。',
      confirm:'跌到價位下方後仍能維持，且賣方壓力增加時價格繼續往下離開。',
      invalidate:'賣方壓力增加但價格跌不動，或穿越後快速收回價位上方。',
    };
  }
  const base=level.family==='VWAP'
    ? '不要只看穿越；觀察成交壓力出現後，價格能否在 VWAP 某一側站穩並持續離開。'
    : '把它當成中性價格參考；穿越後要看能否在某一側站穩並產生同方向價格延伸。';
  return {
    watchFor:base,
    expectedResponse:'有效接受應表現為價格在其中一側站穩，且同方向成交壓力增加時價格能繼續離開該價位。',
    confirm:'價格在其中一側站穩，且同方向成交壓力出現時能持續離開。',
    invalidate:'成交壓力增加但價格推不動，或穿越後很快又回到另一側。',
  };
}
function structuralRank(level){
  if(level.family==='VWAP'||level.family==='OPENING_RANGE')return 5;
  if(level.family==='SESSION_EXTREME')return 4;
  if(['PRIOR_HIGH','PRIOR_LOW'].includes(level.id))return 3;
  if(level.id==='PRIOR_CLOSE')return 2;
  return 1;
}
function sourceExplanation(level){
  if(level.family==='VWAP')return 'TX 實際成交 Tick 累積出的本交易時段 VWAP';
  if(level.family==='OPENING_RANGE')return '已凍結完成的 Opening Range';
  if(level.family==='SESSION_EXTREME')return 'TX actual-contract 本交易時段已形成高／低點';
  if(level.family==='RECENT_SWING')return '已完成 5 分 K 的三根局部轉折；必須等下一根 5 分 K 完成後才成立';
  if(level.id==='PRIOR_CLOSE')return 'governed 前一交易日收盤參考';
  return 'governed 前一交易日高／低參考';
}
function dedupe(rows,tolerance){
  const ordered=[...rows].sort((a,b)=>Number(isStructureEligible(b))-Number(isStructureEligible(a))||structuralRank(b)-structuralRank(a)||b.priority-a.priority);
  const out=[];
  for(const row of ordered){
    const hit=out.find(x=>Math.abs(x.price-row.price)<=tolerance);
    if(!hit)out.push({...row,aliases:[]});
    else hit.aliases.push(row.label);
  }
  return out;
}
function reactionHistory(level,bars,zone){
  if(level.family==='VWAP')return {
    method:'DYNAMIC_REFERENCE_NO_STATIC_REACTION_COUNT',testEpisodes:null,meaningfulReactionCount:null,
    meaningfulThresholdPoints:zone*2,lastTouchAt:null,maxDeparturePoints:null,medianDeparturePoints:null,
  };
  const formedMs=Date.parse(level.formedAt||level.availableAt||'');
  if(!Number.isFinite(formedMs))return {
    method:'FORMATION_TIME_UNAVAILABLE',testEpisodes:null,meaningfulReactionCount:null,
    meaningfulThresholdPoints:zone*2,lastTouchAt:null,maxDeparturePoints:null,medianDeparturePoints:null,
  };
  const eligible=bars.filter(bar=>isStructureEligible(bar)&&Date.parse(bar.time)>=formedMs);
  let inside=false;const departures=[];let lastTouchAt=null;
  for(let i=0;i<eligible.length;i++){
    const bar=eligible[i];
    const touched=finite(bar.low)<=level.price+zone&&finite(bar.high)>=level.price-zone;
    if(touched&&!inside){
      lastTouchAt=barAvailableAt(bar);
      const look=eligible.slice(i,Math.min(eligible.length,i+4)).filter(x=>Date.parse(barAvailableAt(x))-Date.parse(barAvailableAt(bar))<=15*60000);
      const departure=Math.max(0,...look.map(x=>Math.abs((finite(x.close)??level.price)-level.price)));
      departures.push(departure);
    }
    inside=touched;
  }
  const threshold=zone*2;
  return {
    method:'POST_FORMATION_COMPLETED_5M_TOUCH_EPISODES_NEXT_15M',
    testEpisodes:departures.length,
    meaningfulReactionCount:departures.filter(x=>x>=threshold).length,
    meaningfulThresholdPoints:threshold,
    lastTouchAt,
    maxDeparturePoints:departures.length?Math.max(...departures):null,
    medianDeparturePoints:median(departures),
  };
}
function confluenceEvidence(level,rows,zone){
  const nearby=rows.filter(x=>x.id!==level.id&&isStructureEligible(x)&&Math.abs(x.price-level.price)<=zone);
  return {
    count:1+nearby.length,
    labels:nearby.map(x=>x.label).slice(0,5),
    prices:nearby.map(x=>x.price).slice(0,5),
    tolerancePoints:zone,
  };
}
function participationContext(bars,marketPulse){
  const recent=bars.slice(-12);
  const volumes=recent.map(b=>finite(b.volume)).filter(v=>v!=null&&v>=0);
  const latestVolume=finite(recent.at(-1)?.volume);
  const medianVolume=median(volumes);
  const volumeRatio=latestVolume!=null&&medianVolume>0?latestVolume/medianVolume:null;
  const rvolRatio=finite(marketPulse?.rvol?.ratio);
  return {
    latestCompletedBarVolume:latestVolume,
    recentMedianVolume:medianVolume,
    completedBarVolumeRatio:volumeRatio,
    rvolState:marketPulse?.rvol?.state||'UNAVAILABLE',
    rvolRatio,
    rvolPercentile:finite(marketPulse?.rvol?.percentile),
    rvolSampleDays:finite(marketPulse?.rvol?.sampleDays),
  };
}
function flowContext(observedFlow,chart,snapshotTime){
  const pressure=finite(observedFlow?.windows?.primary60s?.pressure?.pressureRatio);
  const response=finite(observedFlow?.windows?.primary60s?.response?.displacementPoints);
  const quality=observedFlow?.researchQuality?.status||observedFlow?.windows?.primary60s?.quality?.status||null;
  const relation=pressure==null||response==null?'UNAVAILABLE'
    : response===0?'FLAT_PRICE'
    : pressure===0?'BALANCED_PRESSURE'
    : Math.sign(pressure)===Math.sign(response)?'SAME_DIRECTION':'OPPOSITE_DIRECTION';
  const identity=observedFlow?.identity;
  const identityMatch=identity&&['actualContract','tradeDate','session'].every(key=>identity[key]&&identity[key]===chart?.[key]);
  const availableAt=iso(observedFlow?.source?.availableAt);
  const timeSafe=availableAt&&Date.parse(availableAt)<=Date.parse(snapshotTime);
  return {
    sourceState:identityMatch&&timeSafe?observedFlow?.sourceState||'UNAVAILABLE':'UNAVAILABLE',
    quality,
    pressure60:pressure,
    response60:response,
    directionRelation:relation,
    availableAt,
  };
}
function importanceBand(level,reaction,confluence){
  const core=['VWAP','OPENING_RANGE','SESSION_EXTREME'].includes(level.family);
  if(!isStructureEligible(level))return 'CONTEXT';
  const repeatedReaction=(reaction?.testEpisodes||0)>=2&&(reaction?.meaningfulReactionCount||0)>=1;
  const strongReaction=(reaction?.meaningfulReactionCount||0)>=2;
  if(confluence.count>=2||strongReaction||repeatedReaction)return 'PRIMARY';
  if(core||['PRIOR_HIGH','PRIOR_LOW'].includes(level.id)||(reaction?.meaningfulReactionCount||0)>=1
    )return 'SECONDARY';
  return 'CONTEXT';
}
function basisReasons(level,{band,confluence,reaction,event,flow,participation,zone}){
  const rows=[`來源：${sourceExplanation(level)}。`];
  if(level.formedAt)rows.push(`形成／可用時間：${level.formedAt}。`);
  if(confluence.count>1)rows.push(`結構共振：${zone} 點觀察區內另有 ${confluence.labels.join('、')}。`);
  if(reaction.testEpisodes!=null){
    if(reaction.testEpisodes>0)rows.push(`形成後反應：已出現 ${reaction.testEpisodes} 次獨立測試，其中 ${reaction.meaningfulReactionCount} 次在 15 分鐘內離開至少 ${reaction.meaningfulThresholdPoints} 點；這是同場盤中描述，不是勝率統計。`);
    else rows.push('形成後反應：尚未累積獨立重複測試。');
  }else if(level.family==='VWAP')rows.push('形成後反應：VWAP 會隨成交持續移動，因此不把目前數值倒套到舊 K 棒計算測試次數。');
  if(event.absoluteDistancePoints<=zone*2){
    if(flow.sourceState==='LIVE'&&flow.pressure60!=null&&flow.response60!=null){
      const pressureSide=flow.pressure60>0?'買方':flow.pressure60<0?'賣方':'平衡';
      const responseSide=flow.response60>0?'價格上移':flow.response60<0?'價格下移':'價格持平';
      rows.push(`當下成交反應：近60秒為${pressureSide}壓力比 ${flow.pressure60.toFixed(2)}，${responseSide} ${Math.abs(flow.response60).toFixed(1)} 點；品質 ${flow.quality||'未標示'}，僅作反應確認。`);
    }else rows.push('當下成交反應：盤中成交力道目前不足以作確認依據。');
    if(participation.rvolState==='READY'&&participation.rvolRatio!=null)rows.push(`量能背景：完成 K 的 RVOL ${participation.rvolRatio.toFixed(2)}×${participation.rvolPercentile!=null?`，分位 ${participation.rvolPercentile.toFixed(0)}`:''}；只作參與度背景。`);
    else if(participation.completedBarVolumeRatio!=null)rows.push(`量能背景：最新完成5分K量約為近期12根中位量的 ${participation.completedBarVolumeRatio.toFixed(2)}×。`);
  }
  if(level.family==='RECENT_SWING'&&band==='CONTEXT')rows.push('重要性限制：目前沒有共振或形成後有效反應的額外證據，只列低優先級局部結構。');
  if(level.qualityStatus&&level.qualityStatus!=='PASS')rows.push(`資料限制：${level.qualityStatus}，不能把此價位稱為已驗證支撐／壓力。`);
  if(hasSourceTimeGeometry(level)&&level.qualityStatus!=='PASS')rows.push('僅依來源所報時間計算結構幾何；跨時計品質仍受限，不代表可交易或成交確認。');
  return rows;
}
function summaryWhy(level,basis){
  const extra=[];
  if(basis.confluence.count>1)extra.push('附近有其他獨立價格結構重疊');
  if((basis.reaction.meaningfulReactionCount||0)>0)extra.push('形成後曾有可觀察價格反應');
  if(basis.importanceBand==='CONTEXT')extra.push('目前只屬低優先級結構參考');
  return [level.why,...extra].join('；');
}

function directionalTarget(levels,node,direction,threshold){
  const candidates=levels.filter(level=>{
    if(!level||level.id===node?.id||level.importanceBand==='CONTEXT'||!isStructureEligible(level)||finite(level.price)==null)return false;
    return direction==='LONG'?level.price>threshold:level.price<threshold;
  });
  return [...candidates].sort((a,b)=>
    structuralRank(b)-structuralRank(a)
    ||(b.basis?.confluence?.count||0)-(a.basis?.confluence?.count||0)
    ||(b.basis?.reaction?.meaningfulReactionCount||0)-(a.basis?.reaction?.meaningfulReactionCount||0)
    ||Math.abs(a.price-threshold)-Math.abs(b.price-threshold)
  )[0]||null;
}
function scenarioRr(direction,confirmThreshold,invalidationThreshold,target){
  if(finite(confirmThreshold)==null||finite(invalidationThreshold)==null)return Object.freeze({
    state:'UNAVAILABLE',ratio:null,riskPoints:null,rewardPoints:null,reason:'THRESHOLDS_UNAVAILABLE',
    meaning:'STRUCTURAL_GEOMETRY_ONLY_NOT_PROBABILITY_OR_EV',
  });
  const risk=Math.abs(confirmThreshold-invalidationThreshold);
  const reward=target?direction==='LONG'?target.price-confirmThreshold:confirmThreshold-target.price:null;
  if(!(risk>0)||!(reward>0))return Object.freeze({
    state:'UNAVAILABLE',ratio:null,riskPoints:risk>0?risk:null,rewardPoints:reward>0?reward:null,
    reason:target?'TARGET_NOT_BEYOND_CONFIRMATION':'NO_EVIDENCE_QUALIFIED_TARGET',
    meaning:'STRUCTURAL_GEOMETRY_ONLY_NOT_PROBABILITY_OR_EV',
  });
  return Object.freeze({
    state:'AVAILABLE',ratio:reward/risk,riskPoints:risk,rewardPoints:reward,
    reason:null,meaning:'STRUCTURAL_GEOMETRY_ONLY_NOT_PROBABILITY_OR_EV',
  });
}
function scenarioFlowState(direction,flow){
  if(flow?.sourceState!=='LIVE'||flow?.pressure60==null||flow?.response60==null)return 'UNAVAILABLE';
  if(flow.quality!=='PASS'&&flow.quality!=='READY')return 'QUALITY_INSUFFICIENT';
  const aligned=direction==='LONG'?flow.pressure60>0&&flow.response60>0:flow.pressure60<0&&flow.response60<0;
  const contrary=direction==='LONG'?flow.pressure60<0&&flow.response60<0:flow.pressure60>0&&flow.response60>0;
  return aligned?'ALIGNED':contrary?'CONTRARY':'MIXED';
}
function buildScenario(direction,node,target,{zone,currentPrice,flow,levels,chartQuality,structureEligibility}){
  const long=direction==='LONG';
  const thresholdsAvailable=isStructureEligible(node)&&finite(zone)>0;
  const confirmThreshold=thresholdsAvailable?node.price+(long?zone:-zone):null;
  const invalidationThreshold=thresholdsAvailable?node.price+(long?-zone:zone):null;
  const priceQualityReady=chartQuality==='PASS';
  const priceGate=thresholdsAvailable&&priceQualityReady&&(long?currentPrice>=confirmThreshold:currentPrice<=confirmThreshold);
  const rr=scenarioRr(direction,confirmThreshold,invalidationThreshold,target);
  const targetDiagnostics=explainScenarioTarget({side:direction,node,levels,target,threshold:confirmThreshold,chartQuality,structureEligibility});
  const targetPayload=target?Object.freeze({
    id:target.id,family:target.family,label:target.label,price:target.price,
    importanceBand:target.importanceBand,sourceId:target.sourceId,availableAt:target.availableAt,
    qualityStatus:target.qualityStatus,qualityReasons:target.qualityReasons||[],structureEligibility:target.structureEligibility||null,why:target.why,basisReasons:Object.freeze([...(target.basisReasons||[])]),
  }):null;
  return Object.freeze({
    side:direction,
    state:!thresholdsAvailable?'UNAVAILABLE':!priceQualityReady?'PRICE_QUALITY_INSUFFICIENT':priceGate?'PRICE_CONFIRMATION_CANDIDATE':'WAIT_CONFIRMATION',
    priceGateState:!thresholdsAvailable||!priceQualityReady?'UNAVAILABLE':priceGate?'MET':'NOT_MET',
    priceGateReason:!priceQualityReady?'CROSS_CLOCK_QUALITY_NOT_VERIFIED':null,
    flowConfirmationState:scenarioFlowState(direction,flow),
    confirmationThreshold:confirmThreshold,
    invalidationThreshold,
    confirm:!thresholdsAvailable?'節點資料品質不足，確認門檻不可用。':long
      ? `價格站上 ${confirmThreshold.toFixed(2)} 並能維持；若買方壓力增加，價格需同步往上離開。`
      : `價格跌到 ${confirmThreshold.toFixed(2)} 下方並能維持；若賣方壓力增加，價格需同步往下離開。`,
    invalidate:!thresholdsAvailable?'節點資料品質不足，失效門檻不可用。':long
      ? `價格重新跌到 ${invalidationThreshold.toFixed(2)} 下方，或買方壓力增加但價格無法往上離開。`
      : `價格重新站上 ${invalidationThreshold.toFixed(2)}，或賣方壓力增加但價格無法往下離開。`,
    target:targetPayload,
    targetDiagnostics,
    rr,
    recommendation:false,
  });
}
function scenarioDirectionState(node,zone){
  if(!node)return 'UNAVAILABLE';
  if(['TESTING','BREAKING','APPROACHING'].includes(node.state)||node.absoluteDistancePoints<=zone)return 'BIDIRECTIONAL_TEST';
  return 'BIDIRECTIONAL_WATCH';
}

function unavailabilityDiagnostics(chart,reason,snapshotTime){
  const completed=completedBars(chart,snapshotTime), recent=completed.slice(-12);
  const eligible=recent.filter(isStructureEligible);
  const reasonCodes=[...new Set([reason,...(chart?.qualityReasons||[]),...(chart?.structureEligibility?.reasonCodes||[])])];
  return Object.freeze({
    summary:`結構不可用：${reasonCodes.join('、')}。最近 ${recent.length} 根完成5分K中，${eligible.length} 根具計算資格；目標與風報比保持空值。`,
    reasonCodes,sourceAvailableAt:chart?.availableAt||null,
    dependencies:{completedBarCount:completed.length,recentRangeBarCount:recent.length,
      eligibleRangeBarCount:eligible.length,restrictedRangeBarCount:recent.filter(b=>b.qualityStatus!=='PASS').length},
    sources:Object.entries(chart?.levels||{}).map(([id,value])=>({id,availability:value?.availability||'UNAVAILABLE',
      qualityStatus:value?.qualityStatus||null,reason:value?.reason||null,qualityReasons:value?.qualityReasons||[],
      structureEligibility:value?.structureEligibility||null})),
  });
}

export function buildDecisionLevelWatch({chart,observedFlow=null,marketPulse=null,snapshotTime=new Date().toISOString(),maxVisible=3}={}){
  const currentPrice=finite(chart?.lastPrice);
  const sourceAvailableAt=iso(chart?.availableAt);
  const sourceGeometry=hasSourceTimeGeometry(chart)&&chart.mode==='LIVE'
    &&Date.parse(chart.structureEligibility.availableAt)<=Date.parse(snapshotTime);
  const structureEligibility=sourceGeometry?chart.structureEligibility:null;
  const identity=Object.freeze({actualContract:chart?.actualContract||null,tradeDate:chart?.tradeDate||null,session:chart?.session||null});
  const unavailable=reason=>Object.freeze({schemaVersion:'decision-level-watch-v3',state:'UNAVAILABLE',reason,structureEligibility,unavailabilityDiagnostics:unavailabilityDiagnostics(chart,reason,snapshotTime),snapshotTime:iso(snapshotTime),sourceAvailableAt,identity,levels:Object.freeze([]),nextWatch:null,scenarioWatch:null,zonePoints:null,formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false});
  if(currentPrice==null)return unavailable('CURRENT_PRICE_UNAVAILABLE');
  if(!iso(snapshotTime)||!Object.values(identity).every(Boolean))return unavailable('CHART_IDENTITY_OR_TIME_UNAVAILABLE');
  if(!sourceAvailableAt||Date.parse(sourceAvailableAt)>Date.parse(snapshotTime))return unavailable('CHART_AVAILABLE_AT_INVALID');
  if(Date.parse(snapshotTime)-Date.parse(sourceAvailableAt)>LIVE_SOURCE_FRESHNESS_MS)return unavailable('CHART_SOURCE_STALE');
  const bars=completedBars(chart,snapshotTime);
  const ranges=bars.slice(-12).filter(b=>isStructureEligible(b)).map(b=>finite(b.high)-finite(b.low)).filter(Number.isFinite);
  const med=median(ranges);
  if(!(med>0))return unavailable('OBSERVATION_ZONE_UNAVAILABLE');
  const zone=clamp(Math.round(med*.35),6,30);
  const L=chart?.levels||{};const rows=[];const currentQuality=chart?.qualityStatus||'UNKNOWN';
  const geometryReady=currentQuality==='PASS'||sourceGeometry;
  const inheritedQuality=sourceGeometry?null:currentQuality;
  const push=x=>{
    if(!x||!x.availableAt||Date.parse(x.availableAt)>Date.parse(snapshotTime))return;
    if(x.actualContract&&x.actualContract!==identity.actualContract)return;
    if(x.family==='PRIOR_REFERENCE'){
      if(x.tradeDate&&x.tradeDate>=identity.tradeDate)return;
    }else if((x.tradeDate&&x.tradeDate!==identity.tradeDate)||(x.session&&x.session!==identity.session))return;
    rows.push(x);
  };
  push(levelRow(L.vwap,{id:'VWAP',family:'VWAP',label:(chart?.vwapSession||chart?.session||'Session')+' VWAP',priority:100,qualityStatus:inheritedQuality,why:'目前交易時段成交均價參考；重要的是測試後市場是否真正接受，而不是單純穿越。'}));
  if(chart?.openingRange?.status==='READY'||(sourceGeometry&&hasSourceTimeGeometry(chart?.openingRange))){
    push(levelRow(L.openingRangeHigh,{id:'OR_HIGH',family:'OPENING_RANGE',label:'OR High',priority:96,qualityStatus:inheritedQuality,why:'已凍結的開盤區間上緣；觀察突破後是否被市場接受。'}));
    push(levelRow(L.openingRangeLow,{id:'OR_LOW',family:'OPENING_RANGE',label:'OR Low',priority:96,qualityStatus:inheritedQuality,why:'已凍結的開盤區間下緣；觀察跌破後是否被市場接受。'}));
  }
  const day=chart?.session==='DAY';
  push(levelRow(day?L.currentDayHigh:L.nightHigh,{id:'SESSION_HIGH',family:'SESSION_EXTREME',label:day?'DAY High':'NIGHT High',priority:91,qualityStatus:inheritedQuality,why:'目前交易時段已形成高點；再次接近時觀察突破是否有價格延伸。'}));
  push(levelRow(day?L.currentDayLow:L.nightLow,{id:'SESSION_LOW',family:'SESSION_EXTREME',label:day?'DAY Low':'NIGHT Low',priority:91,qualityStatus:inheritedQuality,why:'目前交易時段已形成低點；再次接近時觀察跌破是否有價格延伸。'}));
  const swings=recentSwings(bars);
  const swingQuality=swing=>!sourceGeometry&&currentQuality!=='PASS'?currentQuality
    :swing.inputBars.every(b=>b.qualityStatus==='PASS')?'PASS':'QUALITY_INSUFFICIENT';
  const swingProof=swing=>sourceGeometry?{
    qualityReasons:[...new Set(swing.inputBars.flatMap(b=>b.qualityReasons||[]))],
    timeLineageViolationCount:swing.inputBars.reduce((n,b)=>n+(b.timeLineageViolationCount||0),0),
    structureEligibility:{...swing.bar.structureEligibility,availableAt:swing.confirmedAt,
      completionAvailableAt:swing.confirmedAt,
      completionSourceEventTime:swing.confirmBar.structureEligibility?.completionSourceEventTime||null,
      inputBarTimes:swing.inputBars.map(b=>b.time),
      inputCompletions:swing.inputBars.map(b=>({time:b.time,
        availableAt:b.structureEligibility?.completionAvailableAt||null,
        sourceEventTime:b.structureEligibility?.completionSourceEventTime||null}))},
  }:{};
  if(swings.high)push({id:'SWING_HIGH',family:'RECENT_SWING',label:'近期5分K局部高點',price:swings.high.price,priority:50,sourceId:'COMPLETED_5M_LOCAL_PIVOT',availableAt:swings.high.confirmedAt,formedAt:swings.high.confirmedAt,qualityStatus:swingQuality(swings.high),...swingProof(swings.high),why:'已完成5分K形成的局部高點；只有出現共振或形成後有效反應時才提高優先級。'});
  if(swings.low)push({id:'SWING_LOW',family:'RECENT_SWING',label:'近期5分K局部低點',price:swings.low.price,priority:50,sourceId:'COMPLETED_5M_LOCAL_PIVOT',availableAt:swings.low.confirmedAt,formedAt:swings.low.confirmedAt,qualityStatus:swingQuality(swings.low),...swingProof(swings.low),why:'已完成5分K形成的局部低點；只有出現共振或形成後有效反應時才提高優先級。'});
  push(levelRow(L.previousDayHigh,{id:'PRIOR_HIGH',family:'PRIOR_REFERENCE',label:'前一日盤高',priority:70,why:'前一交易日合法高點參考；優先級低於當前時段已驗證結構。'}));
  push(levelRow(L.previousDayLow,{id:'PRIOR_LOW',family:'PRIOR_REFERENCE',label:'前一日盤低',priority:70,why:'前一交易日合法低點參考；優先級低於當前時段已驗證結構。'}));
  push(levelRow(L.previousClose,{id:'PRIOR_CLOSE',family:'PRIOR_REFERENCE',label:'前一日盤收',priority:40,why:'前一交易日收盤參考；不等同即時支撐或壓力。'}));

  const mergeTolerance=Math.max(3,Math.round(zone*.35));
  const unique=dedupe(rows.filter(Boolean),mergeTolerance);
  const flow=flowContext(observedFlow,chart,snapshotTime);
  const participation=participationContext(bars,marketPulse);
  const decorated=unique.map(level=>{
    const event=eventState(level,bars,currentPrice,zone);
    const reaction=reactionHistory(level,bars,zone);
    const confluence=confluenceEvidence(level,rows,zone);
    const band=importanceBand(level,reaction,confluence);
    const contract=responseContract(level);
    const basis={
      importanceBand:band,
      structuralSource:sourceExplanation(level),
      confluence,
      reaction,
      currentConfirmation:{
        nearObservationZone:event.absoluteDistancePoints<=zone*2,
        observedFlow:flow,
        participation,
      },
    };
    return {...level,...event,...contract,importanceBand:band,basis,basisReasons:basisReasons(level,{band,confluence,reaction,event,flow,participation,zone}),why:summaryWhy(level,basis),zonePoints:zone};
  }).sort((a,b)=>
    structuralRank(b)-structuralRank(a)
    ||b.basis.confluence.count-a.basis.confluence.count
    ||(b.basis.reaction.meaningfulReactionCount||0)-(a.basis.reaction.meaningfulReactionCount||0)
    ||Number(isStructureEligible(b))-Number(isStructureEligible(a))
    ||a.absoluteDistancePoints-b.absoluteDistancePoints
  );
  const nodePool=decorated.filter(x=>isStructureEligible(x)&&x.importanceBand!=='CONTEXT');
  const next=[...(nodePool.length?nodePool:decorated)].sort((a,b)=>
    structuralRank(b)-structuralRank(a)
    ||(b.basis?.confluence?.count||0)-(a.basis?.confluence?.count||0)
    ||(b.basis?.reaction?.meaningfulReactionCount||0)-(a.basis?.reaction?.meaningfulReactionCount||0)
    ||Number(isStructureEligible(b))-Number(isStructureEligible(a))
    ||a.absoluteDistancePoints-b.absoluteDistancePoints
  )[0]||null;
  const longThreshold=next?next.price+zone:null;
  const shortThreshold=next?next.price-zone:null;
  const longTarget=next&&geometryReady&&isStructureEligible(next)?directionalTarget(decorated,next,'LONG',longThreshold):null;
  const shortTarget=next&&geometryReady&&isStructureEligible(next)?directionalTarget(decorated,next,'SHORT',shortThreshold):null;
  const scenarioWatch=next?Object.freeze({
    schemaVersion:'decision-scenario-watch-v1',
    directionState:scenarioDirectionState(next,zone),
    node:Object.freeze({
      id:next.id,family:next.family,label:next.label,price:next.price,state:next.state,
      importanceBand:next.importanceBand,sourceId:next.sourceId,availableAt:next.availableAt,
      qualityStatus:next.qualityStatus,qualityReasons:next.qualityReasons||[],structureEligibility:next.structureEligibility||null,why:next.why,basisReasons:Object.freeze([...(next.basisReasons||[])]),
    }),
    long:buildScenario('LONG',next,longTarget,{zone:geometryReady?zone:null,currentPrice,flow,levels:decorated,chartQuality:currentQuality,structureEligibility}),
    short:buildScenario('SHORT',next,shortTarget,{zone:geometryReady?zone:null,currentPrice,flow,levels:decorated,chartQuality:currentQuality,structureEligibility}),
    rrMeaning:'CONDITIONAL_STRUCTURAL_RR_NOT_WIN_RATE_NOT_EV_NOT_ENTRY_ADVICE',
    recommendation:false,
  }):null;
  // Preserve the selected node/targets/thresholds. Explain absence on the existing
  // Next Watch surface so a blank target is not the entire decision explanation.
  const observationGuidance=observationOnlyGuidance(next,scenarioWatch);
  const explainedNext=next&&observationGuidance?{...next,
    why:[observationGuidance.summary,observationGuidance.explanation,next.why].filter(Boolean).join(' '),
    watchFor:observationGuidance.watchFor,
    basisReasons:[...observationGuidance.basisReasons,...(next.basisReasons||[])],
  }:next;
  const displayIds=[];
  const display=[];
  for(const level of [next,longTarget,shortTarget,...decorated]){
    if(!level||displayIds.includes(level.id))continue;
    displayIds.push(level.id);display.push(level);
    if(display.length>=Math.max(1,Math.min(3,maxVisible)))break;
  }
  return Object.freeze({
    schemaVersion:'decision-level-watch-v3',state:display.length?'READY':'UNAVAILABLE',reason:display.length?null:'NO_LAWFUL_LEVELS',snapshotTime:iso(snapshotTime),sourceAvailableAt,identity,
    structureEligibility,currentPriceQualityStatus:currentQuality,
    currentPrice,zonePoints:zone,zoneMethod:'35%_RECENT_COMPLETED_5M_MEDIAN_RANGE_CLAMP_6_30_OBSERVATION_ONLY',
    rankingMethod:'EVIDENCE_FIRST_STRUCTURAL_CONFLUENCE_REACTION_THEN_PROXIMITY',
    levels:freezeRows(display),nextWatch:explainedNext?Object.freeze({...explainedNext}):null,scenarioWatch,observationGuidance,
    observedFlow:Object.freeze(flow),participation:Object.freeze(participation),
    formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false,
  });
}
