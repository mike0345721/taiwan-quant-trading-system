import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const home = fs.readFileSync(new URL('../public/home-workspace.js', import.meta.url), 'utf8');
const sandbox = { window: {} }; vm.runInNewContext(home, sandbox);
const derive = sandbox.window.HomeWorkspace.derive;
const now = Date.parse('2026-01-05T02:00:00Z'), recent = new Date(now - 1000).toISOString();
const id = { actualContract: 'TEST-CONTRACT', tradeDate: '2026-01-05', session: 'DAY' };
function input() { return { now, rendered: true, focusAllowed: true,
  chart: { ...id, mode: 'LIVE', timeframe: '5m', status: 'READY', qualityStatus: 'PASS', availableAt: recent, lastPrice: 1000, bars: [{}] },
  flow: { identity: { ...id }, sourceState: 'LIVE', source: { availableAt: recent }, researchQuality: { status: 'READY' }, windows: { primary60s: {} } },
  watch: { identity: { ...id }, state: 'READY', sourceAvailableAt: recent, decisionFocus: { state: 'ACTIVE_REFERENCE' }, evidenceGate: { actionableRrAllowed: false } },
}; }
test('home presentation: valid existing reference remains observation, never a new signal', () => { const r=derive(input()); assert.equal(r.focus,'active'); assert.equal(r.chartCurrent,true); assert.equal(r.status,'觀察資料合格'); assert.match(r.focusMessage,/不是進場指令/); });
test('home presentation: good data without a reference is distinct from a fault', () => { const x=input();x.watch.decisionFocus.state='NO_ACTIVE_REFERENCE';const r=derive(x);assert.equal(r.focus,'none');assert.equal(r.focusTitle,'附近沒有合格觀察價位'); });
test('home presentation: chart fetch failure freezes the retained image, not its source time', () => { const x=input();x.chartError='Failed to fetch';const r=derive(x);assert.equal(r.chartCurrent,false);assert.equal(r.hasChart,true);assert.match(r.chartLabel,/快照/);assert.equal(r.focus,'blocked');assert.equal(x.chart.availableAt,recent);assert.equal(r.price,'1,000'); });
test('home presentation: dashboard failure does not invalidate an independently fresh chart', () => { const x=input();x.dashboardError='Failed to fetch';const r=derive(x);assert.equal(r.chartCurrent,true);assert.equal(r.status,'部分資料更新中斷');assert.equal(r.focus,'blocked'); });
test('home presentation: timestamp stale or future cannot be shown as current', () => { for(const age of [120001,-5001]){const x=input();x.chart.availableAt=new Date(now-age).toISOString();const r=derive(x);assert.equal(r.chartCurrent,false);assert.equal(r.focus,'blocked');} });
test('home presentation: missing timestamps and identities remain unknown', () => { for(const k of ['availableAt','actualContract','tradeDate','session']){const x=input();delete x.chart[k];assert.equal(derive(x).chartCurrent,false,k);} });
test('home presentation: absent values are not manufactured zeros; legitimate zero survives', () => { const x=input();x.chart.lastPrice=null;assert.equal(derive(x).price,'—');x.chart.lastPrice=0;assert.equal(derive(x).price,'0');x.chart.lastPrice='';assert.equal(derive(x).price,'—'); });
test('home presentation: READY is not a quality promotion', () => { const x=input();x.chart.qualityStatus='QUALITY_INSUFFICIENT';x.focusAllowed=false;const r=derive(x);assert.equal(r.chartQualified,false);assert.equal(r.chartLabel,'圖表資料受限');assert.equal(r.focus,'blocked'); });
test('home presentation: qualified price-only reference retains explicit limits', () => { const x=input();x.chart.qualityStatus='QUALITY_INSUFFICIENT';x.flow.sourceState='UNAVAILABLE';x.flow.windows=null;const r=derive(x);assert.equal(r.focus,'active');assert.match(r.focusTitle,/受限/);assert.match(r.focusMessage,/不代表方向或可執行 R:R/);assert.equal(x.watch.evidenceGate.actionableRrAllowed,false); });
test('home presentation: unavailable flow does not become neutral or zero', () => { const x=input();x.flow.sourceState='UNAVAILABLE';x.flow.windows=null;x.watch.decisionFocus.state='NO_ACTIVE_REFERENCE';const r=derive(x);assert.equal(r.flowCurrent,false);assert.equal(r.flowLabel,'暫不可用');assert.equal(r.focus,'blocked'); });
test('home presentation: mismatched flow does not participate in combined judgment', () => { for(const k of ['actualContract','tradeDate','session']){const x=input();x.flow.identity[k]='OTHER';const r=derive(x);assert.equal(r.mismatch,true);assert.equal(r.flowCurrent,false);assert.match(r.message,/不進行合併/);} });
test('home presentation: stale watch cannot restore a prior focus', () => { const x=input();x.watch.sourceAvailableAt=new Date(now-120001).toISOString();assert.equal(derive(x).focus,'blocked');x.watch.sourceAvailableAt=recent;x.watch.identity.session='NIGHT';assert.equal(derive(x).focus,'blocked'); });
test('home presentation: historical/replay data never imply real-time', () => { const x=input();x.chart.mode='REPLAY';const r=derive(x);assert.equal(r.status,'歷史回放');assert.equal(r.chartCurrent,false);assert.equal(r.focus,'blocked'); });
test('home presentation: no successfully rendered chart means no displayed price', () => { const x=input();x.rendered=false;const r=derive(x);assert.equal(r.hasChart,false);assert.equal(r.price,'—');assert.equal(r.focus,'blocked'); });
test('home presentation: only evidenced process failure gets a process diagnosis', () => { const x=input();x.flow.sourceState='UNAVAILABLE';x.flow.windows=null;x.flow.unavailableReason='Failed to fetch';assert.doesNotMatch(derive(x).flowMessage,/程序未運行/);x.flow.unavailableReason='LIVE_PRODUCER_PROCESS_MISSING';assert.match(derive(x).flowMessage,/程序未運行/); });
test('home presentation: recovery clears transport state only when new input succeeds', () => { const x=input();x.chartError='NETWORK';assert.equal(derive(x).chartCurrent,false);x.chartError=null;assert.equal(derive(x).chartCurrent,true);x.watch.decisionFocus.state='MALFORMED';assert.equal(derive(x).focus,'blocked'); });
test('home implementation cannot initiate transport, model calls, auth or order routes', () => { assert.doesNotMatch(home,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\.checked\s*=\s*true|executionAuthorized\s*[:=]\s*true|orderRoutesEnabled\s*[:=]\s*true/); });
test('production integration registers home after retained source components and updates actual lifecycle', () => { const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),shell=fs.readFileSync(new URL('../public/trader-terminal-shell.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.match(shell,/global\.HomeWorkspace\?\.mount\(root\)/);assert.match(app,/state\.homeChartError = error\?\.message/);assert.match(app,/state\.homeDashboardError = null/);assert.match(app,/homeView\.chartCurrent/);assert.ok(html.indexOf('/home-workspace.js')<html.indexOf('/app.js')); });

// The new presentation files must load in the existing bounded reader; no new API route or write permission.
import {GUEST_ASSETS, GUEST_APIS, authorizeGuest} from '../src/cru21-guest-guard.mjs';
test('home assets use the existing read-only origin checks, not a wildcard or new API', () => {
 for(const asset of ['/home-workspace.js','/home-workspace.css']){
  assert.equal(GUEST_ASSETS.has(asset),true);assert.equal(GUEST_APIS.has(asset),false);
  const request={method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:18722','sec-fetch-site':'same-origin','sec-fetch-mode':'no-cors','sec-fetch-dest':asset.endsWith('.js')?'script':'style'}};
  const url=new URL(asset,'http://127.0.0.1:18722'),deadline={remaining:()=>1000};
  assert.equal(authorizeGuest(request,url,deadline),null);
  assert.equal(authorizeGuest({...request,method:'POST'},url,deadline),'GUEST_READ_ONLY');
  assert.equal(authorizeGuest({...request,headers:{...request.headers,origin:'https://example.invalid'}},url,deadline),'GUEST_ORIGIN_REJECTED');
  assert.equal(authorizeGuest(request,url,{remaining:()=>0}),'GUEST_EXPIRED');
 }
 for(const route of ['/home-private.js','/.env','/api/v1/ask-gpt/ask'])assert.equal(GUEST_ASSETS.has(route),false);
});


test('closed or unverified operating calendar cannot expose fresh cached data as LIVE',()=>{
 for(const state of ['MARKET_CLOSED','SESSION_CLOSED','UNAVAILABLE']){
  const x=input();x.marketOperating={state,marketShouldBeActive:false};
  const r=derive(x);assert.equal(r.chartCurrent,false);assert.equal(r.flowCurrent,false);assert.equal(r.focus,'blocked');
  assert.equal(r.hasChart,true);assert.equal(r.price,'1,000');
  if(state==='MARKET_CLOSED')assert.match(r.status,/休市/);
 }
});
