import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const controllerSource=app.slice(app.indexOf('function decisionCaptureIdentity('),app.indexOf('function renderDecisionCaptureStatus('));
const create=vm.runInNewContext(controllerSource+'\ncreateDecisionCaptureController',{AbortController,setTimeout,clearTimeout});
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const identity=['2026-11-05','TXFK6','DAY','2026-11-05-DAY',null];
function capturePayload(id='a',time='2026-11-05T01:35:00.000Z') {
  const snapshot={snapshotHash:id.repeat(64),snapshotTime:time,tradeDate:identity[0],contract:identity[1],session:identity[2],price:{availability:'AVAILABLE',value:30000},VWAP:{availability:'AVAILABLE',value:30001}};
  const chart={tradeDate:identity[0],actualContract:identity[1],session:identity[2],sessionId:identity[3],timeframe:'5m',asOf:time,lastPrice:30000,levels:{vwap:{availability:'AVAILABLE',value:30001}}};
  return{data:{schemaVersion:'decision-capture-v1',captureId:snapshot.snapshotHash,capturedAt:time,chartCutoff:time,workspace:{snapshot,chatGptCopy:`Snapshot: ${time}\nHash: ${snapshot.snapshotHash}\nfixed context`},chart}};
}
function fixture({response=()=>capturePayload(),clipboard=async()=>{},apply=()=>{}}={}){
  let session='session-a',selection={timeframe:'5m',identity:[...identity],asOf:'2026-11-05T01:34:59.000Z'};
  const requests=[],applied=[],copies=[],timers=new Set();
  const controller=create({request:(frame,signal)=>{requests.push({frame,signal});return response(frame,signal);},selection:()=>selection,ticket:()=>session,currentSession:ticket=>Boolean(ticket&&ticket===session),apply:(data,pair)=>{apply(data,pair);applied.push({data,pair});},clipboard:async text=>{copies.push(text);await clipboard(text);},schedule:fn=>(timers.add(fn),fn),cancel:fn=>timers.delete(fn)});
  return {controller,requests,applied,copies,setSession:value=>{session=value;},setSelection:value=>{selection={...selection,...value};},timeout:()=>[...timers].forEach(fn=>fn()),timers};
}
test('Lock captures once and returns an immutable snapshot/copy pair used for the applied chart and summary',async()=>{
  const payload=capturePayload(),f=fixture({response:()=>payload}),pair=await f.controller.capture();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].frame,'5m');assert.equal(f.applied[0].data.chart.lastPrice,pair.snapshot.price.value);
  assert.equal(pair.copyText,payload.data.workspace.chatGptCopy);assert.equal(pair.chartCutoff,payload.data.chart.asOf);assert.ok(Object.isFrozen(pair.snapshot.price));
  payload.data.workspace.snapshot.price.value=999;assert.equal(pair.snapshot.price.value,30000);
});
test('unlocked Copy uses a fresh capture and never the retained dashboard workspace',async()=>{
  const f=fixture();const pair=await f.controller.copy();assert.equal(f.requests.length,1);assert.deepEqual(f.copies,[pair.copyText]);assert.equal(f.applied.length,1);
});
test('non-5m Lock and unlocked Copy require explicit 5m selection without fetching or changing the chart',async()=>{
  for(const timeframe of ['1m','15m','30m','1h','4h','1D'])for(const action of ['capture','copy']){
    const f=fixture();f.setSelection({timeframe});await assert.rejects(f.controller[action](),/REQUIRES_5M/);
    assert.equal(f.requests.length,0);assert.equal(f.applied.length,0);assert.equal(f.copies.length,0);
  }
});
test('duplicate Lock/Copy interactions share one request and one clipboard write',async()=>{
  const d=pending(),f=fixture({response:()=>d.promise});const lock=f.controller.capture(),copy1=f.controller.copy(),copy2=f.controller.copy();
  assert.equal(copy1,copy2);assert.equal(lock,f.controller.capture());await Promise.resolve();assert.equal(f.requests.length,1);
  d.resolve(capturePayload());await Promise.all([lock,copy1,copy2]);assert.equal(f.copies.length,1);assert.equal(f.applied.length,1);
});
test('locked Copy remains fixed while live chart changes timeframe/session; explicit re-Lock changes the pair',async()=>{
  let next=capturePayload();const f=fixture({response:()=>next});const old=await f.controller.capture();
  f.setSelection({timeframe:'1m',identity:['2026-11-06','TXFL6','NIGHT','2026-11-06-NIGHT',null]});await f.controller.copy();assert.equal(f.requests.length,1);assert.equal(f.copies[0],old.copyText);
  f.setSelection({timeframe:'5m',identity:[...identity]});next=capturePayload('b','2026-11-05T01:35:05.000Z');await f.controller.capture();assert.equal(f.controller.locked().snapshot.snapshotHash,'b'.repeat(64));
});
test('Copy during explicit re-Lock waits for the new pair, never silently copies the old pair',async()=>{
  let next=Promise.resolve(capturePayload());const f=fixture({response:()=>next});await f.controller.capture();
  const d=pending();next=d.promise;const capture=f.controller.capture(),copy=f.controller.copy();d.resolve(capturePayload('b'));await Promise.all([capture,copy]);assert.match(f.copies[0],new RegExp('Hash: '+'b'.repeat(64)));
});
test('timeout bounds ignored cancellation/stalled response body, preserves old lock, and allows explicit retry',async()=>{
  let next=Promise.resolve(capturePayload());const f=fixture({response:()=>next});const old=await f.controller.capture();
  const stalled=pending();next=stalled.promise;const request=f.controller.capture();await Promise.resolve();f.timeout();await assert.rejects(request,/DECISION_CAPTURE_TIMEOUT/);assert.equal(f.controller.locked(),old);
  stalled.resolve(capturePayload('b'));await Promise.resolve();assert.equal(f.applied.length,1);
  next=Promise.resolve(capturePayload('c'));await f.controller.capture();assert.equal(f.controller.locked().snapshot.snapshotHash,'c'.repeat(64));assert.equal(f.timers.size,0);
});
test('logout/relogin rejects old request and old locked Copy without applying or writing clipboard',async()=>{
  const d=pending(),f=fixture({response:()=>d.promise}),request=f.controller.copy();await Promise.resolve();f.setSession('session-b');f.controller.reset();await assert.rejects(request,/SESSION_CHANGED/);d.resolve(capturePayload());await Promise.resolve();assert.equal(f.applied.length,0);assert.equal(f.copies.length,0);assert.equal(f.controller.locked(),null);
});
test('a new session flight survives a late prior-session response',async()=>{
  const first=pending(),second=pending();let calls=0;const f=fixture({response:()=>++calls===1?first.promise:second.promise});
  const old=f.controller.capture();await Promise.resolve();f.setSession('new');f.controller.reset();await assert.rejects(old,/SESSION_CHANGED/);
  const fresh=f.controller.capture();first.resolve(capturePayload('a'));second.resolve(capturePayload('b'));await fresh;assert.equal(f.applied.length,1);assert.equal(f.controller.locked().snapshot.snapshotHash,'b'.repeat(64));
});
test('timeframe or source-session changes during request reject obsolete captures',async()=>{
  for(const change of [{timeframe:'1m'},{identity:['2026-11-06','TXFK6','DAY','2026-11-06-DAY',null]}]){
    const d=pending(),f=fixture({response:()=>d.promise}),request=f.controller.capture();f.setSelection(change);d.resolve(capturePayload());await assert.rejects(request,/VIEW_CHANGED/);assert.equal(f.applied.length,0);
  }
});
test('a newer live chart supersedes an older capture response without rolling the chart backward',async()=>{
  const d=pending(),f=fixture({response:()=>d.promise}),request=f.controller.capture();f.setSelection({asOf:'2026-11-05T01:35:01.000Z'});d.resolve(capturePayload());await assert.rejects(request,/SUPERSEDED_BY_LIVE_CHART/);assert.equal(f.applied.length,0);
});
test('mismatched response hash, identity, timeframe, price and cutoff never reach Copy or journal lock',async()=>{
  for(const mutate of [p=>p.data.captureId='bad',p=>p.data.chart.actualContract='TXFL6',p=>p.data.chart.timeframe='1m',p=>p.data.chart.lastPrice=999,p=>p.data.chart.asOf='2027-01-01T00:00:00Z',p=>p.data.workspace.chatGptCopy='old Copy']){
    const payload=capturePayload();mutate(payload);const f=fixture({response:()=>payload});await assert.rejects(f.controller.copy(),/MISMATCH/);assert.equal(f.applied.length,0);assert.equal(f.copies.length,0);
  }
});
test('failed capture or clipboard does not erase a previous valid lock or claim clipboard success',async()=>{
  let fail=false;const f=fixture({response:()=>{if(fail)throw Error('HTTP 503');return capturePayload();},clipboard:async()=>{throw Error('CLIPBOARD_DENIED');}});
  const pair=await f.controller.capture();fail=true;await assert.rejects(f.controller.capture(),/503/);assert.equal(f.controller.locked(),pair);await assert.rejects(f.controller.copy(),/CLIPBOARD_DENIED/);assert.equal(f.controller.locked(),pair);
});
test('background workspace render preserves locked snapshot and exposes fixed time/price/VWAP/cutoff separately from live chart',()=>{
  const start=app.indexOf('function renderDecisionWorkspace(');
  const prefix=app.slice(start,app.indexOf('  const global = workspace?.globalStatus',start))+'\n}';
  const pair={snapshot:{snapshotHash:'locked',snapshotTime:'fixed',price:{value:30000},VWAP:{value:30001}},chartCutoff:'cutoff'};
  const context={state:{decisionCapturePair:pair,lockedDecisionSnapshot:pair.snapshot},flowChannel:{view:()=>({latest:true})},renderDecisionCaptureStatus:()=>{}};
  vm.runInNewContext(prefix+'\nrenderDecisionWorkspace({snapshot:{snapshotHash:"new"}})',context);assert.equal(context.state.lockedDecisionSnapshot.snapshotHash,'locked');assert.equal(context.state.decisionCapturePair,pair);
  const status=app.slice(app.indexOf('function renderDecisionCaptureStatus('),app.indexOf('function applyDecisionCapture('));let text='';vm.runInNewContext(status+'\nrenderDecisionCaptureStatus();',{state:context.state,fmt:String,dwText:(_,value)=>{text=value;}});
  for(const required of ['fixed','30000','30001','cutoff','主圖仍持續即時更新'])assert.ok(text.includes(required));
});
test('capture apply invalidates older dashboard/chart requests and renders matching objects before replacing the lock',()=>{
  const source=app.slice(app.indexOf('function applyDecisionCapture('),app.indexOf('const decisionCaptureController ='));
  const payload=capturePayload().data,pair={snapshot:payload.workspace.snapshot,copyText:payload.workspace.chatGptCopy},calls=[];
  const state={dashboardRequestId:4,txChartRequestId:8,txChartAbortController:{abort:reason=>calls.push(reason)},lockedDecisionSnapshot:{old:true}};
  vm.runInNewContext(source+'\napplyDecisionCapture(payload,pair);',{state,payload,pair,renderTxDecisionChart:chart=>{calls.push(chart);return {visibleRenderReady:true};},renderDecisionWorkspace:(workspace,options)=>{assert.equal(options.captured,true);calls.push(workspace);},renderDecisionCaptureStatus:value=>calls.push(value),$:()=>({setAttribute(){}})});
  assert.equal(state.dashboardRequestId,5);assert.equal(state.txChartRequestId,9);assert.equal(calls[1],payload.chart);assert.equal(calls[2],payload.workspace);assert.equal(state.lockedDecisionSnapshot,pair.snapshot);
});

