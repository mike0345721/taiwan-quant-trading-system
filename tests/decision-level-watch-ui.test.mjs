import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';
import { createDecisionSnapshot } from '../src/dashboard-decision-workspace.mjs';
import { buildInlineContext } from '../src/ask-gpt-inline-context.mjs';
import { ANALYSIS_INSTRUCTIONS } from '../src/chatgpt-plan-inference.mjs';

test('chart keeps one VWAP label by reusing the VWAP series and skipping a duplicate price line',()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/vwapSeriesLabel/);
  assert.match(app,/state\.txChartSeries\.vwap\.applyOptions/);
  assert.match(app,/if \(entry\.id === 'VWAP'\) continue;/);
});

test('next watch exposes transparent evidence reasons without making them first-layer chart clutter',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="dw-next-watch-basis"/);
  assert.match(app,/renderNextWatchBasis\(next\.basisReasons \|\| \[\]\)/);
  assert.match(html,/<summary>為什麼<\/summary>/);
});

test('owner-facing swing labels are plain-language local five-minute pivots',()=>{
  const source=fs.readFileSync(new URL('../src/decision-level-watch.mjs',import.meta.url),'utf8');
  assert.match(source,/近期5分K局部高點/);
  assert.match(source,/近期5分K局部低點/);
  assert.doesNotMatch(source,/label:'近期 Swing High'/);
  assert.doesNotMatch(source,/label:'近期 Swing Low'/);
});

test('next watch shows separate long and short targets with conditional RR without crowding the chart',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/id="dw-long-target"/);
  assert.match(html,/id="dw-short-target"/);
  assert.match(html,/id="dw-long-rr"/);
  assert.match(html,/id="dw-short-rr"/);
  assert.match(css,/\.dw-scenario-watch/);
  assert.match(app,/scenarioDirectionLabel/);
  assert.match(app,/條件式結構 R:R/);
  assert.match(app,/多方下一關/);
  assert.match(app,/空方下一關/);
});

test('AI contract uses backend scenario targets and RR only, with no invented win rate or EV',()=>{
  const inference=fs.readFileSync(new URL('../src/chatgpt-plan-inference.mjs',import.meta.url),'utf8');
  const context=fs.readFileSync(new URL('../src/ask-gpt-inline-context.mjs',import.meta.url),'utf8');
  assert.match(inference,/scenarioWatch\.long/);
  assert.match(inference,/scenarioWatch\.short/);
  assert.match(inference,/條件式結構 R:R/);
  assert.match(inference,/不是勝率、EV/);
  assert.match(context,/scenarioWatch/);
  assert.match(context,/confirmationThreshold/);
  assert.match(context,/invalidationThreshold/);
  assert.match(context,/rewardPoints/);
  assert.match(context,/riskPoints/);
});

