import { readJson, sendJson } from './http-utils.mjs';
import { PlanError, publicError } from './chatgpt-plan-auth.mjs';
export function createInlineHandler({assistant,port,requireCsrf}){
 const origin='http://127.0.0.1:'+port;
 return async function handleInline(req,res,url,session){
  if(!url.pathname.startsWith('/api/v1/ask-gpt/'))return false;
  try{
   if(!session)throw new PlanError('AUTH_REQUIRED');
   if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host||req.headers.forwarded||req.headers['x-forwarded-for']||req.headers['x-forwarded-host'])throw new PlanError('INLINE_LOOPBACK_REQUIRED');
   if(url.search)throw new PlanError('ANALYSIS_REQUEST_INVALID');
   if(req.method==='POST'){
    if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')throw new PlanError('REQUEST_ORIGIN_REJECTED');
    if(!requireCsrf(req,res,session))return true;
    if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new PlanError('JSON_REQUIRED');
   }
   if(req.method==='GET'&&url.pathname==='/api/v1/ask-gpt/status'){sendJson(res,200,{ok:true,data:assistant.connection()});return true;}
   const match=url.pathname.match(/^\/api\/v1\/ask-gpt\/requests\/([a-f0-9-]+)$/);
   if(req.method==='GET'&&match){sendJson(res,200,{ok:true,data:assistant.read(match[1],session.id)});return true;}
   if(req.method!=='POST')throw new PlanError('ROUTE_NOT_FOUND');
   const body=await readJson(req,{maxBytes:8192});
   if(!body||Array.isArray(body)||typeof body!=='object')throw new PlanError('ANALYSIS_REQUEST_INVALID');
   if(url.pathname==='/api/v1/ask-gpt/models'){sendJson(res,200,{ok:true,data:await assistant.models(body.account)});return true;}
   if(url.pathname==='/api/v1/ask-gpt/cancel'){sendJson(res,200,{ok:true,data:assistant.cancel(body.requestId,session.id)});return true;}
   if(url.pathname==='/api/v1/ask-gpt/setup'){sendJson(res,200,{ok:true,data:await assistant.openSetup()});return true;}
   if(url.pathname==='/api/v1/ask-gpt/ask'){
    assistant.ensure();
    const cancel=new AbortController();
    const disconnected=()=>{if(!res.writableFinished)cancel.abort('CONNECTION_CLOSED');};
    req.once('aborted',disconnected);res.once('close',disconnected);
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    let bytes=0;
    const send=event=>{
     if(res.destroyed||res.writableEnded){cancel.abort('CONNECTION_CLOSED');return;}
     const line=JSON.stringify(event)+'\n';bytes+=Buffer.byteLength(line);
     if(bytes>2097152){cancel.abort('OUTPUT_TRANSPORT_LIMIT');return;}
     if(!res.write(line)&&res.writableLength>262144)cancel.abort('CLIENT_NOT_READING');
    };
    try{await assistant.run(body,session.id,{signal:cancel.signal,onEvent:send});}
    catch(error){send({type:'error',error:publicError(error)});}
    finally{req.removeListener('aborted',disconnected);res.removeListener('close',disconnected);if(!res.destroyed)res.end();}
    return true;
   }
   throw new PlanError('ROUTE_NOT_FOUND');
  }catch(error){
   const code=publicError(error),status=code==='AUTH_REQUIRED'?401:code==='REQUEST_NOT_FOUND'||code==='ROUTE_NOT_FOUND'?404:code.includes('NOT_ACTIVATED')?503:code.includes('ORIGIN')||code.includes('LOOPBACK')?403:400;
   if(!res.headersSent)sendJson(res,status,{ok:false,error:code});else if(!res.destroyed)res.end();
   return true;
  }
 };
}
