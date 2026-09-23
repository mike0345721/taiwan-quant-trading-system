// Genuine local login; compare all public views with their immutable artifacts.
// Session credentials stay in memory and are never included in the receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const [data,sessionFile,out]=process.argv.slice(2);
assert([data,sessionFile,out].every(p=>p&&path.isAbsolute(p)));
const read=p=>JSON.parse(fs.readFileSync(p)),exp=read(path.join(data,'experiment.json')),session=read(sessionFile);
assert.equal(session.head,exp.head);assert.match(session.url,/^http:\/\/127\.0\.0\.1:\d+$/);assert.notEqual(new URL(session.url).port,'8787');
const request=(route,options={})=>fetch(session.url+route,{...options,signal:AbortSignal.timeout(10000)});
assert.equal((await request('/api/v1/cvd-overview')).status,401);
const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:session.url},body:JSON.stringify({password:session.password})});assert.equal(login.status,200);
const headers={Cookie:login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
const root=path.join(path.dirname(exp.configPath),'managed',path.basename(data)),frames=['1m','5m','15m','30m','1h','4h'],checks=[];
const canonical=x=>x===null||typeof x!=='object'?x:Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
for(const view of ['night','day'])for(const frame of frames){
  const response=await request('/api/v1/cvd-overview?view='+view+'&timeframe='+frame,{headers});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.head,exp.head);assert.equal(body.rawReadsPerRequest,0);assert.match(body.artifactHash,/^[a-f0-9]{64}$/);
  assert.equal(body.view,view);assert.equal(body.chart.session.toLowerCase(),view);assert.equal(body.chart.timeframe,frame);
  const selection=read(path.join(root,'stream-selection.json')),relative=selection.views[view].relativeRunPath;assert.match(relative,/^sources\/[a-f0-9]{64}$/);
  const artifact=read(path.join(root,relative,body.artifactHash+'.stream-view.json')),{artifactHash,...content}=artifact;
  assert.equal(artifactHash,body.artifactHash);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex'),artifactHash);
  const {freshness,...chart}=body.chart,{freshness:contextFreshness,...context}=body.context;
  assert.deepEqual(chart,artifact.view.charts[frame]);assert.deepEqual(body.relationship,artifact.view.relationships[frame]);assert.deepEqual(context,artifact.view.sessionContext);assert.deepEqual(body.handoff,artifact.view.handoffs[frame]);
  assert.deepEqual(body.integrity,artifact.integrity);assert.equal(body.integrity.originalRawPrefixVerified,true);
  assert.notEqual(freshness.state,'LIVE');assert.deepEqual(contextFreshness,freshness);
  for(const f of frames)assert.deepEqual(body.scan[f],{timeframe:f,windowMs:artifact.view.relationships[f].windowMs,current:artifact.view.relationships[f].current});
  for(const [k,v]of Object.entries({formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}))assert.equal(body[k],v);
  checks.push({view,frame,artifactHash,cutoff:chart.cutoff,cvd:chart.currentCvd,delta:body.relationship.current?.current?.deltaCvd??null,bars:chart.bars.length,vwap:chart.vwap.length,freshness:freshness.state,contextScope:context.scope,handoff:body.handoff.pairing,pass:true});
}
const result={head:exp.head,at:new Date().toISOString(),unauthenticatedStatus:401,realLogin:true,checks,pass:true,scope:'API_TO_IMMUTABLE_ARTIFACT_EXACT_PARITY_EXCLUDING_ONLY_DYNAMIC_FRESHNESS',naturalLiveAcceptance:false};
fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({out,head:exp.head,checks:checks.length,pass:true}));
