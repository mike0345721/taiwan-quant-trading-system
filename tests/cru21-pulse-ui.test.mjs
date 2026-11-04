import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const identity={actualContract:'TXFJ6',tradeDate:'2026-10-08',session:'NIGHT'};
const epoch=Date.parse('2026-10-07T14:00:00Z');
function pulse(at=epoch,ratio=1.25) { return {schemaVersion:'market-pulse-live-v1',generatedAt:new Date(at).toISOString(),
  sourceAvailableAt:new Date(at).toISOString(),identity:{...identity},
  rvol:{state:'READY',ratio,sampleDays:20},basis:{state:'SESSION_CLOSED_REFERENCE',points:12,pct:.1}}; }
function source(name){ const begin=app.indexOf(`function ${name}(`);const end=app.indexOf('\n}',begin)+2;assert.ok(begin>=0&&end>begin);return app.slice(begin,end); }
function ui(){
  let now=epoch;
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{toggle(){},add(){}},setAttribute(){},closest(){return null;},querySelector(){return null;}});return nodes.get(id);};
  const write=(id,value,options={})=>{node(id).textContent=value??`UNAVAILABLE · ${options.reason}`;node(id).title=options.title;};
  const state={csrfToken:'test',marketPulse:null,marketPulseLoading:false,decisionWorkspace:{},txChartPayload:{...identity,mode:'LIVE',levels:{}}};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const context=vm.createContext({state,$:node,Date:Clock,AbortSignal,document:{querySelector:()=>null},
    terminalWrite:write,dwText:write,terminalUnavailable:r=>`UNAVAILABLE · ${r}`,
    finiteNumber:v=>v==null?null:Number.isFinite(Number(v))?Number(v):null,fmt:(v,n=0)=>Number(v).toFixed(n),signed:(v,s='',n=0)=>`${Number(v).toFixed(n)}${s}`,
    tone:(id,value)=>{node(id).tone=value;},levelValue:()=>null,terminalTxLiveContractMonth:()=>null,
    terminalHealthItem:()=>null,terminalEodHealthUsable:()=>false,terminalHealthUsable:()=>false,
    terminalSourceMode:()=> 'EOD',terminalSourceContext:()=>'',timeLabel:v=>v,healthTone:()=>'',
    dw4FamilyEvidence:()=>null,updateTerminalSummaryDisclosure(){},renderTerminalEvidenceCard(){},renderGlobalTiles(){},
    terminalBreadthCounts:()=>null,terminalHealthSummary:()=>({value:null}),
    api:async()=>{throw Error('OFFLINE_TEST');}});
  vm.runInContext(source('terminalWrite')+'\n'+source('renderTrendStrength')+'\n'+source('renderTxChartFreshness')+'\n'+source('renderLiveMarketPulse')+'\nasync '+source('loadLiveMarketPulse')+'\n'+source('renderTerminalShell'),context);
  return {state,node,context,setNow:v=>{now=v;}};
}
test('chart shell rerenders never replace the live RVOL/basis with EOD placeholders',()=>{
  const h=ui();h.context.renderLiveMarketPulse(pulse());
  const ids=['tt-pulse-rvol','dw-rvol-state','tt-top-basis','tt-pulse-basis','tt-futures-basis'];
  const before=ids.map(id=>h.node(id).textContent);
  for(let i=0;i<4;i++)h.context.renderTerminalShell({},h.state.txChartPayload);
  assert.deepEqual(ids.map(id=>h.node(id).textContent),before);
  assert.match(before[0],/1\.25/);assert.match(before[2],/現貨收盤參考/);
});
test('workspace shell-before-pulse call order preserves its incoming payload on first load and recovery',()=>{
  const h=ui();
  for(const ratio of [1.5,2.5]){
    const workspace={marketPulse:pulse(epoch,ratio)};
    h.state.decisionWorkspace=workspace;
    h.context.renderTerminalShell(workspace,h.state.txChartPayload);
    h.context.renderLiveMarketPulse(workspace.marketPulse);
    assert.equal(workspace.marketPulse.rvol.ratio,ratio);
    assert.match(h.node('tt-pulse-rvol').textContent,new RegExp(ratio.toFixed(2).replace('.','\\.')));
  }
});
test('RVOL evidence title preserves unavailable quality and sample timestamps',()=>{
  const h=ui();const p=pulse();
  p.rvol={state:'UNAVAILABLE',reason:'RVOL_SOURCE_QUALITY_INSUFFICIENT',ratio:null,
    completedBarTime:'2026-10-07T12:50:00Z',completedBarAvailableAt:'2026-10-07T12:54:59Z',
    sourceQualityStatus:'QUALITY_INSUFFICIENT',sourceQualityReasons:['TIMESTAMP_LINEAGE_INSUFFICIENT']};
  h.context.renderLiveMarketPulse(p);
  assert.match(h.node('tt-pulse-rvol').textContent,/RVOL_SOURCE_QUALITY_INSUFFICIENT/);
  assert.match(h.node('tt-pulse-rvol').title,/12:54:59/);
  assert.match(h.node('tt-pulse-rvol').title,/TIMESTAMP_LINEAGE_INSUFFICIENT/);
});
test('explicit unavailable aggregate health is shown as evidence, not missing payload',()=>{
  const h=ui();
  h.context.renderTerminalShell({globalStatus:{dataHealth:'UNAVAILABLE'}},h.state.txChartPayload);
  assert.equal(h.node('tt-health-main').textContent,'UNAVAILABLE');
  assert.equal(h.node('tt-health-ring-value').textContent,'UNAVAILABLE');
  assert.equal(h.node('tt-health-main').title,'overall=UNAVAILABLE');
  h.context.renderTerminalShell({},h.state.txChartPayload);
  assert.match(h.node('tt-health-main').textContent,/DATA_HEALTH_UNAVAILABLE/);
  assert.equal(h.node('tt-health-ring-value').textContent,'N/A');
});

