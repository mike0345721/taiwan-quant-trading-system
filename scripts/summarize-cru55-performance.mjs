// Offline evidence summary. Never rewrites measurements or drops censored data.
import fs from 'node:fs';
import path from 'node:path';
const [data,out]=process.argv.slice(2);
if(![data,out].every(p=>p&&path.isAbsolute(p)))throw Error('PERF_SUMMARY_ARGUMENTS');
const lines=file=>fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const observations=lines(path.join(data,'observations.ndjson'));
const exp=JSON.parse(fs.readFileSync(path.join(data,'experiment.json')));
const append=observations.filter(x=>x.kind==='append'),api=observations.filter(x=>x.kind==='api');
const warm=observations.find(x=>x.kind==='warm')?.warmAt??null,endAt=observations.at(-1)?.at??null;
const advancing=[];let maxOrdinal=0;
for(const s of api)if(s.ordinal>maxOrdinal){maxOrdinal=s.ordinal;advancing.push(s);}
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
const distribution=a=>({count:a.length,p50:percentile(a,.5),p95:percentile(a,.95),p99:percentile(a,.99),max:a.length?Math.max(...a):null});
const latency=append.map(a=>{const s=advancing.find(s=>s.ordinal>=a.ordinal&&s.at>=a.appendAt);return {fromOrdinal:a.fromOrdinal,ordinal:a.ordinal,events:a.ordinal-a.fromOrdinal+1,appendAt:a.appendAt,apiAt:s?.at??null,latencyMs:s?s.at-a.appendAt:null,censoredForMs:s?null:endAt-a.appendAt};});
const lastAppendAt=t=>append.findLast(x=>x.appendAt<=t)?.ordinal??exp.initialOrdinal;
const lastApiAt=t=>advancing.findLast(x=>x.at<=t)?.ordinal??0;
const backlog=t=>Math.max(0,lastAppendAt(t)-lastApiAt(t));
const burstStart=warm===null?null:warm+exp.burstStartMs,burstEnd=burstStart===null?null:burstStart+exp.burstDurationMs;
const preBurst=burstStart!==null&&endAt>=burstStart?backlog(burstStart-1):null;
const recovered=preBurst!==null?advancing.find(x=>x.at>=burstEnd&&backlog(x.at)<=preBurst):null;
const gaps=advancing.slice(1).map((x,i)=>({startAt:advancing[i].at,endAt:x.at,ms:x.at-advancing[i].at,from:advancing[i].ordinal,to:x.ordinal}));
const terminal=advancing.at(-1);if(terminal&&backlog(endAt)>0)gaps.push({startAt:terminal.at,endAt,ms:endAt-terminal.at,from:terminal.ordinal,to:null,open:true});
const unavailable={};for(const x of observations.filter(x=>x.kind==='api-unavailable')){const k=x.status+':'+x.reason;unavailable[k]=(unavailable[k]??0)+1;}
const sampleStats=s=>({total:s.length,unpublished:s.filter(x=>x.latencyMs===null).length,over5sOrUnpublished:s.filter(x=>x.latencyMs===null||x.latencyMs>5000).length,over10sOrUnpublished:s.filter(x=>x.latencyMs===null||x.latencyMs>10000).length,successfulOnlyMs:distribution(s.filter(x=>x.latencyMs!==null).map(x=>x.latencyMs)),allQuantilesDefined:s.every(x=>x.latencyMs!==null)});
let browser=null;
const browserFile=path.join(data,'browser-observations.ndjson');
if(fs.existsSync(browserFile)){
  const dom=lines(browserFile),artifactOrdinal=new Map(api.map(x=>[x.artifactHash,x.ordinal]));
  const samples=append.map(a=>{const s=dom.find(s=>s.at>=a.appendAt&&(artifactOrdinal.get(s.artifact)??0)>=a.ordinal);return {ordinal:a.ordinal,latencyMs:s?s.at-a.appendAt:null};});
  browser={firstAt:dom[0]?.at,lastAt:dom.at(-1)?.at,observations:dom.length,maxObservationGapMs:Math.max(0,...dom.slice(1).map((s,i)=>s.at-dom[i].at)),...sampleStats(samples),measurement:'first DOM observation of an API-known artifact covering each append; gaps are conservative latency upper bounds; missing coverage is NOT a pass'};
}
let resources=null;
const resourceFile=path.join(data,'resources.ndjson');
if(fs.existsSync(resourceFile)){
  const r=lines(resourceFile),byPid={};
  for(const s of r)for(const p of (Array.isArray(s.processes)?s.processes:s.processes?[s.processes]:[]))(byPid[p.ProcessId]??=[]).push({at:s.at,...p});
  resources={hostCpuPercent:distribution(r.map(x=>Number(x.hostCpuPercent))),processes:Object.entries(byPid).map(([pid,s])=>{const a=s[0],b=s.at(-1);return {pid,firstAt:a.at,lastAt:b.at,samples:s.length,cpuMs:(Number(b.UserModeTime)+Number(b.KernelModeTime)-Number(a.UserModeTime)-Number(a.KernelModeTime))/10000,readTransferBytes:Number(b.ReadTransferCount)-Number(a.ReadTransferCount),writeTransferBytes:Number(b.WriteTransferCount)-Number(a.WriteTransferCount),peakWorkingSetBytes:Math.max(...s.map(x=>Number(x.WorkingSetSize)))};}),scope:'sampled process counters including cached I/O; not physical disk throughput; PID reuse must be ruled out by owner receipts'};
}
const result={head:exp.head,mode:exp.mode,firstAt:observations[0]?.at,endAt,warmAt:warm,elapsedAfterWarmMs:warm===null?null:endAt-warm,appendedEvents:append.reduce((n,x)=>n+x.ordinal-x.fromOrdinal+1,0),finalAppendedOrdinal:append.at(-1)?.ordinal??exp.initialOrdinal,latestApiOrdinal:maxOrdinal,latency:sampleStats(latency),normalLatency:sampleStats(latency.filter(x=>burstStart===null||x.appendAt<burstStart||x.appendAt>=burstEnd)),burstLatency:sampleStats(latency.filter(x=>burstStart!==null&&x.appendAt>=burstStart&&x.appendAt<burstEnd)),arrivalJitterMs:distribution(append.filter(x=>Number.isFinite(x.plannedAt)).map(x=>x.appendAt-x.plannedAt)),appendBatchEvents:distribution(append.map(x=>x.ordinal-x.fromOrdinal+1)),persistWriteMs:distribution(append.map(x=>x.writeMs)),unavailable,apiErrors:observations.filter(x=>x.kind==='api-error').length,advancingPublicationsObserved:advancing.length,progressGapsMs:distribution(gaps.map(x=>x.ms)),gapsOver30s:gaps.filter(x=>x.ms>30000),burst:{startAt:burstStart,endAt:burstEnd,complete:endAt>=burstEnd,preBurstBacklogRecords:preBurst,recoveredAt:recovered?.at??null,recoveryMs:recovered?recovered.at-burstEnd:null,observedUntil:endAt},browser,resources,engineeringTargetPass:false,naturalLiveAcceptance:false};
fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});
fs.writeFileSync(out+'.samples.json',JSON.stringify(latency),{flag:'wx'});
console.log(JSON.stringify({out,head:result.head,elapsedAfterWarmMs:result.elapsedAfterWarmMs,latency:result.latency,burst:result.burst}));
