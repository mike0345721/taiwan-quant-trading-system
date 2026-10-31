import fs from 'node:fs';
import path from 'node:path';
import { loadTxDecisionChart } from './dashboard-tx-chart-source.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { loadFlowRefresh } from './dashboard-flow-refresh.mjs';
import { buildMarketPulseLive } from './market-pulse-live.mjs';
import { buildIndexLeadership } from './index-leadership.mjs';
import { buildDecisionLevelWatch } from './decision-level-watch.mjs';
import { buildDecisionWorkspace } from './dashboard-decision-workspace.mjs';
import { projectGuest,chartSchema,watchSchema,flowSchema,pulseSchema,workspaceSchema,leadershipSchema } from './cru21-guest-projection.mjs';

// No cookies, tokens, redirects, environment-selected URL, arbitrary paths or remote upstreams.
export async function guestBridgeGet(route,{remaining,fetchImpl=fetch}={}) {
 if(!['/health','/latest','/leadership'].includes(route)||remaining()<=0)throw Error('GUEST_BRIDGE_DENIED');
 const res=await fetchImpl('http://127.0.0.1:8790'+route,{redirect:'error',credentials:'omit',headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(1200,Math.floor(remaining()))))});
 if(!res.ok||res.redirected||!res.body)throw Error('GUEST_BRIDGE_UNAVAILABLE');
 const reader=res.body.getReader();let size=0;const chunks=[];
 try {while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024)throw Error('GUEST_BRIDGE_OVERSIZE');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}
 if(remaining()<=0)throw Error('GUEST_EXPIRED');
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// Refuse redirects/hardlinks and bound synchronous scans before invoking existing readers.
export function guardGuestReadTree(root,relativePaths) {
 let total=0,count=0;
 const walk=(target,depth)=>{
  if(depth>5||++count>5000)throw Error('GUEST_READ_BUDGET');
  let st;try{st=fs.lstatSync(target);}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(st.isSymbolicLink()||(!st.isDirectory()&&(!st.isFile()||st.nlink!==1)))throw Error('GUEST_READ_REDIRECTION');
  if(st.isFile()){total+=st.size;if(st.size>64*1024*1024||total>128*1024*1024)throw Error('GUEST_READ_BUDGET');return;}
  for(const name of fs.readdirSync(target))walk(path.join(target,name),depth+1);
 };
 for(const rel of relativePaths) {
  let cursor=root;
  for(const part of rel.split('/').slice(0,-1)) {cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('GUEST_READ_REDIRECTION');}catch(e){if(e.code!=='ENOENT')throw e;}}
  walk(path.join(root,rel),0);
 }
}
function readSnapshot(root) {
 guardGuestReadTree(root,['latest.json']);
 try {const p=path.join(root,'latest.json');if(fs.statSync(p).size>4*1024*1024)return {};const v=JSON.parse(fs.readFileSync(p,'utf8'));return v?.dataMode==='live'?v:{};}catch{return {};}
}
export function createGuestReader({paths,appRoot,head,base,deadline,bridgeGet=guestBridgeGet,now=()=>new Date()}) {
 const calendar=loadGovernedTradingCalendar(path.join(appRoot,'config','taifex-official-calendar-2026.json'));
 const runtimeStartedAt=now().toISOString();
 let current=null,lastAt=0,pending=null;
 const unavailable=()=>({status:'UNAVAILABLE',qualityStatus:'UNAVAILABLE',mode:'LIVE',timeframe:'5m',bars:[],levels:{}});
 async function bundle(){
  if(deadline.remaining()<=0)throw Error('GUEST_EXPIRED');
  if(current&&Date.now()-lastAt<2000)return current;
  if(pending)return pending;
  pending=(async()=>{
   guardGuestReadTree(paths.chartRoot,['live-events','intraday/archive']);
   guardGuestReadTree(path.dirname(paths.snapshotPath),['latest.json','status.json','worker.lock']);
   const chart=loadTxDecisionChart({dataRoot:paths.chartRoot,cacheRoot:null,calendar,timeframe:'5m',mode:'LIVE',now:now()});
   const flow=loadFlowRefresh({runtimeCommit:head,dataRoot:paths.flowRoot,projectionRoot:path.dirname(paths.snapshotPath),liveSnapshotPath:paths.snapshotPath,liveStatusPath:paths.statusPath,now:now()});
   const get=route=>bridgeGet(route,{remaining:deadline.remaining}).catch(()=>null);
   const health=await get('/health');
   const safe=health?.mode==='market_data_only'&&health.formalWeight===0&&health.researchOnly===true&&health.executionAuthorized===false&&health.orderRoutesEnabled===false;
   const latestRaw=safe?await get('/latest'):null,leadershipRaw=safe?await get('/leadership'):null;
   const latestSafe=latestRaw?.mode==='market_data_only'&&latestRaw.data&&Object.values(latestRaw.data).every(record=>record?.formalWeight===0&&record?.researchOnly===true&&record?.executionAuthorized===false&&record?.orderRoutesEnabled===false);
   const latest=latestSafe?{state:'AVAILABLE',data:latestRaw.data}:null;
   const leadershipSafe=leadershipRaw?.mode==='market_data_only'&&leadershipRaw.executionAuthorized===false&&leadershipRaw.orderRoutesEnabled===false&&leadershipRaw.data?.executionAuthorized===false&&leadershipRaw.data?.orderRoutesEnabled===false;
   const subscription=prefix=>{const rows=(health?.requiredSubscriptions||[]).filter(r=>r.product===prefix||r.product?.startsWith(prefix+'_'));return rows.length&&rows.every(r=>r.state==='RESTORED')?'RESTORED':'UNKNOWN';};
   const leadership=buildIndexLeadership(leadershipSafe?leadershipRaw.data:{},{now:now(),indexSubscriptionState:subscription('IX0001_INDEX'),industrySubscriptionState:subscription('IX0001_INDUSTRY')});
   const pulse=buildMarketPulseLive({chart,bridgeLatest:latest||{state:'UNAVAILABLE',data:null},archiveDir:path.join(paths.chartRoot,'intraday','archive'),calendar,now:now()});
   const watch=buildDecisionLevelWatch({chart,observedFlow:flow,marketPulse:pulse,snapshotTime:now().toISOString()});
   const snapshot=readSnapshot(paths.readRoot);
   // No SQLite/research/forward ledger access. Unknown non-core panels remain unavailable.
   const dataHealth={overall:'UNAVAILABLE',items:[],staleCount:0,unavailableCount:1};
   const workspace=buildDecisionWorkspace({snapshot,dataHealth,runtimeVersion:{productVersion:'CRU-21 Scenario Watch',previewLabel:'候選審查 · 尚未批准交付',runtimeStartedAt,runtimeCommit:head,approvedMainCommit:base,buildCommit:head,exactHead:head,baseMainCommit:base,branch:'codex/cru21-decision-quality-p0-20261016',previewType:'CRU21_OWNER_PREVIEW',dataMode:'LIVE',syncState:'MISMATCH',complete:false},chart,observedFlow:flow,marketPulse:pulse,indexLeadership:null,now:now()});
   if(deadline.remaining()<=0)throw Error('GUEST_EXPIRED');
   current={chart,flow,pulse,watch,workspace,leadership};lastAt=Date.now();return current;
  })();
  try{return await pending;}finally{pending=null;}
 }
 return async function read(route,query=new URLSearchParams()) {
  let b;try{b=await bundle();}catch(e){if(deadline.remaining()<=0)throw Error('GUEST_EXPIRED');b={chart:unavailable(),flow:{sourceState:'UNAVAILABLE'},pulse:null,watch:{state:'UNAVAILABLE',nextWatch:null,scenarioWatch:null},workspace:null,leadership:null};}
  if(route==='/api/v1/dashboard')return{ok:true,data:null,service:{readOnly:true,guestReadOnly:true},decisionWorkspace:projectGuest(b.workspace,workspaceSchema)};
  if(route==='/api/v1/tx-chart'){
   const frame=query.get('timeframe')||'5m';
   let chart=b.chart;
   if(frame!=='5m'){try{guardGuestReadTree(paths.chartRoot,['live-events','intraday/archive']);chart=loadTxDecisionChart({dataRoot:paths.chartRoot,cacheRoot:null,calendar,timeframe:frame,mode:'LIVE',now:now()});}catch{chart={...unavailable(),timeframe:frame};}}
   return{ok:true,data:projectGuest(chart,chartSchema)};
  }
  const schemas={'/api/v1/decision-level-watch':['watch',watchSchema],'/api/v1/observed-flow':['flow',flowSchema],'/api/v1/market-pulse':['pulse',pulseSchema],'/api/v1/index-leadership':['leadership',leadershipSchema]};
  const entry=schemas[route];if(!entry)throw Error('GUEST_ROUTE_DENIED');
  return{ok:true,data:projectGuest(b[entry[0]],entry[1])};
 };
}