test('late workspace response cannot overwrite a newer independent pulse poll',()=>{
  const h=ui();h.setNow(epoch+5_000);h.context.renderLiveMarketPulse(pulse(epoch+5_000,2));
  const workspace={marketPulse:pulse(epoch,1)};h.state.decisionWorkspace=workspace;
  h.context.renderTerminalShell(workspace,h.state.txChartPayload);h.context.renderLiveMarketPulse(workspace.marketPulse);
  assert.equal(h.state.marketPulse.rvol.ratio,2);assert.equal(h.state.decisionWorkspace.marketPulse.rvol.ratio,2);
  assert.equal(workspace.marketPulse.rvol.ratio,1);
});
test('failed poll clears cached values and directional colour; a later successful poll recovers',async()=>{
  const h=ui();h.context.renderLiveMarketPulse(pulse());h.setNow(epoch+5_000);
  await h.context.loadLiveMarketPulse();
  assert.match(h.node('tt-pulse-rvol').textContent,/REFRESH_FAILED/);
  assert.match(h.node('tt-pulse-basis').textContent,/REFRESH_FAILED/);assert.equal(h.node('tt-top-basis').tone,0);
  h.setNow(epoch+10_000);h.context.api=async(_route,options)=>{assert.ok(options.signal);return{data:pulse(epoch+10_000,3)};};
  await h.context.loadLiveMarketPulse();assert.match(h.node('tt-pulse-rvol').textContent,/3\.00/);
});
test('stopped responses cannot keep a cached READY value beyond the source freshness limit',()=>{
  const h=ui();h.context.renderLiveMarketPulse(pulse());h.setNow(epoch+120_001);
  h.context.renderTerminalShell({},h.state.txChartPayload);assert.match(h.node('tt-pulse-rvol').textContent,/STALE/);
  const p=pulse(epoch+120_001);p.sourceAvailableAt=new Date(epoch).toISOString();h.context.renderLiveMarketPulse(p);
  assert.match(h.node('tt-pulse-basis').textContent,/SOURCE_STALE/);
});
test('replay and changed contract/session/date cannot display current pulse values',()=>{
  for(const change of [{mode:'REPLAY'},{actualContract:'TXFK6'},{session:'DAY'},{tradeDate:'2026-10-09'}]){
    const h=ui();h.context.renderLiveMarketPulse(pulse());Object.assign(h.state.txChartPayload,change);
    h.context.renderTerminalShell({},h.state.txChartPayload);assert.match(h.node('tt-pulse-rvol').textContent,/IDENTITY_MISMATCH/);
  }
});
test('malformed and future poll responses fail closed without poisoning the recovery watermark',async()=>{
  for(const bad of [{},pulse(epoch+60_000)]){
    const h=ui();h.context.renderLiveMarketPulse(pulse());h.context.api=async()=>({data:bad});
    await h.context.loadLiveMarketPulse();assert.match(h.node('tt-pulse-rvol').textContent,/REFRESH_FAILED/);
    h.setNow(epoch+5_000);h.context.api=async()=>({data:pulse(epoch+5_000,4)});
    await h.context.loadLiveMarketPulse();assert.match(h.node('tt-pulse-rvol').textContent,/4\.00/);
  }
});
