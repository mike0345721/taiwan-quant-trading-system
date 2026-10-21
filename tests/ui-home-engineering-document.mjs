// Real production HTML/CSS/Home module + extracted original chart factory. All market/account inputs are synthetic.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const app=read('public/app.js').replaceAll('\r\n','\n');
const script=s=>'<script>'+s.replaceAll('</script','<\\/script')+'</script>';
function productionFunction(name){const start=app.indexOf('function '+name+'('),end=app.indexOf('\n}',start)+2;if(start<0||end<=start)throw Error('PRODUCTION_FUNCTION_MISSING '+name);return app.slice(start,end);}
export function homeEngineeringDocument({scenario='normal'}={}){
 let html=read('public/index.html').replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/g,'').replace(/\s*<script[^>]+src="[^"]+"[^>]*><\/script>/g,'');
 const styles=['public/styles.css','public/trader-terminal-shell.css','public/ask-gpt-inline.css','public/home-workspace.css'].map(f=>'<style>'+read(f)+'</style>').join('');
 const rb=app.indexOf('const OBSERVED_FLOW_WINDOW_REGISTRY ='),re=app.indexOf('\n]);',rb)+4;
 const registryCode=app.slice(rb,re);
 const chartCode=['timeLabel','finiteNumber','fmt','signed','dwText','chartTimeLabel','chartEpoch','activeCandlePalette','txChartRuntimeReason','captureCoverageWarning','txBarObservationLabel','ensureTxChart','chartSeriesData','normalizeDashboardPageFragments','setDashboardPage','observedFlowMetric','observedFlowCoverage','observedFlowRatio','observedFlowStateLabel','observedFlowDisplayCells','renderObservedFlowSegments','renderObservedFlowEnergy','observedFlowWindowByKey','observedFlowPressureSide','observedFlowRelation','observedFlowSelectedSummary','renderObservedFlowSelected','renderObservedFlowStrip','selectObservedFlowWindow','selectChartTimeframe','bindObservationControls','sourceTimeStructureEligible','levelWatchIsFresh','levelWatchMatchesChart','renderHomeWorkspace'].map(productionFunction).join('\n');
 const setup=`
 const $=id=>document.getElementById(id);let observedFlowSelectedWindow='5m',lastObservedFlowValue=null;
 const flowChannel={view:()=>lastObservedFlowValue||{sourceState:'UNAVAILABLE',windows:null}};
 const dwHumanize=v=>String(v||'未知');
 async function loadTxDecisionChart(){state.txChartPayload={...state.txChartPayload,timeframe:state.txChartTimeframe};renderHomeWorkspace();}
 const state={txChartPalette:'red-up',txChartPayload:null,csrfToken:'',guestReadOnly:false};let dataOperationsPageActive=false;
 window.__calls=[];window.__uiAccountRows=[{key:'a'.repeat(64),label:'SYNTHETIC TEST ACCOUNT',accessReady:true,planPermission:true}];window.__runtimeErrors=[];
 window.addEventListener('error',e=>window.__runtimeErrors.push(e.message));
 window.fetch=async function(url,options={}){window.__calls.push(String(url));
  if(url==='/api/session')return new Response(JSON.stringify({authenticated:true,csrfToken:crypto.randomUUID()}));
  if(url==='/api/v1/ask-gpt/status')return new Response(JSON.stringify({ok:true,data:{enabled:true,accounts:window.__uiAccountRows,reason:null,runtimeCommit:'SYNTHETIC_ENGINEERING'}}));
  if(url==='/api/v1/ask-gpt/models')return new Response(JSON.stringify({ok:true,data:{models:[{slug:'gpt-5.6-terra',display_name:'SYNTHETIC TEST MODEL'}]}}));
  throw Error('UNEXPECTED_TEST_FETCH '+url);
 };
 $('loading-view').classList.add('hidden');$('login-view').classList.add('hidden');$('dashboard-view').classList.remove('hidden');$('app').classList.add('is-dashboard-shell');
 const banner=document.createElement('div');banner.textContent='工程版面預覽 · 合成資料／測試帳號 · 非即時行情／非產品驗收';banner.style.cssText='padding:8px 16px;background:#3b2732;color:#fff;font:13px sans-serif;line-height:1.5;';document.body.prepend(banner);
 window.__originalIds=[...document.querySelectorAll('[id]')].map(n=>n.id);
 try{localStorage.removeItem('twchip.home.navigation.v1');}catch{}
 `;
 const inspect=`
 (async()=>{const output=document.createElement('pre');output.id='ui-convergence-test-result';output.hidden=true;
 try{
  const r=$('decision-workspace');normalizeDashboardPageFragments();setDashboardPage('workspace',{scroll:false});window.TraderTerminalShell.mount(r);
  document.querySelectorAll('[data-dashboard-page]').forEach(b=>b.addEventListener('click',()=>setDashboardPage(b.dataset.dashboardPage,{scroll:false})));
  const sleep=()=>new Promise(resolve=>setTimeout(resolve,70));await sleep();await sleep();
  const rect=n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom};};
  const identity={actualContract:'TX-TEST',tradeDate:'2026-01-05',session:'NIGHT'};let v=46720;
  const bars=Array.from({length:72},(_,i)=>{const open=v;v=Math.round(v+Math.sin(i*.52)*12+2.2);return{time:new Date(Date.UTC(2026,0,5,7)+i*300000).toISOString(),open,high:Math.max(open,v)+13,low:Math.min(open,v)-12,close:v,volume:80+(i%13)*18};});
  const chartPayload={...identity,mode:'LIVE',timeframe:'5m',status:'READY',qualityStatus:'PASS',availableAt:new Date().toISOString(),lastPrice:bars.at(-1).close,bars,vwap:bars.map((b,i)=>({time:b.time,value:46725+i*1.2})),levels:{}};
  state.txChartPayload=chartPayload;const chart=ensureTxChart();if(!chart)throw Error('REAL_CHART_FACTORY_FAILED '+state.txChartRuntimeReason);
  const series=chartSeriesData(chartPayload);state.txChartSeries.candle.setData(series.candles);state.txChartSeries.volume.setData(series.volumes);state.txChartSeries.vwap.setData(series.vwap);chart.timeScale().fitContent();
  $('dw-chart-empty').classList.add('hidden');
  const base={now:Date.now(),chart:chartPayload,rendered:true,focusAllowed:true,
   flow:{identity:{...identity},sourceState:'LIVE',source:{availableAt:chartPayload.availableAt},researchQuality:{status:'READY'},windows:{primary60s:{}}},
   watch:{state:'READY',identity:{...identity},sourceAvailableAt:chartPayload.availableAt,decisionFocus:{state:'ACTIVE_REFERENCE'},nextWatch:{price:46760},scenarioWatch:{long:{target:{price:46920}},short:{target:{price:46720}}},evidenceGate:{actionableRrAllowed:false}}};
  base.flowDefinitions=OBSERVED_FLOW_WINDOW_REGISTRY;base.selectedFlowWindow='5m';base.watch.snapshotTime=chartPayload.availableAt;
 for(const d of OBSERVED_FLOW_WINDOW_REGISTRY.filter(d=>d.data==='GOVERNED'))base.flow.windows[d.source]={status:'READY',truthState:'LIVE',pressure:{status:'READY',pressureRatio:.25,classifiedCoverage:1,direction:'BUY_SIDE',buyProxyVolume:125,sellProxyVolume:75,unknownVolume:0,totalExecutedVolume:200,netAggressiveFlowProxy:50},response:{status:'READY',displacementPoints:12},pathEfficiency:{status:'READY',value:.4}};
 base.pulse={schemaVersion:'market-pulse-live-v1',identity:{...identity},generatedAt:chartPayload.availableAt,sourceAvailableAt:chartPayload.availableAt,rvol:{state:'READY',ratio:1.24,sampleDays:20},basis:{state:'SESSION_CLOSED_REFERENCE',points:12,spotPrice:chartPayload.lastPrice-12,spotTradeDate:identity.tradeDate}};
 base.leadership={indexCode:'IX0001',session:'DAY',state:'SESSION_CLOSED',sourceMode:'EOD_CONTEXT',quality:'PASS',sourceTradeDate:identity.tradeDate,lastAvailableAt:chartPayload.availableAt,indexLeadership:{topAbsolute:[{name:'測試成分甲',points:12},{name:'測試成分乙',points:-4}]}};
 state.txChartBarCount=72;state.txChartTimeframe='5m';
 window.__homeScenario=name=>{const x=structuredClone(base);x.now=Date.now();
   if(name==='limited'){x.chart.qualityStatus='QUALITY_INSUFFICIENT';x.chart.qualityReasons=['TIMESTAMP_LINEAGE_INSUFFICIENT'];x.flow.sourceState='UNAVAILABLE';x.flow.windows=null;x.flow.unavailableReason='LIVE_PRODUCER_PROCESS_MISSING';x.focusAllowed=false;}
   if(name==='offline'){x.chartError='Failed to fetch';x.dashboardError='DASHBOARD_REFRESH: Failed to fetch';x.flow.sourceState='UNAVAILABLE';x.flow.windows=null;x.flow.unavailableReason='Failed to fetch';}
   if(name==='offline'){x.pulse=null;x.leadership={state:'UNAVAILABLE'};}
   if(name==='warming')x.flow.windows.window14400s.truthState='WARMING_UP';
   if(name==='noFocus'){x.watch.decisionFocus.state='NO_ACTIVE_REFERENCE';x.focusAllowed=false;}
   if(name==='day'){x.chart.session=x.flow.identity.session=x.watch.identity.session=x.pulse.identity.session='DAY';x.pulse.basis.state='LIVE';x.leadership.state='LIVE';x.leadership.sourceMode='LIVE_RAW';}
   lastObservedFlowValue=x.flow;state.txChartPayload=x.chart;state.txChartTimeframe=x.chart.timeframe;document.querySelectorAll('[data-chart-timeframe]').forEach(b=>{const active=b.dataset.chartTimeframe===x.chart.timeframe;b.classList.toggle('is-selected',active);b.setAttribute('aria-pressed',String(active));});state.levelWatch=x.watch;state.marketPulse=x.pulse;state.indexLeadership=x.leadership;state.homeChartError=x.chartError;state.homeDashboardError=x.dashboardError;observedFlowSelectedWindow=x.selectedFlowWindow;
   window.HomeWorkspace.render(r,x);window.__currentHomeInput=x;return x;
  };
  for(const [id,value] of Object.entries({'dw-chart-session':'夜盤','dw-chart-contract':'TX-TEST','dw-reference-price':fmt(chartPayload.lastPrice),'dw-vwap-label':'本時段 VWAP','dw-vwap-state':'46,810.20','dw-session-levels':'46,920 / 46,684','dw-rvol-state':'1.24×','dw-next-watch-label':'觀察位置 46,760（合成案例）','dw-next-watch-distance':'距現價 120 點・僅為版面案例','dw-long-target':'46,920（示例）','dw-short-target':'46,720（示例）','dw-long-confirm':'依既有合法條件確認','dw-long-invalidate':'依既有失效条件排除','dw-short-confirm':'依既有合法條件確認','dw-short-invalidate':'依既有失效條件排除','dw-scenario-rr-note':'條件不足，不提供可執行 R:R。','dw-flow-selected-ratio':'+0.218','dw-flow-selected-side':'成交壓力觀測','dw-flow-selected-response':'+12 點','dw-flow-selected-relation':'價格反應觀測','dw-flow-selected-path':'0.420','dw-flow-selected-coverage':'100.0%'}))$(id).textContent=value;
  window.__homeScenario('normal');bindObservationControls();
  const originalCanvas=$('dw-chart-canvas').querySelector('canvas');
  $('dw-flow-tab-1h').click();await sleep();
  const flowSelectionIndependent=state.txChartTimeframe==='5m'&&observedFlowSelectedWindow==='1h'&&$('home-flow-selection-title').textContent.includes('1小時');
  document.querySelector('[data-chart-timeframe="15m"]').click();await sleep();
  const chartSelectionIndependent=state.txChartTimeframe==='15m'&&observedFlowSelectedWindow==='1h';
  const rowSelectionPreservesChart=originalCanvas===$('dw-chart-canvas').querySelector('canvas');
  const actualAdapterRows=[...r.querySelectorAll('[data-home-window]')].length===6&&$('home-flow-buy').textContent==='125';
  window.__homeScenario('normal');
  const quickButtons=[...r.querySelectorAll('[data-home-quick-key]')];
  const quickInitial=quickButtons.length===6&&$('home-flow-quick-5m').getAttribute('aria-pressed')==='true';
  const quickBeforeChart=rect($('home-flow-quick')).bottom<=rect(r.querySelector('.dw-chart-stage')).y+1;
  let quickSelectionSync=true,quickKeyboardReachable=true;
  for(const b of quickButtons){b.focus();quickKeyboardReachable=quickKeyboardReachable&&document.activeElement===b&&b.tagName==='BUTTON'&&b.type==='button'&&b.tabIndex>=0;b.click();await sleep();const key=b.dataset.homeQuickKey;quickSelectionSync=quickSelectionSync&&observedFlowSelectedWindow===key&&state.txChartTimeframe==='5m'&&$('dw-flow-tab-'+key).getAttribute('aria-pressed')==='true'&&b.getAttribute('aria-pressed')==='true'&&quickButtons.filter(n=>n.getAttribute('aria-pressed')==='true').length===1;}
  $('dw-flow-tab-30m').click();await sleep();const quickTableToStrip=$('home-flow-quick-30m').getAttribute('aria-pressed')==='true';
  const quickCanvasPreserved=originalCanvas===$('dw-chart-canvas').querySelector('canvas');
  const quickMirrorValues=quickButtons.every(b=>b.querySelector('.home-flow-quick-value').textContent===r.querySelector('[data-home-window="'+b.dataset.homeQuickKey+'"] [data-home-field="pressure"]').textContent);
  window.HomeWorkspace.mount(r);const quickMountIdempotent=r.querySelectorAll('#home-flow-quick').length===1&&r.querySelectorAll('[data-home-quick-key]').length===6&&r.querySelectorAll('[data-flow-window]').length===7;
  window.__homeScenario('normal');
  const menu=$('home-nav-toggle'),nav=$('side-nav'),pages=document.querySelector('.dashboard-pages');
  const navigationInitiallyHidden=nav.hidden,menuInitiallyReachable=rect(menu).w>=40;
  const canvas=$('dw-chart-canvas').querySelector('canvas'),beforeWidth=rect(r.querySelector('.dw-price-region')).w;
  menu.click();await sleep();const navigationOpens=!nav.hidden;const openedChartWidth=rect(r.querySelector('.dw-price-region')).w;
  const modal=innerWidth<768;let escapeRestoresFocus=true,modalInertPreserved=true;
  if(modal){modalInertPreserved=pages.inert===true;document.querySelector('#side-nav button').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep();escapeRestoresFocus=nav.hidden&&document.activeElement===menu&&pages.inert===false;}
  else{$('side-nav-toggle').click();await sleep();}
  const navigationCloses=nav.hidden,canvasIdentityPreserved=canvas===$('dw-chart-canvas').querySelector('canvas'),hiddenRailReclaimsWidth=rect(r.querySelector('.dw-price-region')).w>=beforeWidth-1;
  const ai=$('home-ai'),aiInitiallyClosed=!ai.open;ai.open=true;await sleep();
  const background=r.querySelector('.tt-context-section'),fallback=r.querySelector('.tt-copy-fallback');
  const checkbox=$('ai-credits'),consent=checkbox.closest('label'),span=consent.querySelector('span');
  const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
  const beforeConsent=checkbox.checked,submitBefore=$('ai-submit').disabled;
  $('ai-models').click();await sleep();await sleep();
  const settingsClosedAfterModels=!$('ai-settings').open,summaryAfterModels=$('ai-settings-summary').textContent;
  const modelReady=$('ai-model').value==='gpt-5.6-terra',submitStillDisabled=$('ai-submit').disabled;
  $('ai-model').add(new Option('SYNTHETIC SECOND MODEL','test-second'));$('ai-model').value='test-second';$('ai-model').dispatchEvent(new Event('change'));
  const selectedModelSummaryUpdated=$('ai-settings-summary').textContent.includes('SYNTHETIC SECOND MODEL');
  $('ai-account').value='';$('ai-account').dispatchEvent(new Event('change'));const settingsReopened=$('ai-settings').open;
  const result={engineeringOnly:true,productionChartFactory:true,canvasCount:$('dw-chart-canvas').querySelectorAll('canvas').length,viewport:innerWidth,docWidth:document.documentElement.scrollWidth,layout:r.dataset.uiLayout,
   clientWidth:document.documentElement.clientWidth,workspace:rect(r),navigationWidthDelta:beforeWidth-openedChartWidth,chart:rect(r.querySelector('.dw-chart-stage')),chartRegion:rect(r.querySelector('.dw-price-region')),focus:rect(r.querySelector('.tt-focus-card')),
   focusFont:parseFloat(getComputedStyle($('dw-next-watch-label')).fontSize),checkbox:rect(checkbox),consent:rect(consent),consentText:rect(span),consentFont:parseFloat(getComputedStyle(span).fontSize),
   creditsInitiallyUnchecked:!beforeConsent,submitBefore,submitStillDisabled,settingsClosedAfterModels,summaryAfterModels,settingsReopened,modelReady,selectedModelSummaryUpdated,
   modelCalls:window.__calls.filter(u=>u==='/api/v1/ask-gpt/ask').length,backgroundInitiallyClosed:!background.open,fallbackInitiallyClosed:!fallback.open,
   recencyVisible:rect($('tt-top-updated')).h>0,modeVisible:rect(r.querySelector('.dw-mode-switch')).h>0,
   confirmVisible:['dw-long-confirm','dw-long-invalidate','dw-short-confirm','dw-short-invalidate'].every(id=>!$(id).closest('details:not([open])')&&rect($(id)).h>0),
   rrNoteVisible:!$('dw-scenario-rr-note').closest('details:not([open])'),flowBelowChart:rect(r.querySelector('.tt-flow-overview')).y>=rect(r.querySelector('.dw-price-region')).bottom-1,
   preservedIds:window.__originalIds.every(id=>ids.includes(id)),missingIds:window.__originalIds.filter(id=>!ids.includes(id)),duplicateCriticalIds:['ai-credits','ai-account','ai-model','dw-next-watch','dw-chart-canvas'].filter(id=>ids.filter(v=>v===id).length!==1),
   flowSelectionIndependent,chartSelectionIndependent,rowSelectionPreservesChart,actualAdapterRows,
   quickInitial,quickBeforeChart,quickSelectionSync,quickKeyboardReachable,quickTableToStrip,quickCanvasPreserved,quickMirrorValues,quickMountIdempotent,
   evidenceRowsVisible:[...r.querySelectorAll('[data-home-window]')].every(n=>rect(n).h>0&&!n.closest('details:not([open])')),
   relatedMarketVisible:rect($('home-related-market')).h>0&&!$('home-related-market').closest('details:not([open])'),
   navigationInitiallyHidden,menuInitiallyReachable,navigationOpens,navigationCloses,escapeRestoresFocus,modalInertPreserved,canvasIdentityPreserved,hiddenRailReclaimsWidth,aiInitiallyClosed};
  background.open=true;fallback.open=true;result.backgroundExpandable=rect(background.querySelector('.tt-card-global')).h>0;result.fallbackExpandable=rect($('dw-copy-gpt-prompt')).h>0;result.docWidthExpanded=document.documentElement.scrollWidth;
  background.open=false;fallback.open=false;ai.open=false;
  $('tt-chart-expand').click();result.quickExpandedVisible=rect($('home-flow-quick')).h>0&&rect($('home-flow-quick')).bottom<=rect(r.querySelector('.dw-chart-stage')).y+1;result.expandHidesRail=getComputedStyle(r.querySelector('.tt-tier-one-grid')).display==='none';$('tt-chart-expand').click();result.restoreShowsRail=getComputedStyle(r.querySelector('.tt-tier-one-grid')).display!=='none';
  window.__homeScenario('offline');result.quickOfflineCleared=quickButtons.every(b=>b.querySelector('.home-flow-quick-value').textContent==='—'&&b.querySelector('.home-flow-quick-fill').hidden);result.offlineSnapshotVisible=!$('home-chart-notice').hidden&&$('dw-chart-status').textContent.includes('非即時');result.offlineFocusBlocked=r.dataset.homeFocus==='blocked';
  result.offlineNoPriceError=!/fetch|UNAVAILABLE/i.test($('tt-top-price').textContent);result.offlineTimeUnchanged=$('tt-top-updated').textContent.includes(new Date(chartPayload.availableAt).getFullYear());
  result.offlineCanvasRetained=canvas===$('dw-chart-canvas').querySelector('canvas');
  window.__homeScenario('limited');result.limitedStateVisible=$('home-status').textContent==='資料受限'&&r.dataset.homeFlow==='unavailable';
  window.__homeScenario('normal');result.quickRecoveryRestores=quickButtons.every(b=>b.querySelector('.home-flow-quick-value').textContent==='+0.250');result.recoveryClearsSnapshot=$('home-chart-notice').hidden&&r.dataset.homeFocus==='active';
  const longInput=structuredClone(base);longInput.dashboardError='FAILED_'+ 'x'.repeat(3000);window.HomeWorkspace.render(r,longInput);$('home-data-details').open=true;
  result.longErrorNoOverflow=document.documentElement.scrollWidth<=innerWidth+1;$('home-data-details').open=false;
  window.__homeScenario(${JSON.stringify(scenario)});$('ai-account').value='a'.repeat(64);$('ai-model').value='gpt-5.6-terra';$('ai-settings').open=false;HomeWorkspace.aiSummary();
  result.mobileFocusVisible=innerWidth>=1200||rect($('home-mobile-focus')).h>0;
  result.chartControlsPreserved=['tt-level-toggle','tt-chart-expand','dw-chart-timeframes'].every(id=>Boolean($(id)));
  result.quickFinal=quickButtons.map(b=>({key:b.dataset.homeQuickKey,value:b.querySelector('.home-flow-quick-value').textContent,status:b.querySelector('.home-flow-quick-state').textContent,visible:rect(b).h>0}));
  result.finalFlowRows=[...r.querySelectorAll('[data-home-window]')].map(n=>({key:n.dataset.homeWindow,state:n.querySelector('[data-home-field="state"]').textContent,net:n.querySelector('[data-home-field="net"]').textContent}));
  result.finalContextBasisLabel=$('home-context-basis-label').textContent;result.finalContextBasis=$('home-context-basis').textContent;
  result.runtimeErrors=window.__runtimeErrors;result.finalScenario=${JSON.stringify(scenario)};
  result.overflowElements=[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(n=>({id:n.id,class:n.className,rect:rect(n)}));
  output.textContent=JSON.stringify(result);window.scrollTo(0,0);
 }catch(e){output.textContent=JSON.stringify({error:e.message,stack:e.stack});}
 document.body.append(output);
 })();`;
 const bundle=read('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
 return html.replace('</head>',styles+'</head>').replace('</body>',script(setup)+script(bundle)+script(read('public/home-workspace.js'))+script(read('public/trader-terminal-shell.js'))+script(registryCode)+script(chartCode)+script(read('public/ask-gpt-inline.js'))+script(inspect)+'</body>');
}