// Execute the existing production functions in a minimal DOM/chart host. No live runtime or model calls.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function ui(){
  let now=Date.parse('2026-10-05T10:30:00Z');
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const nodes=new Map();const text=(id,value)=>{node(id).textContent=value;};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},classList:{contains:()=>false},replaceChildren(...children){this.children=children;}});return nodes.get(id);};
  const state={csrfToken:'fixture',levelWatchLoading:false,txChartLevelLines:[],decisionWorkspace:{}};
  let vwapOptions={};
  state.txChartSeries={candle:{createPriceLine:options=>options,removePriceLine:()=>{}},vwap:{applyOptions:options=>{vwapOptions=options;}}};
  const context=vm.createContext({state,$:node,Date:Clock,document:{hidden:false,createElement:()=>({textContent:''})},dwText:text,
    terminalWrite:text,terminalUnavailable:reason=>reason,timeLabel:value=>value,window:{LightweightCharts:{LineStyle:{Dashed:2}}},
    finiteNumber:value=>value==null?null:Number.isFinite(Number(value))?Number(value):null,fmt:(value,n=0)=>Number(value).toFixed(n),
    levelValue:level=>level?.availability==='AVAILABLE'?level.value:null,AbortSignal,
    api:async()=>{throw new Error('OFFLINE_FIXTURE');}});
  // Execute the production warning helper used by the renderer, not a stub.
  const captureStart=app.indexOf('function captureCoverageWarning(');
  const captureEnd=app.indexOf('function txBarObservationLabel(',captureStart);
  vm.runInContext(app.slice(captureStart,captureEnd),context);
  vm.runInContext(app.slice(app.indexOf('function levelEventLabel('),app.indexOf('function renderTxChartLevels(')),context);
  const start=app.indexOf('function renderTxChartLevels('),end=app.indexOf('\n}\n',start)+3;
  vm.runInContext(app.slice(start,end),context);
  return{context,state,node,getVwap:()=>vwapOptions,setNow:value=>{now=value;}};
}
const identity={actualContract:'TXFJ6',tradeDate:'2026-10-05',session:'DAY'};
function displayWatch(){
  const levels=[['OR_HIGH',120],['SESSION_HIGH',160],['OR_LOW',80]].map(([id,price])=>({id,price,label:id,state:'TESTING',basisReasons:['結構','形成時間','反應','資料品質限制']}));
  const scenario=(target)=>({target:{...target,sourceId:'SOURCE',availableAt:'2026-10-05T10:29:00Z',qualityStatus:'PASS',why:'合法結構'},rr:{state:'AVAILABLE',ratio:2,riskPoints:12,rewardPoints:24},priceGateState:'NOT_MET',flowConfirmationState:'QUALITY_INSUFFICIENT',confirm:'確認條件',invalidate:'失效條件'});
  return{state:'READY',snapshotTime:'2026-10-05T10:30:00Z',sourceAvailableAt:'2026-10-05T10:29:30Z',identity,levels,nextWatch:levels[0],scenarioWatch:{directionState:'BIDIRECTIONAL_TEST',node:levels[0],long:scenario(levels[1]),short:scenario(levels[2])}};
}
function displayChart(){return{...identity,mode:'LIVE',status:'READY',qualityStatus:'PASS',availableAt:'2026-10-05T10:29:30Z',levels:{vwap:{availability:'AVAILABLE',value:100},openingRangeHigh:{availability:'AVAILABLE',value:120},openingRangeLow:{availability:'AVAILABLE',value:80},previousClose:{availability:'AVAILABLE',value:95}}};}
test('executed chart render caps all overlays including VWAP and optional references at three',()=>{
  const h=ui();h.state.levelWatch=displayWatch();h.node('decision-workspace').classList.contains=()=>true;
  h.context.renderTxChartLevels(displayChart());
  assert.equal(h.state.txChartLevelLines.length+Number(h.getVwap().lastValueVisible),3);
  assert.equal(new Set(h.state.txChartLevelLines.map(x=>x.price)).size,h.state.txChartLevelLines.length);
});
test('executed poll failure clears scenario targets, RR and old scenario chart labels',async()=>{
  const h=ui();h.state.txChartPayload=displayChart();h.context.renderDecisionLevelWatch(displayWatch());
  assert.match(h.node('dw-long-rr').textContent,/2\.00/);
  await h.context.loadDecisionLevelWatch();
  assert.equal(h.state.levelWatch.state,'UNAVAILABLE');assert.equal(h.state.decisionWorkspace.levelWatch.state,'UNAVAILABLE');
  assert.equal(h.node('dw-long-rr').textContent,'R:R —');assert.equal(h.node('dw-short-rr').textContent,'R:R —');
  assert.match(h.node('dw-next-watch-label').textContent,/更新失敗/);
  assert.equal(h.state.txChartLevelLines.some(x=>/下一關/.test(x.title)),false);
  assert.equal(h.state.levelWatchLoading,false);
});
test('executed render excludes live scenarios from other chart identities and replay',()=>{
  for(const patch of [{actualContract:'TXFK6'},{tradeDate:'2026-10-06'},{session:'NIGHT'},{mode:'REPLAY'}]){
    const h=ui();const chart={...displayChart(),...patch};h.state.txChartPayload=chart;
    h.context.renderDecisionLevelWatch(displayWatch());h.context.renderTxChartLevels(chart);
    assert.equal(h.node('dw-long-rr').textContent,'R:R —');
    assert.equal(h.state.txChartLevelLines.some(x=>/下一關|雙向/.test(x.title)),false);
  }
});
test('same-identity unavailable, stale or quality-degraded chart cannot retain an old available RR',()=>{
  for(const patch of [{status:'UNAVAILABLE',qualityStatus:'UNAVAILABLE'},{status:'STALE'},{qualityStatus:'QUALITY_INSUFFICIENT'}]){
    const h=ui();const chart={...displayChart(),...patch};h.state.txChartPayload=chart;
    h.context.renderDecisionLevelWatch(displayWatch());h.context.renderTxChartLevels(chart);
    assert.equal(h.node('dw-long-rr').textContent,'R:R —');
    assert.equal(h.state.txChartLevelLines.some(x=>/下一關|雙向/.test(x.title)),false);
  }
  const h=ui(),watch=displayWatch();h.state.txChartPayload={...displayChart(),qualityStatus:'QUALITY_INSUFFICIENT'};
  for(const side of ['long','short'])watch.scenarioWatch[side].rr={state:'UNAVAILABLE',ratio:null,reason:'THRESHOLDS_UNAVAILABLE'};
  h.context.renderDecisionLevelWatch(watch);
  assert.match(h.node('dw-next-watch-label').textContent,/雙向/);
  assert.match(h.node('dw-long-evidence').textContent,/缺乏合格資料/);
});
function sourceTimeFixture(){
  const eligibility={schemaVersion:'source-time-structure-v1',state:'ELIGIBLE',basis:'REPORTED_SOURCE_TIME_GEOMETRY',scope:'LIVE_DESCRIPTIVE_ONLY'};
  const watch=displayWatch(),chart={...displayChart(),qualityStatus:'QUALITY_INSUFFICIENT',qualityReasons:['TIMESTAMP_LINEAGE_INSUFFICIENT'],structureEligibility:{...eligibility}};
  watch.structureEligibility={...eligibility};watch.currentPriceQualityStatus='QUALITY_INSUFFICIENT';
  watch.nextWatch.qualityStatus='QUALITY_INSUFFICIENT';
  for(const side of ['long','short']){
    watch.scenarioWatch[side].target.qualityStatus='QUALITY_INSUFFICIENT';
    watch.scenarioWatch[side].target.qualityReasons=['TIMESTAMP_LINEAGE_INSUFFICIENT'];
    watch.scenarioWatch[side].priceGateState='UNAVAILABLE';
  }
  return{watch,chart};
}
test('source-time structural RR needs matching chart and watch contracts and visibly retains raw quality restrictions',()=>{
  const h=ui(),{watch,chart}=sourceTimeFixture(),before=JSON.stringify({watch,chart});
  h.state.txChartPayload=chart;h.context.renderDecisionLevelWatch(watch);h.context.renderTxChartLevels(chart);
  assert.equal(h.node('dw-long-rr').textContent,'R:R 2.00');
  assert.equal(h.node('dw-short-rr').textContent,'R:R 2.00');
  assert.match(h.node('dw-next-watch-label').textContent,/來源時間結構/);
  assert.match(h.node('dw-next-watch-distance').textContent,/跨時計品質受限／不等於可交易/);
  for(const id of ['dw-next-watch-why','dw-long-target-why','dw-short-target-why','dw-long-evidence','dw-short-evidence','dw-scenario-rr-note']){
    assert.match(h.node(id).textContent,/來源所報時間.*跨時計品質受限.*不等於可交易/,id);
  }
  assert.match(h.node('dw-long-target-why').textContent,/QUALITY_INSUFFICIENT（TIMESTAMP_LINEAGE_INSUFFICIENT）/);
  assert.match(h.node('dw-long-evidence').textContent,/價格確認條件不可用/);
  assert.equal(JSON.stringify({watch,chart}),before);
  h.state.txChartPayload={...chart,qualityStatus:'PASS'};h.context.renderDecisionLevelWatch(watch);
  assert.match(h.node('dw-next-watch-distance').textContent,/跨時計品質受限／不等於可交易/,'a newer PASS chart does not relabel the restricted watch');
  delete h.state.txChartPayload.structureEligibility;h.context.renderDecisionLevelWatch(watch);
  assert.equal(h.node('dw-long-rr').textContent,'R:R —');
});
test('missing, malformed or ineligible structure contracts cannot bypass the old degraded-chart guard',()=>{
  for(const side of ['watch','chart'])for(const change of [null,{schemaVersion:'old'},{state:'INELIGIBLE'},{basis:'CLOCK_CORRECTED'},{scope:'TRADING'}]){
    const h=ui(),fixture=sourceTimeFixture();
    fixture[side].structureEligibility=change===null?null:{...fixture[side].structureEligibility,...change};
    h.state.txChartPayload=fixture.chart;h.context.renderDecisionLevelWatch(fixture.watch);h.context.renderTxChartLevels(fixture.chart);
    assert.equal(h.node('dw-long-rr').textContent,'R:R —',side+JSON.stringify(change));
    assert.equal(h.state.txChartLevelLines.some(x=>/下一關|雙向/.test(x.title)),false);
  }
  const h=ui();h.context.renderDecisionLevelWatch(sourceTimeFixture().watch);
  assert.equal(h.node('dw-long-rr').textContent,'R:R —','chart contract must be present for restricted source-time geometry');
});
test('source-time eligibility does not bypass identity, replay, status or freshness guards',()=>{
  for(const patch of [{actualContract:'TXFK6'},{tradeDate:'2026-10-06'},{session:'NIGHT'},{mode:'REPLAY'},
    {status:'UNAVAILABLE'},{status:'STALE'},{availableAt:'2026-10-05T10:20:00Z'},{availableAt:'2026-10-05T10:31:00Z'}]){
    const h=ui(),{watch,chart}=sourceTimeFixture();h.state.txChartPayload={...chart,...patch};
    h.context.renderDecisionLevelWatch(watch);h.context.renderTxChartLevels(h.state.txChartPayload);
    assert.equal(h.node('dw-long-rr').textContent,'R:R —',JSON.stringify(patch));
    assert.equal(h.state.txChartLevelLines.some(x=>/下一關|雙向/.test(x.title)),false);
  }
});
test('an unavailable watch explains source dependencies on both target drawers without manufacturing values',()=>{
  const h=ui();h.state.txChartPayload=displayChart();
  const watch={...displayWatch(),state:'UNAVAILABLE',reason:'OBSERVATION_ZONE_UNAVAILABLE',nextWatch:null,scenarioWatch:null,levels:[],
    unavailabilityDiagnostics:{summary:'近期完成 5 分 K 的結構依賴未通過，不能建立觀察區。',reasonCodes:['OBSERVATION_ZONE_UNAVAILABLE','TIMESTAMP_LINEAGE_INSUFFICIENT'],
      dependencies:{completedBarCount:92,recentRangeBarCount:12,eligibleRangeBarCount:0,restrictedRangeBarCount:12},
      sources:[{id:'OR_HIGH',availability:'UNAVAILABLE',qualityStatus:null,reason:'NIGHT_OPENING_RANGE_NOT_FROZEN'},
        {id:'PRIOR_HIGH',availability:'UNAVAILABLE',qualityStatus:null,reason:'PRIOR_DAY_SOURCE_UNAVAILABLE'}]}};
  h.context.renderDecisionLevelWatch(watch);
  for(const side of ['long','short']){
    assert.equal(h.node(`dw-${side}-target`).textContent,'目前無合法目標');
    assert.equal(h.node(`dw-${side}-rr`).textContent,'R:R —');
    assert.match(h.node(`dw-${side}-target-why`).textContent,/完成 5 分 K 92 根.*range 輸入 12 根.*結構合格 0 根.*原品質受限 12 根/);
    assert.match(h.node(`dw-${side}-target-why`).textContent,/NIGHT_OPENING_RANGE_NOT_FROZEN.*PRIOR_DAY_SOURCE_UNAVAILABLE/);
  }
  assert.match(h.node('dw-next-watch-why').textContent,/10:29:30Z.*TIMESTAMP_LINEAGE_INSUFFICIENT/);
  delete watch.unavailabilityDiagnostics.dependencies.eligibleRangeBarCount;
  h.context.renderDecisionLevelWatch(watch);
  assert.match(h.node('dw-next-watch-why').textContent,/結構合格 未知 根/);
  h.state.txChartPayload={...displayChart(),session:'NIGHT'};h.context.renderDecisionLevelWatch(watch);
  assert.doesNotMatch(h.node('dw-next-watch-why').textContent,/92 根|range 輸入/);
});
test('an absent side target reuses its specific backend exclusion and wait reason',()=>{
  const h=ui(),watch=displayWatch();
  watch.scenarioWatch.long={...watch.scenarioWatch.long,target:null,rr:{state:'UNAVAILABLE',ratio:null},
    targetDiagnostics:{summary:'多方：確認邊界外僅有低優先級背景結構。',waitFor:'等待形成後有效反應，不外推目標。'}};
  h.state.txChartPayload=displayChart();h.context.renderDecisionLevelWatch(watch);
  assert.equal(h.node('dw-long-target').textContent,'目前無合法目標');assert.equal(h.node('dw-long-rr').textContent,'R:R —');
  assert.match(h.node('dw-long-target-why').textContent,/低優先級背景結構.*等待形成後有效反應/);
  assert.equal(h.node('dw-short-rr').textContent,'R:R 2.00');
});
test('executed drawer keeps complete target evidence and distinguishes candidate from confirmation',()=>{
  const h=ui();h.context.renderDecisionLevelWatch(displayWatch());
  const why=h.node('dw-long-target-why').textContent;
  for(const text of ['反應','資料品質限制','SOURCE','2026-10-05T10:29:00Z','PASS'])assert.ok(why.includes(text));
  assert.match(h.node('dw-next-watch-label').textContent,/雙向測試／方向未定/);
  assert.match(h.node('dw-long-evidence').textContent,/尚未達確認邊界.*品質不足.*12\.00.*24\.00/);
});
test('bounded GPT context preserves exact backend scenarios and unavailable thresholds',()=>{
  const snapshotTime='2026-10-05T10:30:00Z';
  for(const qualityStatus of ['PASS','QUALITY_INSUFFICIENT']){
    const available=value=>({availability:'AVAILABLE',value,availableAt:snapshotTime,source:'GOVERNED_FIXTURE',qualityStatus:'PASS'});
    const chart={...identity,availableAt:snapshotTime,timeframe:'5m',lastPrice:100,qualityStatus,
      bars:[{time:'2026-10-05T10:20:00Z',availableAt:'2026-10-05T10:24:59Z',open:100,high:105,low:95,close:100,qualityStatus:'PASS'}],
      openingRange:{status:'READY'},levels:{vwap:available(100),openingRangeHigh:available(150),openingRangeLow:available(50)}};
    const levelWatch=buildDecisionLevelWatch({chart,snapshotTime});
    const snapshot=createDecisionSnapshot({chart,levelWatch,snapshotTime,dataHealth:{items:[],overall:'PARTIAL',unavailableCount:0,staleCount:0}});
    const result=buildInlineContext(snapshot,{now:Date.parse(snapshotTime)+1000});
    for(const side of ['long','short']){
      const actual=result.context.levelWatch.scenarioWatch[side],expected=levelWatch.scenarioWatch[side];
      assert.equal(actual.confirmationThreshold,expected.confirmationThreshold);assert.equal(actual.invalidationThreshold,expected.invalidationThreshold);
      assert.deepEqual(actual.target,expected.target);assert.deepEqual(actual.rr,expected.rr);
      assert.equal(actual.rr.state,qualityStatus==='PASS'?'AVAILABLE':'UNAVAILABLE');
    }
    assert.ok(result.inputBytes<40000);
    for(const [key,value]of Object.entries({formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false}))assert.equal(result.context[key],value);
  }
  const headings=['現在怎麼看','核心決策節點','多方情境','空方情境','觀望條件','條件式結構 R:R','現在不要做什麼','資料限制'];
  let previous=-1;for(const heading of headings){const index=ANALYSIS_INSTRUCTIONS.indexOf(`「${heading}」`);assert.ok(index>previous);previous=index;}
});


