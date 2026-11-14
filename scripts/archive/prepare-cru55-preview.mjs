// Offline, explicit import of accepted sealed projections. No raw/SQLite/collector access.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT, PRIVATE, ACCEPTED, MAIN, git, isolated, validateView, boundedRead } from '../src/cru55-preview-bundle.mjs';
import { assertPlainPath } from '../src/cvd-observation-isolation.mjs';
import { digest, stableJson, SAFETY } from '../src/cvd-observation-core.mjs';
import { buildDemo } from './cru55-synthetic-demo.mjs';

isolated();
const source=assertPlainPath(path.resolve(ROOT,'../cru54-cvd-current-main-v1'));
if(git(['rev-parse','HEAD'],source)!==ACCEPTED || git(['status','--porcelain'],source)) throw Error('CRU54_ACCEPTED_CLEAN_SOURCE_REQUIRED');
// Recheck all inherited producer/semantic modules; changed UI cannot silently alter them.
if(git(['diff',ACCEPTED,'--','src/cvd-*','src/tx-intraday-pressure-path-efficiency.mjs','src/dashboard-tx-chart.mjs','src/market-state-forward-shadow-calendar.mjs','config/taifex-official-calendar-2026.json'])) throw Error('FROZEN_SEMANTIC_CHANGE_STOP');
const hashes={day:'f2dd7f644295b5c00d0f5b5f97899bc7ba779edbe98669fbba7f1939a5e5e149',night:'b474c5e4d4cf32239170a9987c798b886d56b687a1d5032529202b96791e629c'};
const moduleUrl=pathToFileURL(path.join(source,'src/cvd-session-context-artifact.mjs')).href;
const exportCode=`import {loadSessionContext} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(loadSessionContext(process.argv[1])));`;
const views={};
for(const [key,hash] of Object.entries(hashes)) {
  const v=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',exportCode,hash],{cwd:source,encoding:'utf8',windowsHide:true,maxBuffer:40*1024*1024,timeout:120000}));
  views[key]=validateView({...v,kind:'GOVERNED_FRAGMENT',acceptedBundle:hash});
}
views.demo=validateView(buildDemo());
const primary=path.dirname(path.resolve(ROOT,git(['rev-parse','--git-common-dir'])));
const latest=assertPlainPath(path.join(primary,'data/latest.json'));
const bytes=boundedRead(latest,2*1024*1024);
const snapshot=JSON.parse(bytes);
if(snapshot.dataMode!=='live') throw Error('LOWER_SNAPSHOT_REAL_SOURCE_REQUIRED');
// Named existing public-market aggregates only. No signal/dealer inference, credentials or raw events.
const lower={asOfDate:snapshot.asOfDate,generatedAt:snapshot.generatedAt,sourceHash:digest(bytes),sourceMode:'READ_ONLY_HISTORICAL_SNAPSHOT',freshness:'STALE'};
for(const k of ['marketOverview','futuresMarket','futuresInstitutional','marketBreadth','spotInstitutional']) lower[k]=snapshot[k] ?? null;
const o=snapshot.options;
lower.options=o?{ok:o.ok,source:o.source,dataDate:o.dataDate,fetchedAt:o.fetchedAt,data:o.data?Object.fromEntries(['contract','expiryDate','totalCallOi','totalPutOi','oiPcRatio','callWall','putWall','maxPain'].map(k=>[k,o.data[k]??null])):null}:null;
const body={schema:'cru55-preview-v1',acceptedHead:ACCEPTED,approvedMain:MAIN,...SAFETY,views,lower,importedAt:new Date().toISOString()};
const bundleHash=digest(stableJson(body)), folder=assertPlainPath(path.join(PRIVATE,'bundles'));
fs.mkdirSync(folder,{recursive:true}); fs.writeFileSync(assertPlainPath(path.join(folder,bundleHash+'.json')),stableJson({...body,bundleHash})+'\n',{flag:'wx'});
console.log(JSON.stringify({bundleHash,views:Object.fromEntries(Object.entries(views).map(([k,v])=>[k,{kind:v.kind,cvd:v.charts['1m'].currentCvd,bars:v.charts['1m'].bars.length,scope:v.sessionContext.scope}])),lowerDate:lower.asOfDate}));
