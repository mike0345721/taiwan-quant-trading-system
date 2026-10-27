// Own SIWC credentials only. Never reads Codex, browser, broker or API-key files.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PlanError } from './chatgpt-plan-auth.mjs';
function powershell(script, input = '') {
  const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 2097152 });
  if (child.error || child.status !== 0) throw new PlanError('LOCAL_CREDENTIAL_PROTECTION_FAILED');
  return child.stdout.replace(/^\uFEFF/, '').trim();
}
const prefix = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $value=[Console]::In.ReadToEnd(); ";
function protect(value) { return powershell(prefix + '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))', value); }
function unprotect(value) { return powershell(prefix + '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))', value); }
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
function readBoundFile(io,file,before,limit=1048576){
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<=0||before.size>limit)throw new PlanError('CREDENTIAL_FILE_REJECTED');
  let fd;
  try{
    fd=io.openSync(file,io.constants.O_RDONLY|(io.constants.O_NOFOLLOW||0));
    const held=io.fstatSync(fd);if(!sameFile(before,held))throw new PlanError('CREDENTIAL_FILE_REJECTED');
    const raw=io.readFileSync(fd,'utf8');
    if(Buffer.byteLength(raw)>limit||!sameFile(held,io.fstatSync(fd))||!sameFile(held,io.lstatSync(file)))throw new PlanError('CREDENTIAL_FILE_REJECTED');
    return raw;
  }finally{if(fd!==undefined)io.closeSync(fd);}
}
export const registrationKey = r => createHash('sha256').update(JSON.stringify([r.issuer,r.client_id,r.subject])).digest('hex');
function plainObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function validRegistration(record){
  if(!plainObject(record)||!['issuer','client_id','subject'].every(key=>typeof record[key]==='string'&&record[key].trim().length>0))return false;
  for(const key of ['email','access_token','refresh_token','id_token','originalNonce','savedAt'])if(Object.hasOwn(record,key)&&record[key]!==null&&typeof record[key]!=='string')return false;
  for(const key of ['expiresAt','earliestRefreshAt'])if(Object.hasOwn(record,key)&&record[key]!==null&&(!Number.isFinite(record[key])||record[key]<0))return false;
  if(Object.hasOwn(record,'scopes')&&record.scopes!==null&&(!Array.isArray(record.scopes)||record.scopes.some(value=>typeof value!=='string')))return false;
  return true;
}
function validateVault(value){
  if(!plainObject(value)||value.schema!=='cru21-siwc-vault-v1'||!/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId)||!plainObject(value.registrations))throw new PlanError('CREDENTIAL_STORE_INVALID');
  for(const [key,record] of Object.entries(value.registrations))if(!/^[a-f0-9]{64}$/.test(key)||!validRegistration(record)||key!==registrationKey(record))throw new PlanError('CREDENTIAL_STORE_INVALID');
  return value;
}
// Encryption is injected only for synthetic tests; the Windows entry always uses DPAPI.
export function createProtectedPlanStore({dir, encrypt, decrypt, initialize=true, readValidation=()=>{}, fs:io=fs}) {
  const file=path.join(dir,'siwc-v1.dpapi'), lock=path.join(dir,'siwc-v1.writer-lock');
  if(!io.existsSync(dir))throw new PlanError('CREDENTIAL_STORE_MISSING');
  if(io.lstatSync(dir).isSymbolicLink()) throw new PlanError('CREDENTIAL_PATH_REJECTED');
  let ownedLease=null;
  const validate=()=>{const result=readValidation({ownedLease});if(result&&typeof result.then==='function')throw new PlanError('CREDENTIAL_READ_VALIDATION_INVALID');};
  const acquire=()=>{
    validate();
    let fd; try{fd=io.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new PlanError('CREDENTIAL_STORE_BUSY');throw new PlanError('CREDENTIAL_LOCK_FAILED');}
    const stamp=JSON.stringify({pid:process.pid,instance:randomUUID(),createdAt:new Date().toISOString()});
    try{io.writeFileSync(fd,stamp);io.fsyncSync(fd);const held=io.fstatSync(fd);ownedLease={dev:held.dev,ino:held.ino,stamp};}
    catch(error){io.closeSync(fd);throw error;}
    return ()=>{
      const lease=ownedLease;
      try{const named=io.lstatSync(lock),held=io.fstatSync(fd);if(named.isSymbolicLink()||named.nlink!==1||named.dev!==held.dev||named.ino!==held.ino||held.dev!==lease.dev||held.ino!==lease.ino||io.readFileSync(lock,'utf8')!==stamp)throw new PlanError('CREDENTIAL_LOCK_IDENTITY_CHANGED');io.unlinkSync(lock);}
      finally{io.closeSync(fd);if(ownedLease===lease)ownedLease=null;}
    };
  };
  function load(){
    validate();
    if(!io.existsSync(file))throw new PlanError('CREDENTIAL_STORE_MISSING');
    const before=io.lstatSync(file);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>1048576)throw new PlanError('CREDENTIAL_FILE_REJECTED');
    const encrypted=readBoundFile(io,file,before),after=io.lstatSync(file);
    if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new PlanError('CREDENTIAL_FILE_REJECTED');
    validate();
    let value;try{value=JSON.parse(decrypt(encrypted));}catch{throw new PlanError('CREDENTIAL_STORE_UNREADABLE');}
    return validateVault(value);
  }
  let data;
  function persist(next){
    validate();
    validateVault(next);
    const encrypted=encrypt(JSON.stringify(next)),tmp=file+'.'+randomUUID()+'.tmp';
    try{io.writeFileSync(tmp,encrypted,{flag:'wx',mode:0o600});io.renameSync(tmp,file);data=next;}
    finally{if(io.existsSync(tmp))io.unlinkSync(tmp);}
  }
  if(!io.existsSync(file)){
    if(!initialize)throw new PlanError('CREDENTIAL_STORE_MISSING');
    const release=acquire();try{if(!io.existsSync(file))persist({schema:'cru21-siwc-vault-v1',hostId:'urn:uuid:'+randomUUID(),registrations:{}});}finally{release();}
  }
  data=load();
  const get=key=>{validate();return typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)&&Object.hasOwn(data.registrations,key)?data.registrations[key]:null;};
  return {
    get hostId(){validate();return data.hostId;}, get,
    reload(){data=load();},
    list(){validate();return Object.entries(data.registrations).map(([key,r])=>({key,label:`${r.email||'已驗證帳號'} · ${key.slice(0,8)}`,expiresAt:r.expiresAt}));},
    save(record){
      const release=acquire();try{data=load();const key=registrationKey(record);persist({...data,registrations:{...data.registrations,[key]:record}});return key;}finally{release();}
    },
    // Holds a cross-process lease across token rotation, then stores the replacement atomically.
    // Unknown/stale locks fail closed; never delete somebody else's lock or retry a rotating token.
    async updateExclusive(key, transform){
      const release=acquire();try{
        data=load();const current=get(key);if(!current)throw new PlanError('SIGN_IN_REQUIRED');
        const update=await transform(structuredClone(current));
        if(update.record){if(registrationKey(update.record)!==key)throw new PlanError('REFRESH_ACCOUNT_MISMATCH');persist({...data,registrations:{...data.registrations,[key]:update.record}});}
        if(update.error)throw update.error;
        return update.result;
      }finally{release();}
    },
  };
}

