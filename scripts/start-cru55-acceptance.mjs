import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {readManagedConfig} from '../src/cru55-managed-plan.mjs';
import {assertPlainPath} from '../src/cvd-observation-isolation.mjs';
import {hashPassword} from '../src/security.mjs';
import {attestRealInputs} from '../src/cru55-acceptance-inputs.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),file=path.resolve(process.argv[2]||''),port=Number(process.argv[3]||3056);
if(!Number.isInteger(port)||port<1024||port>65535||port===8787||port===8790)throw Error('CRU55_ACCEPTANCE_PORT');
const plan=readManagedConfig(file,{runtimeRoot:root,candidate:true});
attestRealInputs(plan);
if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8',windowsHide:true}).trim())throw Error('CRU55_ACCEPTANCE_CLEAN_HEAD');
const data=assertPlainPath(path.join(root,'data/cru55-dynamic/acceptance',plan.runId));
function checkTree(dir){assertPlainPath(dir);for(const name of fs.readdirSync(dir)){const target=assertPlainPath(path.join(dir,name)),st=fs.lstatSync(target);if(st.isDirectory())checkTree(target);else if(!st.isFile()||st.nlink!==1)throw Error('CRU55_ACCEPTANCE_LINK');}}
checkTree(data);
const manifest=JSON.parse(fs.readFileSync(path.join(data,'input-manifest.json')));
for(const entry of manifest.files){
  if(!entry.path||path.isAbsolute(entry.path)||entry.path.split(/[\\/]/).includes('..'))throw Error('CRU55_ACCEPTANCE_INPUT_PATH');
  const bytes=fs.readFileSync(assertPlainPath(path.join(data,entry.path)));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('CRU55_ACCEPTANCE_INPUT_HASH');
}
if(JSON.parse(fs.readFileSync(path.join(data,'latest.json'))).dataMode!=='live')throw Error('CRU55_ACCEPTANCE_REAL_CACHE');
// Fresh private credentials use the application's real scrypt/session backend.
// Only OS essentials are inherited; no .env, broker credentials or formal runtime.
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const password=crypto.randomBytes(32).toString('hex');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
Object.assign(env,{CRU55_ACCEPTANCE_CONFIG:file,CRU55_DYNAMIC_ROOT:plan.outputRoot,DASHBOARD_RUNTIME_COMMIT:plan.runtimeCommit,
  HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'production',MOCK_DATA:'false',TRUST_PROXY:'false',COOKIE_SECURE:'false',REFRESH_INTERVAL_SECONDS:'0',DASHBOARD_PASSWORD_HASH:hashPassword(password),
  TX_CHART_DATA_ROOT:data,TX_CHART_CACHE_ROOT:path.join(data,'dashboard-chart-cache'),CRU34_LIVE_DATA_ROOT:data,
  CRU34_LIVE_SNAPSHOT_PATH:path.join(data,'runtime/cru34-live/latest.json'),CRU34_LIVE_STATUS_PATH:path.join(data,'runtime/cru34-live/status.json'),
  V2_RESEARCH_DATABASE_PATH:path.join(data,'v2/data/research-v2.sqlite'),V2_BACKTEST_REPORT_PATH:path.join(data,'v2/reports/latest-backtest.json'),DATA_OPERATIONS_OUTPUT_ROOT:path.join(data,'quality/daily-data-operations')});
const stamp=Date.now(),stdout=fs.openSync(path.join(data,`server-${stamp}.stdout.log`),'wx'),stderr=fs.openSync(path.join(data,`server-${stamp}.stderr.log`),'wx');
// This invokes the same owner-aware managed launcher as normal daily-use startup.
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/start-cru55-managed.ps1'),'-ProjectRoot',root,'-BindingFile',file,'-Candidate'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:60000});
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore',stdout,stderr]});
fs.closeSync(stdout);fs.closeSync(stderr);
let failed=null;child.once('error',e=>{failed=e;});child.once('exit',code=>{failed=Error('CRU55_ACCEPTANCE_SERVER_EXIT:'+code);});
let ready=false;
for(let i=0;i<40&&!failed;i++){
  try{const h=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
    if(h.runtimeCommit===plan.runtimeCommit&&h.cru55Acceptance?.bindingHash===plan.bindingHash){ready=true;break;}
  }catch{}
  await new Promise(r=>setTimeout(r,250));
}
if(!ready){if(!failed)child.kill();throw failed??Error('CRU55_ACCEPTANCE_NOT_READY_MANAGED_OWNER_RETAINED');}
const receipt={schemaVersion:'cru55-complete-candidate-session-v1',head:plan.runtimeCommit,bindingHash:plan.bindingHash,serverPid:child.pid,url:`http://127.0.0.1:${port}`,password,startedAt:new Date().toISOString(),sourceKind:plan.sourceKind};
const receiptPath=path.join(data,`session-${stamp}.json`);fs.writeFileSync(receiptPath,JSON.stringify(receipt),{flag:'wx',mode:0o600});
console.log(JSON.stringify({head:plan.runtimeCommit,serverPid:child.pid,url:receipt.url,receiptPath}));
child.unref();
