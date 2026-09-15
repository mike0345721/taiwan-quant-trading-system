import {LABELS,FRAMES,FLOW,fmt,signed,windowPresentation,cvdChunks,deltaChunks,timelineTime,scopeLabel} from '/presentation.mjs';
const $=id=>document.getElementById(id),time=t=>t==null?'時間未知':new Date(t).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const shortTime=t=>t==null?'未知':new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const text=(id,s)=>{$(id).textContent=s;},node=(tag,s,cls)=>{const el=document.createElement(tag);if(s!=null)el.textContent=s;if(cls)el.className=cls;return el;};
let current=null,lower=null,chart=null,candle=null,volume=null,serial=0,frame='1m',view='day',palette='red-up',chartObserver=null;
const handoffLabels={CONFIRMED_CONTINUATION:'延續獲確認',CONFIRMED_BUT_WEAKENING:'延續但轉弱',PRIOR_SESSION_REJECTED:'前勢遭拒絕',OPPOSITE_TAKEOVER:'反向已接手',UNCONFIRMED_OR_CONFLICT:'尚未獲確認',UNAVAILABLE:'暫無法判讀'};
function numericClass(el,value){el.classList.remove('positive-text','negative-text');if(value>0)el.classList.add('positive-text');else if(value<0)el.classList.add('negative-text');}
function metric(label,value){const el=node('div',null,'metric');el.append(node('span',label),node('b',value));return el;}
function clearChart(){chartObserver?.disconnect();chartObserver=null;if(chart)chart.remove();chart=candle=volume=null;}
function fail(message){
  current=null;clearChart();document.body.dataset.error='true';document.body.dataset.endpoint='null';document.body.dataset.contextScope='UNAVAILABLE';
  numericClass($('change-delta'),null);document.body.dataset.priceBars='0';document.body.dataset.panes='0';document.body.dataset.cvdChunks='0';text('chart-identity','來源未驗證');
  for(const id of ['price','contract','cvd-value','change-price','change-volume','change-delta','change-path','path-value','context-label','context-relationship','handoff-prior','handoff-current','handoff-gap'])text(id,'不可用');
  for(const id of ['session-metrics','timeline'])$(id).replaceChildren();
  for(const id of ['price-context','context-scope','context-quality','coverage','unknown','origin','timeline-status','cvd-sign','volume-subset','freshness'])text(id,'');
  text('trust','UNAVAILABLE');text('source-notice',message);text('selected-truth','窗口未驗證');text('endpoint','端點未驗證');text('handoff-state','UNAVAILABLE');$('path-fill').style.width='0%';renderScan({});
}
async function api(route){const r=await fetch(route);if(r.status===401){$('login').hidden=false;throw Error('請以本次 launcher 的本機啟動連結登入。');}if(!r.ok)throw Error(`資料無法載入（${r.status}）`);return r.json();}
async function authenticate(token){const r=await fetch('/session',{method:'POST',headers:{'Content-Type':'text/plain'},body:token});if(!r.ok)throw Error('存取碼無效或已過期');$('login').hidden=true;}
function renderScan(scan){
  const lights=[],rows=[];
  for(const f of FRAMES){const m=windowPresentation(scan[f]);
    const b=node('button',null,'scan-button');b.type='button';b.dataset.frame=f;b.dataset.state=m.state;b.dataset.code=m.code;b.dataset.tone=m.tone;b.setAttribute('aria-pressed',String(f===frame));b.setAttribute('aria-label',`${f} ${m.label} ${m.state}`);b.title=`${m.label} · ${m.state}`;
    b.append(node('i',null,`light ${m.tone}`),node('b',f),node('small',m.state));lights.push(b);
    const tr=node('tr');tr.dataset.frame=f;tr.dataset.state=m.state;tr.dataset.code=m.code;tr.dataset.tone=m.tone;tr.classList.toggle('selected',f===frame);
    const first=node('td'),name=node('button',f);name.type='button';name.dataset.frame=f;name.className='row-window';name.setAttribute('aria-label',`選擇 ${f} 最近變化`);first.append(node('i',null,`light ${m.tone}`),name);
    const middle=node('td');middle.append(node('b',m.label),node('small',`Δ ${signed(m.delta)} · P ${signed(m.response)}`));
    const end=node('td');end.append(node('span',m.state,'truth-state'));if(m.span!=null)end.append(node('small',`${Math.floor(m.span/1000)}s 觀測`));tr.append(first,middle,end);rows.push(tr);
  }$('fast-lights').replaceChildren(...lights);$('relationship-rows').replaceChildren(...rows);
}
function renderContext(c){
  const e=c.evidence;text('context-label',c.label);text('context-scope',c.scope==='SESSION_TO_NOW'?'SESSION_TO_NOW':c.scope==='OBSERVED_SEGMENT_TO_NOW'?'OBSERVED SEGMENT':'UNAVAILABLE');
  text('context-relationship',LABELS[c.relationship.code]||LABELS.UNAVAILABLE);text('context-quality',`${c.freshness.state} · ${e?.quality?.status||'UNAVAILABLE'} · 捕捉 UNPROVEN`);
  $('session-metrics').replaceChildren(...[
    ['Price Δ · 點',signed(e?.priceDelta)],['觀測 Volume · 口',fmt(e?.observedVolume)],['CVD · 口',signed(c.cumulativeCvd)],['ΔCVD · 口',signed(e?.deltaCvd)],['Executed Pressure',fmt(e?.pressure?.pressureRatio)],['Price Response · 點',signed(e?.response?.displacementPoints)]
  ].map(([k,v])=>metric(k,v)));
  const path=e?.pathEfficiency?.value;text('path-value',path==null?'不可用':String(path));$('path-fill').style.width=path==null?'0%':`${100*path}%`;
  text('coverage',`classifiedCoverage ${e?.pressure?.classifiedCoverage==null?'未知':(100*e.pressure.classifiedCoverage).toFixed(2)+'%'}`);text('unknown',`UNKNOWN ${fmt(e?.unknownVolume)}`);
  text('origin',`起點 ${shortTime(c.origin?.eventTimeMs)} → ${shortTime(c.cutoff?.availableAtMs)} · ${fmt(c.observedSpanMs==null?null:c.observedSpanMs/1000)} 秒\n${c.sessionStartProven?'盤別起點已證明':'觀測起算 · 非完整盤別'}`);
  document.body.dataset.contextScope=c.scope;
}
function renderHandoff(h){
  text('handoff-state',`${handoffLabels[h.handoff.code]||'暫無法判讀'} · ${h.handoff.code}`);
  const side=s=>s?.identity?`${s.identity[2]} ${s.identity[1]}｜${scopeLabel(s.contextScope)} · CVD ${signed(s.evidence?.deltaCvd)}`:'缺少合法時段';
  text('handoff-prior',side(h.prior));text('handoff-current',side(h.current));text('handoff-gap',`${h.gap.label||'觀測片段端點差'} ${signed(h.gap.points)}`);
}
function renderChart(p,r){
  clearChart();const L=window.LightweightCharts;if(!L?.createChart)throw Error('圖表相依套件未載入');
  chart=L.createChart($('chart'),{autoSize:true,layout:{background:{type:'solid',color:'#081827'},textColor:'#A9BDD0',fontSize:11,fontFamily:'Inter, system-ui, "Noto Sans TC", sans-serif',panes:{separatorColor:'#21445F',enableResize:false}},grid:{vertLines:{color:'#10263A'},horzLines:{color:'#10263A'}},rightPriceScale:{minimumWidth:75,scaleMargins:{top:.12,bottom:.12}},timeScale:{timeVisible:true,secondsVisible:true,rightOffset:4,tickMarkFormatter:t=>shortTime(t*1000)},localization:{timeFormatter:t=>time(t*1000)},crosshair:{mode:L.CrosshairMode.Normal}});
  const colors=window.TraderTerminalShell.PALETTES[palette];
  candle=chart.addSeries(L.CandlestickSeries,{upColor:colors.up,downColor:colors.down,wickUpColor:colors.up,wickDownColor:colors.down,borderVisible:false},0);
  const bars=p.bars.filter(b=>b.actualContract===p.actualContract&&b.tradeDate===p.tradeDate&&b.session===p.session);
  candle.setData(bars.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
  volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);
  volume.setData(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?colors.upVolume:colors.downVolume})));
  const chunks=cvdChunks(p);let endpoint=null;
  for(const chunk of chunks){const line=chart.addSeries(L.LineSeries,{color:'#46C7F4',lineWidth:2,title:'',priceLineVisible:false,lastValueVisible:false,pointMarkersVisible:chunk.data.length===1},2);line.setData(chunk.data);line.priceScale().applyOptions({autoScale:true,scaleMargins:{top:.28,bottom:.14}});line.createPriceLine({price:0,color:'#718395',lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:false,title:'CVD 0'});if(chunk.segment===p.segmentIndex)endpoint=chunk.data.at(-1).value;}
  if(!chunks.length)chart.addSeries(L.LineSeries,{color:'#46C7F4'},2);
  for(const chunk of deltaChunks(p,r)){const hist=chart.addSeries(L.HistogramSeries,{base:0,priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false,autoscaleInfoProvider:base=>{const i=base();if(!i)return null;const a=Math.max(Math.abs(i.priceRange.minValue),Math.abs(i.priceRange.maxValue),1);return {...i,priceRange:{minValue:Math.min(i.priceRange.minValue,-a*.1),maxValue:Math.max(i.priceRange.maxValue,a*.1)}};}},3);hist.setData(chunk.data);hist.priceScale().applyOptions({scaleMargins:{top:.30,bottom:.10}});hist.createPriceLine({price:0,color:'#A9BDD0',lineWidth:1,lineStyle:L.LineStyle.Solid,axisLabelVisible:true,title:''});}
  if(!p.segments.length)chart.addSeries(L.HistogramSeries,{},3);
  const markers=r.markers.filter(m=>m.identity[0]===p.actualContract&&m.identity[1]===p.tradeDate&&m.identity[2]===p.session&&bars.some(b=>b.time===m.time)).slice(-8);
  if(markers.length&&L.createSeriesMarkers)L.createSeriesMarkers(candle,markers.map(m=>({time:m.time,position:'aboveBar',shape:'circle',color:'#46C7F4',text:''})));
  const ratios=[.58,.09,.23,.10];chart.panes().forEach((pane,i)=>pane.setStretchFactor(ratios[i]));
  const resize=()=>{if(!chart)return;const h=$('chart').clientHeight-31;document.querySelector('.volume-label').style.top=`${h*.58+2}px`;document.querySelector('.cvd-label').style.top=`${h*.67+3}px`;document.querySelector('.delta-label').style.top=`${h*.90+4}px`;chart.timeScale().fitContent();};
  resize();chartObserver=new ResizeObserver(resize);chartObserver.observe($('chart'));
  if(p.currentCvd!=null&&p.display.currentPlotAvailable&&endpoint!==p.currentCvd)throw Error('圖表與 API 累積端點不一致');
  document.body.dataset.endpoint=p.display.currentPlotAvailable&&p.currentCvd!=null?String(endpoint):'null';
  document.body.dataset.priceBars=String(bars.length);document.body.dataset.panes=String(chart.panes().length);document.body.dataset.cvdChunks=String(chunks.length);
  text('price',bars.length?fmt(bars.at(-1).close):'價格不可用');text('price-context',bars.length?'最後合法 K 棒收價':'本片段無合法價格 K 棒');text('volume-subset',bars.length?`價格合法子集 · ${fmt(bars.reduce((n,b)=>n+b.volume,0))} 口`:'無合法價格子集');
  text('cvd-value',`CVD ${signed(p.currentCvd)}`);text('cvd-sign',p.currentCvd==null?'累積不可用':p.currentCvd>0?'買方主動成交累積較多':p.currentCvd<0?'賣方主動成交累積較多':'已分類買賣累積差為 0');
  text('endpoint',p.currentCvd==null||!p.display.currentPlotAvailable?'目前端點不可用 · 歷史曲線不代表有效現值':`同 cutoff 累積 ${signed(p.currentCvd)} · 已核對端點`);
  $('chart-empty').hidden=bars.length>0;text('chart-empty','K 線 / Volume：本片段無合法價格 K 棒。CVD 與價格的合法輸入集合不同。');
  text('vwap','VWAP · UNAVAILABLE（片段未提供）');
}
function render(data){
  const p=data.chart,r=data.relationship,c=r.current?.current,m=windowPresentation(data.scan[frame]);
  if(p.generationHash!==r.generationHash||p.semanticHash!==r.semanticHash||p.cutoff.recordHash!==r.sourceCutoff.recordHash||p.cutoff.recordHash!==data.context.sourceCutoff.recordHash)throw Error('cutoff / 來源未通過核對');
  document.body.dataset.error='false';document.body.dataset.view=data.view;document.body.dataset.timeframe=frame;document.body.dataset.head=data.head;
  text('contract',`${p.actualContract||'UNKNOWN'} · ${p.session||'UNKNOWN'}`);text('chart-identity',`${p.actualContract||'UNKNOWN'} / ${p.tradeDate||'UNKNOWN'} / ${p.session||'UNKNOWN'}`);
  text('trust',p.freshness.state);text('freshness',`來源 ${time(p.lastTradeAvailableAtMs)} · 非即時`);
  text('source-notice',data.kind==='SYNTHETIC_FIXTURE'?'SYNTHETIC / UI DEMO — 合成資料，僅檢查版面與互動；所有市場證據均為合成。':`真實歷史觀測片段 · ${p.tradeDate} ${p.session} · ${data.context.sessionStartProven?'盘別起點已證明':'完整盤別未證明'} · 捕捉完整性 UNPROVEN`);$('source-notice').classList.toggle('synthetic',data.kind==='SYNTHETIC_FIXTURE');
  text('selected-truth',`${frame} ${m.state} · 觀測 ${m.span==null?'未知':Math.floor(m.span/1000)+'s'} / ${r.windowMs/1000}s`);
  text('change-price',signed(c?.response?.displacementPoints));text('change-volume',fmt(c?.observedVolume));text('change-delta',signed(c?.deltaCvd));text('change-path',c?.pathEfficiency?.value==null?'不可用':String(c.pathEfficiency.value));numericClass($('change-delta'),c?.deltaCvd);
  renderScan(data.scan);renderContext(data.context);renderHandoff(data.handoff);renderChart(p,r);
  const events=r.timeline.slice(-8);text('timeline-status',events.length?`${events.length} 個可見轉換`:'無合法狀態轉換 · 不補造事件');$('timeline').replaceChildren(...events.map(e=>node('li',`${time(timelineTime(e))} · ${LABELS[e.from]||e.from} → ${LABELS[e.to]||e.to}`)));
  text('version',`CRU-55 · HEAD ${data.head.slice(0,12)} · ${data.kind==='SYNTHETIC_FIXTURE'?'SYNTHETIC':'REAL FRAGMENT'}`);
  for(const b of $('frames').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.frame===frame));renderLower();
}
function renderLower(){
  const demo=view==='demo',s=demo?null:lower;
  text('lower-date',demo?'SYNTHETIC / UI DEMO · 真實背景不混入':s?`STALE · ${s.asOfDate} 歷史快照`:'MISSING · 未載入背景快照');
  const val=(part,k)=>s?.[part]?.ok?s[part].data?.[k]:null;
  const pairs=(id,values)=>$(id).replaceChildren(...values.map(([k,v])=>{const row=node('div');row.append(node('span',k),node('strong',v));return row;}));
  const index=val('marketOverview','twii'),f=val('futuresMarket','txDay'),o=s?.options?.ok?s.options.data:null,b=val('marketBreadth','listed');
  text('spot-value',index?fmt(index.price):'UNAVAILABLE');pairs('spot-metrics',[['加權漲跌',signed(index?.change)],['櫃買',fmt(val('marketOverview','otc')?.price)]]);
  text('futures-value',signed(val('futuresInstitutional','foreignNet')));pairs('futures-metrics',[['外資淨 OI','口'],['TX 未平倉',fmt(f?.openInterest)],['契約',f?.contract||'UNAVAILABLE']]);
  text('options-value',o?.oiPcRatio==null?'UNAVAILABLE':`P/C ${fmt(o.oiPcRatio)}`);pairs('options-metrics',[['Call / Put Wall',o?`${fmt(o.callWall?.strike)} / ${fmt(o.putWall?.strike)}`:'不可用'],['契約',o?.contract||'UNAVAILABLE']]);
  text('breadth-value',b?`${fmt(b.advance)} / ${fmt(b.decline)}`:'UNAVAILABLE');pairs('breadth-metrics',[['上市上漲 / 下跌','家'],['平盤',fmt(b?.unchanged)]]);
}
async function load(){const request=++serial;fail('正在載入隔離投影…');text('trust','載入中');renderLower();try{const data=await api(`/api/preview?view=${view}&timeframe=${frame}`);if(request!==serial)return;current=data;render(data);}catch(e){if(request===serial)fail(e.message);}}
function details(which){
  const c=current;let title='資料品質',copy='',value=null;
  const contextDate=lower?`歷史來源日期 ${lower.asOfDate}；不是所選盤別的同步證據。`:'背景未載入。';
  switch(which){
    case 'context':title='Session Context｜本盤背景';copy='觀測累積不是完整盤別。Price Δ 使用合法首末價格；Price Response 保留已接受計算，兩者不互相補值。Path 顯示原始比值，沒有智慧分數。';value=c?.context;break;
    case 'change':title=`${frame}｜最近變化`;copy='Relationship → Change → Rate / Persistence → Level。ΔCVD 是同窗淨主動成交增量；重疊窗口不能加總。PARTIAL 是觀測片段，不能當成完整窗口。';value=c?.relationship.current;break;
    case 'handoff':title='Market Handoff｜市場交接';copy='上一盤 → 觀測片段端點差 → 本盤。DAY / NIGHT CVD 分開；不連線、不相減、不插補休市 Volume / Pressure / Path。';value=c?.handoff;break;
    case 'scope':title='版本與預覽範圍';copy='CRU-55 隔離 Dashboard 預覽。保留原版導覽、價格配色、K / Volume 主區域、Fast Scan、右側解釋與下方產品模組。\nVWAP 位置保留，CRU-54 接受的價格片段未提供 VWAP；不另推算。正式 runtime 目前未啟動，UI 以 approved main source 為基礎對照。\nAsk GPT 使用「複製快照」供人工討論；不呼叫 GPT API。完整研究頁、資料更新、正式日誌與營運控制未接入本隔離預覽。';value=c?{head:c.head,acceptedHead:c.acceptedHead,approvedMain:c.approvedMain,view:c.view,kind:c.kind,formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}:null;break;
    case 'spot':title='現貨 / 指數貢獻';copy=contextDate+'\n沒有本盤 index leadership 資料，貢獻保留 UNAVAILABLE。';value=view==='demo'?null:{marketOverview:lower?.marketOverview,spotInstitutional:lower?.spotInstitutional};break;
    case 'futures':title='期貨流向';copy=contextDate+'\n法人 OI 不代表主動成交方向。缺失的前日差值保留不可用，不採快照中的佔位 0。';value=view==='demo'?null:{market:lower?.futuresMarket,institutional:lower?.futuresInstitutional};break;
    case 'options':title='選擇權背景';copy=contextDate+'\n歷史到期契約的 OI / Max Pain 不推論本盤價格，不代表 Dealer inventory 或成本。';value=view==='demo'?null:lower?.options;break;
    case 'breadth':title='市場參與度';copy=contextDate;value=view==='demo'?null:lower?.marketBreadth;break;
    case 'global':title='海外背景';copy=contextDate+'\n已有 USD/TWD / VIX 僅作歷史背景；NQ / SOX 同步本盤資料 UNAVAILABLE。';value=view==='demo'?null:{usdTwd:lower?.marketOverview?.data?.usdtwd,vix:lower?.marketOverview?.data?.vix,source:lower?.marketOverview?.source};break;
    case 'risk':title='風險 / 衝突';copy='本盤風險模型尚無合法輸出。UNAVAILABLE 不等於低風險。formalWeight=0；研究未 Promotion。';break;
    default:title='Data Trust｜資料品質';copy='STALE != LIVE · Missing != 0 · Unknown != Neutral。分類覆蓋率不等於捕捉完整率。K / Volume 的合法子集可能少於 CVD；缺口保持缺口。';value=c?{freshness:c.chart.freshness,contextScope:c.context.scope,origin:c.context.origin,cutoff:c.chart.cutoff,summary:c.chart.summary,priceReason:c.chart.priceReason,priceExclusions:c.chart.priceTimeLineageViolationCount,segments:c.chart.segments.map(({points,...s})=>s),generation:c.chart.generationHash}:null;
  }text('drawer-title',title);text('drawer-copy',copy);text('drawer-json',value?JSON.stringify(value,null,2):'UNAVAILABLE');$('drawer').showModal();
}
for(const f of FRAMES){const b=node('button',f);b.dataset.frame=f;b.type='button';b.setAttribute('aria-pressed',String(f===frame));$('frames').append(b);}
document.addEventListener('click',e=>{const target=e.target.closest('[data-frame]');if(target){frame=target.dataset.frame;load();}const open=e.target.closest('[data-open]');if(open)details(open.dataset.open);});
$('view').addEventListener('change',()=>{view=$('view').value;load();});$('refresh').addEventListener('click',load);$('fit').addEventListener('click',()=>chart?.timeScale().fitContent());
$('palette').addEventListener('change',()=>{palette=$('palette').value;if(current)renderChart(current.chart,current.relationship);});
$('detail-open').addEventListener('click',()=>details('quality'));$('drawer-close').addEventListener('click',()=>$('drawer').close());
$('copy').addEventListener('click',async()=>{if(!current){text('copy-status','資料不可用，未複製');return;}try{await navigator.clipboard.writeText(JSON.stringify({head:current.head,kind:current.kind,context:current.context,selectedWindow:current.relationship.current,...{formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}},null,2));text('copy-status','已複製隔離快照 · 僅供人工討論');}catch{text('copy-status','剪貼簿不可用；請從資料明細選取文字');}});
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await authenticate($('access').value);$('access').value='';await bootstrap();}catch(e){fail(e.message);}});
async function bootstrap(){try{lower=await api('/api/lower');}catch{lower=null;}await load();}
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);try{if(token)await authenticate(token);await bootstrap();}catch(e){fail(e.message);$('login').hidden=false;}
