import {renderObservation} from '/observation.mjs';
import {renderContextCards} from '/context-cards.mjs';
import {LABELS,FRAMES,FLOW,fmt,signed,windowPresentation,cvdChunks,deltaChunks,timelineTime,scopeLabel,pressureCells,evidenceDirection,observedPricePercent,relationshipExplanation,contextSummary} from '/presentation.mjs';
const $=id=>document.getElementById(id),time=t=>t==null?'時間未知':new Date(t).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const shortTime=t=>t==null?'未知':new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const text=(id,s)=>{$(id).textContent=s;},node=(tag,s,cls)=>{const el=document.createElement(tag);if(s!=null)el.textContent=s;if(cls)el.className=cls;return el;};
let current=null,lower=null,chart=null,candle=null,volume=null,serial=0,frame='1m',view='day',selectedProduct='TX',selectedMonth='current',palette='red-up',chartObserver=null,markerApi=null,markerData=[];
const LOWER_TTL_MS=60000;
let lowerPending=null,lowerAttemptAt=-Infinity,lowerLoading=false,lowerError=null,lowerSerial=0,authEpoch=0;
const selectionAvailable=()=>selectedProduct==='TX';
const handoffLabels={CONFIRMED_CONTINUATION:'延續獲確認',CONFIRMED_BUT_WEAKENING:'延續但轉弱',PRIOR_SESSION_REJECTED:'前勢遭拒絕',OPPOSITE_TAKEOVER:'反向已接手',UNCONFIRMED_OR_CONFLICT:'尚未獲確認',UNAVAILABLE:'暫無法判讀'};
function numericClass(el,value){el.classList.remove('positive-text','negative-text');if(value>0)el.classList.add('positive-text');else if(value<0)el.classList.add('negative-text');}
function metric(label,value){const el=node('div',null,'metric');el.append(node('span',label),node('b',value));return el;}
function clearChart(){chartObserver?.disconnect();chartObserver=null;if(chart)chart.remove();chart=candle=volume=markerApi=null;markerData=[];document.body.dataset.markerCount='0';}
function fail(message){
  renderObservation($('cvd-observation'),null,frame);
  $('month-select').replaceChildren(new Option('來源契約不可用','current'));
  if($('drawer').open)$('drawer').close();text('drawer-json','UNAVAILABLE');for(const key of ['artifact','delta','head'])delete document.body.dataset[key];
  for(const id of ['context-price','context-price-delta','chart-price','chart-price-change'])$(id).className='price-neutral';
  $('chart-empty').hidden=true;text('chart-empty','');
  if($('ask-drawer').open)$('ask-drawer').close();current=null;clearChart();document.body.dataset.error='true';document.body.dataset.endpoint='null';document.body.dataset.contextScope='UNAVAILABLE';
  document.body.dataset.priceBars='0';document.body.dataset.panes='0';document.body.dataset.cvdChunks='0';text('chart-identity','來源未驗證');
  for(const id of ['context-price','context-price-delta','chart-price','chart-price-change','chart-contract','session-pill','contract','cvd-value','path-value','context-label','context-relationship','handoff-prior','handoff-current','handoff-gap'])text(id,'不可用');
  for(const id of ['quote-metrics','context-core-metrics','timeline'])$(id).replaceChildren();
  for(const id of ['context-scope','context-quality','coverage','unknown','origin','timeline-status','cvd-sign','volume-subset','freshness'])text(id,'');
  $('source-light').className='light neutral';$('handoff-strip').dataset.unavailable='true';text('handoff-reason','來源未驗證');$('handoff-reason').title='UNAVAILABLE';$('handoff-reason').hidden=false;$('path-value').title='不可用';text('trust','UNAVAILABLE');text('context-quality','UNAVAILABLE');text('source-notice',message);text('selected-truth','窗口未驗證');text('endpoint','端點未驗證');text('handoff-state','UNAVAILABLE');$('path-fill').style.width='0%';$('coverage-fill').style.width='0%';$('context-light').className='light neutral';text('context-explanation',relationshipExplanation('UNAVAILABLE'));text('context-summary','本盤證據不可用，暫無法彙整。');renderScan({});
}
async function api(route){const epoch=authEpoch,r=await fetch(route,{signal:AbortSignal.timeout(10000)});if(r.status===401){if(epoch===authEpoch)$('login').hidden=false;throw Error('請使用既有 Dashboard 密碼登入。');}if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(`資料無法載入（${r.status}） · ${e.reason||'讀取失敗'}`)};return r.json();}
async function authenticate(token){const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:token})});if(!r.ok)throw Error('存取碼無效或已過期');authEpoch++;lowerSerial++;lowerPending=null;lowerAttemptAt=-Infinity;$('login').hidden=true;}

