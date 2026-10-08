import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const code=app.slice(app.indexOf('async function reportCru46BrowserRuntimeProof('),app.indexOf('function renderDecisionWorkspace('));
const commit='a'.repeat(40);
const formalVersion=()=>({runtimeCommit:commit,approvedMainCommit:commit,syncState:'SYNCED'});
function harness(version=formalVersion(),location={hostname:'127.0.0.1',port:'8787'}){
  const calls=[];
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:id==='dw-chart-status'?'READY':'',offsetParent:{},getClientRects:()=>[{}],getBoundingClientRect:()=>({width:900,height:280}),querySelectorAll:()=>[{},{},{}]});return nodes.get(id);};
  const flow={windows:{primary60s:{status:'READY'},context300s:{status:'READY'}}};
  const context=vm.createContext({state:{decisionWorkspace:{runtimeVersion:version},txChartPayload:{status:'READY'},txChartBarCount:21,txChartVolumeCount:21},
    $:node,lastObservedFlowValue:flow,window:{location,LightweightCharts:{createChart(){},CandlestickSeries:{},HistogramSeries:{}}},
    api:async(route,options)=>{calls.push({route,method:options.method,body:JSON.parse(options.body)});return{ok:true};}});
  vm.runInContext(code,context);
  return{context,calls,node,flow};
}

test('normal formal entry posts observed browser proof only for matching synced main on port 8787',async()=>{
  const h=harness();await h.context.reportCru46BrowserRuntimeProof();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].route,'/api/v1/cru46-browser-runtime-proof');assert.equal(h.calls[0].method,'POST');
  const body=h.calls[0].body;
  assert.equal(body.lightweightChartsApiMajor,5);assert.equal(body.canvasCount,3);assert.equal(body.chartWidth,900);assert.equal(body.chartHeight,280);
  assert.equal(body.candleCount,21);assert.equal(body.volumeCount,21);assert.equal(body.chartStatusVisible,true);
  assert.equal(body.observedFlow1m,true);assert.equal(body.observedFlow5m,true);
});

test('unmatched, unknown, malformed and non-formal identities never post a normal-entry proof',async()=>{
  for(const patch of [{runtimeCommit:'b'.repeat(40)},{runtimeCommit:null},{runtimeCommit:'bad',approvedMainCommit:'bad'},
    {approvedMainCommit:null},{syncState:'MISMATCH'},{syncState:'UNKNOWN'},{previewType:'UNKNOWN_PREVIEW'}]){
    const h=harness({...formalVersion(),...patch});await h.context.reportCru46BrowserRuntimeProof();assert.equal(h.calls.length,0);
  }
  for(const location of [{hostname:'127.0.0.1',port:'18722'},{hostname:'127.0.0.1',port:'8790'},
    {hostname:'example.com',port:'8787'},{hostname:'localhost',port:'8787'},undefined]){
    const h=harness(formalVersion(),location);if(location===undefined)h.context.window.location=undefined;
    await h.context.reportCru46BrowserRuntimeProof();assert.equal(h.calls.length,0);
  }
  const missing=harness(null);await missing.context.reportCru46BrowserRuntimeProof();assert.equal(missing.calls.length,0);
});

test('existing preview entry routes still report observed proof independently of formal identity',async()=>{
  for(const previewType of ['INTEGRATION_OWNER_PREVIEW','CRU44_OWNER_PREVIEW','CRU21_OWNER_PREVIEW']){
    const h=harness({previewType,runtimeCommit:commit,syncState:'MISMATCH'},{hostname:'127.0.0.1',port:'18722'});
    await h.context.reportCru46BrowserRuntimeProof();assert.equal(h.calls.length,1);
  }
});

test('formal routing preserves missing-chart and unavailable-Flow evidence for server rejection',async()=>{
  const h=harness();h.node('dw-chart-status').offsetParent=null;h.flow.windows.primary60s.status='UNAVAILABLE';h.flow.windows.context300s.status='UNAVAILABLE';
  h.context.state.txChartBarCount=0;h.context.state.txChartVolumeCount=0;h.context.window.LightweightCharts={};
  await h.context.reportCru46BrowserRuntimeProof();
  assert.equal(h.calls.length,1);const body=h.calls[0].body;
  assert.equal(body.lightweightChartsApiMajor,null);assert.equal(body.chartStatusVisible,false);
  assert.equal(body.observedFlow1m,false);assert.equal(body.observedFlow5m,false);assert.equal(body.candleCount,0);assert.equal(body.volumeCount,0);
});
