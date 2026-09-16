import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,PRIVATE,BRANCH,MAIN,isolated,loadPreview,boundedRead,git} from '../src/cru55-preview-bundle.mjs';
import {assertPlainPath} from '../src/cvd-observation-isolation.mjs';
import {hashPassword} from '../src/security.mjs';
import {V2ResearchService} from '../src/v2-research.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const head=isolated({clean:true}),bundleHash=process.argv[2];loadPreview(bundleHash);
const formal=path.resolve(ROOT,'../../../..','approved-main-runtime');
if(git(['rev-parse','HEAD'],formal)!==MAIN)throw Error('FORMAL_HEAD_CHANGED');
const out=assertPlainPath(path.join(PRIVATE,'integration-runtime'));fs.mkdirSync(out,{recursive:true});
const seedPath=assertPlainPath(path.join(formal,'data/latest.json')),seedBytes=boundedRead(seedPath,8*1024*1024),seed=JSON.parse(seedBytes);
if(seed.dataMode!=='live'||!seed.asOfDate)throw Error('FORMAL_SEED_NOT_REAL');
const dbPath=path.join(formal,'v2/data/research-v2.sqlite'),reportPath=path.join(formal,'v2/reports/latest-backtest.json');
const globalContext=new V2ResearchService(dbPath,reportPath).decisionSupport().globalContext,globalSeries={};
const db=new DatabaseSync(assertPlainPath(dbPath),{readOnly:true});
try{db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');for(const symbol of ['SOX','NDX','USDTWD'])globalSeries[symbol]=db.prepare('SELECT trade_date AS date, close AS value FROM global_market_daily WHERE symbol=? ORDER BY trade_date DESC LIMIT 20').all(symbol).reverse();}finally{db.close();}
const historySource=assertPlainPath(path.join(formal,'data/history')),historyOut=assertPlainPath(path.join(out,'history'));fs.mkdirSync(historyOut,{recursive:true});
const history=[],historyManifest=[];let total=0;
for(const name of fs.readdirSync(historySource).filter(n=>/^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(-400)){const bytes=boundedRead(path.join(historySource,name),8*1024*1024);total+=bytes.length;if(total>128*1024*1024)throw Error('HISTORY_BUDGET');history.push(JSON.parse(bytes));fs.writeFileSync(assertPlainPath(path.join(historyOut,name)),bytes);historyManifest.push({name,sha256:sha(bytes)});}
const fields=['marketOverview','marketBreadth','spotInstitutional','futuresMarket','futuresInstitutional','options'];
const context={asOfDate:seed.asOfDate,generatedAt:seed.generatedAt,sourceMode:'FORMAL_READ_ONLY_SNAPSHOT',...Object.fromEntries(fields.map(k=>[k,seed[k]])),globalContext,globalSeries,futuresSeries:history.filter(x=>x.futuresMarket?.ok&&Number.isFinite(x.futuresMarket.data?.txDay?.openInterest)).map(x=>({date:x.futuresMarket.dataDate,value:x.futuresMarket.data.txDay.openInterest})).slice(-20),sourceDates:Object.fromEntries(fields.map(k=>[k,seed[k]?.dataDate||null])),limitations:['HISTORICAL_CONTEXT_NOT_CURRENT_SESSION','INDEX_CONTRIBUTION_SOURCE_UNAVAILABLE','TRUE_NQ_UNAVAILABLE_SOURCE_GAP','TWN_GOVERNED_SOURCE_UNAVAILABLE'],formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false};
// Context is a bounded presentation projection; market producers and frozen CRU54 semantics are untouched.
context.options=context.options?{...context.options,data:{...context.options.data,contracts:undefined,strikes:undefined}}:null;
const contextBytes=Buffer.from(JSON.stringify(context));fs.writeFileSync(assertPlainPath(path.join(out,'latest.json')),seedBytes);fs.writeFileSync(assertPlainPath(path.join(out,'context.json')),contextBytes);
const manifest={head,formalHead:MAIN,createdAt:new Date().toISOString(),seed:{path:seedPath,sha256:sha(seedBytes),asOfDate:seed.asOfDate,generatedAt:seed.generatedAt},files:{'latest.json':sha(seedBytes),'context.json':sha(contextBytes)},history:historyManifest,globalDates:globalContext.latest.map(x=>({symbol:x.symbol,tradeDate:x.tradeDate,availableAt:x.availableAt,sourceHash:x.sourceHash})),readOnlyInputs:true};fs.writeFileSync(assertPlainPath(path.join(out,'input-manifest.json')),JSON.stringify(manifest,null,2));
const password=crypto.randomBytes(32).toString('hex');
// Do not inherit application overrides or a formal password. Only OS execution essentials are carried forward.
const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{CRU55_INTEGRATION_CANDIDATE:'1',CRU55_BUNDLE_HASH:bundleHash,HOST:'127.0.0.1',PORT:'3055',NODE_ENV:'production',MOCK_DATA:'false',TRUST_PROXY:'false',COOKIE_SECURE:'false',REFRESH_INTERVAL_SECONDS:'0',DASHBOARD_PASSWORD_HASH:hashPassword(password),CRU55_FORMAL_DATA_ROOT:path.join(formal,'data'),TX_CHART_DATA_ROOT:path.join(formal,'data'),TX_CHART_CACHE_ROOT:path.join(out,'dashboard-chart-cache'),CRU34_LIVE_DATA_ROOT:path.join(formal,'data'),CRU34_LIVE_SNAPSHOT_PATH:path.join(formal,'data/runtime/cru34-live/latest.json'),CRU34_LIVE_STATUS_PATH:path.join(formal,'data/runtime/cru34-live/status.json'),DATA_OPERATIONS_OUTPUT_ROOT:path.join(formal,'data/quality/daily-data-operations'),V2_RESEARCH_DATABASE_PATH:dbPath,V2_BACKTEST_REPORT_PATH:reportPath});
const child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env,windowsHide:true,stdio:'inherit'});
const receipt={head,branch:BRANCH,bundleHash,pid:child.pid,url:'http://127.0.0.1:3055/',bootstrapUrl:`http://127.0.0.1:3055/#${password}`,startedAt:new Date().toISOString()};fs.writeFileSync(assertPlainPath(path.join(out,`session-${child.pid}.json`)),JSON.stringify(receipt),{flag:'wx',mode:0o600});
console.log(JSON.stringify({head,pid:child.pid,url:receipt.url,receiptPath:path.join(out,`session-${child.pid}.json`),state:'ISOLATED_INTEGRATION_CANDIDATE'}));
child.on('exit',code=>{process.exitCode=code||0;});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