function pressureBar(ratio,state) {
  const {cells,direction}=pressureCells(ratio,state),bar=node('span',null,'pressure-segments');
  bar.dataset.cells=String(cells);bar.dataset.direction=direction;bar.setAttribute('aria-hidden','true');
  for(let i=0;i<9;i++){const active=direction==='positive'?i>4&&i<=4+cells:direction==='negative'?i<4&&i>=4-cells:false;bar.append(node('i',null,i===4?'center':active?direction:''));}return bar;
}
function directionCell(value,state,kind) {
  const d=evidenceDirection(value,state),cell=node('td',null,`direction-cell ${kind}-${d.direction}`);
  cell.dataset.direction=d.direction;cell.append(node('b',d.symbol));cell.title=state==='AVAILABLE'?signed(value):`${state} · 已觀測 ${signed(value)} · 不推定窗口方向`;
  cell.append(node('small',state==='AVAILABLE'?signed(value):'—'));return cell;
}
function renderScan(scan){
  const lights=[],rows=[];
  for(const f of FRAMES){const m=windowPresentation(scan[f]);
    const b=node('button',null,'scan-button');b.type='button';b.dataset.frame=f;b.dataset.state=m.state;b.dataset.code=m.code;b.dataset.tone=m.tone;b.setAttribute('aria-pressed',String(f===frame));b.setAttribute('aria-label',`${f} ${m.label} ${m.state}`);b.title=`${m.label} · ${m.state}`;
    b.title=`${m.label} · ${m.state} · 主動成交壓力 ${m.state==='AVAILABLE'?fmt(m.pressure):'不可判定完整窗口方向'}`;
    b.append(node('i',null,`light ${m.tone}`),node('b',f),pressureBar(m.pressure,m.state),node('small',m.state));lights.push(b);
    const tr=node('tr');Object.assign(tr.dataset,{frame:f,state:m.state,code:m.code,tone:m.tone});tr.classList.toggle('selected',f===frame);
    const first=node('td'),name=node('button',f);name.type='button';name.dataset.frame=f;name.className='row-window';name.setAttribute('aria-label',`選擇 ${f} 最近變化`);first.append(name);
    const relation=node('td',null,'relationship-cell');relation.append(node('i',null,`light ${m.tone}`),node('b',m.label));
    const end=node('td');end.append(node('span',m.state,`truth-state ${m.state.toLowerCase()}`));
    tr.append(first,directionCell(m.response,m.state,'price'),directionCell(m.delta,m.state,'flow'),relation,end);rows.push(tr);
  }$('fast-lights').replaceChildren(...lights);$('relationship-rows').replaceChildren(...rows);
}
function coloredMetric(label,value,raw,kind='flow') {
  const el=metric(label,value);el.classList.add(`${kind}-${raw>0?'positive':raw<0?'negative':'neutral'}`);return el;
}
function renderContext(c){
  const e=c.evidence;text('context-label',c.label);text('context-scope',c.scope==='SESSION_TO_NOW'?'SESSION_TO_NOW':c.scope==='OBSERVED_SEGMENT_TO_NOW'?'OBSERVED SEGMENT':'UNAVAILABLE');
  text('context-relationship',LABELS[c.relationship.code]||LABELS.UNAVAILABLE);text('context-quality',e?.quality?.status||'UNAVAILABLE');
  const relation=windowPresentation({current:{relationship:c.relationship,current:e}});$('context-light').className=`light ${relation.tone}`;
  text('context-price',fmt(c.lastPrice?.price));const percent=observedPricePercent(c);text('context-price-delta',e?.priceDelta==null?'觀測漲跌 不可用':`觀測漲跌 ${signed(e.priceDelta)} 點（${percent==null?'不可用':`${percent>0?'+':''}${percent.toFixed(2)}%`}）`);$('context-price-delta').title='漲跌百分比以已觀測起點價為基準，非昨收漲跌幅';
  text('chart-price',fmt(c.lastPrice?.price));text('chart-price-change',e?.priceDelta==null?'觀測漲跌不可用':`${signed(e.priceDelta)}（${percent==null?'不可用':`${percent>0?'+':''}${percent.toFixed(2)}%`}）`);$('chart-price-change').title='觀測漲跌：以本盤已觀測起點價為基準，非昨收漲跌幅';
  $('quote-metrics').replaceChildren(metric('觀測起點價',fmt(c.firstPrice?.price)),metric('觀測成交量 · 口',fmt(e?.observedVolume)),metric('未平倉 · 口','不可用'));
  for(const id of ['context-price','context-price-delta','chart-price','chart-price-change'])$(id).className=e?.priceDelta>0?'price-positive':e?.priceDelta<0?'price-negative':'price-neutral';
  $('context-core-metrics').replaceChildren(
    coloredMetric('CVD 累積',signed(c.cumulativeCvd),c.cumulativeCvd,'cvd'),
    coloredMetric('ΔCVD',signed(e?.deltaCvd),e?.deltaCvd),
    coloredMetric('主動壓力',fmt(e?.pressure?.pressureRatio),e?.pressure?.pressureRatio),
    coloredMetric('價格反應',signed(e?.response?.displacementPoints),e?.response?.displacementPoints,'price'));
  text('context-explanation',relationshipExplanation(c.relationship.code));text('context-summary',contextSummary(c));
  const path=e?.pathEfficiency?.value;text('path-value',path==null?'不可用':path.toFixed(2));$('path-value').title=path==null?'不可用':`原始比值 ${path} · 完整證據見即時盤況明細`;$('path-fill').style.width=path==null?'0%':`${100*path}%`;
  const coverage=e?.pressure?.classifiedCoverage;text('coverage',`分類覆蓋率 ${coverage==null?'未知':(100*coverage).toFixed(2)+'%'}`);text('unknown',`UNKNOWN ${fmt(e?.unknownVolume)}`);$('coverage-fill').style.width=coverage==null?'0%':`${100*coverage}%`;
  text('origin',`起點 ${shortTime(c.origin?.eventTimeMs)} → ${shortTime(c.cutoff?.availableAtMs)} · ${fmt(c.observedSpanMs==null?null:c.observedSpanMs/1000)} 秒 · ${c.sessionStartProven?'盤別起點已證明':'觀測起算 · 非完整盤別'}`);
  document.body.dataset.contextScope=c.scope;
}
function renderHandoff(h){
  const unavailable=h.handoff.code==='UNAVAILABLE',comparable=h.pairing?.state==='COMPARABLE';$('handoff-strip').dataset.unavailable=String(unavailable);
  const reason=h.handoff.reason||h.pairing?.reason;const reasons={SESSION_SIDE_MISSING:'缺少合法相鄰盤別',SESSIONS_NOT_GOVERNED_ADJACENT:'盤別不相鄰',SESSION_CONTEXT_UNAVAILABLE:'盤別背景不可用'};
  text('handoff-state',handoffLabels[h.handoff.code]||'暫無法判讀');text('handoff-reason',unavailable?(reasons[reason]||'交接證據不足'):h.handoff.code);$('handoff-reason').title=`${h.handoff.code} · ${reason||''}`;
  text('handoff-prior',comparable?fmt(h.prior?.lastPrice?.price):'不可用');text('handoff-current',h.current?.reason?'不可用':fmt(h.current?.firstPrice?.price));text('handoff-gap',h.gap.state==='AVAILABLE'?signed(h.gap.points):'不可用');
}
function renderChart(p,r){
  const savedRange=chart?.timeScale().getVisibleRange();const savedIdentity=current?.chart?.identity?.join('|');clearChart();const L=window.LightweightCharts;if(!L?.createChart)throw Error('圖表相依套件未載入');
  chart=L.createChart($('chart'),{autoSize:true,layout:{background:{type:'solid',color:'#081827'},textColor:'#A9BDD0',fontSize:11,fontFamily:'Inter, system-ui, "Noto Sans TC", sans-serif',panes:{separatorColor:'#21445F',enableResize:false}},grid:{vertLines:{color:'#10263A'},horzLines:{color:'#10263A'}},rightPriceScale:{minimumWidth:75,scaleMargins:{top:.12,bottom:.12}},timeScale:{timeVisible:true,secondsVisible:true,rightOffset:4,tickMarkFormatter:t=>shortTime(t*1000)},localization:{timeFormatter:t=>time(t*1000)},crosshair:{mode:L.CrosshairMode.Normal}});
  const colors=window.TraderTerminalShell.PALETTES[palette];document.documentElement.style.setProperty('--price-up',colors.up);document.documentElement.style.setProperty('--price-down',colors.down);
  candle=chart.addSeries(L.CandlestickSeries,{upColor:colors.up,downColor:colors.down,wickUpColor:colors.up,wickDownColor:colors.down,borderVisible:false},0);
  const bars=p.bars.filter(b=>b.actualContract===p.actualContract&&b.tradeDate===p.tradeDate&&b.session===p.session);
  candle.setData(bars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
  volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
  volume.setData(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?colors.upVolume:colors.downVolume})));
  const visible={...p,segments:p.segments.filter(s=>s.actualContract===p.actualContract&&s.tradeDate===p.tradeDate&&s.session===p.session)};const chunks=cvdChunks(visible);let endpoint=null;
  for(const chunk of chunks){const line=chart.addSeries(L.LineSeries,{color:'#46C7F4',lineWidth:2,title:'',priceLineVisible:false,lastValueVisible:false,pointMarkersVisible:chunk.data.length===1},2);line.setData(chunk.data);line.priceScale().applyOptions({autoScale:true,scaleMargins:{top:.28,bottom:.14}});line.createPriceLine({price:0,color:'#718395',lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:false,title:'CVD 0'});if(chunk.segment===p.segmentIndex)endpoint=chunk.data.at(-1).value;}
  if(!chunks.length)chart.addSeries(L.LineSeries,{color:'#46C7F4'},2);
  for(const chunk of deltaChunks(visible,r)){const hist=chart.addSeries(L.HistogramSeries,{base:0,priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:base=>{const i=base();if(!i)return null;const a=Math.max(Math.abs(i.priceRange.minValue),Math.abs(i.priceRange.maxValue),1);return {...i,priceRange:{minValue:Math.min(i.priceRange.minValue,-a*.1),maxValue:Math.max(i.priceRange.maxValue,a*.1)}};}},3);hist.setData(chunk.data);hist.priceScale().applyOptions({scaleMargins:{top:.30,bottom:.10}});hist.createPriceLine({price:0,color:'#A9BDD0',lineWidth:1,lineStyle:L.LineStyle.Solid,axisLabelVisible:true,title:''});}
  if(!p.segments.length)chart.addSeries(L.HistogramSeries,{},3);
  const markers=r.markers.filter(m=>m.identity[0]===p.actualContract&&m.identity[1]===p.tradeDate&&m.identity[2]===p.session&&bars.some(b=>b.time===m.time)).slice(-8);
  markerData=markers.map(m=>({time:m.time,position:'aboveBar',shape:'circle',color:'#46C7F4',text:''}));if(L.createSeriesMarkers)markerApi=L.createSeriesMarkers(candle,[]);updateMarkers();
  const ratios=[.58,.09,.23,.10];chart.panes().forEach((pane,i)=>pane.setStretchFactor(ratios[i]));
  const resize=()=>{if(!chart)return;const h=$('chart').clientHeight-31;document.querySelector('.volume-label').style.top=`${h*.58+2}px`;document.querySelector('.cvd-label').style.top=`${h*.67+3}px`;document.querySelector('.delta-label').style.top=`${h*.90+4}px`;};
  resize();if(savedRange&&savedIdentity===p.identity.join('|'))chart.timeScale().setVisibleRange(savedRange);else chart.timeScale().fitContent();chartObserver=new ResizeObserver(resize);chartObserver.observe($('chart'));
  if(p.currentCvd!=null&&p.display.currentPlotAvailable&&endpoint!==p.currentCvd)throw Error('圖表與 API 累積端點不一致');
  document.body.dataset.endpoint=p.display.currentPlotAvailable&&p.currentCvd!=null?String(endpoint):'null';
  document.body.dataset.priceBars=String(bars.length);document.body.dataset.panes=String(chart.panes().length);document.body.dataset.cvdChunks=String(chunks.length);
  text('volume-subset',bars.length?fmt(bars.reduce((n,b)=>n+b.volume,0)):'不可用');
  text('cvd-value',`CVD ${signed(p.currentCvd)}`);text('cvd-sign',p.currentCvd==null?'累積不可用':p.currentCvd>0?'買方主動成交累積較多':p.currentCvd<0?'賣方主動成交累積較多':'已分類買賣累積差為 0');
  text('endpoint',p.currentCvd==null||!p.display.currentPlotAvailable?'目前端點不可用 · 歷史曲線不代表有效現值':`同 cutoff 累積 ${signed(p.currentCvd)} · 已核對端點`);
  $('chart-empty').hidden=bars.length>0;text('chart-empty','此片段尚無可顯示的 K 線與成交量。');
  const vwap=(p.vwap||[]).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.value));
  if(vwap.length){const line=chart.addSeries(L.LineSeries,{color:'#E6C46C',lineWidth:1,priceLineVisible:false,lastValueVisible:false},0);line.setData(vwap);}
  text('vwap',vwap.length?`VWAP · ${fmt(vwap.at(-1).value)}（同來源觀測累積）`:'VWAP · UNAVAILABLE（片段未提供）');
  document.body.dataset.vwapPoints=String(vwap.length);
  $('endpoint').nextElementSibling.textContent=p.projectionHash?'ΔCVD 為所選滾動窗，僅顯示已驗證時點；重疊柱不可加總':'ΔCVD 為所選滾動窗，重疊柱不可加總';
}
function renderObservationTruth(data){
  const m=renderObservation($('cvd-observation'),data,frame);
  $('source-light').className='light '+(m.state==='LIVE'?'positive':['STALE','DELAYED','DEGRADED'].includes(m.state)?'warning':'neutral');
  text('trust',m.state+' · '+m.quality);text('freshness','Observation V1 · '+(m.latencyMs===null?'延遲 UNKNOWN':fmt(m.latencyMs/1000)+'s'));
  text('context-summary',contextSummary({...data.context,freshness:{state:m.state}}));
}
function render(data){
  const p=data.chart,r=data.relationship,c=r.current?.current,m=windowPresentation(data.scan[frame]);
  const matchingProjection=p.projectionHash? p.projectionHash===r.projectionHash&&p.projectionHash===data.context.projectionHash : p.semanticHash===r.semanticHash;
  if(p.generationHash!==r.generationHash||!matchingProjection||p.cutoff.recordHash!==r.sourceCutoff.recordHash||p.cutoff.recordHash!==data.context.sourceCutoff.recordHash)throw Error('cutoff / 來源未通過核對');
  document.body.dataset.error='false';document.body.dataset.view=data.view;document.body.dataset.timeframe=frame;document.body.dataset.head=data.head;
  text('contract',p.actualContract||'UNKNOWN');text('chart-contract',p.actualContract||'UNKNOWN');text('chart-identity',`${p.actualContract||'UNKNOWN'} / ${p.tradeDate||'UNKNOWN'} / ${p.session||'UNKNOWN'}`);
  text('session-pill',p.session||'UNKNOWN');
  text('source-notice',data.kind==='SYNTHETIC_FIXTURE'?'合成資料｜僅檢查 UI 互動，不代表真實行情':`真實歷史觀測片段 · ${p.tradeDate} ${p.session} · ${data.context.sessionStartProven?'盘別起點已證明':'完整盤別未證明'} · 捕捉完整性 UNPROVEN · ${p.reason}`);$('source-notice').classList.toggle('synthetic',data.kind==='SYNTHETIC_FIXTURE');
  text('selected-truth',`${frame}${m.state==='AVAILABLE'?'':` ${m.state}`} · 觀測 ${m.span==null?'未知':Math.floor(m.span/1000)+'s'} / ${r.windowMs/1000}s`);

  renderScan(data.scan);renderContext(data.context);renderObservationTruth(data);renderHandoff(data.handoff);renderChart(p,r);
  const events=r.timeline.slice(-8);text('timeline-status',events.length?`${events.length} 個可見轉換`:'無合法狀態轉換 · 不補造事件');$('timeline').replaceChildren(...events.map(e=>node('li',`${time(timelineTime(e))} · ${LABELS[e.from]||e.from} → ${LABELS[e.to]||e.to}`)));
  text('version',`CRU-55 · HEAD ${data.head.slice(0,12)} · ${data.kind==='SYNTHETIC_FIXTURE'?'SYNTHETIC':'REAL FRAGMENT'}`);
  renderLower();
}
function renderLower(){
  renderContextCards($('lower-cards'),view==='demo'||!selectionAvailable()?null:lower,{demo:view==='demo',available:selectionAvailable()});
  $('lower-cards').setAttribute('aria-busy',String(lowerLoading));
  text('lower-date',view==='demo'?'SYNTHETIC / UI DEMO · 不混入真實背景':!selectionAvailable()?'UNAVAILABLE · 所選商品／月份無資料':lower?`HISTORICAL · ${lower.asOfDate||'日期未知'} 獨立日期背景${lowerLoading?' · 更新中':''}`:lowerLoading?'UNAVAILABLE · 背景讀取中':lowerError?'UNAVAILABLE · 背景讀取失敗；可按更新畫面重試':'UNAVAILABLE · 背景來源未載入');
}
function refreshLower({force=false}={}){
  if(lowerPending)return lowerPending;
  const now=Date.now();
  if(!force&&now-lowerAttemptAt<LOWER_TTL_MS)return Promise.resolve();
  const request=++lowerSerial,epoch=authEpoch;
  lowerAttemptAt=now;lowerLoading=true;lowerError=null;renderLower();
  lowerPending=(async()=>{
    try{const data=await api('/api/lower');if(request===lowerSerial&&epoch===authEpoch)lower=data;}
    catch(error){if(request===lowerSerial&&epoch===authEpoch){lower=null;lowerError=error.message;}}
    finally{
      if(request===lowerSerial&&epoch===authEpoch){
        lowerLoading=false;lowerPending=null;
        // Background evidence has its own source lifetime, independent of CVD.
        if($('drawer').open&&$('drawer').dataset.source==='background'){$('drawer').close();text('drawer-json','UNAVAILABLE');}
        renderLower();
      }
    }
  })();
  return lowerPending;
}

