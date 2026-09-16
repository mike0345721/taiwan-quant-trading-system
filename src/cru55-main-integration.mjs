import fs from 'node:fs';
import crypto from 'node:crypto';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
import path from 'node:path';
import {ROOT,MAIN,ACCEPTED,isolated,git,loadPreview,boundedRead} from './cru55-preview-bundle.mjs';
import {withFreshness,FRAMES} from './cvd-chart-projection.mjs';
import {SAFETY} from './cvd-observation-core.mjs';
import {sendJson} from './http-utils.mjs';

// Opt-in mount uses main SessionStore/CSRF; never replaces the formal entry by default.
export function prepareIntegration(config) {
  const head=isolated({clean:true});
  git(['merge-base','--is-ancestor',MAIN,head]);
  if(config.host!=='127.0.0.1'||config.port!==3055||config.mockData||!config.passwordHash||config.refreshIntervalMs!==0)throw Error('CRU55_CANDIDATE_CONFIG_REFUSED');
  if(git(['diff',ACCEPTED,'--','src/cvd-*','src/tx-intraday-pressure-path-efficiency.mjs','src/dashboard-tx-chart.mjs']))throw Error('CRU55_FROZEN_SEMANTIC_CHANGE');
  const formalRoot=path.resolve(ROOT,'../../../..','approved-main-runtime');
  if(git(['rev-parse','HEAD'],formalRoot)!==MAIN)throw Error('CRU55_FORMAL_HEAD_CHANGED');
  const expected={CRU55_FORMAL_DATA_ROOT:path.join(formalRoot,'data'),TX_CHART_DATA_ROOT:path.join(formalRoot,'data'),CRU34_LIVE_DATA_ROOT:path.join(formalRoot,'data'),CRU34_LIVE_SNAPSHOT_PATH:path.join(formalRoot,'data/runtime/cru34-live/latest.json'),CRU34_LIVE_STATUS_PATH:path.join(formalRoot,'data/runtime/cru34-live/status.json'),DATA_OPERATIONS_OUTPUT_ROOT:path.join(formalRoot,'data/quality/daily-data-operations'),TX_CHART_CACHE_ROOT:path.join(config.dataDir,'dashboard-chart-cache')};
  for(const [key,value] of Object.entries(expected)){if(path.resolve(process.env[key]||'')!==path.resolve(value))throw Error('CRU55_INPUT_PATH_REFUSED:'+key);if(['CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH'].includes(key)){const physical=path.resolve(ROOT,'../../..','data/runtime/cru34-live',path.basename(value));if(fs.realpathSync.native(value).toLowerCase()!==physical.toLowerCase())throw Error('CRU55_READ_ALIAS_CHANGED');assertPlainPath(physical);}else assertPlainPath(value);}
  if(config.v2DatabasePath!==path.join(formalRoot,'v2/data/research-v2.sqlite')||config.v2ReportPath!==path.join(formalRoot,'v2/reports/latest-backtest.json')||config.trustProxy||config.cookieSecure)throw Error('CRU55_RESEARCH_OR_AUTH_CONFIG_REFUSED');
  const manifest=JSON.parse(boundedRead(path.join(config.dataDir,'input-manifest.json'),256*1024));
  if(manifest.head!==head||manifest.formalHead!==MAIN)throw Error('CRU55_INPUT_IDENTITY_MISMATCH');
  for(const file of ['latest.json','context.json']){const bytes=boundedRead(path.join(config.dataDir,file),8*1024*1024);if(crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.files[file])throw Error('CRU55_INPUT_HASH_MISMATCH');}
  const historyRoot=path.join(config.dataDir,'history');
  const names=fs.readdirSync(historyRoot).sort(),listed=manifest.history.map(x=>x.name).sort();
  if(JSON.stringify(names)!==JSON.stringify(listed)||names.some(n=>!/^\d{4}-\d{2}-\d{2}\.json$/.test(n)))throw Error('CRU55_HISTORY_SET_MISMATCH');
  const history=manifest.history.map(row=>{const bytes=boundedRead(path.join(historyRoot,row.name),8*1024*1024);if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('CRU55_HISTORY_HASH_MISMATCH');return JSON.parse(bytes);}).reverse();
  const seed=JSON.parse(boundedRead(path.join(config.dataDir,'latest.json'),8*1024*1024));
  // Reject pre-existing redirects/hardlinks on every candidate write subtree.
  function checkPrivateTree(dir){assertPlainPath(dir);if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir)){const file=assertPlainPath(path.join(dir,name)),st=fs.lstatSync(file);if(st.isDirectory())checkPrivateTree(file);else if(!st.isFile()||st.nlink!==1)throw Error('CRU55_PRIVATE_LINK_REFUSED');}}
  checkPrivateTree(config.dataDir);
  const bundle=loadPreview(process.env.CRU55_BUNDLE_HASH);
  const lower=JSON.parse(boundedRead(path.join(config.dataDir,'context.json'),2*1024*1024));
  const routes={'/':'cru55-preview.html','/index.html':'cru55-preview.html','/preview.css':'cru55-preview.css','/preview.js':'cru55-preview.js','/presentation.mjs':'cru55-presentation.mjs','/context-cards.mjs':'cru55-context-cards.mjs','/terminal.js':'trader-terminal-shell.js','/workspace':'index.html','/workspace.css':'cru55-workspace.css','/workspace.js':'cru55-workspace.js'};
  const assets=Object.fromEntries(Object.entries(routes).map(([r,f])=>[r,fs.readFileSync(path.join(ROOT,'public',f))]));
  const identity={head,acceptedHead:ACCEPTED,approvedMain:MAIN,previewType:'CRU55_CURRENT_MAIN_INTEGRATION_CANDIDATE',rawReadsPerRequest:0,...SAFETY};
  return {
    seed,history,
    guard(req,res){
      const origin='http://127.0.0.1:3055';
      for(const name of ['sessions.json','decision-workspace','dashboard-chart-cache']){const dest=assertPlainPath(path.join(config.dataDir,name));if(fs.existsSync(dest)){const st=fs.lstatSync(dest);if(st.isDirectory())checkPrivateTree(dest);else if(!st.isFile()||st.nlink!==1)throw Error('CRU55_PRIVATE_LINK_REFUSED');}}
      if(req.headers.host!=='127.0.0.1:3055'||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||(req.headers.origin&&req.headers.origin!==origin)||(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))){sendJson(res,403,{error:'CANDIDATE_ORIGIN_REFUSED'});return false;}
      // Main auth/CSRF remain intact. Acquisition is disabled; journal writes remain private.
      if(!['GET','HEAD'].includes(req.method)&&!['/api/auth/login','/api/auth/logout','/api/v1/cru46-browser-runtime-proof','/api/v1/decision-journal'].includes(req.url)){sendJson(res,403,{error:'CANDIDATE_READ_ONLY'});return false;}
      return true;
    },
    async handle(req,res,url,requireSession){
      if(req.method!=='GET')return false;
      if(['/api/preview','/api/lower','/api/identity'].includes(url.pathname)){
        if(!requireSession())return true;
        if(url.pathname==='/api/identity'){sendJson(res,200,identity);return true;}
        if(url.pathname==='/api/lower'){sendJson(res,200,{...lower,...identity});return true;}
        const view=url.searchParams.get('view')||'day',frame=url.searchParams.get('timeframe')||'1m';
        if(!['day','night','demo'].includes(view)||!FRAMES.includes(frame)||[...url.searchParams.keys()].some(k=>!['view','timeframe'].includes(k))||['view','timeframe'].some(k=>url.searchParams.getAll(k).length>1)){sendJson(res,400,{error:'VIEW_OR_FRAME_INVALID'});return true;}
        const v=bundle.views[view],chart=withFreshness(v.charts[frame]);
        sendJson(res,200,{...identity,view,kind:v.kind,chart,relationship:v.relationships[frame],handoff:v.handoffs[frame],context:{...v.sessionContext,freshness:chart.freshness},scan:Object.fromEntries(FRAMES.map(f=>[f,{timeframe:f,windowMs:v.relationships[f].windowMs,current:v.relationships[f].current}]))});return true;
      }
      if(Object.hasOwn(assets,url.pathname)){
        let body=assets[url.pathname];
        if(url.pathname==='/workspace')body=Buffer.from(body.toString().replace('</head>','<link rel="stylesheet" href="/workspace.css"><script src="/workspace.js" defer></script></head>'));
        const type=url.pathname==='/'||url.pathname==='/index.html'||url.pathname==='/workspace'?'text/html':url.pathname.endsWith('.css')?'text/css':'text/javascript';
        res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(body);return true;
      }
      if(url.pathname==='/vendor.js'){
        const file=path.join(ROOT,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(file));return true;
      }
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return true;}
      return false;
    }
  };
}
