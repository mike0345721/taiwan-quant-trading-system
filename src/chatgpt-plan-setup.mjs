// Isolated, bounded SIWC setup prerequisite. Never imports the formal server.
import http from 'node:http';
import fs from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { PlanError, publicError, prepareAuthorization, consumeCallback, exchangeAuthorization, discovery, requirePlanPermission, listPlanModels, probePlanInference } from './chatgpt-plan-auth.mjs';
const secret = () => randomBytes(32).toString('base64url');
const equal = (a,b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookieName = 'cru21_plan_setup';
const reject = code => { throw new PlanError(code); };
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/setup.js', ['setup.js','text/javascript; charset=utf-8']],
  ['/setup.css', ['setup.css','text/css; charset=utf-8']],
]);
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') reject('JSON_REQUIRED');
  const chunks=[]; let bytes=0;
  for await (const chunk of req) { bytes+=chunk.length; if(bytes>16384) reject('REQUEST_TOO_LARGE'); chunks.push(chunk); }
  let body; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject('INVALID_JSON'); }
  if(!body || Array.isArray(body) || typeof body!=='object') reject('INVALID_JSON');
  return body;
}
export async function startPlanSetup({ store, initializeStore=null, port=18721, lifetimeMs=30*60_000, onReceipt=()=>{}, operations={} }) {
  if(!Number.isInteger(port) || port<0 || port>65535 || [8787,8790,8791].includes(port)) reject('SETUP_PORT_REJECTED');
  if(!Number.isFinite(lifetimeMs) || lifetimeMs<=0 || lifetimeMs>60*60_000) reject('SETUP_LIFETIME_REJECTED');
  const ops={discovery,exchangeAuthorization,listPlanModels,probePlanInference,...operations};
  const assetBytes=new Map([...assets].map(([route,[file,type]])=>[route,{type,bytes:fs.readFileSync(new URL('../tools/chatgpt-plan-setup/'+file,import.meta.url))}]));
  let origin,bootstrap=secret(),bootstrapExpires=Date.now()+300_000,session=null,pending=null,active=null,busy=false,attemptUsed=false,timer;
  const state={phase:'AUTHORIZATION_REQUIRED',reason:null,updatedAt:new Date().toISOString(),models:[],result:null};
  const expiresAt=new Date(Date.now()+lifetimeMs).toISOString();
  function receipt() {
    const result=state.result;
    return {schema:'cru21-plan-preflight-v1',phase:state.phase,reason:state.reason,updatedAt:state.updatedAt,expiresAt,authenticated:Boolean(active),directPermission:Boolean(active?.scopes?.includes('chatgpt.tokens.use.direct')),modelCount:state.models.length,probeAttempted:attemptUsed,completed:result?.terminal==='response.completed',selectedModel:result?.model||null,requestId:result?.requestId||null,responseChars:result?.text?.length||0,responseHash:result?.text?createHash('sha256').update(result.text).digest('hex'):null,usage:result?.usage||null,usageRoute:'SIWC_OAUTH_PUBLIC_RESPONSES',creditsSetting:'OWNER_CONFIRMATION_REQUIRED_NOT_API_AUDITED',paidApiFallback:false,formalDashboardModified:false};
  }
  function update(phase,reason=null) {
    state.phase=phase;state.reason=reason;state.updatedAt=new Date().toISOString();
    try{onReceipt(receipt());}catch{reject('RECEIPT_WRITE_FAILED');}
  }
  function headers(res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  }
  function json(res,status,body) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
  function requireSession(req) {
    const values=(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'=')).map(x=>x.slice(cookieName.length+1));
    if(!session || values.length!==1 || !equal(values[0],session.id)) reject('SETUP_SESSION_REQUIRED');
  }
  const server=http.createServer(async(req,res)=>{
    headers(res); let ownerRequest=false;
    try {
      if(req.socket.remoteAddress!=='127.0.0.1' || req.headers.host!==new URL(origin).host || req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) reject('LOOPBACK_OR_HOST_REJECTED');
      if(!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length>16384) reject('REQUEST_PATH_REJECTED');
      const url=new URL(req.url,origin);
      if(url.origin!==origin) reject('REQUEST_ORIGIN_REJECTED');
      const asset=assetBytes.get(url.pathname);
      if(req.method==='GET' && asset && !url.search){res.writeHead(200,{'Content-Type':asset.type});res.end(asset.bytes);return;}
      if(req.method==='POST') {
        if(req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site') reject('REQUEST_ORIGIN_REJECTED');
        if(url.pathname==='/api/bootstrap') {
          const body=await readJson(req);
          if(!bootstrap || Date.now()>bootstrapExpires || !equal(body.capability,bootstrap)) reject('SETUP_LINK_EXPIRED_OR_USED');
          bootstrap=null;session={id:secret(),csrf:secret()};
          res.setHeader('Set-Cookie',`${cookieName}=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.ceil(lifetimeMs/1000)}`);
          json(res,200,{ok:true});return;
        }
        requireSession(req);
        if(!equal(req.headers['x-csrf-token'],session.csrf)) reject('CSRF_REJECTED');
        ownerRequest=true;
        const body=await readJson(req);
        if(busy) reject('REQUEST_ALREADY_RUNNING');
        if(url.pathname==='/api/authorize') {
          if(attemptUsed) reject('PROBE_ALREADY_USED');
          const key=body.registration;
          if(key && (typeof key!=='string' || !/^[a-f0-9]{64}$/.test(key))) reject('REGISTRATION_INVALID');
          const saved=key?store.get(key):null;if(key&&!saved)reject('REGISTRATION_NOT_FOUND');
          busy=true;
          try {
            await ops.discovery();
            const prepared=prepareAuthorization({hostId:store.hostId,redirectUri:origin+'/auth/callback',browserSession:session.id,saved});
            pending=prepared.pending;update('WAITING_FOR_OWNER_SIGN_IN');json(res,200,{ok:true,authorizationUrl:prepared.url});
          } finally {busy=false;}return;
        }
        if(url.pathname==='/api/cancel') {pending=null;update('AUTHORIZATION_CANCELLED');json(res,200,{ok:true});return;}
        if(url.pathname==='/api/models') {
          requirePlanPermission(active);busy=true;
          try{state.models=await ops.listPlanModels(active);update('MODEL_SELECTION_READY');json(res,200,{ok:true});}finally{busy=false;}return;
        }
        if(url.pathname==='/api/probe') {
          requirePlanPermission(active);
          if(attemptUsed)reject('PROBE_ALREADY_USED');
          if(body.creditsDisabledConfirmed!==true)reject('CREDITS_SETTING_CONFIRMATION_REQUIRED');
          if(typeof body.model!=='string'||!state.models.some(m=>m.slug===body.model))reject('MODEL_NOT_IN_ACCOUNT_CATALOG');
          attemptUsed=true;busy=true;update('MODEL_TEST_RUNNING');
          try{state.result=await ops.probePlanInference(active,body.model,{creditsDisabledConfirmed:true});update('CONNECTIVITY_PROBE_COMPLETED');json(res,200,{ok:true});}finally{busy=false;}return;
        }
        if(url.pathname==='/api/stop') {pending=null;active=null;update('SETUP_STOPPED');json(res,200,{ok:true});setTimeout(()=>close(),50);return;}
        reject('ROUTE_NOT_FOUND');
      }
      if(req.method==='GET' && url.pathname==='/auth/callback') {
        requireSession(req);
        if(busy)reject('REQUEST_ALREADY_RUNNING');
        const tx=consumeCallback(pending,url.href,session.id);ownerRequest=true;busy=true;update('VALIDATING_AUTHORIZATION');
        try{
          const record=await ops.exchangeAuthorization(tx);const key=store.save(record);
          active=store.get(key);state.models=[];state.result=null;pending=null;
          try{requirePlanPermission(active);update('AUTHORIZED_MODEL_NOT_TESTED');}catch(error){update('IDENTITY_ONLY_PLAN_NOT_GRANTED',publicError(error));}
        }catch(error){pending=null;update('AUTHORIZATION_FAILED',publicError(error));}
        finally{busy=false;}
        res.writeHead(303,{Location:'/'});res.end();return;
      }
      if(req.method==='GET' && url.pathname==='/api/status' && !url.search) {
        requireSession(req);
        if(pending && !pending.consumed && Date.now()>pending.expiresAt){pending=null;update('AUTHORIZATION_EXPIRED');}
        json(res,200,{ok:true,...state,csrf:session.csrf,accounts:store.list(),activeLabel:active?store.list().find(r=>store.get(r.key)===active)?.label||'已驗證帳號':null,busy,probeAttempted:attemptUsed,expiresAt,directPermission:Boolean(active?.scopes?.includes('chatgpt.tokens.use.direct')),stage:'CONNECTION_PREREQUISITE_NOT_DASHBOARD_DELIVERY'});return;
      }
      reject('ROUTE_NOT_FOUND');
    }catch(error){
      const code=publicError(error);
      if(ownerRequest && ['WAITING_FOR_OWNER_SIGN_IN','VALIDATING_AUTHORIZATION','MODEL_TEST_RUNNING'].includes(state.phase) && !['CSRF_REJECTED','SETUP_SESSION_REQUIRED','REQUEST_ORIGIN_REJECTED','LOOPBACK_OR_HOST_REJECTED','AUTH_STATE_MISMATCH','REQUEST_ALREADY_RUNNING'].includes(code)){try{update('REQUEST_FAILED',code);}catch{}}
      json(res,code==='SETUP_SESSION_REQUIRED'?401:code==='ROUTE_NOT_FOUND'?404:400,{ok:false,error:code});
    }
  });
  server.requestTimeout=20_000;server.headersTimeout=10_000;server.keepAliveTimeout=1000;
  const close=()=>{clearTimeout(timer);pending=null;active=null;bootstrap=null;session=null;server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
  await new Promise((resolve,rejectListen)=>{server.once('error',rejectListen);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  try { if(!store)store=await initializeStore(); if(!store?.hostId || typeof store.save!=='function')reject('LOCAL_STORE_UNAVAILABLE'); } catch(error) { await close(); throw error; }
  timer=setTimeout(()=>{update('SETUP_EXPIRED');void close();},lifetimeMs);
  update('AUTHORIZATION_REQUIRED');
  return {server,origin,launchUrl:origin+'/#'+bootstrap,expiresAt,receipt,close};
}