let pending=false,lastSelection=null;
async function load(){
  const request=++serial,selection=[view,frame,selectedProduct].join('|');
  if(lastSelection!==selection){fail('正在讀取帳本投影…');lastSelection=selection;}
  renderLower();
  if(!selectionAvailable()){fail('UNAVAILABLE · 此來源僅提供 TX');return;}
  pending=true;
  try{
    const data=await api(`/api/v1/cvd-overview?view=${view.toLowerCase()}&timeframe=${frame}`);
    if(request!==serial)return;
    if(current&&current.artifactHash!==data.artifactHash){
      if($('drawer').open)$('drawer').close();text('drawer-json','UNAVAILABLE');
      if($('ask-drawer').open)$('ask-drawer').close();
    }
    render(data);current=data;
    $('month-select').replaceChildren(new Option(data.chart.actualContract||'UNKNOWN','current'));
    document.body.dataset.artifact=data.artifactHash;
    document.body.dataset.delta=String(data.relationship.current?.current?.deltaCvd??'null');
  }catch(e){if(request===serial)fail(e.message);}
  finally{if(request===serial)pending=false;}
}
function details(which){
  $('drawer').dataset.source=['spot','futures','options','breadth','global','risk'].includes(which)?'background':'cvd';
  const c=current;let title='資料品質',copy='',value=null;
  const contextDate=lower?`歷史來源日期 ${lower.asOfDate}；不是所選盤別的同步證據。`:'背景未載入。';
  switch(which){
    case 'context':title='Session Context｜本盤背景';copy='觀測累積不是完整盤別。Price Δ 使用合法首末價格；Price Response 保留已接受計算，兩者不互相補值。Path 顯示原始比值，沒有智慧分數。';value=c?.context;break;
    case 'change':title=`${frame}｜最近變化`;copy='Relationship → Change → Rate / Persistence → Level。ΔCVD 是同窗淨主動成交增量；重疊窗口不能加總。PARTIAL 是觀測片段，不能當成完整窗口。';value=c?.relationship.current;break;
    case 'handoff':title='Market Handoff｜市場交接';copy='上一盤 → 觀測片段端點差 → 本盤。DAY / NIGHT CVD 分開；不連線、不相減、不插補休市 Volume / Pressure / Path。';value=c?.handoff;break;
    case 'settings':title='設定';copy='漲跌配色可由頂部選單切換。此總覽讀取版本化帳本投影；既有操作留在原工作區。GPT 回答未啟用。';value={pricePalette:palette,formalWeight:0,executionAuthorized:false};break;
    case 'scope':title='版本與資料範圍';copy='CRU-55 總覽接線候選。圖表、力價關係、本盤背景與市場交接來自同一帳本 cutoff 的版本化投影，定期讀取新產出。\n每個 cutoff 保留歷史觀測片段語意，不代表 LIVE 或完整交易日。VWAP 使用同來源合法成交的觀測累積；缺值保持不可用。正式部署狀態須另行驗收。\nAsk GPT 使用「複製快照」供人工討論；不呼叫 GPT API。既有 Workspace 沿用原認證與 API。';value=c?{head:c.head,artifactHash:c.artifactHash,producerMode:c.producerMode,view:c.view,kind:c.kind,formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}:null;break;
    case 'spot':title='現貨 / 指數貢獻';copy=contextDate+'\n沒有本盤 index leadership 資料，貢獻保留 UNAVAILABLE。';value=view==='demo'||!selectionAvailable()?null:{marketOverview:lower?.marketOverview,spotInstitutional:lower?.spotInstitutional};break;
    case 'futures':title='期貨流向';copy=contextDate+'\n法人 OI 不代表主動成交方向。缺失的前日差值保留不可用，不採快照中的佔位 0。';value=view==='demo'||!selectionAvailable()?null:{market:lower?.futuresMarket,institutional:lower?.futuresInstitutional};break;
    case 'options':title='選擇權背景';copy=contextDate+'\n歷史到期契約的 OI / Max Pain 不推論本盤價格，不代表 Dealer inventory 或成本。';value=view==='demo'||!selectionAvailable()?null:lower?.options;break;
    case 'breadth':title='市場參與度';copy=contextDate;value=view==='demo'||!selectionAvailable()?null:lower?.marketBreadth;break;
    case 'global':title='海外背景';copy=contextDate+'\n已有 USD/TWD / VIX 僅作歷史背景；NQ / SOX 同步本盤資料 UNAVAILABLE。';value=view==='demo'||!selectionAvailable()?null:{usdTwd:lower?.marketOverview?.data?.usdtwd,vix:lower?.marketOverview?.data?.vix,source:lower?.marketOverview?.source};break;
    case 'risk':title='風險 / 衝突';copy='背景資料與盤中圖表的日期獨立；不合成風險分數。UNKNOWN 不等於低風險。formalWeight=0。';value={sourceDates:lower?.sourceDates,context:current?.context?.evidence?.quality?.status,handoff:current?.handoff?.handoff?.code,limitations:lower?.limitations};break;
    default:title='Data Trust｜資料品質';copy='STALE != LIVE · Missing != 0 · Unknown != Neutral。分類覆蓋率不等於捕捉完整率。K / Volume 的合法子集可能少於 CVD；缺口保持缺口。';value=c?{freshness:c.chart.freshness,contextScope:c.context.scope,origin:c.context.origin,cutoff:c.chart.cutoff,summary:c.chart.summary,priceReason:c.chart.priceReason,priceExclusions:c.chart.priceTimeLineageViolationCount,segments:c.chart.segments.map(({points,...s})=>s),generation:c.chart.generationHash}:null;
  }text('drawer-title',title);text('drawer-copy',copy);text('drawer-json',value?JSON.stringify(value,null,2):'UNAVAILABLE');$('drawer').showModal();
}
function updateMarkers(){const shown=$('show-markers').checked&&document.querySelector('.timeline').open;markerApi?.setMarkers(shown?markerData:[]);document.body.dataset.markerCount=String(shown?markerData.length:0);}
$('show-markers').addEventListener('change',updateMarkers);document.querySelector('.timeline').addEventListener('toggle',updateMarkers);
document.addEventListener('click',e=>{const target=e.target.closest('[data-frame]');if(target){frame=target.dataset.frame;load();}const open=e.target.closest('[data-open]');if(open)details(open.dataset.open);});
// UI-only placeholder: reads the already-rendered source; no request, storage or answer.
function openAsk(){
  $('ask-form').reset();const c=current;
  text('ask-identity',c?`${selectedProduct} · ${c.chart.actualContract||'UNAVAILABLE'} · ${c.chart.session||'UNAVAILABLE'} · ${frame}`:`${selectedProduct} / ${selectedMonth} · UNAVAILABLE`);
  text('ask-cutoff',c?`觀測截止 ${time(c.context.cutoff?.availableAtMs)} · ${c.context.scope}`:'沒有已核對的快照');
  text('ask-source',c?`${c.kind==='SYNTHETIC_FIXTURE'?'SYNTHETIC / UI DEMO':'真實觀測片段'} · ${c.chart.freshness.state} · 捕捉完整性 ${c.context.captureCompleteness||'UNPROVEN'}`:'資料不可用；未帶入上一筆市場證據');
  $('ask-drawer').showModal();$('ask-kind').focus();
}
$('ask-open').addEventListener('click',openAsk);
$('ask-close').addEventListener('click',()=>$('ask-drawer').close());
$('ask-drawer').addEventListener('close',()=>{$('ask-form').reset();for(const id of ['ask-identity','ask-cutoff','ask-source'])text(id,'');$('ask-open').focus();});
$('ask-form').addEventListener('submit',e=>e.preventDefault());
$('product-select').addEventListener('change',()=>{selectedProduct=$('product-select').value;load();});$('month-select').addEventListener('change',()=>{selectedMonth=$('month-select').value;load();});
$('view').addEventListener('change',()=>{view=$('view').value.toLowerCase();load();});$('refresh').addEventListener('click',()=>{refreshLower({force:true});load();});$('fit').addEventListener('click',()=>chart?.timeScale().fitContent());
$('palette').addEventListener('change',()=>{palette=$('palette').value;if(current)renderChart(current.chart,current.relationship);});
$('detail-open').addEventListener('click',()=>details('quality'));$('drawer-close').addEventListener('click',()=>$('drawer').close());
$('copy').addEventListener('click',async()=>{if(!current){text('copy-status','資料不可用，未複製');return;}try{await navigator.clipboard.writeText(JSON.stringify({head:current.head,kind:current.kind,context:current.context,selectedWindow:current.relationship.current,...{formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}},null,2));text('copy-status','已複製隔離快照 · 僅供人工討論');}catch{text('copy-status','剪貼簿不可用；請從資料明細選取文字');}});
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await authenticate($('access').value);$('access').value='';await bootstrap();}catch(e){fail(e.message);}});
async function bootstrap(){await Promise.allSettled([refreshLower({force:true}),load()]);}
$('month-select').disabled=true;$('month-select').replaceChildren(new Option('來源契約','current'));
await bootstrap();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current)renderObservationTruth(current);});
const timer=setInterval(()=>{if(!document.hidden){if(current)renderObservationTruth(current);refreshLower();if(!pending)load();}},5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