test('same-identity READY charts cannot display an expired or unverifiable scenario',()=>{
  const now=Date.parse('2026-10-05T10:30:00Z');
  for(const patch of [{snapshotTime:new Date(now-121000).toISOString(),sourceAvailableAt:new Date(now-121001).toISOString()},
    {sourceAvailableAt:new Date(now-120001).toISOString()},{sourceAvailableAt:null},{snapshotTime:null},
    {snapshotTime:new Date(now+6000).toISOString()},{sourceAvailableAt:'not-a-time'},
    {sourceAvailableAt:new Date(now+1000).toISOString()}]){
    const h=ui();h.state.txChartPayload=displayChart();
    h.context.renderDecisionLevelWatch({...displayWatch(),...patch});h.context.renderTxChartLevels(h.state.txChartPayload);
    assert.equal(h.node('dw-long-rr').textContent,'R:R —');assert.equal(h.node('dw-short-rr').textContent,'R:R —');
    assert.match(h.node('dw-next-watch-label').textContent,/非最新/);
    assert.equal(h.state.txChartLevelLines.some(x=>/下一關|雙向/.test(x.title)),false);
  }
  const h=ui();h.state.txChartPayload={...displayChart(),availableAt:new Date(now-120001).toISOString()};
  h.context.renderDecisionLevelWatch(displayWatch());assert.equal(h.node('dw-long-rr').textContent,'R:R —');
});

