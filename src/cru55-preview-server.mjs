import http from 'node:http';
import crypto from 'node:crypto';
import {FRAMES,withFreshness} from './cvd-chart-projection.mjs';
import {SAFETY} from './cvd-observation-core.mjs';

// Memory-only isolated transport. Same loopback/Origin/session policy as accepted CRU54.
export function createPreviewServer({bundle,assets,head,port=3055,token=crypto.randomBytes(32).toString('hex')}) {
  const cookie=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+8*60*60*1000;
  const json=(res,status,value)=>{const body=JSON.stringify(value);if(Buffer.byteLength(body)>4*1024*1024) throw Error('RESPONSE_BUDGET');res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(body);};
  const server=http.createServer(async(req,res)=>{
    for(const [k,v] of Object.entries({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"})) res.setHeader(k,v);
    try {
      const host=`127.0.0.1:${port || server.address().port}`,origin=`http://${host}`;
      if(req.headers.host!==host || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || (req.headers.origin && req.headers.origin!==origin) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) return json(res,403,{reason:'CANDIDATE_ORIGIN_REFUSED'});
      if((req.url||'').length>512) return json(res,414,{reason:'REQUEST_TOO_LONG'});
      const url=new URL(req.url,origin);
      if(Date.now()>=expiresAt && (url.pathname.startsWith('/api/') || url.pathname==='/session')) return json(res,401,{reason:'CANDIDATE_SESSION_EXPIRED'});
      if(url.pathname==='/session' && req.method==='POST') {
        if(req.headers.origin!==origin || req.headers['content-type']!=='text/plain' || url.search) return json(res,403,{reason:'SESSION_ORIGIN_REQUIRED'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>128)return json(res,413,{reason:'SESSION_BODY_TOO_LARGE'});}
        if(!/^[a-f0-9]{64}$/.test(body) || !crypto.timingSafeEqual(Buffer.from(body),Buffer.from(token)))return json(res,401,{reason:'CANDIDATE_SESSION_REQUIRED'});
        res.setHeader('Set-Cookie',`cru55=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);return json(res,200,{state:'ISOLATED_SESSION'});
      }
      if(req.method!=='GET')return json(res,405,{reason:'READ_ONLY_CANDIDATE'});
      if(url.pathname.startsWith('/api/')) {
        if(!(req.headers.cookie||'').split(';').some(c=>c.trim()===`cru55=${cookie}`))return json(res,401,{reason:'CANDIDATE_SESSION_REQUIRED'});
        const identity={head,previewType:'CRU55_ISOLATED_DASHBOARD_PREVIEW',acceptedHead:bundle.acceptedHead,approvedMain:bundle.approvedMain,rawReadsPerRequest:0,...SAFETY};
        if(url.pathname==='/api/identity' && !url.search)return json(res,200,identity);
        if(url.pathname==='/api/lower' && !url.search)return json(res,200,{...bundle.lower,...identity});
        if(url.pathname!=='/api/preview')return json(res,404,{reason:'ROUTE_UNAVAILABLE'});
        if([...url.searchParams.keys()].some(k=>!['view','timeframe'].includes(k)) || ['view','timeframe'].some(k=>url.searchParams.getAll(k).length>1))return json(res,400,{reason:'QUERY_UNSUPPORTED'});
        const view=url.searchParams.get('view')||'day',frame=url.searchParams.get('timeframe')||'1m',v=bundle.views[view];
        if(!['day','night','demo'].includes(view)||!v||!FRAMES.includes(frame))return json(res,400,{reason:'VIEW_OR_FRAME_INVALID'});
        const chart=withFreshness(v.charts[frame]);
        return json(res,200,{...identity,view,kind:v.kind,chart,relationship:v.relationships[frame],handoff:v.handoffs[frame],context:{...v.sessionContext,freshness:chart.freshness},scan:Object.fromEntries(FRAMES.map(f=>[f,{timeframe:f,windowMs:v.relationships[f].windowMs,current:v.relationships[f].current}]))});
      }
      const asset=Object.hasOwn(assets,url.pathname)?assets[url.pathname]:null;
      if(!asset || url.search)return json(res,404,{reason:'ROUTE_UNAVAILABLE'});
      res.writeHead(200,{'Content-Type':asset.type});res.end(asset.body);
    }catch{if(!res.headersSent)json(res,500,{reason:'CANDIDATE_REQUEST_FAILED'});else res.destroy();}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=32;
  return {server,token};
}
