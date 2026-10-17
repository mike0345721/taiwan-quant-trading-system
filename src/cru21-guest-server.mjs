import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { guestDeadline,validateGuestIdentity,approvedGuestPaths,authorizeGuest,GUEST_ASSETS } from './cru21-guest-guard.mjs';
import { createGuestReader } from './cru21-guest-reader.mjs';
import { setSecurityHeaders } from './http-utils.mjs';

export function createGuestServer({deadline,read,publicDir,vendorPath,head,verifyIdentity=()=>true}) {
 let inFlight=0;
 const server=http.createServer(async(req,res)=>{
  setSecurityHeaders(res,{isHttps:false});res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  // No auth cookies are read or issued. This dispatcher never falls through to normal handlers.
  const send=(status,value,type='application/json; charset=utf-8')=>{
   if(status<400&&!verifyIdentity()){status=503;value={ok:false,error:'GUEST_IDENTITY_CHANGED'};type='application/json; charset=utf-8';}
   if(deadline.remaining()<=0){status=410;value={ok:false,error:'GUEST_EXPIRED'};type='application/json; charset=utf-8';}
   res.writeHead(status,{'Content-Type':type});res.end(req.method==='HEAD'?'':typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));
  };
  try{
   if(!verifyIdentity()){send(503,{ok:false,error:'GUEST_IDENTITY_CHANGED'});return;}
   const url=new URL(req.url,'http://127.0.0.1:18722');
   // Reject absolute-form URLs as well as lookalike authorities and encoded path aliases.
   if(url.pathname!==req.url.split('?')[0]||!req.url.startsWith('/')||req.url.startsWith('//')||/%|\\/.test(url.pathname)){send(403,{ok:false,error:'GUEST_ROUTE_DENIED'});return;}
   const rejected=authorizeGuest(req,url,deadline);
   if(rejected){send(rejected==='GUEST_EXPIRED'?410:403,{ok:false,error:rejected});return;}
   if(url.pathname==='/api/session'){send(200,{ok:true,authenticated:false,guestReadOnly:true,expiresAt:deadline.expiresAt,runtimeCommit:head});return;}
   if(url.pathname==='/healthz'){send(200,{ok:true,guestReadOnly:true,runtimeCommit:head,expiresAt:deadline.expiresAt,executionAuthorized:false,orderRoutesEnabled:false});return;}
   if(GUEST_ASSETS.has(url.pathname)){
    let file=url.pathname==='/'?'/index.html':url.pathname;
    if(file==='/ask-gpt-inline.js'){send(200,'/* Guest mode: no AI/session/OAuth initialization. */','text/javascript; charset=utf-8');return;}
    const target=file==='/vendor/lightweight-charts.js'?vendorPath:path.join(publicDir,file.slice(1));
    // Static paths are fixed, and clean-source identity binds their contents. No generic file server.
    const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('GUEST_ASSET_INVALID');
    let body=fs.readFileSync(target);
    if(file==='/index.html')body=Buffer.from(body.toString('utf8').replace('<html','<html data-guest-read-only="true"'));
    send(200,body,file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return;
   }
   if(inFlight>=8){send(429,{ok:false,error:'GUEST_READ_BUSY'});return;}
   inFlight++;
   try{send(200,await read(url.pathname,url.searchParams));}finally{inFlight--;}
  }catch{if(!res.headersSent)send(503,{ok:false,error:'GUEST_DATA_UNAVAILABLE'});else res.end();}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=50;
 return server;
}
export async function startGuestServer({appRoot,env=process.env}) {
 const git=(...args)=>execFileSync('git',args,{cwd:appRoot,encoding:'utf8',windowsHide:true,timeout:2000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
 const head=git('rev-parse','HEAD'),base=git('rev-parse','refs/heads/main'),branch=git('branch','--show-current');
 validateGuestIdentity({env,head,base,branch,clean:git('status','--porcelain')===''});
 const deadline=guestDeadline(env.CRU21_GUEST_EXPIRES_AT);
 const paths=approvedGuestPaths(env,appRoot);
 const read=createGuestReader({paths,appRoot,head,base,deadline});
 const server=createGuestServer({deadline,read,publicDir:path.join(appRoot,'public'),vendorPath:path.join(appRoot,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),head,verifyIdentity:()=>git('rev-parse','HEAD')===head&&git('branch','--show-current')===branch&&git('rev-parse','refs/heads/main')===base&&git('status','--porcelain')===''});
 const timer=setTimeout(()=>{server.close();server.closeAllConnections();},Math.ceil(deadline.remaining()));
 server.once('close',()=>clearTimeout(timer));
 const stop=()=>{server.close();server.closeAllConnections();};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await new Promise((resolve,reject)=>{server.once('error',e=>{clearTimeout(timer);reject(e);});server.listen(18722,'127.0.0.1',resolve);});
 console.log(JSON.stringify({service:'CRU21_GUEST_READ_ONLY',head,expiresAt:deadline.expiresAt,executionAuthorized:false,orderRoutesEnabled:false}));
 return server;
}
