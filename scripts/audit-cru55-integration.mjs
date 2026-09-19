import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT,git} from '../src/cru55-preview-bundle.mjs';
const receipt=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),origin='http://127.0.0.1:3055';
assert.equal(receipt.head,git(['rev-parse','HEAD']));
const results=[];let cookie='',csrf='';
async function request(route,{method='GET',body,headers={},expected=200}={}){const start=Date.now(),res=await fetch(origin+route,{method,headers:{...(cookie?{cookie}:{}),...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const text=await res.text();let value;try{value=JSON.parse(text);}catch{value=text;}results.push({route,method,status:res.status,expected,ms:Date.now()-start});assert.equal(res.status,expected,route);return {res,value};}
await request('/api/preview',{expected:401});
const login=await request('/api/auth/login',{method:'POST',body:{password:receipt.bootstrapUrl.split('#')[1]},headers:{Origin:origin}});const set=login.res.headers.get('set-cookie');assert.match(set,/^cru55_main_session=/);assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);assert.ok(!set.includes('twchip_session='));cookie=set.split(';')[0];
const session=(await request('/api/session')).value;csrf=session.csrfToken;assert.ok(csrf);
const identity=(await request('/api/identity')).value;assert.equal(identity.head,receipt.head);assert.equal(identity.executionAuthorized,false);assert.equal(identity.orderRoutesEnabled,false);assert.equal(identity.formalWeight,0);
await request('/api/identity',{headers:{Origin:'https://example.invalid'},expected:403});
await request('/api/v1/refresh',{method:'POST',body:{},headers:{'X-CSRF-Token':csrf},expected:403});await request('/api/v2/daily-update',{method:'POST',body:{},headers:{'X-CSRF-Token':csrf},expected:403});
await request('/api/v1/decision-journal',{method:'POST',body:{},expected:403});
const endpoints={};for(const view of ['day','night','demo']){let endpoint;for(const frame of ['1m','5m','15m','30m','1h','4h']){const p=(await request(`/api/preview?view=${view}&timeframe=${frame}`)).value;if(frame==='1m')endpoint=p.chart.currentCvd;assert.equal(p.chart.currentCvd,endpoint);assert.equal(p.chart.cutoff.recordHash,p.context.sourceCutoff.recordHash);assert.deepEqual(p.scan[frame].current,p.relationship.current);assert.equal(p.executionAuthorized,false);}endpoints[view]=endpoint;}
await request('/api/preview?view=day&timeframe=invalid',{expected:400});
const lower=(await request('/api/lower')).value;assert.equal(lower.sourceMode,'FORMAL_READ_ONLY_SNAPSHOT');assert.equal(lower.globalContext.trueNqState,'UNAVAILABLE_SOURCE_GAP');assert.equal(lower.globalContext.latest.some(x=>x.symbol==='NQ'),false);
const dashboard=(await request('/api/v1/dashboard')).value;assert.equal(dashboard.ok,true);assert.ok(dashboard.decisionWorkspace);assert.equal(dashboard.data.dataMode,'live');
const routes=['/api/v1/data-operations','/api/v1/observed-flow','/api/v1/index-leadership','/api/v2/research?days=20','/api/v1/decision-journal?limit=20'];const details=[];
for(const route of routes){const v=(await request(route)).value;details.push({route,ok:v.ok,availability:v.data?.availability,status:v.data?.status,sourceDates:v.data?.globalContext?.latest?.map(x=>({symbol:x.symbol,tradeDate:x.tradeDate,availableAt:x.availableAt}))});}
await request('/api/v2/backtests',{expected:503});
await request('/api/auth/logout',{method:'POST',body:{},headers:{'X-CSRF-Token':csrf}}).then(({res})=>assert.match(res.headers.get('set-cookie'),/^cru55_main_session=;/));await request('/api/identity',{expected:401});
const report={head:identity.head,createdAt:new Date().toISOString(),results,endpoints,sourceDates:lower.sourceDates,globalDates:lower.globalContext.latest.map(x=>({symbol:x.symbol,tradeDate:x.tradeDate,availableAt:x.availableAt})),details,safety:{formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false},auth:'ISOLATED_COOKIE_AND_MAIN_CSRF_PASS',upstreamMutations:'BLOCKED',backtests:'UNAVAILABLE_WITH_REASON: formal report missing',result:'PASS'};
fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));console.log(JSON.stringify({head:report.head,checks:results.length,endpoints,result:'PASS'}));
