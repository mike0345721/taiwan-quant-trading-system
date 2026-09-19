import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCvdCandidateServer } from '../src/cvd-candidate-server.mjs';
import { FRAMES } from '../src/cvd-chart-projection.mjs';
test('Phase C HTTP is memory-only, same frame identity, bounded and retains auth/query/origin/negative protections', async () => {
  const frames=Object.fromEntries(FRAMES.map(timeframe=>[timeframe,{timeframe,generationHash:'same',availableAt:'2026-09-14T01:00:00Z',lastTradeAvailableAt:'2026-09-14T01:00:00Z'}]));
  const relationships=Object.fromEntries(FRAMES.map(timeframe=>[timeframe,{timeframe,generationHash:'same',current:{relationship:{code:'MIXED_OR_QUALITY_LIMITED'}}}]));
  const {server,token}=createCvdCandidateServer({frames,relationships,assets:{},head:'exact-head',port:0});
  await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const oldRead=fs.readFileSync,oldOpen=fs.openSync;
  fs.readFileSync=()=>{throw Error('NO_REQUEST_READ');};fs.openSync=()=>{throw Error('NO_REQUEST_OPEN');};
  try {
    assert.equal((await fetch(base+'/api/relationship')).status,401);
    const auth=await fetch(base+'/session',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:token});
    const headers={cookie:auth.headers.get('set-cookie').split(';')[0]};
    for(const frame of FRAMES){const r=await fetch(base+'/api/relationship?timeframe='+frame,{headers});assert.equal(r.status,200);const p=await r.json();assert.equal(p.timeframe,frame);assert.equal(p.head,'exact-head');assert.equal(p.previewType,'ISOLATED_PHASE_C');assert.equal(p.freshness.state,'STALE');}
    assert.equal((await fetch(base+'/api/relationship?path=raw',{headers})).status,400);
    assert.equal((await fetch(base+'/api/relationship?timeframe=1d',{headers})).status,400);
    assert.equal((await fetch(base+'/api/relationship',{headers:{...headers,Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await fetch(base+'/api/relationship',{headers,method:'POST'})).status,405);
    relationships['1m'].generationHash='wrong';assert.equal((await fetch(base+'/api/relationship',{headers})).status,503);
    const id=await (await fetch(base+'/api/identity',{headers})).json();assert.equal(id.rawReadsPerRequest,0);assert.equal(id.executionAuthorized,false);
  } finally {fs.readFileSync=oldRead;fs.openSync=oldOpen;await new Promise(resolve=>server.close(resolve));}
});
