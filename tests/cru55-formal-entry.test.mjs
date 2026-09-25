import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFormalEntry } from '../src/cru55-formal-entry.mjs';
import { chartTrust,taipeiChartTime,sameChartSelection } from '../public/cru55-formal-presentation.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('chart eligibility never overrides known degraded quality; Taipei display preserves epoch',()=>{
  assert.deepEqual(chartTrust({status:'READY',qualityStatus:'QUALITY_INSUFFICIENT',qualityReasons:['TIMESTAMP_LINEAGE_INSUFFICIENT']}),
    {state:'QUALITY_INSUFFICIENT',eligibility:'READY',reasons:['TIMESTAMP_LINEAGE_INSUFFICIENT']});
  assert.equal(chartTrust({status:'READY'}).state,'UNAVAILABLE');
  assert.equal(taipeiChartTime(Date.parse('2026-09-18T00:45:00Z')/1000),'08:45:00');
  assert.equal(sameChartSelection('TX|DAY|1m','TX|DAY|1m'),true);
  assert.equal(sameChartSelection('TX|DAY|1m','TX|NIGHT|1m'),false);
});
test('formal route uses current named aggregates, gates data and preserves the original workspace', async()=>{
  let snapshot={dataMode:'live',asOfDate:'2026-09-18',marketBreadth:{ok:false},secret:'not public'};
  const handle=prepareFormalEntry({publicDir:path.join(root,'public')},()=>snapshot);
  const server=http.createServer(async(req,res)=>{
    const matched=await handle(req,res,new URL(req.url,'http://localhost'),()=>{
      if(req.headers.authorization==='test-session')return true;
      res.writeHead(401);res.end();return false;
    });
    if(!matched){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    assert.equal((await fetch(base+'/api/lower')).status,401);
    const options={headers:{authorization:'test-session'}};
    assert.equal((await fetch(base+'/api/v1/cvd-overview')).status,401);
    assert.equal((await fetch(base+'/api/v1/cvd-overview',{...options,method:'POST'})).status,405);
    assert.equal((await fetch(base+'/api/v1/cvd-overview?rawPath=secret',options)).status,400);
    assert.equal((await fetch(base+'/api/v1/cvd-overview?view=day&view=night',options)).status,400);
    assert.equal((await fetch(base+'/api/v1/cvd-overview',options)).status,503);
    let response=await fetch(base+'/api/lower',options);
    assert.equal(response.headers.get('cache-control'),'no-store');
    let lower=await response.json();
    assert.equal(lower.asOfDate,'2026-09-18');assert.equal(lower.secret,undefined);
    snapshot={dataMode:'live',asOfDate:'2026-09-21'};
    lower=await (await fetch(base+'/api/lower',options)).json();
    assert.equal(lower.asOfDate,'2026-09-21');assert.equal(lower.options,null);
    snapshot={dataMode:'mock',asOfDate:'2026-09-21'};
    assert.equal(await (await fetch(base+'/api/lower',options)).json(),null);
    const page=await (await fetch(base+'/')).text();
    assert.match(page,/id="cvd-observation"/);assert.match(page,/CVD Observation V1/);assert.match(page,/data-formal-entry="true"/);assert.match(page,/formal-overview.js/);
    assert.match(page,/vendor\/lightweight-charts.js/);assert.doesNotMatch(page,/SYNTHETIC \/ UI DEMO/);
    assert.doesNotMatch(page,/CRU-55 · ISOLATED PREVIEW/);
    const workspace=await (await fetch(base+'/workspace?space=futures')).text();
    for(const id of ['login-form','dw-journal-submit','daily-update-button'])
      assert.ok(workspace.includes('id="'+id+'"'),id);
    const original=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
    assert.equal(workspace.replace(' data-formal-entry="true"','')
      .replace('<link rel="stylesheet" href="/workspace.css"><script src="/workspace.js" defer></script>',''),original);
    assert.match(workspace,/data-formal-entry="true"/);
    for(const route of ['/formal-overview.js','/observation.mjs','/observation.css','/cru55-presentation.mjs','/workspace.js','/context-cards.mjs','/cru55-provisional-logo-v01.jpg'])
      assert.equal((await fetch(base+route)).status,200,route);
    assert.equal((await fetch(base+'/api/preview')).status,404);
    assert.equal((await fetch(base+'/api/lower',{method:'POST'})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
