// Real server/session + normal managed launcher are prerequisites. This process
// only appends the original private frozen suffix and observes authenticated API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [data,sessionFile]=process.argv.slice(2);
if(![data,sessionFile].every(p=>p&&path.isAbsolute(p)))throw Error('PERF_OBSERVER_ARGUMENTS');
const read=p=>JSON.parse(fs.readFileSync(p)),exp=read(path.join(data,'experiment.json')),session=read(sessionFile);
if(session.head!==exp.head||!/^http:\/\/127\.0\.0\.1:\d+$/.test(session.url)||new URL(session.url).port==='8787')throw Error('PERF_SESSION_IDENTITY');
const full=fs.readFileSync(exp.frozenInput);
if(crypto.createHash('sha256').update(full).digest('hex')!==exp.frozenHash)throw Error('PERF_INPUT_CHANGED');
const offsets=[0];for(let i=0;i<full.length;i++)if(full[i]===10)offsets.push(i+1);
const log=path.join(data,'observations.ndjson'),emit=x=>fs.appendFileSync(log,JSON.stringify({at:Date.now(),...x})+'\n');
const request=(route,options={})=>fetch(session.url+route,{...options,signal:AbortSignal.timeout(10000)});
if((await request('/api/v1/cvd-overview')).status!==401)throw Error('PERF_AUTH_BYPASS');
const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:session.url},body:JSON.stringify({password:session.password})});if(login.status!==200)throw Error('PERF_REAL_LOGIN');
const headers={Cookie:login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
let ordinal=exp.initialOrdinal,warmAt=null,finishedAppend=false,lastCutoff=0,apiErrors=0;const appended=[],seen=[];
const start=Date.now();emit({kind:'start',head:exp.head,mode:exp.mode,experiment:exp,realLogin:true,unauthenticatedStatus:401});
try{
  while(Date.now()-start<exp.warmupDeadlineMs+exp.durationMs+exp.drainMs){
    const now=Date.now(),elapsed=warmAt===null?null:now-warmAt;
    if(exp.mode==='steady'&&warmAt!==null&&elapsed<=exp.durationMs){
      const normalSeconds=Math.min(Math.floor(elapsed/1000),exp.durationMs/1000);
      const burstSeconds=Math.max(0,Math.min(normalSeconds-exp.burstStartMs/1000,exp.burstDurationMs/1000));
      const wanted=Math.min(offsets.length-1,exp.initialOrdinal+normalSeconds*exp.normalRate+burstSeconds*(exp.burstRate-exp.normalRate));
      if(wanted>ordinal){const before=performance.now();fs.appendFileSync(exp.sourcePath,full.subarray(offsets[ordinal],offsets[wanted]));const at=Date.now();const item={kind:'append',fromOrdinal:ordinal+1,ordinal:wanted,bytes:offsets[wanted],appendAt:at,writeMs:performance.now()-before,elapsedMs:elapsed};appended.push(item);emit(item);ordinal=wanted;}
    }
    if(exp.mode==='steady'&&elapsed>=exp.durationMs&&!finishedAppend){finishedAppend=true;emit({kind:'append-complete',elapsedMs:elapsed,ordinal});}
    for(const view of ['night','day']){
      try{const response=await request('/api/v1/cvd-overview?view='+view+'&timeframe=1m',{headers}),body=await response.json();
        if(response.status!==200){emit({kind:'api-unavailable',view,status:response.status,reason:body.reason});continue;}
        const cut=body.chart?.cutoff?.ledgerOrdinal??0;
        if(body.head!==exp.head||body.rawReadsPerRequest!==0||body.integrity?.originalRawPrefixVerified!==true)throw Error('PERF_API_TRUTH');
        const sample={kind:'api',view,ordinal:cut,artifactHash:body.artifactHash,cvd:body.chart.currentCvd,cutoff:body.chart.cutoff,integrity:body.integrity};emit(sample);
        if(cut>lastCutoff){lastCutoff=cut;seen.push({at:Date.now(),ordinal:cut});}
        if(warmAt===null&&cut===exp.initialOrdinal){warmAt=Date.now();emit({kind:'warm',warmAt,initialColdApiMs:warmAt-start,ordinal:cut});}
      }catch(e){apiErrors++;emit({kind:'api-error',view,error:e.message});}
    }
    if(exp.mode==='cold'&&warmAt!==null)break;
    if(exp.mode==='steady'&&warmAt!==null&&Date.now()-warmAt>=exp.durationMs+exp.drainMs)break;
    if(warmAt===null&&Date.now()-start>exp.warmupDeadlineMs)break;
    await new Promise(r=>setTimeout(r,500));
  }
}finally{
  const samples=appended.map(a=>{const s=seen.find(s=>s.ordinal>=a.ordinal&&s.at>=a.appendAt);return {ordinal:a.ordinal,events:a.ordinal-a.fromOrdinal+1,appendAt:a.appendAt,apiAt:s?.at??null,latencyMs:s?s.at-a.appendAt:null};});
  const lat=samples.filter(s=>s.latencyMs!==null).map(s=>s.latencyMs).sort((a,b)=>a-b),q=p=>lat[Math.ceil(lat.length*p)-1]??null;
  const summary={head:exp.head,mode:exp.mode,durationMs:Date.now()-start,warmAt,samples:samples.length,appendedEvents:ordinal-exp.initialOrdinal,unpublished:samples.filter(s=>s.apiAt===null).length,over5s:samples.filter(s=>s.latencyMs===null||s.latencyMs>5000).length,over10s:samples.filter(s=>s.latencyMs===null||s.latencyMs>10000).length,successfulOnlyLatency:{p95:q(.95),p99:q(.99),max:lat.at(-1)??null},allSampleQuantilesDefined:samples.every(s=>s.apiAt!==null),apiErrors,latestCutoff:lastCutoff,finalAppendedOrdinal:ordinal,engineeringTargetPass:false,naturalLiveAcceptance:false,fullDayAcceptance:false};
  fs.writeFileSync(path.join(data,'latency-samples.json'),JSON.stringify(samples));fs.writeFileSync(path.join(data,'performance-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
