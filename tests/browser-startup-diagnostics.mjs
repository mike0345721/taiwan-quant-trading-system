// Read-only evidence from the browser child owned by this isolated test.
// Never reads a user profile, credentials, environment values or unrelated PIDs.
import fs from 'node:fs';
import path from 'node:path';
export function ownedBrowserWaitState(child) {
 if(process.platform!=='linux'||!Number.isInteger(child?.pid))return {platform:process.platform};
 const read=(p)=>{try{return fs.readFileSync(p,'utf8')}catch{return ''}};
 const processes=[],pending=[{pid:child.pid,parent:null,depth:0}],seen=new Set();
 while(pending.length&&processes.length<24){
  const x=pending.shift();if(seen.has(x.pid))continue;seen.add(x.pid);
  const dir='/proc/'+x.pid,status=read(dir+'/status');if(!status)continue;
  const ppid=Number(status.match(/^PPid:\s*(\d+)/m)?.[1]);if(x.parent!==null&&ppid!==x.parent)continue;
  let executable=null;try{executable=path.basename(fs.readlinkSync(dir+'/exe'))}catch{}
  const row={pid:x.pid,parent:ppid,executable,state:status.match(/^State:\s*(.+)/m)?.[1],wchan:read(dir+'/wchan').trim(),threads:[]};
  let tids=[];try{tids=fs.readdirSync(dir+'/task').slice(0,32)}catch{}
  for(const tid of tids){row.threads.push({name:read(dir+'/task/'+tid+'/comm').trim(),wchan:read(dir+'/task/'+tid+'/wchan').trim()});
   if(x.depth<2)for(const id of read(dir+'/task/'+tid+'/children').trim().split(/\s+/).map(Number).filter(n=>n>0))pending.push({pid:id,parent:x.pid,depth:x.depth+1});
  }
  processes.push(row);
 }
 let sharedMemory=null;try{const s=fs.statfsSync('/dev/shm');sharedMemory={freeBytes:s.bavail*s.bsize,totalBytes:s.blocks*s.bsize}}catch{}
 return {platform:process.platform,processes,sharedMemory};
}
export function sanitizedBrowserStderr(value, temporaryRoot) {
 return String(value).split(String(temporaryRoot)).join('<test-temp>')
  .replace(/(?:https?|wss?):\/\/[^\s"']+/g,'<url>')
  .replace(/\/home\/[^\s"']+|\/tmp\/[^\s"']+/g,'<private-path>')
  .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g,'<ip>').slice(-5000);
}
