import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export function inside(root, child) { const r=path.relative(root,child); return r!=='' && r!=='..' && !r.startsWith('..'+path.sep) && !path.isAbsolute(r); }
export function readJson(file) { const p=assertPlainPath(file),s=fs.lstatSync(p); if(!s.isFile()||s.nlink!==1||s.size>1024*1024)throw Error('UPDATE_PRIVATE_FILE'); return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')); }
export function writeJson(file,value) { assertPlainPath(file); const temp=file+'.'+crypto.randomUUID()+'.tmp'; fs.writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx',mode:0o600}); fs.renameSync(temp,file); }
export function validateUpdatePlan(value,root) {
  root=assertPlainPath(root); const base=assertPlainPath(path.join(root,'data/cru55-update'));
  if(value.schemaVersion!=='cru55-local-update-v1'||value.mode!=='ISOLATED_CANDIDATE')throw Error('UPDATE_FORMAL_ACTIVATION_NOT_IMPLEMENTED');
  if(!/^[a-f0-9]{40}$/.test(value.targetSha||'')||!/^[a-f0-9]{40}$/.test(value.approvedMainSha||'')||!/^https:\/\/github\.com\/mike0345721\/taiwan-quant-trading-system\/(pull|issues)\/\d+#issuecomment-\d+$/.test(value.decisionUrl||''))throw Error('UPDATE_EXACT_DECISION_REQUIRED');
  if(!/^[a-z0-9][a-z0-9-]{0,30}$/.test(value.lane||'')||!Number.isInteger(value.port)||value.port<3000||value.port>3999)throw Error('UPDATE_ISOLATED_LANE');
  if(!Number.isInteger(value.timeoutSeconds)||value.timeoutSeconds<15||value.timeoutSeconds>1800)throw Error('UPDATE_DEADLINE');
  const seedRoot=assertPlainPath(value.seedRoot||''); if(!inside(path.join(base,'inputs'),seedRoot))throw Error('UPDATE_SEED_OUTSIDE_PRIVATE_ROOT');
  if(!/^[a-f0-9]{64}$/.test(value.seedManifestHash||''))throw Error('UPDATE_SEED_DIGEST');
  const expected=value.expected;
  if(!expected||!['day','night'].includes(expected.view)||!Number.isSafeInteger(expected.ordinal)||expected.ordinal<1||!/^[a-f0-9]{64}$/.test(expected.recordHash||'')||!(expected.cvd===null||Number.isFinite(expected.cvd)))throw Error('UPDATE_EXPECTED_PUBLICATION');
  if(!Array.isArray(value.uiFiles)||value.uiFiles.length<1||value.uiFiles.length>12||value.uiFiles.some(f=>!/^public\/[a-zA-Z0-9_.-]+$/.test(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('UPDATE_UI_ACCEPTED_HASHES');
  return {...value,root,base,seedRoot,stateRoot:assertPlainPath(path.join(base,'lanes',value.lane))};
}

// Small transaction wrapper; OS/Git/runtime operations are fixed in the Windows adapter.
// No daily-use changes, arbitrary hooks, destructive checkout, or production target option.
export async function runLocalUpdate(plan,{driver,confirm,onStage=()=>{}}) {
  if(confirm!==plan.targetSha)throw Error('UPDATE_CONFIRM_EXACT_SHA');
  fs.mkdirSync(assertPlainPath(plan.stateRoot),{recursive:true});
  const lock=assertPlainPath(path.join(plan.stateRoot,'update.lock'));
  try { fs.mkdirSync(lock); } catch(e) { if(e.code==='EEXIST')throw Error('UPDATE_ALREADY_RUNNING_OR_RECOVERY_REQUIRED'); throw e; }
  const transaction=crypto.randomUUID(),journal=path.join(plan.stateRoot,'transaction-'+transaction+'.json');
  const routeFile=path.join(plan.stateRoot,'active.json'),previous=fs.existsSync(routeFile)?readJson(routeFile):null;
  const originalRoute=fs.existsSync(routeFile)?sha256(fs.readFileSync(routeFile)):null;
  const record={schemaVersion:'cru55-update-receipt-v1',transaction,targetSha:plan.targetSha,mode:plan.mode,decisionUrl:plan.decisionUrl,startedAt:new Date().toISOString(),stages:[],previous,formalDeployment:false,productReady:false};
  const stage=(name,result,detail={},recovering=false)=>{record.stages.push({name,result,at:new Date().toISOString(),...detail});try{writeJson(journal,record);}catch(error){if(!recovering)throw error;retainLock=true;(record.journalErrors??=[]).push(error.message);}try{onStage(record.stages.at(-1));}catch{record.displayWarning=true;}};
  let prepared=null,started=null,oldStopped=false,retainLock=false,routeCommitted=false;
  try {
    fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,transaction,journal}),{flag:'wx'});
    const unresolved=fs.readdirSync(plan.stateRoot).filter(n=>/^transaction-.*\.json$/.test(n)).map(n=>readJson(path.join(plan.stateRoot,n))).find(x=>!x.finishedAt);
    if(unresolved)throw Error('UPDATE_INTERRUPTED_TRANSACTION_REQUIRES_REVIEW');
    await driver.preflight(plan,previous);stage('版本與路徑','通過',{target:plan.targetSha,actualPrevious:previous?.head??null});
    if(previous?.head===plan.targetSha&&previous?.planHash===driver.planHash(plan)) {
      const proof=await driver.verify(plan,previous);stage('已是目標版本','驗證通過',proof);record.result='UNCHANGED_VERIFIED';return record;
    }
    // Original route/config and whole version remain beside the new release.
    await driver.preserve(plan,previous,transaction);stage('舊版與設定保留','通過');
    prepared=await driver.prepare(plan,transaction);stage('整版與鎖定依賴','通過',{release:prepared.root});
    if((fs.existsSync(routeFile)?sha256(fs.readFileSync(routeFile)):null)!==originalRoute)throw Error('UPDATE_ROUTE_DRIFT');
    await driver.preflight(plan,previous); // PID/version/path recheck immediately before stop.
    if(previous){oldStopped=true;await driver.stop(plan,previous);}
    stage('必要切換','開始',{scope:'ISOLATED_DASHBOARD_AND_CRU55_ONLY'});
    started=await driver.start(plan,prepared);stage('必要切換','啟動成功',{head:started.head});
    const proof=await driver.verify(plan,started);stage('資料接收／衍生發布／API','通過',proof);
    stage('UI','沿用已驗收相同檔案',{render:'REUSED_ACCEPTED_UI_BLOBS; fresh browser observation recorded separately'});
    writeJson(routeFile,started);routeCommitted=true;record.result='UPDATED_ISOLATED_VERIFIED';record.active=started;
    stage('結果','隔離更新完成',{naturalLive:'未驗證',fullDayCapacity:'未驗證',formalSwitch:'未執行'});
    return record;
  } catch(error) {
    // A committed, verified live route must not be stopped because receipt output
    // subsequently failed. Retain the lock and require reconciliation of evidence.
    if(routeCommitted){retainLock=true;record.result='UPDATED_RECEIPT_RECOVERY_REQUIRED';record.error=error.message;throw Object.assign(Error(record.result),{receipt:record});}
    record.error=error.message;stage('更新','失敗',{reason:error.message},true);
    try {
      if(prepared)await driver.cleanupAttempt(plan,prepared,started);
      if(oldStopped){const restored=await driver.start(plan,previous);const proof=await driver.verify({...plan,expected:previous.expected,uiFiles:previous.uiFiles},restored);writeJson(routeFile,restored);record.result='ROLLED_BACK_VERIFIED';stage('回退','舊版真實驗證通過',proof,true);}
      else {record.result='FAILED_BEFORE_SWITCH';stage('回退','原版本保留',{},true);}
    }catch(rollback){record.rollbackError=rollback.message;record.result='RECOVERY_REQUIRED';retainLock=true;stage('回退','需要檢查；不停止未知程序',{reason:rollback.message},true);}
    throw Object.assign(Error(record.result+': '+error.message),{receipt:record});
  } finally {
    record.finishedAt=new Date().toISOString();
    try{writeJson(journal,record);}catch(error){retainLock=true;(record.journalErrors??=[]).push(error.message);throw Object.assign(Error('UPDATE_RECEIPT_RECOVERY_REQUIRED'),{receipt:record,cause:error});}
    if(!retainLock){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}
  }
}
