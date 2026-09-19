import { renderContextCards } from '/context-cards.mjs';
import { FRAMES, fmt } from '/presentation.mjs';
import { chartTrust, taipeiChartTime, sameChartSelection } from '/formal-presentation.mjs';
const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const stamp = value => value ? new Date(value).toLocaleString('zh-TW', {timeZone:'Asia/Taipei',hour12:false}) : '未知';
let chart, candles, volumes, vwap, evidence = null, requestId = 0, frame = '1m', palette = 'red-up';
let timer, pending = false, resizeObserver;
let lastSelection=null, chartIdentity=null;
const unavailable = 'UNAVAILABLE · 正式動態 CVD 產出鏈尚未接通';
function clear(message) {
  resizeObserver?.disconnect(); resizeObserver=null;
  chart?.remove(); chart = candles = volumes = vwap = null; evidence = null;chartIdentity=null;
  document.body.dataset.priceBars = '0';
  document.body.dataset.endpoint = 'null';
  for (const id of ['contract','chart-contract','chart-price','context-price','path-value']) text(id,'不可用');
  text('trust','UNAVAILABLE'); text('source-notice',message);
  text('chart-identity','來源未驗證'); text('freshness','等待來源時間');
  text('chart-price-change','觀測漲跌不可用'); text('context-price-delta','觀測漲跌不可用');
  text('vwap','VWAP · UNAVAILABLE'); text('volume-subset','不可用');
  text('cvd-value','CVD 不可用'); text('cvd-sign',unavailable); text('endpoint',unavailable);
  text('context-label','Session Context'); text('context-scope','UNAVAILABLE');
  text('context-quality','UNAVAILABLE'); text('context-relationship','暫無法判讀');
  text('context-explanation',unavailable); text('context-summary','既有 Pressure / Response / Path 可在台指期貨工作區檢視。');
  text('handoff-state','UNAVAILABLE'); text('handoff-reason','尚無合法相鄰盤別 CVD 證據');
  text('timeline-status','未接通正式 Relationship 產出；不補造轉換');
  $('chart-empty').hidden = false; text('chart-empty',message);
}
async function api(route) {
  const response = await fetch(route,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status===401) { $('login').hidden=false; throw Error('請使用既有 Dashboard 密碼登入。'); }
  if(!response.ok) throw Error('資料讀取失敗：'+response.status);
  return response.json();
}
function colors() {
  const p=window.TraderTerminalShell.PALETTES[palette];
  document.documentElement.style.setProperty('--price-up',p.up);
  document.documentElement.style.setProperty('--price-down',p.down);
  return p;
}
function draw(data) {
  const L=window.LightweightCharts,p=colors();
  const identity=[data.actualContract,data.tradeDate,data.session,frame].join('|');
  if(chart&&!sameChartSelection(chartIdentity,identity)){resizeObserver?.disconnect();chart.remove();chart=null;}
  const created=!chart;
  if(created){
  chartIdentity=identity;
  chart=L.createChart($('chart'),{autoSize:true,layout:{background:{color:'#091724'},textColor:'#B8CBDC',fontSize:11},
    timeScale:{timeVisible:true,tickMarkFormatter:t=>taipeiChartTime(t)},localization:{timeFormatter:t=>stamp(t*1000)},rightPriceScale:{minimumWidth:75}});
  candles=chart.addSeries(L.CandlestickSeries,{upColor:p.up,downColor:p.down,wickUpColor:p.up,wickDownColor:p.down,borderVisible:false},0);
  volumes=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false},1);
  vwap=chart.addSeries(L.LineSeries,{color:'#E8C76A',lineWidth:1,priceLineVisible:false},0);
  // Empty evidence panes preserve the accepted layout without importing a historical CVD bundle.
  chart.addSeries(L.LineSeries,{color:'#46C7F4'},2);
  chart.addSeries(L.HistogramSeries,{},3);
  chart.panes().forEach((p,i)=>p.setStretchFactor([.58,.09,.23,.10][i]));
  const resize=()=>{const height=$('chart').clientHeight-31;
    document.querySelector('.volume-label').style.top=(height*.58+2)+'px';
    document.querySelector('.cvd-label').style.top=(height*.67+3)+'px';
    document.querySelector('.delta-label').style.top=(height*.90+4)+'px';};
  resize();resizeObserver=new ResizeObserver(resize);resizeObserver.observe($('chart'));
  }
  candles.applyOptions({upColor:p.up,downColor:p.down,wickUpColor:p.up,wickDownColor:p.down});
  const bars=(data.bars||[]).map(b=>({...b,time:typeof b.time==='number'?b.time:Date.parse(b.time)/1000}));
  candles.setData(bars.map(({time,open,high,low,close})=>({time,open,high,low,close})));
  volumes.setData(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?p.upVolume:p.downVolume})));
  vwap.setData((data.vwap||[]).filter(p=>Number.isFinite(p.value)).map(p=>({time:typeof p.time==='number'?p.time:Date.parse(p.time)/1000,value:p.value})));
  if(created)chart.timeScale().fitContent();
  $('chart-empty').hidden=bars.length>0;
  document.body.dataset.priceBars=String(bars.length);
  text('volume-subset',bars.length?fmt(bars.reduce((s,b)=>s+b.volume,0)):'不可用');
  text('vwap','VWAP '+fmt(data.vwap?.at(-1)?.value));
}
async function load() {
  const serial=++requestId;
  const selection=[$('product-select').value,$('view').value,frame].join('|');
  if(!sameChartSelection(lastSelection,selection)){
    clear('正在讀取正式行情 API…');renderContextCards($('lower-cards'),null,{available:false});lastSelection=selection;
  }
  if($('product-select').value!=='TX') { pending=false;text('source-notice','UNAVAILABLE · 既有行情 API 僅提供 TX'); return; }
  pending=true;
  try {
    const [session,price,flow,background,health]=await Promise.all([
      api('/api/session'),api('/api/v1/tx-chart?mode=LIVE&session='+$('view').value.toUpperCase()+'&timeframe='+frame),
      api('/api/v1/observed-flow'),api('/api/lower'),api('/healthz')]);
    if(serial!==requestId) return;
    if(!session.authenticated) throw Error('請登入');
    $('login').hidden=true;
    const data=price.data;
    evidence={chart:data,observedFlow:flow.data,background,version:health.versionTruth,
      receivedAt:new Date().toISOString(),cvd:{status:'UNAVAILABLE',reason:'FORMAL_CVD_PRODUCER_NOT_BOUND'}};
    draw(data);
    text('contract',data.actualContract||'UNKNOWN'); text('chart-contract',data.actualContract||'UNKNOWN');
    text('session-pill',data.session||'UNKNOWN');
    text('chart-price',fmt(data.lastPrice)); text('context-price',fmt(data.lastPrice));
    text('chart-identity',[data.actualContract,data.tradeDate,data.session].map(v=>v||'UNKNOWN').join(' / '));
    // READY is API eligibility, never a claim of live reception or complete session.
    const trust=chartTrust(data);
    text('trust',trust.state);
    text('source-notice',(trust.reasons.join(' / ')||'既有 TX 行情 API')+' · CVD / Relationship / Handoff 尚未接通');
    text('freshness','最後行情 '+stamp(data.availableAt)+' · 畫面讀取 '+stamp(evidence.receivedAt));
    text('selected-truth',frame+' · API '+trust.eligibility+' · CVD 力價關係不可用；原有力道工作區保留');
    text('version','正式入口 · HEAD '+(health.runtimeCommit||'UNKNOWN').slice(0,12));
    $('month-select').replaceChildren(new Option(data.contractMonth||'目前 API 契約',data.contractMonth||'current'));
    renderContextCards($('lower-cards'),background,{available:Boolean(background)});
    text('lower-date',background?'HISTORICAL · '+(background.asOfDate||'日期未知')+' · 獨立日期背景':'UNAVAILABLE');
  } catch(error) { if(serial===requestId){clear(error.message);renderContextCards($('lower-cards'),null,{available:false});} }
  finally { if(serial===requestId) pending=false; }
}
$('month-select').disabled=true; $('month-select').title='沿用既有行情 API 解析的實際契約；不固定歷史月份';
$('month-select').replaceChildren(new Option('目前 API 契約','current'));
$('fast-lights').replaceChildren(...FRAMES.map(f=>{
  const button=document.createElement('button');button.className='scan-button';button.dataset.state='UNAVAILABLE';button.dataset.frame=f;
  const light=document.createElement('i');light.className='light neutral';
  const name=document.createElement('b');name.textContent=f;
  const state=document.createElement('small');state.textContent='UNAVAILABLE';button.append(light,name,state);
  button.setAttribute('aria-label',f+' 暫無法判讀 UNAVAILABLE');
  button.addEventListener('click',()=>{frame=f;load();});return button;
}));
$('relationship-rows').replaceChildren(...FRAMES.map(f=>{
  const row=document.createElement('tr');for(const value of [f,'不可用','不可用','暫無法判讀','UNAVAILABLE']) {
    const cell=document.createElement('td');cell.textContent=value;row.append(cell);
  }return row;
}));
function details(kind) {
  text('drawer-title',kind==='settings'?'設定':'正式資料證據');
  text('drawer-copy','行情、力道、背景各保留來源時間；不拼成同 cutoff 的 CVD。原有完整功能與資料品質請至工作區。');
  text('drawer-json',JSON.stringify(evidence,null,2));$('drawer').showModal();
}
document.addEventListener('click',e=>{const open=e.target.closest('[data-open]');if(open)details(open.dataset.open);});
$('detail-open').addEventListener('click',()=>{location.href='/workspace?space=futures&section=quality';});
$('drawer-close').addEventListener('click',()=>$('drawer').close());
$('refresh').addEventListener('click',load); $('view').addEventListener('change',load);
$('product-select').addEventListener('change',load);
$('palette').addEventListener('change',()=>{palette=$('palette').value;load();});
$('fit').addEventListener('click',()=>chart?.timeScale().fitContent());
$('show-markers').disabled=true;$('show-markers').title='沒有正式 Relationship 轉換證據';
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(evidence,null,2));text('copy-status','已複製來源快照');}catch{text('copy-status','複製失敗');}});
$('ask-open').addEventListener('click',()=>{$('ask-form').reset();text('ask-identity','正式行情；CVD 尚未接通');text('ask-cutoff',stamp(evidence?.chart?.availableAt));text('ask-source','僅試填，不送出');$('ask-drawer').showModal();});
$('ask-close').addEventListener('click',()=>$('ask-drawer').close());
$('ask-drawer').addEventListener('close',()=>{$('ask-form').reset();$('ask-open').focus();});
$('ask-form').addEventListener('submit',e=>e.preventDefault());
$('login').addEventListener('submit',async e=>{
  e.preventDefault();try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('access').value})});
    $('access').value='';if(!response.ok)throw Error('登入失敗');await load();
  }catch(error){clear(error.message);}
});
await load();
// Serialize periodic reads, expire visible evidence on transport failures, stop in background.
timer=setInterval(()=>{if(!document.hidden&&!pending)load();},5000);
window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
