import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256,readJson,writeJson,inside} from './cru55-local-update.mjs';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
import {sourceDirectoryIdentity} from './cru55-runtime-binding.mjs';
import {digest,stableJson,SAFETY} from './cvd-observation-core.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const requireTrue=(value,code)=>{if(!value)throw Error(code);};
const command=(exe,args,cwd,options={})=>(execFileSync(exe,args,{cwd,encoding:'utf8',windowsHide:true,timeout:60000,...options})??'').trim();
const git=(root,args)=>command('git',args,root);
const uiHash=(root,files)=>{for(const f of files)requireTrue(sha256(fs.readFileSync(assertPlainPath(path.join(root,f.path))))===f.sha256,'UPDATE_UI_VERSION_CHANGED');};
const privateFile=(root,file)=>{const p=assertPlainPath(file);requireTrue(inside(root,p),'UPDATE_PRIVATE_PATH_ESCAPE');return p;};
export function assertRetainedConfig(r) { requireTrue(/^[a-f0-9]{64}$/.test(r.configHash||'')&&sha256(fs.readFileSync(assertPlainPath(r.configFile)))===r.configHash,'UPDATE_RELEASE_CONFIG_DRIFT'); }
async function http(url,pathname,options={}) { const response=await fetch(url+pathname,{...options,signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json(),headers:response.headers}; }
function osProcess(pid) {
  requireTrue(Number.isSafeInteger(pid)&&pid>0,'UPDATE_PID_INVALID');
  const code='$ErrorActionPreference="Stop"; $p=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$env:CRU55_PROBE_PID); if($p){[pscustomobject]@{pid=$p.ProcessId;startTime=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine}|ConvertTo-Json -Compress}else{"null"}';
  return JSON.parse(command('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],undefined,{env:{...process.env,CRU55_PROBE_PID:String(pid)}}));
}
function sameProcess(expected,actual) { return actual&&actual.pid===expected.pid&&actual.commandLine===expected.commandLine&&Math.abs(Date.parse(actual.startTime)-Date.parse(expected.startTime))<1; }
function listenerPids(port) {
  const code='$ErrorActionPreference="Stop"; @([System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()) | Out-Null; $rows=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $env:CRU55_PROBE_PORT | Select-Object -ExpandProperty OwningProcess -Unique); ConvertTo-Json -InputObject $rows -Compress';
  return JSON.parse(command('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],undefined,{env:{...process.env,CRU55_PROBE_PORT:String(port)}}));
}
// A matching live PID is identity evidence, never sufficient authority to stop it.
export function assertOwnedProcesses(r,{proof,session,owner,server,managed,listeners,node=process.execPath,allowAbsent=false}) {
  requireTrue(['root','head','runId','configFile','configHash','bindingHash','url','sessionFile'].every(k=>proof[k]===r[k])&&sameProcess(r.server,proof.server)&&sameProcess(r.managed,proof.managed),'UPDATE_LAUNCH_RECEIPT_MISMATCH');
  requireTrue(session.head===r.head&&session.bindingHash===r.bindingHash&&session.serverPid===r.server.pid&&session.url===r.url,'UPDATE_SESSION_OWNERSHIP');
  requireTrue(r.server.commandLine===`"${node}" server.mjs`&&r.managed.commandLine.includes(`"${path.join(r.root,'scripts/run-cru55-managed.mjs')}"`)&&r.managed.commandLine.includes(`"${r.configFile}"`)&&r.managed.commandLine.trim().endsWith('--candidate'),'UPDATE_PROCESS_NOT_CANDIDATE');
  requireTrue((server?sameProcess(r.server,server):allowAbsent)&&(managed?sameProcess(r.managed,managed):allowAbsent),'UPDATE_UNKNOWN_PID_REFUSED');
  if(managed)requireTrue(owner&&sameProcess(r.managed,owner)&&owner.runtimeCommit===r.head&&owner.bindingHash===r.bindingHash&&owner.configPath===r.configFile&&owner.outputRoot===path.join(r.root,'data/cru55-dynamic/managed',r.runId),'UPDATE_MANAGED_OWNERSHIP');
  requireTrue(server?listeners.length===1&&listeners[0]===r.server.pid:listeners.length===0,'UPDATE_LISTENER_OWNERSHIP');
}
function stopExact(expected) {
  const actual=osProcess(expected.pid);if(!actual)return;
  requireTrue(sameProcess(expected,actual),'UPDATE_UNKNOWN_PID_REFUSED');
  // The command does a fresh CIM equality check before Stop-Process, limiting PID reuse.
  const code='$ErrorActionPreference="Stop"; $e=$env:CRU55_PROCESS_JSON|ConvertFrom-Json; $p=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$e.pid); if(-not $p){exit 0}; if($p.CommandLine -cne $e.commandLine -or [Math]::Abs(($p.CreationDate.ToUniversalTime()-[DateTime]::Parse($e.startTime).ToUniversalTime()).TotalMilliseconds) -gt 1){throw "UPDATE_PID_CHANGED"}; Stop-Process -Id $e.pid -Force';
  command('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],undefined,{env:{...process.env,CRU55_PROCESS_JSON:JSON.stringify(expected)}});
}
export function createWindowsUpdateDriver(controllerRoot) {
  const driver={
    planHash:p=>sha256(stableJson(p)),
    async preflight(p,previous) {
      requireTrue(process.platform==='win32','UPDATE_WINDOWS_REQUIRED');
      requireTrue(fs.lstatSync(path.join(controllerRoot,'.git')).isFile(),'UPDATE_CONTROLLER_WORKTREE_REQUIRED');
      requireTrue(git(controllerRoot,['branch','--show-current'])==='codex/cru55-one-click-update-v1','UPDATE_CONTROLLER_BRANCH');
      requireTrue(git(controllerRoot,['remote','get-url','origin'])==='https://github.com/mike0345721/taiwan-quant-trading-system.git','UPDATE_REPOSITORY');
      // Fetch cannot change the target: exact approved main and candidate ancestry are pinned.
      requireTrue(git(controllerRoot,['rev-parse','origin/main'])===p.approvedMainSha,'UPDATE_APPROVED_MAIN_DRIFT');
      requireTrue(git(controllerRoot,['rev-parse',p.targetSha+'^{commit}'])===p.targetSha,'UPDATE_TARGET_UNKNOWN');
      git(controllerRoot,['merge-base','--is-ancestor',p.approvedMainSha,p.targetSha]);
      git(controllerRoot,['merge-base','--is-ancestor',p.targetSha,'HEAD']);
      requireTrue(!git(controllerRoot,['status','--porcelain','--untracked-files=no']),'UPDATE_CONTROLLER_DIRTY');
      const manifest=readJson(path.join(p.seedRoot,'seed-manifest.json'));
      requireTrue(sha256(fs.readFileSync(path.join(p.seedRoot,'seed-manifest.json')))===p.seedManifestHash,'UPDATE_SEED_MANIFEST_DRIFT');
      requireTrue(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=32,'UPDATE_SEED_FILES');
      let total=0;for(const f of manifest.files){requireTrue(/^(source\/(provenance\.json|\d{4}-\d{2}-\d{2}\.ndjson)|app\/(latest\.json|history\/\d{4}-\d{2}-\d{2}\.json|input-manifest\.json))$/.test(f.path),'UPDATE_SEED_ALLOWLIST');const file=privateFile(p.seedRoot,path.join(p.seedRoot,f.path)),st=fs.lstatSync(file);requireTrue(st.isFile()&&st.nlink===1&&st.size<=8*1024*1024,'UPDATE_SMALL_ISOLATED_SEED_ONLY');total+=st.size;requireTrue(total<=16*1024*1024,'UPDATE_NO_LARGE_DATA_COPY');requireTrue(sha256(fs.readFileSync(file))===f.sha256,'UPDATE_SEED_BYTES_CHANGED');}
      if(previous){
        driver.checkRelease(p,previous);uiHash(previous.root,previous.uiFiles);
        requireTrue(previous.url===`http://127.0.0.1:${p.port}`,'UPDATE_PORT_CHANGED');
        driver.checkOwnership(p,previous);
        const h=await http(previous.url,'/healthz');requireTrue(h.body.runtimeCommit===previous.head&&h.body.cru55Acceptance?.bindingHash===previous.bindingHash,'UPDATE_RUNNING_VERSION_DRIFT');
      }else{
        // A missing route never authorizes stopping any listener.
        const net=await import('node:net');await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error('UPDATE_UNKNOWN_LISTENER')));s.listen(p.port,'127.0.0.1',()=>s.close(resolve));});
      }
    },
    checkRelease(p,r) {
      requireTrue(inside(path.join(p.base,'releases'),assertPlainPath(r.root)),'UPDATE_RELEASE_OUTSIDE_ISOLATION');
      requireTrue(git(r.root,['rev-parse','HEAD'])===r.head&&!git(r.root,['status','--porcelain','--untracked-files=no']),'UPDATE_RELEASE_VERSION_DRIFT');
      requireTrue(/^candidate-update-[a-f0-9]{12}$/.test(r.runId),'UPDATE_RELEASE_RUN_ID');
      requireTrue(r.configFile===path.join(r.root,'data/cru55-dynamic/update-config.json'),'UPDATE_RELEASE_CONFIG');
      assertRetainedConfig(r);
    },
    checkOwnership(p,r,{allowAbsent=false}={}) {
      requireTrue(r.url===`http://127.0.0.1:${p.port}`,'UPDATE_PORT_CHANGED');
      const app=path.join(r.root,'data/cru55-dynamic/acceptance',r.runId);
      requireTrue(path.dirname(r.sessionFile)===app&&/^session-\d+\.json$/.test(path.basename(r.sessionFile)),'UPDATE_SESSION_PATH');
      const ownerPath=path.join(r.root,'data/cru55-dynamic/managed',r.runId,'managed-owner.lock/owner.json');
      assertOwnedProcesses(r,{proof:readJson(path.join(r.root,'data/cru55-dynamic/update-processes.json')),session:readJson(r.sessionFile),owner:fs.existsSync(ownerPath)?readJson(ownerPath):null,server:osProcess(r.server.pid),managed:osProcess(r.managed.pid),listeners:listenerPids(p.port),allowAbsent});
    },
    async preserve(p,previous,id) {
      const dir=privateFile(p.stateRoot,path.join(p.stateRoot,'preserved-'+id));fs.mkdirSync(dir);
      writeJson(path.join(dir,'route.json'),previous);
      if(previous){const bytes=fs.readFileSync(assertPlainPath(previous.configFile));fs.writeFileSync(path.join(dir,'candidate-config.json'),bytes,{flag:'wx'});writeJson(path.join(dir,'version.json'),{head:previous.head,root:previous.root,tree:git(previous.root,['rev-parse','HEAD^{tree}']),configHash:sha256(bytes),retention:'WHOLE_OLD_WORKTREE_RETAINED; raw/SQLite/credentials not copied'});}
    },
    async prepare(p,id) {
      const token=id.replaceAll('-','').slice(0,12),root=privateFile(p.base,path.join(p.base,'releases',token)),runId='candidate-update-'+token;
      requireTrue(!fs.existsSync(root),'UPDATE_RELEASE_CONFLICT');fs.mkdirSync(path.dirname(root),{recursive:true});
      git(controllerRoot,['worktree','add','-b','codex/cru55-update-'+token,root,p.targetSha]);
      uiHash(root,p.uiFiles);
      const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');requireTrue(fs.existsSync(npm),'UPDATE_NPM_RUNTIME_MISSING');
      const log=fs.openSync(path.join(p.stateRoot,'dependencies-'+id+'.log'),'wx');
      try {command(process.execPath,[npm,'ci','--no-audit','--no-fund'],root,{timeout:180000,stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
      command(process.execPath,['--input-type=module','-e',"import koffi from 'koffi'; const k=koffi.load('kernel32.dll'); console.log(k.func('uint32_t GetCurrentProcessId()')());"],root);
      const sourceRoot=path.join(root,'data/cru55-dynamic/real-inputs',runId),appRoot=path.join(root,'data/cru55-dynamic/acceptance',runId);
      const manifest=readJson(path.join(p.seedRoot,'seed-manifest.json'));
      for(const f of manifest.files){const to=privateFile(root,path.join(f.path.startsWith('source/')?sourceRoot:appRoot,f.path.slice(f.path.indexOf('/')+1)));fs.mkdirSync(path.dirname(to),{recursive:true});const bytes=fs.readFileSync(privateFile(p.seedRoot,path.join(p.seedRoot,f.path)));requireTrue(sha256(bytes)===f.sha256,'UPDATE_SEED_CHANGED_DURING_PREPARE');fs.writeFileSync(to,bytes,{flag:'wx'});}
      const provenance=readJson(path.join(sourceRoot,'provenance.json'));
      const config={schemaVersion:'cru55-managed-candidate-v1',runtimeCommit:p.targetSha,runId,sourceKind:'GOVERNED_FRAGMENT',producer:'STREAM_PAGED_V2',sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',provenanceHash:digest(stableJson(provenance)),sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:provenance.sources.map(s=>s.name.slice(0,10)).sort()[0]},sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},...SAFETY};
      const configFile=path.join(root,'data/cru55-dynamic/update-config.json');writeJson(configFile,config);
      return {root,head:p.targetSha,runId,configFile,configHash:sha256(fs.readFileSync(configFile)),bindingHash:digest(stableJson(config)),expected:p.expected,uiFiles:p.uiFiles,planHash:driver.planHash(p),url:`http://127.0.0.1:${p.port}`};
    },
    async start(p,r) {
      driver.checkRelease(p,r);
      const output=command(process.execPath,[path.join(r.root,'scripts/start-cru55-acceptance.mjs'),r.configFile,String(p.port)],r.root,{timeout:90000});
      const summary=JSON.parse(output.split('\n').at(-1));
      const credentials=readJson(privateFile(r.root,summary.receiptPath));
      const owner=readJson(path.join(r.root,'data/cru55-dynamic/managed',r.runId,'managed-owner.lock/owner.json'));
      const server=osProcess(credentials.serverPid),managed=osProcess(owner.pid);
      requireTrue(server?.commandLine===`"${process.execPath}" server.mjs`&&sameProcess(owner,managed),'UPDATE_NEW_PROCESS_IDENTITY');
      requireTrue(credentials.bindingHash===r.bindingHash,'UPDATE_NEW_BINDING_DRIFT');
      const route={...r,server,managed,sessionFile:summary.receiptPath};
      assertOwnedProcesses(route,{proof:route,session:credentials,owner,server,managed,listeners:listenerPids(p.port)});
      writeJson(path.join(r.root,'data/cru55-dynamic/update-processes.json'),route);return route;
    },
    async stop(p,r) {
      driver.checkRelease(p,r);driver.checkOwnership(p,r,{allowAbsent:true});
      stopExact(r.server);stopExact(r.managed);
    },
    async cleanupAttempt(p,r,started) {
      if(started){await driver.stop(p,started);return;}
      // A launcher failure may leave a manager. Only its exact config/HEAD and
      // known candidate command can establish ownership; never kill by port.
      const ownerPath=path.join(r.root,'data/cru55-dynamic/managed',r.runId,'managed-owner.lock/owner.json');
      if(fs.existsSync(ownerPath)){const owner=readJson(ownerPath);requireTrue(owner.configPath===r.configFile&&owner.runtimeCommit===r.head&&owner.bindingHash===r.bindingHash&&owner.outputRoot===path.join(r.root,'data/cru55-dynamic/managed',r.runId)&&owner.commandLine.includes(`"${path.join(r.root,'scripts/run-cru55-managed.mjs')}"`)&&owner.commandLine.includes(`"${r.configFile}"`)&&owner.commandLine.trim().endsWith('--candidate'),'UPDATE_UNKNOWN_PARTIAL_OWNER');stopExact(owner);}
      // A session receipt lacks exact server birth identity. Never infer ownership
      // from a generic command or a nearby timestamp after an incomplete start.
      const app=path.join(r.root,'data/cru55-dynamic/acceptance',r.runId);
      const sessions=fs.readdirSync(app).filter(n=>/^session-\d+\.json$/.test(n)).sort();
      for(const name of sessions){const s=readJson(path.join(app,name));if(osProcess(s.serverPid))throw Error('UPDATE_PARTIAL_SERVER_REQUIRES_REVIEW');}
    },
    async verify(p,r) {
      driver.checkRelease(p,r);driver.checkOwnership(p,r);uiHash(r.root,p.uiFiles);
      const session=readJson(privateFile(r.root,r.sessionFile));
      const h=await http(r.url,'/healthz');requireTrue(h.body.runtimeCommit===r.head&&h.body.cru55Acceptance?.bindingHash===r.bindingHash,'UPDATE_HEALTH_IDENTITY');
      requireTrue((await http(r.url,'/api/v1/cvd-overview')).status===401,'UPDATE_AUTH_REQUIRED');
      const auth=await http(r.url,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:session.password})});
      requireTrue(auth.status===200,'UPDATE_REAL_LOGIN');const cookie=auth.headers.get('set-cookie');requireTrue(cookie?.includes('HttpOnly')&&cookie.includes('SameSite=Strict'),'UPDATE_SESSION_FLAGS');
      const headers={Cookie:cookie.split(';')[0]};let body,status;
      try {
        const lower=await http(r.url,'/api/lower',{headers}),seed=readJson(path.join(r.root,'data/cru55-dynamic/acceptance',r.runId,'latest.json'));
        requireTrue(lower.status===200&&['asOfDate','generatedAt','marketOverview','futuresMarket','futuresInstitutional','marketBreadth','spotInstitutional','options'].every(k=>stableJson(lower.body[k]??null)===stableJson(seed[k]??null)),'UPDATE_LEGACY_API_PARITY');
        const deadline=Date.now()+p.timeoutSeconds*1000;
        do {const result=await http(r.url,`/api/v1/cvd-overview?view=${p.expected.view}&timeframe=1m`,{headers});body=result.body;status=result.status;if(status===200&&body.chart?.cutoff?.ledgerOrdinal===p.expected.ordinal)break;await pause(1000);}while(Date.now()<deadline);
        requireTrue(publicationMatches(status,body,r.head,p.expected),'UPDATE_PUBLICATION_NOT_VERIFIED');
        const frames=[];for(const timeframe of ['1m','5m','15m','30m','1h','4h']){const f=await http(r.url,`/api/v1/cvd-overview?view=${p.expected.view}&timeframe=${timeframe}`,{headers});requireTrue(publicationMatches(f.status,f.body,r.head,p.expected)&&f.body.artifactHash===body.artifactHash&&f.headers.get('cache-control')==='no-store','UPDATE_SIX_WINDOW_IDENTITY');frames.push(timeframe);}
        return {auth:'REAL_SCRYPT_SESSION',dataReception:'ISOLATED_GOVERNED_FRAGMENT',publication:{artifactHash:body.artifactHash,cutoff:body.chart.cutoff,cvd:body.chart.currentCvd,integrity:body.integrity},api:frames,ui:'ACCEPTED_BLOBS_IDENTICAL',naturalLive:'NOT_TESTED',fullDayCapacity:'NOT_PROVEN'};
      } finally {await http(r.url,'/api/auth/logout',{method:'POST',headers:{...headers,'X-CSRF-Token':auth.body.csrfToken}});}
    }
  };return driver;
}
export function publicationMatches(status,body,head,expected) {
  return status===200&&body?.head===head&&body.chart?.cutoff?.ledgerOrdinal===expected.ordinal&&body.chart.cutoff.recordHash===expected.recordHash&&body.chart.currentCvd===expected.cvd&&body.integrity?.originalRawPrefixVerified===true;
}