const SID=/^S-1-(?:[0-9]+-)*[0-9]+$/;
const SYSTEM_SID='S-1-5-18',ADMIN_SID='S-1-5-32-544';
// Only these read/execute rights may be granted directly to other ancestor SIDs.
// Unknown rights, ACCESS_SYSTEM_SECURITY, write/delete and ACL/owner changes deny.
const READ_RIGHTS=(1|8|32|128|131072|1048576|0x80000000|0x20000000)>>>0;
const DPAPI_HEADER=Buffer.from('01000000d08c9ddf0115d1118c7a00c04fc297eb','hex');
function rejectStore(code){throw new PlanError(code);}
function readWindowsSecurity({paths}){
  // Fixed read-only query. Paths are JSON on stdin, never executable script text.
  const script="$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $request=[Console]::In.ReadToEnd()|ConvertFrom-Json; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $entries=@(foreach($item in $request.paths){ $p=[string]$item.path; $acl=Get-Acl -LiteralPath $p; $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; $rules=@(foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){ @{sid=$rule.IdentityReference.Value;type=$rule.AccessControlType.ToString();inherited=[bool]$rule.IsInherited;inheritance=[int]$rule.InheritanceFlags;propagation=[int]$rule.PropagationFlags;rights=[long]$rule.FileSystemRights} }); @{path=$p;ownerSid=$owner;protected=[bool]$acl.AreAccessRulesProtected;reparsePoint=([bool](([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0));rules=$rules} }); @{currentUserSid=$sid;entries=$entries}|ConvertTo-Json -Depth 8 -Compress";
  try{return JSON.parse(powershell(script,JSON.stringify({paths})));}catch{rejectStore('CREDENTIAL_SECURITY_INSPECTION_FAILED');}
}
function windowsOptions(options={}){
  const platform=options.platform??process.platform,localAppData=options.localAppData??process.env.LOCALAPPDATA;
  if(platform!=='win32'||typeof localAppData!=='string'||!path.isAbsolute(localAppData))rejectStore('WINDOWS_PROTECTED_STORE_REQUIRED');
  // A platform mock cannot accidentally fall through to native PowerShell on this host.
  if(process.platform!=='win32'&&!options.securityInspector)rejectStore('WINDOWS_PROTECTED_STORE_REQUIRED');
  return {io:options.fs??fs,localAppData:path.resolve(localAppData),securityInspector:options.securityInspector??readWindowsSecurity};
}
function pathEqual(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function isReparse(stat){return stat.isSymbolicLink()||stat.reparsePoint===true||stat.isReparsePoint===true||(typeof stat.isReparsePoint==='function'&&stat.isReparsePoint())||Boolean((stat.fileAttributes??0)&0x400);}
function ancestors(target){const out=[];let current=target;for(;;){out.unshift(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}return out;}
function checkSecurity(inspector,paths){
  let result;try{result=inspector({paths:paths.map(({path:target,kind})=>({path:target,kind}))});}catch(error){if(error instanceof PlanError)throw error;rejectStore('CREDENTIAL_SECURITY_INSPECTION_FAILED');}
  if(!result||typeof result.then==='function'||!SID.test(result.currentUserSid??'')||!Array.isArray(result.entries)||result.entries.length!==paths.length)rejectStore('LOCAL_IDENTITY_UNVERIFIED');
  const principals=new Set([result.currentUserSid,SYSTEM_SID]),ancestorsAllowed=new Set([...principals,ADMIN_SID]);
  for(const item of paths){
    const matches=result.entries.filter(entry=>entry&&typeof entry.path==='string'&&pathEqual(entry.path,item.path));
    if(matches.length!==1)rejectStore('CREDENTIAL_ACL_UNSAFE');
    const entry=matches[0],allowed=item.kind==='ancestor'?ancestorsAllowed:principals;
    if(!allowed.has(entry.ownerSid)||entry.reparsePoint!==false||typeof entry.protected!=='boolean'||!Array.isArray(entry.rules)||entry.rules.length===0)rejectStore('CREDENTIAL_ACL_UNSAFE');
    for(const rule of entry.rules){
      if(!rule||!SID.test(rule.sid??'')||!['Allow','Deny'].includes(rule.type)||typeof rule.inherited!=='boolean'||!Number.isInteger(rule.inheritance)||rule.inheritance<0||rule.inheritance>3||!Number.isInteger(rule.propagation)||rule.propagation<0||rule.propagation>3||(rule.propagation!==0&&rule.inheritance===0)||!Number.isSafeInteger(rule.rights)||rule.rights< -2147483648||rule.rights>4294967295)rejectStore('CREDENTIAL_ACL_UNSAFE');
      // InheritOnly is not an effective ACE on this ancestor. Each child in the
      // chain is still inspected, and store/credential leaves keep the SID rule.
      if(item.kind==='ancestor'&&(rule.propagation&2)!==0)continue;
      if(rule.type==='Allow'&&!allowed.has(rule.sid)&&(item.kind!=='ancestor'||Boolean((rule.rights>>>0)&~READ_RIGHTS)))rejectStore('CREDENTIAL_ACL_UNSAFE');
    }
  }
}
function inspectExisting(context,{ownedLease=null}={}){
  const {io,localAppData,securityInspector}=context;
  const dir=path.join(localAppData,'TaiwanQuantDashboard','ChatGPTPlan'),file=path.join(dir,'siwc-v1.dpapi'),lock=path.join(dir,'siwc-v1.writer-lock');
  const chain=[...ancestors(localAppData),path.dirname(dir),dir],paths=[];
  function checkLock(){
    let stat;try{stat=io.lstatSync(lock);}catch(error){if(error.code!=='ENOENT')rejectStore('CREDENTIAL_STORE_BUSY');}
    if(stat){
      if(!ownedLease||isReparse(stat)||!stat.isFile()||stat.nlink!==1||stat.dev!==ownedLease.dev||stat.ino!==ownedLease.ino)rejectStore('CREDENTIAL_STORE_BUSY');
      if(readBoundFile(io,lock,stat,4096)!==ownedLease.stamp)rejectStore('CREDENTIAL_STORE_BUSY');
    }else if(ownedLease)rejectStore('CREDENTIAL_STORE_BUSY');
    return stat;
  }
  let missing=false;
  for(const target of chain){
    let stat;try{stat=io.lstatSync(target);}catch(error){if(error.code==='ENOENT'){missing=true;break;}rejectStore('CREDENTIAL_PATH_REJECTED');}
    if(!stat.isDirectory()||isReparse(stat)||!pathEqual(io.realpathSync(target),target))rejectStore('CREDENTIAL_PATH_REJECTED');
    paths.push({path:target,kind:target===dir?'directory':'ancestor',stat});
  }
  let fileStat;
  if(!missing){
    const lockStat=checkLock();
    if(lockStat){
      paths.push({path:lock,kind:'lock',stat:lockStat});
    }
    try{fileStat=io.lstatSync(file);}catch(error){if(error.code==='ENOENT')missing=true;else rejectStore('CREDENTIAL_FILE_REJECTED');}
    if(fileStat){
      if(isReparse(fileStat)||!fileStat.isFile()||fileStat.nlink!==1||fileStat.size<=0||fileStat.size>1048576||!pathEqual(io.realpathSync(file),file))rejectStore('CREDENTIAL_FILE_REJECTED');
      paths.push({path:file,kind:'file',stat:fileStat});
    }
  }
  checkSecurity(securityInspector,paths);
  if(missing)rejectStore('CREDENTIAL_STORE_MISSING');
  const raw=readBoundFile(io,file,fileStat),trimmed=raw.trim();
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed))rejectStore('CREDENTIAL_STORE_UNREADABLE');
  const bytes=Buffer.from(trimmed,'base64');
  if(bytes.length<64||bytes.toString('base64')!==trimmed||!bytes.subarray(0,DPAPI_HEADER.length).equals(DPAPI_HEADER))rejectStore('CREDENTIAL_STORE_UNREADABLE');
  // Recheck identities and ACLs after reading; no decrypt, lock, repair or sidecar.
  for(const item of paths){
    const after=io.lstatSync(item.path),same=item.kind==='file'||item.kind==='lock'?sameFile(item.stat,after):after.isDirectory()&&item.stat.dev===after.dev&&item.stat.ino===after.ino;
    if(isReparse(after)||!same||!pathEqual(io.realpathSync(item.path),item.path))rejectStore('CREDENTIAL_PATH_REJECTED');
  }
  checkSecurity(securityInspector,paths);
  checkLock();
  return {dir,file};
}
function metadataFailure(error){
  const reason=error instanceof PlanError?error.code:'CREDENTIAL_STORE_UNREADABLE';
  const states={CREDENTIAL_STORE_MISSING:'MISSING',CREDENTIAL_STORE_BUSY:'BUSY',CREDENTIAL_PATH_REJECTED:'UNSAFE',CREDENTIAL_FILE_REJECTED:'UNSAFE',CREDENTIAL_ACL_UNSAFE:'UNSAFE',LOCAL_IDENTITY_UNVERIFIED:'UNSAFE',CREDENTIAL_STORE_UNREADABLE:'UNREADABLE',CREDENTIAL_SECURITY_INSPECTION_FAILED:'UNAVAILABLE'};
  return Object.freeze({state:states[reason]??'UNAVAILABLE',reason:Object.hasOwn(states,reason)?reason:'CREDENTIAL_SECURITY_INSPECTION_FAILED',accountMetadataLoaded:false});
}
export function inspectWindowsPlanStore(options={}){
  const context=windowsOptions(options);
  try{inspectExisting(context);return Object.freeze({state:'PRESENT_UNVERIFIED',reason:'ACCOUNT_METADATA_NOT_LOADED',accountMetadataLoaded:false});}
  catch(error){return metadataFailure(error);}
}
export function openExistingWindowsPlanStore(options={}){
  const context=windowsOptions(options),{dir}=inspectExisting(context);
  return createProtectedPlanStore({dir,initialize:false,fs:context.io,encrypt:options.encrypt??protect,decrypt:options.decrypt??unprotect,readValidation:lease=>inspectExisting(context,lease)});
}
export function createWindowsPlanStore(){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new PlanError('WINDOWS_PROTECTED_STORE_REQUIRED');
  const dir=path.join(process.env.LOCALAPPDATA,'TaiwanQuantDashboard','ChatGPTPlan');fs.mkdirSync(dir,{recursive:true});
  if(fs.lstatSync(dir).isSymbolicLink())throw new PlanError('CREDENTIAL_PATH_REJECTED');
  const sid=powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  if(!/^S-1-5-[0-9-]+$/.test(sid))throw new PlanError('LOCAL_IDENTITY_UNVERIFIED');
  const acl=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,timeout:10000,encoding:'utf8'});
  if(acl.error||acl.status!==0)throw new PlanError('CREDENTIAL_ACL_FAILED');
  return createProtectedPlanStore({dir,encrypt:protect,decrypt:unprotect});
}
