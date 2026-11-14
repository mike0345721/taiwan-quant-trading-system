import assert from 'node:assert/strict';
import { createDynamicReader } from '../src/cru55-dynamic-reader.mjs';
const [origin,root]=process.argv.slice(2),url=new URL(origin);
if(url.hostname!=='127.0.0.1'||url.port!=='3065'||url.protocol!=='http:')throw Error('ISOLATED_3065_REQUIRED');
if(!process.env.CRU55_ACCEPT_PASSWORD)throw Error('LOCAL_TEST_PASSWORD_REQUIRED');
const request=(route,options={})=>fetch(new URL(route,origin),{...options,signal:AbortSignal.timeout(10000)});
assert.equal((await request('/api/v1/cvd-overview')).status,401);
const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({password:process.env.CRU55_ACCEPT_PASSWORD})});
assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),headers={Cookie:cookie};
const reader=createDynamicReader(root),results=[];
for(const view of ['day','night'])for(const timeframe of ['1m','5m','15m','30m','1h','4h']){
  const response=await request(`/api/v1/cvd-overview?view=${view}&timeframe=${timeframe}`,{headers});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const actual=await response.json(),expected=reader({view,timeframe});
  for(const key of ['artifactHash','kind','rawReadsPerRequest','executionAuthorized','orderRoutesEnabled'])assert.deepEqual(actual[key],expected[key]);
  assert.deepEqual(actual.chart.cutoff,expected.chart.cutoff);assert.equal(actual.chart.currentCvd,expected.chart.currentCvd);
  assert.deepEqual(actual.relationship,expected.relationship);assert.deepEqual(actual.handoff,expected.handoff);
  const encoded=JSON.stringify(actual);assert.ok(!encoded.includes('sourceBinding')&&!encoded.includes('checkpoint')&&!encoded.includes('D:\\'));
  assert.equal(actual.context.cumulativeCvd,expected.context.cumulativeCvd);assert.deepEqual(actual.context.evidence,expected.context.evidence);
  results.push({view,timeframe,artifactHash:actual.artifactHash,cutoff:actual.chart.cutoff,cvd:actual.chart.currentCvd,delta:actual.relationship.current.current?.deltaCvd??null,scope:actual.context.scope,windowState:actual.relationship.current.current?.status,handoff:actual.handoff.handoff,rawReadsPerRequest:actual.rawReadsPerRequest});
}
assert.equal((await request('/api/v1/cvd-overview?view=day&view=night',{headers})).status,400);
assert.equal((await request('/api/v1/cvd-overview?timeframe=bad',{headers})).status,400);
console.log(JSON.stringify({state:'PASS',checks:'401 unauthenticated; 12 authenticated artifact/API parity pairs; invalid query 400; no-store; no private paths/checkpoints',results},null,2));
