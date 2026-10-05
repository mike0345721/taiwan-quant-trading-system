// Manual prerequisite only: no .env import, collector, scheduler, or formal server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWindowsPlanStore } from '../src/chatgpt-plan-store.mjs';
import { startPlanSetup } from '../src/chatgpt-plan-setup.mjs';
import { publicError } from '../src/chatgpt-plan-auth.mjs';
import { configurePlanTransport } from '../src/chatgpt-plan-transport.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let app;
try {
  configurePlanTransport();
  const args=process.argv.slice(2);
  if(args.some(x=>x!=='--no-open'))throw new Error('UNSUPPORTED_ARGUMENT');
  const evidence=path.join(root,'data','chatgpt-plan-preflight');fs.mkdirSync(evidence,{recursive:true});
  app=await startPlanSetup({initializeStore:createWindowsPlanStore,onReceipt:receipt=>{
    const destination=path.join(evidence,'status.json'),temporary=destination+'.tmp';
    // Only sanitized lifecycle receipts: no callback URLs, codes, state, or credentials.
    fs.appendFileSync(path.join(evidence,'events.ndjson'),JSON.stringify({...receipt,pid:process.pid})+'\n',{mode:0o600});
    fs.writeFileSync(temporary,JSON.stringify({...receipt,pid:process.pid},null,2),{mode:0o600});fs.renameSync(temporary,destination);
  }});
  console.log(JSON.stringify({state:'WAITING_FOR_OWNER_AUTHORIZATION',setupUrl:app.origin,pid:process.pid,expiresAt:app.expiresAt,modelRequests:0,formalDashboardModified:false}));
  // Bootstrap capability is passed only to the local system browser, never logged.
  if(!args.includes('--no-open')) {
    const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',app.launchUrl],{stdio:'ignore',windowsHide:true});
    browser.once('error',()=>{console.error('SYSTEM_BROWSER_OPEN_FAILED');void app.close();});
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void app.close();});
}catch(error){if(app)await app.close();console.error(publicError(error));process.exitCode=1;}