test('in-flight polls expire the current scenario before a replacement response arrives',async()=>{
  const h=ui();h.state.txChartPayload=displayChart();h.context.renderDecisionLevelWatch(displayWatch());
  assert.match(h.node('dw-long-rr').textContent,/2\.00/);
  h.setNow(Date.parse('2026-10-05T10:32:01Z'));
  let finish;h.context.api=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.context.loadDecisionLevelWatch();
  assert.equal(h.node('dw-long-rr').textContent,'R:R —');assert.match(h.node('dw-next-watch-label').textContent,/非最新/);
  finish({data:{state:'UNAVAILABLE',reason:'CHART_SOURCE_STALE'}});await pending;
  assert.equal(h.node('dw-short-rr').textContent,'R:R —');assert.equal(h.state.levelWatchLoading,false);
});

test('a freshly generated AI snapshot keeps stale market source time and cannot revive scenario conditions',()=>{
  const snapshotTime='2026-10-05T10:30:00Z',sourceAvailableAt='2026-10-05T10:20:00Z';
  const chart={...displayChart(),timeframe:'5m',lastPrice:100,availableAt:sourceAvailableAt};
  const levelWatch=buildDecisionLevelWatch({chart,snapshotTime});
  assert.equal(levelWatch.reason,'CHART_SOURCE_STALE');
  const snapshot=createDecisionSnapshot({chart,levelWatch,snapshotTime,dataHealth:{items:[],overall:'PARTIAL',unavailableCount:0,staleCount:1}});
  const result=buildInlineContext(snapshot,{now:Date.parse(snapshotTime)+1000});
  assert.equal(result.context.levelWatch.state,'UNAVAILABLE');assert.equal(result.context.levelWatch.reason,'CHART_SOURCE_STALE');
  assert.equal(result.context.levelWatch.sourceAvailableAt,new Date(sourceAvailableAt).toISOString());
  assert.equal(result.context.levelWatch.scenarioWatch,null);assert.equal(result.context.levelWatch.nextWatch,null);
});

test('P0 production DOM omits distant hypothetical nodes and RR from the current focus and overlays',()=>{
  const h=ui(), watch=displayWatch(), chart=displayChart();
  watch.decisionFocus={
    state:'NO_ACTIVE_REFERENCE',activeNodeId:null,activityRadiusPoints:12,
    nearestBackground:{id:'OR_HIGH',label:'歷史參考',price:120,distancePoints:360},
  };
  h.state.txChartPayload=chart;
  h.context.renderDecisionLevelWatch(watch);
  h.context.renderTxChartLevels(chart);
  assert.match(h.node('dw-next-watch-label').textContent,/沒有合格且接近現價的主要觀察節點/);
  assert.match(h.node('dw-next-watch-why').textContent,/不是當前測試/);
  assert.equal(h.node('dw-long-rr').textContent,'R:R —');
  assert.equal(h.node('dw-short-rr').textContent,'R:R —');
  assert.equal(h.state.txChartLevelLines.some(x=>/雙向|下一關/.test(x.title)),false);
});