// Whole production script stack, not extracted renderers. Transport is synthetic;
// this verifies login/failure lifecycle without using an Owner session or live data.
export function homeBootstrapDocument(authenticated = false) {
 const original=read('public/index.html');
 const css=[...original.matchAll(/<link[^>]+href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(m=>m[1]).filter(p=>p.startsWith('/')&&p.endsWith('.css'));
 const js=[...original.matchAll(/<script[^>]+src="([^"?]+)(?:\?[^"]*)?"[^>]*><\/script>/g)].map(m=>m[1]);
 const assets=js.map(p=>p==='/vendor/lightweight-charts.js'?read('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'):read('public'+p));
 const html=original.replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/g,'').replace(/\s*<script[^>]+src="[^"]+"[^>]*><\/script>/g,'');
 const setup=`window.__entryErrors=[];window.__entryCalls=[];window.addEventListener('error',e=>window.__entryErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__entryErrors.push(String(e.reason)));
 window.fetch=async(url,options={})=>{window.__entryCalls.push({url:String(url),method:options.method||'GET'});
 if(String(url)==='/api/session')return new Response(JSON.stringify({authenticated:${Boolean(authenticated)},csrfToken:${authenticated?'"SYNTHETIC_ENTRY_CSRF"':'""'}}));
 if(String(url)==='/api/v1/ask-gpt/status')return new Response(JSON.stringify({ok:true,data:{enabled:false,accounts:[],reason:'SYNTHETIC_DISABLED'}}));
 throw new Error('SYNTHETIC_SOURCE_OFFLINE');};`;
 const check=`(async()=>{await new Promise(r=>setTimeout(r,650));const out=document.createElement('pre');out.id='ui-convergence-test-result';out.hidden=true;const root=document.getElementById('decision-workspace');
 const result={engineeringOnly:true,wholeProductionStack:true,authenticatedFixture:${Boolean(authenticated)},errors:window.__entryErrors,loginVisible:!document.getElementById('login-view').classList.contains('hidden'),dashboardVisible:!document.getElementById('dashboard-view').classList.contains('hidden'),homeVersion:root.dataset.homeEvidence,loadState:root.dataset.dashboardLoadState,sourceFailureVisible:!document.getElementById('home-banner').hidden&&document.getElementById('home-status').textContent.includes('中斷'),rows:document.querySelectorAll('[data-home-window]').length,modelWrites:window.__entryCalls.filter(c=>c.method!=='GET'||c.url.includes('/ask-gpt/ask')).length,sessionCalls:window.__entryCalls.filter(c=>c.url==='/api/session').length,idsUnique:[...document.querySelectorAll('[id]')].map(n=>n.id).length===new Set([...document.querySelectorAll('[id]')].map(n=>n.id)).size};out.textContent=JSON.stringify(result);document.body.append(out);})();`;
 return html.replace('</head>',css.map(p=>'<style>'+read('public'+p)+'</style>').join('')+'</head>').replace('</body>',script(setup)+assets.map(script).join('')+script(check)+'</body>');
}
