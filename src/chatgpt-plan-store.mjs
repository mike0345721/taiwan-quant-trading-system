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
export const registrationKey = r => createHash('sha256').update(JSON.stringify([r.issuer,r.client_id,r.subject])).digest('hex');
// Encryption is injected only for synthetic tests; the Windows entry always uses DPAPI.
export function createProtectedPlanStore({dir, encrypt, decrypt}) {
  const file=path.join(dir,'siwc-v1.dpapi'), lock=path.join(dir,'siwc-v1.writer-lock');
  if(fs.lstatSync(dir).isSymbolicLink()) throw new PlanError('CREDENTIAL_PATH_REJECTED');
  const acquire=()=>{
    let fd; try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new PlanError('CREDENTIAL_STORE_BUSY');throw new PlanError('CREDENTIAL_LOCK_FAILED');}
    const stamp=JSON.stringify({pid:process.pid,instance:randomUUID(),createdAt:new Date().toISOString()});
    try{fs.writeFileSync(fd,stamp);fs.fsyncSync(fd);}catch(error){fs.closeSync(fd);fs.unlinkSync(lock);throw error;}
    return ()=>{fs.closeSync(fd);if(fs.readFileSync(lock,'utf8')!==stamp)throw new PlanError('CREDENTIAL_LOCK_IDENTITY_CHANGED');fs.unlinkSync(lock);};
  };
  function load(){
    if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>1048576)throw new PlanError('CREDENTIAL_FILE_REJECTED');
    let value;try{value=JSON.parse(decrypt(fs.readFileSync(file,'utf8')));}catch{throw new PlanError('CREDENTIAL_STORE_UNREADABLE');}
    if(value.schema!=='cru21-siwc-vault-v1'||!/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId)||!value.registrations||Array.isArray(value.registrations))throw new PlanError('CREDENTIAL_STORE_INVALID');
    return value;
  }
  let data;
  function persist(next){
    const encrypted=encrypt(JSON.stringify(next)),tmp=file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,encrypted,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);data=next;}
    finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  }
  if(!fs.existsSync(file)){
    const release=acquire();try{if(!fs.existsSync(file))persist({schema:'cru21-siwc-vault-v1',hostId:'urn:uuid:'+randomUUID(),registrations:{}});}finally{release();}
  }
  data=load();
  const get=key=>typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)&&Object.hasOwn(data.registrations,key)?data.registrations[key]:null;
  return {
    get hostId(){return data.hostId;}, get,
    reload(){data=load();},
    list(){return Object.entries(data.registrations).map(([key,r])=>({key,label:`${r.email||'已驗證帳號'} · ${key.slice(0,8)}`,expiresAt:r.expiresAt}));},
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
