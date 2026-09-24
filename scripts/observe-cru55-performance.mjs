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
// Private diagnostics are separate from the frozen latency denominator. These
// sequential file snapshots are not an atomic explanation of an HTTP response.
const diagnosticFile=path.join(data,'api-diagnostics.ndjson'),firstHttp200=new Map(),firstValid200=new Map();
let diagnosticErrors=0,diagnosticRoot=null,diagnosticConfigError=null;
function boundedJson(file,cap){
  const fd=fs.openSync(file,'r');
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>cap)throw Error('PERF_DIAGNOSTIC_FILE_BUDGET');
    const bytes=Buffer.alloc(cap+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
    if(length>cap)throw Error('PERF_DIAGNOSTIC_FILE_BUDGET');
    return {value:JSON.parse(bytes.subarray(0,length).toString('utf8')),mtimeMs:stat.mtimeMs};
  }finally{fs.closeSync(fd);}
}
try{
  const runId=path.basename(data),base=path.dirname(path.dirname(data));
  if(!/^candidate-perf-[a-z0-9-]+$/.test(runId)||path.resolve(exp.configPath)!==path.join(base,runId+'.json'))throw Error('PERF_DIAGNOSTIC_CONFIG_PATH');
  const {value:config}=boundedJson(exp.configPath,16384);
  if(config.schemaVersion!=='cru55-managed-candidate-v1'||config.runId!==runId||config.runtimeCommit!==exp.head)throw Error('PERF_DIAGNOSTIC_CONFIG_IDENTITY');
  diagnosticRoot=path.join(base,'managed',runId);
}catch(error){diagnosticConfigError=error.code??error.message;}
function snapshot(name,cap,select){
  const startedAt=Date.now();
  try{const {value,mtimeMs}=boundedJson(path.join(diagnosticRoot,name),cap);return {startedAt,endedAt:Date.now(),mtimeMs,state:'READ',...select(value)};}
  catch(error){return {startedAt,endedAt:Date.now(),state:'UNKNOWN',error:error.code??error.message};}
}
function unavailableContext(view){
  const startedAt=Date.now(),scope='NON_ATOMIC_POST_RESPONSE_SNAPSHOTS; may race publication; not proof of response cause';
  if(!diagnosticRoot)return {startedAt,endedAt:Date.now(),scope,configError:diagnosticConfigError};
  const managed=snapshot('stream-managed-status.json',65536,s=>({runtimeCommit:s.runtimeCommit??null,bindingHash:s.bindingHash??null,statusAt:s.at??null,producerState:s.state??null,phase:s.phase??null,reason:s.reason??null,missingViews:s.missingViews??null,session:s.session??null,cutoff:s.cutoff??null}));
  const selection=snapshot('stream-selection.json',128*1024,s=>({schemaVersion:s.schemaVersion??null,bindingHash:s.bindingHash??null,availableViews:Object.keys(s.views??{}),requestedViewPresent:Object.hasOwn(s.views??{},view),selected:s.views?.[view]?{session:s.views[view].session??null,artifactHash:s.views[view].artifactHash??null,cutoff:s.views[view].cutoff??null}:null}));
  return {startedAt,endedAt:Date.now(),scope,managed,selection};
}
function emitDiagnostic(value){
  try{fs.appendFileSync(diagnosticFile,JSON.stringify(value)+'\n');}
  catch(error){diagnosticErrors++;if(diagnosticErrors===1)console.error('PERF_DIAGNOSTIC_WRITE_FAILED',error.code??error.message);}
}
const request=(route,options={})=>fetch(session.url+route,{...options,signal:AbortSignal.timeout(10000)});
if((await request('/api/v1/cvd-overview')).status!==401)throw Error('PERF_AUTH_BYPASS');
const login=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:session.url},body:JSON.stringify({password:session.password})});if(login.status!==200)throw Error('PERF_REAL_LOGIN');
const headers={Cookie:login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
let ordinal=exp.initialOrdinal,warmAt=null,finishedAppend=false,lastCutoff=0,apiErrors=0,stop=false,writerError=null;const appended=[],seen=[];
const start=Date.now();emit({kind:'start',head:exp.head,mode:exp.mode,experiment:exp,realLogin:true,unauthenticatedStatus:401});
process.on('SIGINT',()=>{stop=true;});process.on('SIGTERM',()=>{stop=true;});
// Separate arrival timing from network polling. Preserve the exact original
// bytes/order; fsync completion is the experimental persistence clock.
const writer=setInterval(()=>{
  if(exp.mode!=='steady'||warmAt===null||stop||writerError)return;
  try{
    const elapsed=Date.now()-warmAt,seconds=Math.min(Math.floor(elapsed/1000),exp.durationMs/1000);
    const burstSeconds=Math.max(0,Math.min(seconds-exp.burstStartMs/1000,exp.burstDurationMs/1000));
    const wanted=Math.min(offsets.length-1,exp.initialOrdinal+seconds*exp.normalRate+burstSeconds*(exp.burstRate-exp.normalRate));
    if(wanted>ordinal){
      const before=performance.now(),fd=fs.openSync(exp.sourcePath,'a');
      try{fs.writeFileSync(fd,full.subarray(offsets[ordinal],offsets[wanted]));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const at=Date.now(),item={kind:'append',fromOrdinal:ordinal+1,ordinal:wanted,bytes:offsets[wanted],appendAt:at,writeMs:performance.now()-before,elapsedMs:elapsed,plannedAt:warmAt+seconds*1000};
      appended.push(item);emit(item);ordinal=wanted;
    }
    if(elapsed>=exp.durationMs&&!finishedAppend){finishedAppend=true;emit({kind:'append-complete',elapsedMs:elapsed,ordinal});}
  }catch(error){writerError=error.message;stop=true;emit({kind:'writer-error',error:writerError});}
},100);
try{
  while(!stop&&Date.now()-start<exp.warmupDeadlineMs+exp.durationMs+exp.drainMs){
    const now=Date.now(),elapsed=warmAt===null?null:now-warmAt;
    for(const view of ['night','day']){
      const key=view+'|1m',diagnostic={kind:'api-request',head:exp.head,view,timeframe:'1m',requestStartedAt:Date.now(),warmAtRequestStart:warmAt,firstValid200AtBefore:firstValid200.get(key)??null,status:null,reason:null,error:null};
      try{const response=await request('/api/v1/cvd-overview?view='+view+'&timeframe=1m',{headers});
        diagnostic.status=response.status;diagnostic.responseHeadersAt=Date.now();
        if(response.status===200&&!firstHttp200.has(key))firstHttp200.set(key,diagnostic.responseHeadersAt);
        const body=await response.json();diagnostic.requestEndedAt=Date.now();diagnostic.reason=body.reason??null;
        if(response.status!==200){emit({kind:'api-unavailable',view,status:response.status,reason:body.reason});continue;}
        const cut=body.chart?.cutoff?.ledgerOrdinal??0;
        if(body.head!==exp.head||body.view!==view||body.chart?.session?.toLowerCase()!==view||body.chart?.timeframe!=='1m'||body.rawReadsPerRequest!==0||body.integrity?.originalRawPrefixVerified!==true)throw Error('PERF_API_TRUTH');
        if(!firstValid200.has(key))firstValid200.set(key,diagnostic.requestEndedAt);
        diagnostic.valid200=true;diagnostic.ordinal=cut;diagnostic.artifactHash=body.artifactHash;
        const sample={kind:'api',view,ordinal:cut,artifactHash:body.artifactHash,cvd:body.chart.currentCvd,cutoff:body.chart.cutoff,integrity:body.integrity};emit(sample);
        if(cut>lastCutoff){lastCutoff=cut;seen.push({at:Date.now(),ordinal:cut});}
        if(warmAt===null&&cut===exp.initialOrdinal){warmAt=Date.now();emit({kind:'warm',warmAt,initialColdApiMs:warmAt-start,ordinal:cut});}
      }catch(e){diagnostic.error=e.message;apiErrors++;emit({kind:'api-error',view,error:e.message});}
      finally{
        diagnostic.requestEndedAt??=Date.now();diagnostic.warmAtRequestEnd=warmAt;
        diagnostic.firstHttp200At=firstHttp200.get(key)??null;diagnostic.firstValid200At=firstValid200.get(key)??null;
        if(diagnostic.status===503)diagnostic.unavailableContext=unavailableContext(view);
        diagnostic.diagnosticCompletedAt=Date.now();emitDiagnostic(diagnostic);
      }
    }
    if(exp.mode==='cold'&&warmAt!==null)break;
    if(exp.mode==='steady'&&warmAt!==null&&Date.now()-warmAt>=exp.durationMs+exp.drainMs)break;
    if(warmAt===null&&Date.now()-start>exp.warmupDeadlineMs)break;
    await new Promise(r=>setTimeout(r,500));
  }
}finally{
  clearInterval(writer);
  const samples=appended.map(a=>{const s=seen.find(s=>s.ordinal>=a.ordinal&&s.at>=a.appendAt);return {ordinal:a.ordinal,events:a.ordinal-a.fromOrdinal+1,appendAt:a.appendAt,apiAt:s?.at??null,latencyMs:s?s.at-a.appendAt:null};});
  const lat=samples.filter(s=>s.latencyMs!==null).map(s=>s.latencyMs).sort((a,b)=>a-b),q=p=>lat[Math.ceil(lat.length*p)-1]??null;
  const clockFile=path.join(data,'launch-clock.json'),launch=fs.existsSync(clockFile)?read(clockFile):null;
  const summary={head:exp.head,mode:exp.mode,durationMs:Date.now()-start,warmAt,processLaunchToApiMs:warmAt!==null&&launch?.head===exp.head?warmAt-launch.startedAt:null,stoppedEarly:stop,writerError,samples:samples.length,appendedEvents:ordinal-exp.initialOrdinal,unpublished:samples.filter(s=>s.apiAt===null).length,over5s:samples.filter(s=>s.latencyMs===null||s.latencyMs>5000).length,over10s:samples.filter(s=>s.latencyMs===null||s.latencyMs>10000).length,successfulOnlyLatency:{p95:q(.95),p99:q(.99),max:lat.at(-1)??null},allSampleQuantilesDefined:samples.every(s=>s.apiAt!==null),apiErrors,latestCutoff:lastCutoff,finalAppendedOrdinal:ordinal,engineeringTargetPass:false,naturalLiveAcceptance:false,fullDayAcceptance:false};
  summary.apiDiagnostics={file:'api-diagnostics.ndjson',writeErrors:diagnosticErrors,configError:diagnosticConfigError,scope:'ADDITIONAL_OBSERVER_IO; request times precede sidecar capture; not part of latency denominator'};
  fs.writeFileSync(path.join(data,'latency-samples.json'),JSON.stringify(samples));fs.writeFileSync(path.join(data,'performance-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
