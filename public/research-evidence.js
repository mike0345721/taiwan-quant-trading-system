const el=id=>document.getElementById(id);
let last=null,receivedWall=0,receivedMono=0,pending=false;
const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:3}):'—';
const reason=r=>'不可用 · '+(r||'資料不足');
function textNode(tag,text,className){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function table(headers,rows){const wrap=document.createElement('div');wrap.className='table-wrap';const t=document.createElement('table');
 const head=document.createElement('thead'),tr=document.createElement('tr');headers.forEach(h=>tr.append(textNode('th',h)));head.append(tr);t.append(head);
 const body=document.createElement('tbody');rows.forEach(r=>{const tr=document.createElement('tr');r.forEach(v=>tr.append(textNode('td',v)));body.append(tr);});t.append(body);wrap.append(t);return wrap;}
function active(e,now){return e?.state==='READY'&&Number.isFinite(Date.parse(e.validUntil))&&now<=Date.parse(e.validUntil);}
function paint(){
 const age=Math.max(0,performance.now()-receivedMono),now=Math.max(Date.now(),receivedWall+age,Date.parse(last?.servedAt)+age);
 const clockOK=last&&Math.abs(receivedWall-Date.parse(last.servedAt))<=5000&&Date.now()>=receivedWall-5000;
 const d=last?.depth,depth=el('depth');depth.replaceChildren();
 if(clockOK&&active(d,now)){depth.append(textNode('p',`價差 ${number(d.value.spreadTicks)} 跳 · 五檔不平衡 ${number(d.value.imbalance5)}`,'ready'));
  depth.append(table(['委買價','委買量','委賣價','委賣量'],d.value.bids.map((b,i)=>[number(b.price),number(b.volume),number(d.value.asks[i].price),number(d.value.asks[i].volume)])));
  depth.append(textNode('p',`${d.value.actualContract} · ${d.value.sourceTime}`,'meta'));
 }else depth.append(textNode('p',reason(d?.state==='READY'?'STALE_OR_CLOCK_UNVERIFIED':d?.reason),'unavailable'));
 const rows=(last?.windows||[]).map(w=>[w.label,clockOK&&active(w.pressure,now)?number(w.pressure.value):reason(w.pressure.reason||'STALE'),
  clockOK&&active(w.response,now)?`${number(w.response.value.displacementPoints)} 點 / 效率 ${number(w.response.value.efficiency)}`:reason(w.response.reason||'STALE'),
  w.classifiedCoverage===null?'—':number(w.classifiedCoverage*100)+'%']);
 el('flow').replaceChildren(rows.length?table(['時窗','Flow 比率','價格反應','分類覆蓋'],rows):textNode('p',reason('FLOW_MISSING'),'unavailable'));
 const outcomes=last?.outcomes||[];el('outcomes').replaceChildren(outcomes.length?table(['固定訊號','MFE / MAE 毛點數','最佳 / 最差淨點數','終點淨損益','出場淨損益','結果'],outcomes.slice(0,500).map(o=>[
  o.eventId,`${number(o.mfePoints)} / ${number(o.maePoints)}`,`${number(o.maxNetLiquidationPoints)} / ${number(o.minNetLiquidationPoints)}`,number(o.netEndpointPoints),number(o.netExitPoints),o.state==='BLOCKED'?reason(o.reason):(o.failureReasons?.join('、')||o.exitReason)])):
  textNode('p','沒有合格完整路徑，MFE、MAE 與含成本損益均不可用。','unavailable'));
 const c=last?.comparison,box=el('comparison');box.replaceChildren();
 if(!c?.metrics){box.append(textNode('p',reason(c?.reason||'QUALIFIED_CORPUS_MISSING'),'unavailable'));return;}
 box.append(textNode('p',`樣本 ${c.sampleSize} 日 · 信賴程度 ${c.confidence} · 尚未證實正期望值`));
 box.append(table(['組別','交易數 / 保留率','累積淨點數','最大回撤','最差5%均值'],Object.entries(c.metrics).map(([k,v])=>[k,`${v.trades} / ${number(v.coverage*100)}%`,number(v.totalNetPoints),number(v.maxDrawdownPoints),number(v.expectedShortfall5PctPoints)])));
 box.append(table(['比較','每日平均差','99%信賴區間','判定'],c.comparisons.map(v=>[`${v.candidate} / ${v.reference}`,number(v.meanDeltaPointsPerEligibleDay),`${number(v.confidenceInterval.lower)} ～ ${number(v.confidenceInterval.upper)}`,v.interpretation])));
}
async function refresh(){if(pending)return;pending=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try{const r=await fetch('/api/v1/research-evidence',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(!r.ok)throw Error(r.status===401?'請先返回工作臺正常登入。':'讀取失敗：'+r.status);const response=await r.json();
  if(response.data?.schemaVersion!=='dashboard-research-evidence-v1')throw Error('資料格式不符');
  last=response.data;receivedWall=Date.now();receivedMono=performance.now();el('connection').textContent='讀取時間 '+last.servedAt;paint();
 }catch(e){last=null;el('connection').textContent=e.message;paint();}finally{clearTimeout(timeout);pending=false;}}
el('refresh').addEventListener('click',refresh);setInterval(paint,1000);
setInterval(()=>{if(last&&!document.hidden)refresh();},4000);refresh();
