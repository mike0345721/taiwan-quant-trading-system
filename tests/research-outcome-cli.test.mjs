import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {dates,fixture,protocolFor,rules} from './research-replay-fixtures.mjs';
const source=fileURLToPath(new URL('..',import.meta.url));
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-runner-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(path.join(source,'src'),path.join(root,'src'),{recursive:true});fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'scripts'));
 fs.copyFileSync(path.join(source,'config/taifex-official-calendar-2026.json'),path.join(root,'config/taifex-official-calendar-2026.json'));
 fs.copyFileSync(path.join(source,'scripts/run-research-outcome-oos.mjs'),path.join(root,'scripts/run-research-outcome-oos.mjs'));
 fs.mkdirSync(path.join(root,'data/research-validation'),{recursive:true});return root;}
test('CLI produces hash-bound SYNTHETIC engineering results, refuses output overwrite and outside input',t=>{
 const root=setup(t),data=path.join(root,'data/research-validation'),input=path.join(data,'input.json'),output=path.join(data,'result.json');
 fs.writeFileSync(input,JSON.stringify({engineeringOnly:true,rules,protocol:protocolFor(),events:dates.map((d,i)=>({...fixture(d,i),foldId:'fold'+Math.floor(i/8)}))}));
 const run=(a)=>spawnSync(process.execPath,['scripts/run-research-outcome-oos.mjs',...a],{cwd:root,encoding:'utf8'});
 const r=run([input,output]);assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.outcomes.length,24);assert.equal(result.comparison.sampleSize,24);
 const saved=fs.readFileSync(output,'utf8');const again=run([input,output]);assert.equal(again.status,2);assert.equal(fs.readFileSync(output,'utf8'),saved);
 fs.copyFileSync(input,path.join(root,'outside.json'));assert.equal(run([path.join(root,'outside.json')]).status,2);
});
test('missing real inputs produce explicit BLOCKED with null comparative metrics',t=>{
 const root=setup(t),file=path.join(root,'data/research-validation/empty.json');fs.writeFileSync(file,JSON.stringify({events:[],rules:null,protocol:null}));
 const r=spawnSync(process.execPath,['scripts/run-research-outcome-oos.mjs',file],{cwd:root,encoding:'utf8'});
 assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).comparison.metrics,null);assert.equal(JSON.parse(r.stdout).state,'BLOCKED');
});
test('stream audit detects submillisecond negative latency even with intact original record hash',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-ledger-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const record=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:'2026-10-22T02:00:00.200100Z',exchangeTimestamp:'2026-10-22T02:00:00.200900Z',
  executionAuthorized:false,orderRoutesEnabled:false,duplicate:false,sequenceGap:0,payload:{productFamily:'TX',simtrade:false,tick_type:1}});
 const file=path.join(dir,'ledger.ndjson');fs.writeFileSync(file,JSON.stringify(record)+'\n');
 const r=spawnSync(process.execPath,[path.join(source,'scripts/audit-research-ledger-stream.mjs'),file],{encoding:'utf8'});
 assert.equal(r.status,2,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.timestampViolations,1);assert.equal(report.hashFailures,0);
});
