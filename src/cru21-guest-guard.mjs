import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
export const GUEST_BRANCH = 'codex/cru21-decision-quality-p0-20261016';
export const GUEST_ORIGIN = 'http://127.0.0.1:18722';
export const GUEST_APIS = new Set(['/api/session','/healthz','/api/v1/dashboard','/api/v1/tx-chart','/api/v1/decision-level-watch','/api/v1/observed-flow','/api/v1/market-pulse','/api/v1/index-leadership']);
export const GUEST_ASSETS = new Set(['/','/index.html','/app.js','/styles.css','/trader-terminal-shell.js','/trader-terminal-shell.css','/observed-flow-refresh.js','/data-operations.js','/data-operations.css','/ask-gpt-inline.css','/ask-gpt-inline.js','/home-workspace.css','/home-workspace.js','/vendor/lightweight-charts.js']);
const sha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
export function guestRequested(env=process.env) {
 if (env.CRU21_GUEST_ENABLED && !['0','1'].includes(env.CRU21_GUEST_ENABLED)) throw Error('GUEST_FLAG_INVALID');
 return env.CRU21_GUEST_ENABLED === '1';
}
export function validateGuestIdentity({env,head,branch,base,clean}) {
 if(!guestRequested(env))throw Error('GUEST_NOT_ENABLED');
 if(env.HOST!=='127.0.0.1'||env.PORT!=='18722'||env.MOCK_DATA!=='0'||env.DASHBOARD_PREVIEW_TYPE!=='CRU21_OWNER_PREVIEW'
  ||env.DASHBOARD_PREVIEW_DATA_MODE!=='LIVE'||env.ASK_GPT_INLINE_ENABLED!=='0')throw Error('GUEST_BOUNDARY');
 if(head===base||branch!==GUEST_BRANCH||env.DASHBOARD_PREVIEW_BRANCH!==branch||!sha(head)||env.DASHBOARD_PREVIEW_EXPECTED_HEAD!==head
  ||!sha(base)||env.DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN!==base||clean!==true)throw Error('GUEST_IDENTITY');
 for(const key of ['CRU55_ACCEPTANCE_CONFIG','CRU55_INTEGRATION_CANDIDATE','CRU55_RUNTIME_BINDING','CRU55_DYNAMIC_ROOT','DASHBOARD_FORMAL_READ_ROOT','FORWARD_SHADOW_RUNTIME_ROOT']) {
  if(env[key] && !(key==='CRU55_INTEGRATION_CANDIDATE' && env[key]==='0'))throw Error('GUEST_INCOMPATIBLE_MODE');
 }
}
// Both wall and monotonic clocks are bounded; the absolute deadline never slides.
export function guestDeadline(expiresAt,{now=Date.now,mono=()=>performance.now()}={}) {
 if(typeof expiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiresAt))throw Error('GUEST_EXPIRY_REQUIRED');
 const end=Date.parse(expiresAt),duration=end-now(),start=mono();
 if(!Number.isFinite(end)||duration<=0||duration>900_000)throw Error('GUEST_EXPIRY_INVALID');
 return Object.freeze({expiresAt:new Date(end).toISOString(),remaining:()=>Math.max(0,Math.min(end-now(),duration-(mono()-start)))});
}
export function authorizeGuest(req,url,deadline) {
 if(deadline.remaining()<=0)return 'GUEST_EXPIRED';
 if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!=='127.0.0.1:18722')return 'GUEST_SOURCE_REJECTED';
 if(Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-')||['via','x-real-ip'].includes(k)))return 'GUEST_PROXY_REJECTED';
 if(req.headers.origin && req.headers.origin!==GUEST_ORIGIN)return 'GUEST_ORIGIN_REJECTED';
 const site=req.headers['sec-fetch-site'];
 if(!site || !['same-origin','none'].includes(site))return 'GUEST_ORIGIN_REJECTED';
 const mode=req.headers['sec-fetch-mode'],dest=req.headers['sec-fetch-dest'];
 if(GUEST_APIS.has(url.pathname)) {
  if(site!=='same-origin'||!['cors','same-origin'].includes(mode)||dest!=='empty')return 'GUEST_ORIGIN_REJECTED';
 } else {
  const navigation=mode==='navigate'&&dest==='document';
  const asset=site==='same-origin'&&mode==='no-cors'&&((dest==='script'&&url.pathname.endsWith('.js'))||(dest==='style'&&url.pathname.endsWith('.css')));
  if(!navigation&&!asset)return 'GUEST_ORIGIN_REJECTED';
 }
 if(req.headers.referer){try{if(new URL(req.headers.referer).origin!==GUEST_ORIGIN)return 'GUEST_ORIGIN_REJECTED';}catch{return 'GUEST_ORIGIN_REJECTED';}}
 if(!['GET','HEAD'].includes(req.method)||req.headers.upgrade||req.headers.authorization)return 'GUEST_READ_ONLY';
 if(!GUEST_APIS.has(url.pathname)&&!GUEST_ASSETS.has(url.pathname))return 'GUEST_ROUTE_DENIED';
 if(req.method==='HEAD'&&!GUEST_ASSETS.has(url.pathname))return 'GUEST_ROUTE_DENIED';
 if(url.pathname==='/api/v1/tx-chart') {
  if([...url.searchParams.keys()].some(k=>!['timeframe','mode'].includes(k))||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))return 'GUEST_QUERY_REJECTED';
  if(url.searchParams.has('mode')&&url.searchParams.get('mode')!=='LIVE')return 'GUEST_QUERY_REJECTED';
  if(url.searchParams.has('timeframe')&&!['1m','5m','15m','30m','1h','4h','1D'].includes(url.searchParams.get('timeframe')))return 'GUEST_QUERY_REJECTED';
 } else if(GUEST_APIS.has(url.pathname)&&url.search)return 'GUEST_QUERY_REJECTED';
 return null;
}
export function approvedGuestPaths(env,appRoot) {
 const directory = (key) => {
  if(!env[key]||!path.isAbsolute(env[key]))throw Error('GUEST_READ_BINDING_REQUIRED');
  const root=fs.realpathSync(env[key]);if(!fs.statSync(root).isDirectory())throw Error('GUEST_READ_BINDING_REQUIRED');return root;
 };
 const readRoot=directory('ASK_GPT_CANDIDATE_READ_ROOT'),chartRoot=directory('TX_CHART_DATA_ROOT'),flowRoot=directory('CRU34_LIVE_DATA_ROOT');
 const privatePath=path.resolve(appRoot,'data');
 const privateRoot=fs.existsSync(privatePath)?fs.realpathSync(privatePath):privatePath;
 const contains=(a,b)=>{const rel=path.relative(a,b);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));};
 for(const root of [readRoot,chartRoot,flowRoot])if(contains(privateRoot,root)||contains(root,privateRoot))throw Error('GUEST_SOURCE_PRIVATE_OVERLAP');
 const bound = (key) => {
  if(!env[key]||!path.isAbsolute(env[key]))throw Error('GUEST_FLOW_BINDING_REQUIRED');
  const expected=path.join(flowRoot,'runtime','cru34-live',key==='CRU34_LIVE_SNAPSHOT_PATH'?'latest.json':'status.json');
  // Resolve existing directory aliases; missing products remain unavailable, not fabricated.
  const resolveParent=p=>{let cursor=path.resolve(p),tail=[];while(!fs.existsSync(cursor)){const next=path.dirname(cursor);if(next===cursor)throw Error('GUEST_FLOW_BINDING_REQUIRED');tail.unshift(path.basename(cursor));cursor=next;}return path.join(fs.realpathSync(cursor),...tail);};
  const parent=resolveParent(path.dirname(env[key]));
  const expectedParent=resolveParent(path.dirname(expected));
  if(contains(privateRoot,parent)||contains(parent,privateRoot))throw Error('GUEST_SOURCE_PRIVATE_OVERLAP');
  if(parent!==expectedParent||path.basename(env[key])!==path.basename(expected))throw Error('GUEST_FLOW_BINDING_MISMATCH');
  return path.join(parent,path.basename(expected));
 };
 return Object.freeze({readRoot,chartRoot,flowRoot,snapshotPath:bound('CRU34_LIVE_SNAPSHOT_PATH'),statusPath:bound('CRU34_LIVE_STATUS_PATH')});
}