function realRenderFixture() {
  let mode='success';const nodes=new Map();
  const node=()=>({dataset:{},className:'',textContent:'',classList:{toggle(){},add(){},remove(){}},setAttribute(){},append(){},replaceChildren(){}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const displayed={candle:[],volume:[],vwap:[]},writes=[];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const write=(role,kind,value)=>{
    if(mode===role)throw Error('SYNTHETIC_SERIES_FAILURE');
    writes.push({role,kind});
    if(kind==='setData')displayed[role]=clone(value);
    else {const at=displayed[role].findIndex(point=>point.time===value.time);if(at>=0)displayed[role][at]=clone(value);else displayed[role].push(clone(value));}
  };
  const series=Object.fromEntries(['candle','volume','vwap'].map(role=>[role,{setData:value=>write(role,'setData',value),update:value=>write(role,'update',value)}]));
  const context={state:{dashboardRequestId:0,txChartRequestId:0,txChartSeries:series,decisionCapturePair:null},$:get,
    document:{createElement:node},flowChannel:{view:()=>null},
    dwText:(id,value)=>{get(id).textContent=value;},dwHumanize:value=>value,terminalUnavailable:value=>'UNAVAILABLE '+value,
    finiteNumber:value=>Number.isFinite(value)?value:null,ensureTxChart:()=>mode==='initialization'?null:{timeScale:()=>({fitContent(){}})},
    chartEpoch:value=>Number.isFinite(Date.parse(value))?Date.parse(value)/1000:null,activeCandlePalette:()=>({upVolume:'red',downVolume:'green'}),
    healthTone:()=>'',dw4SummaryLabel:value=>value,timeLabel:value=>value,availabilityLabel:value=>value?.value??null,
    fmt:value=>String(value),captureCoverageWarning:()=>'',terminalWrite:(id,value)=>{get(id).textContent=value;}};
  for(const name of ['renderDecisionLevelWatch','renderObservedFlow','renderTxChartFreshness','renderTxChartLevels','renderMarketPulse','renderTerminalShell','renderDecisionCaptureStatus','renderRuntimeVersion','renderDw4Evidence','renderLiveMarketPulse','renderIndexLeadership','renderPlainList','renderMarketChangeFeed'])context[name]=()=>{};
  const pieces=[app.slice(app.indexOf('function chartSeriesData('),app.indexOf('function marketChangeMarkerData(')),
    app.slice(app.indexOf('function renderTxDecisionChart('),app.indexOf('async function loadTxDecisionChart(')),
    app.slice(app.indexOf('function renderDecisionWorkspace('),app.indexOf('function renderJournalHistory(')),
    app.slice(app.indexOf('function applyDecisionCapture('),app.indexOf('const decisionCaptureController ='))];
  vm.createContext(context);vm.runInContext(pieces.join('\n'),context);
  return {context,get,displayed,writes,mode:value=>{mode=value;context.state.txChartIdentity=null;},apply:(data,pair)=>context.applyDecisionCapture(data,pair)};
}
function renderableCapture(id='a') {
  const payload=capturePayload(id);payload.data.chart.status='READY';
  payload.data.chart.bars=[{time:'2026-11-05T01:15:00.000Z',open:30000,high:30000,low:30000,close:30000,volume:1}];
  payload.data.chart.vwap=[{time:'2026-11-05T01:15:00.000Z',value:30001}];
  payload.data.workspace.priceChartSlot={status:'READY',price:{availability:'AVAILABLE',value:30000}};
  payload.data.workspace.snapshot.dataHealth={items:[]};return payload;
}
for(const mode of ['initialization','candle','volume','vwap'])test(`real render failure ${mode} cannot create/replace a lock or copy, and explicit retry recovers`,async()=>{
  const render=realRenderFixture();let next=renderableCapture();
  const f=fixture({response:()=>next,apply:render.apply});render.mode(mode);
  const reason=mode==='initialization'?'CHART_RENDER_INITIALIZATION_FAILED':'CHART_SERIES_WRITE_FAILED';
  await assert.rejects(f.controller.copy(),new RegExp(reason));assert.equal(f.copies.length,0);assert.equal(f.controller.locked(),null);
  assert.ok(render.get('dw-chart-status').textContent.includes(reason));
  render.mode('success');const old=await f.controller.capture();
  assert.equal(render.context.state.lockedDecisionSnapshot,old.snapshot);
  render.mode(mode);next=renderableCapture('b');
  const relock=f.controller.capture(),copy=f.controller.copy();await assert.rejects(relock,new RegExp(reason));await assert.rejects(copy,new RegExp(reason));
  assert.equal(f.controller.locked(),old);assert.equal(render.context.state.lockedDecisionSnapshot,old.snapshot);assert.equal(f.copies.length,0);
  // The real background workspace renderer also cannot overwrite the actual chart failure with payload READY.
  render.context.renderDecisionWorkspace(next.data.workspace);
  assert.ok(render.get('dw-chart-status').textContent.includes(reason));
  render.mode('success');next=renderableCapture('c');const recovered=await f.controller.capture();await f.controller.copy();
  assert.equal(render.get('dw-chart-status').textContent,'READY');assert.equal(f.copies.length,1);assert.equal(f.copies[0],recovered.copyText);assert.notEqual(recovered,old);
});

function multiBarCapture(id,closes) {
  const payload=renderableCapture(id),chart=payload.data.chart,workspace=payload.data.workspace;
  chart.bars=closes.map((close,index)=>({time:new Date(Date.parse('2026-11-05T01:15:00.000Z')+index*300000).toISOString(),open:close-1,high:close+1,low:close-2,close,volume:close-29000}));
  chart.vwap=chart.bars.map(bar=>({time:bar.time,value:bar.close-0.5}));
  chart.lastPrice=closes.at(-1);chart.levels.vwap.value=chart.vwap.at(-1).value;
  workspace.snapshot.price.value=chart.lastPrice;workspace.snapshot.VWAP.value=chart.levels.vwap.value;workspace.priceChartSlot.price.value=chart.lastPrice;
  return payload;
}
for(const [name,before,after] of [['multiple intervening bars',[30000],[30001,30002,30003]],['same-length historical correction',[30000,30002,30003],[30001,30002,30003]]])test(`explicit capture fully replaces candles, volume and VWAP for ${name}`,async()=>{
  const render=realRenderFixture();let next=multiBarCapture('a',before);const f=fixture({response:()=>next,apply:render.apply});
  await f.controller.capture();const priorWrites=render.writes.length;
  next=multiBarCapture('b',after);const pair=await f.controller.capture();await f.controller.copy();
  const expected=JSON.parse(JSON.stringify(render.context.chartSeriesData(next.data.chart)));
  assert.deepEqual(render.displayed.candle,expected.candles);assert.deepEqual(render.displayed.volume,expected.volumes);assert.deepEqual(render.displayed.vwap,expected.vwap);
  assert.deepEqual(render.writes.slice(priorWrites),['candle','volume','vwap'].map(role=>({role,kind:'setData'})));
  assert.equal(render.context.state.txChartBarCount,after.length);assert.equal(pair.snapshot.price.value,after.at(-1));assert.equal(f.copies[0],pair.copyText);
});
test('ordinary same-bar polling retains the existing incremental update path',()=>{
  const render=realRenderFixture();render.context.renderTxDecisionChart(multiBarCapture('a',[30000]).data.chart);
  const prior=render.writes.length;render.context.renderTxDecisionChart(multiBarCapture('b',[30001]).data.chart);
  assert.deepEqual(render.writes.slice(prior),['candle','volume','vwap'].map(role=>({role,kind:'update'})));
});

test('old session action completion cannot release buttons held by a new session capture',async()=>{
  const source=app.slice(app.indexOf('async function runDecisionCaptureAction('),app.indexOf("$('dw-lock-snapshot').addEventListener('click', () => void"));
  const old=pending(),fresh=pending();let calls=0;const feedback=[];
  const buttons=Object.fromEntries(['dw-lock-snapshot','dw-copy-chatgpt'].map(id=>[id,{disabled:false,setAttribute(){},removeAttribute(){}}]));
  const state={csrfToken:'old',decisionCaptureActionId:0};
  const context={state,$:id=>buttons[id],dwText:(_,value)=>feedback.push(value),decisionCaptureController:{locked:()=>null,capture:()=>++calls===1?old.promise:fresh.promise}};
  vm.createContext(context);vm.runInContext(source,context);
  const first=context.runDecisionCaptureAction('lock');
  state.csrfToken='new';state.decisionCaptureActionId+=1;
  for(const button of Object.values(buttons))button.disabled=false;
  const second=context.runDecisionCaptureAction('lock');
  old.reject(Error('SESSION_CHANGED'));await first;
  assert.ok(Object.values(buttons).every(button=>button.disabled));assert.equal(feedback.length,2);
  fresh.resolve({snapshot:capturePayload('b').data.workspace.snapshot});await second;
  assert.ok(Object.values(buttons).every(button=>!button.disabled));assert.match(feedback.at(-1),/bbbbbbbbbbbb/);
});

const library=await import(new URL('../src/dashboard-decision-workspace.mjs',import.meta.url));
const marketChange=await import(new URL('../src/market-change-feed.mjs',import.meta.url));
const builderSource=server.slice(server.indexOf('async function decisionWorkspacePayload('),server.indexOf('\nasync function currentDiscussionWorkspace('));
const envelopeSource=server.slice(server.indexOf('function decisionCaptureEnvelope('),server.indexOf('\nasync function loadMarketChangeFeed('));
test('server capture returns the identical chart object consumed by real snapshot/copy builder, once, with unchanged quality',async()=>{
  let reads=0;const chart={...capturePayload().data.chart,status:'QUALITY_INSUFFICIENT',qualityStatus:'QUALITY_INSUFFICIENT',mode:'LIVE',source:'SYNTHETIC',availableAt:'2026-11-05T01:35:00.000Z',bars:[],vwap:[]};
  const context={Date,forwardShadowBaseRoot:'synthetic',process:{env:{}},readDashboardRuntimeTruth:async()=>null,txChartService:{load:async selection=>{reads++;assert.equal(selection.timeframe,'5m');return chart;}},loadIx0001BreadthForWorkspace:()=>null,txChartDataRoot:'synthetic',buildDataHealthContract:()=>({overall:'QUALITY_INSUFFICIENT',items:[],staleCount:0,unavailableCount:0}),readLocalJson:()=>null,futuresAuditPath:'synthetic',...marketChange,currentObservedFlow:()=>null,currentMarketPulse:async()=>null,runtimeVersion:{},productSurfaceContract:{},assessTaifexMarketSession:()=>({state:'synthetic'}),operatingCalendar:{},...library,buildDecisionWorkspace:options=>library.buildDecisionWorkspace({...options,now:new Date('2026-11-05T01:35:01.000Z')})};
  vm.createContext(context);vm.runInContext(builderSource+'\n'+envelopeSource,context);
  const capture=await context.decisionWorkspacePayload({dataMode:'live'},null,{capture:true,timeframe:'5m'}),result=context.decisionCaptureEnvelope(capture,'5m');
  assert.equal(reads,1);assert.equal(result.chart,chart);assert.equal(result.workspace.snapshot.price.value,chart.lastPrice);assert.equal(result.workspace.snapshot.VWAP.value,30001);assert.equal(result.chart.qualityStatus,'QUALITY_INSUFFICIENT');assert.equal(result.workspace.snapshot.executionAuthorized,false);assert.equal(result.workspace.snapshot.formalWeight,0);
  const changed={...capture,chart:{...chart,lastPrice:30100}};assert.throws(()=>context.decisionCaptureEnvelope(changed,'5m'),/INCONSISTENT/);
});
test('capture route stays behind normal session boundary, uses no-store and rejects non-5m frame without altering auth or journal',()=>{
  const guard=server.indexOf("if (pathname.startsWith('/api/v1/'))"),session=server.indexOf('const session = requireSession(req, res);',guard),route=server.indexOf("pathname === '/api/v1/decision-capture'");assert.ok(session>guard&&route>session);
  const block=server.slice(route,server.indexOf("pathname === '/api/v1/ask-gpt-context'",route));assert.match(block,/timeframe !== '5m'/);assert.match(block,/'Cache-Control': 'no-store'/);assert.match(block,/currentDiscussionWorkspace\(\{ capture: true \}\)/);
  assert.doesNotMatch(block,/Set-Cookie|sessions\.create|refreshSnapshot\(/);
});
test('real route branch rejects all non-5m requests before building; 5m takes one capture path',async()=>{
  const start=server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/decision-capture') {");
  const body=server.slice(start,server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/ask-gpt-context') {",start));
  for(const frame of ['1m','15m','30m','1h','4h','1D','bad','5m']){
    let reads=0,sent=null;const context={req:{method:'GET'},pathname:'/api/v1/decision-capture',url:new URL('http://fixture/api/v1/decision-capture?timeframe='+frame),res:{},sendJson:(_res,status,payload,headers)=>{sent={status,payload,headers};},currentDiscussionWorkspace:async options=>{reads++;assert.equal(options.capture,true);return 'capture';},decisionCaptureEnvelope:value=>value};
    vm.createContext(context);vm.runInContext('async function route(){'+body+'}',context);await context.route();
    assert.equal(reads,frame==='5m'?1:0);assert.equal(sent.status,frame==='5m'?200:400);assert.equal(sent.headers['Cache-Control'],'no-store');
    if(frame!=='5m')assert.equal(sent.payload.error,'DECISION_CAPTURE_REQUIRES_5M');
  }
});
