import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventoryResearchCorpus,probeHistoricalDepthTail} from '../src/research-corpus-inventory.mjs';
import {bytesHash} from '../src/t0-outcome-linkage.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
const repo=fileURLToPath(new URL('..',import.meta.url));
const calendar=loadGovernedTradingCalendar(path.join(repo,'config/taifex-official-calendar-2026.json'));
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'qualification-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'data/live-events'),{recursive:true});return root;}
function quote(previous='GENESIS',second='00') {return buildLiveEventRecord({kind:'futures_bidask',code:'TXFK6',
  executionAuthorized:false,orderRoutesEnabled:false,exchangeTimestamp:`2026-10-22T02:00:${second}.000Z`,receivedAt:`2026-10-22T02:00:${second}.200Z`,
  clockSkewMs:200,duplicate:false,sequenceGap:0,
  payload:{productFamily:'TX',actualContract:'TXFK6',simtrade:false,bid_price:[100,99,98,97,96],ask_price:[101,102,103,104,105],bid_volume:[1,1,1,1,1],ask_volume:[1,1,1,1,1]}},previous);}
test('metadata inventory does not infer sessions, zero qualification or CVD from files',t=>{
  const sourceRoot=setup(t);fs.writeFileSync(path.join(sourceRoot,'data/live-events/2026-10-22.ndjson'),'not parsed by metadata stage');
  const r=inventoryResearchCorpus({sourceRoot});
  assert.equal(r.summary.calendarFiles,1);assert.equal(r.rawContentBytesRead,0);assert.equal(r.files[0].tradeDate,null);
  assert.equal(r.summary.qualifiedFullDays,null);assert.equal(r.summary.hypothesisResearchReady,false);
});
test('historical receipt is bound and prior classification is not promoted to current evidence',t=>{
  const sourceRoot=setup(t),priorScreeningFile=path.join(sourceRoot,'session-screening.json');
  const bytes=Buffer.from(JSON.stringify([{tradeDate:'2026-09-09',session:'DAY',class:'A',reasonCodes:[]}])) ;
  fs.writeFileSync(priorScreeningFile,bytes);fs.writeFileSync(path.join(sourceRoot,'audit-receipt.json'),JSON.stringify({artifacts:[{file:'session-screening.json',bytes:bytes.length,sha256:bytesHash(bytes)}]}));
  const r=inventoryResearchCorpus({sourceRoot,priorScreeningFile});assert.equal(r.sessions[0].class,null);assert.equal(r.sessions[0].previousClass,'A');
  fs.appendFileSync(priorScreeningFile,' ');assert.throws(()=>inventoryResearchCorpus({sourceRoot,priorScreeningFile}),/RECEIPT_MISMATCH/);
});
test('bounded historical depth probe reuses canonical qualification without claiming capture or live freshness',t=>{
  const sourceRoot=setup(t),first=quote(),second=quote(first.recordHash,'01'),file=path.join(sourceRoot,'data/live-events/2026-10-22.ndjson');
  const bytes=Buffer.from([first,second].map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(file,bytes);
  const r=probeHistoricalDepthTail({sourceRoot,date:'2026-10-22',calendar});
  assert.equal(r.groups[0].validDepthSamples,2);assert.equal(r.fullOutcomeQualified,false);assert.equal(r.captureCompleteness,null);
  assert.equal(r.cvdQualified,null);assert.equal(r.groups[0].tradeDate,'2026-10-22');assert.equal(r.groups[0].session,'DAY');
  assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(probeHistoricalDepthTail({sourceRoot,date:'2026-10-22',calendar,maxBytes:bytes.length-10}).groups[0].validDepthSamples,1);
});
test('tampering or malformed tail invalidates all sample claims',t=>{
  const sourceRoot=setup(t),q=quote(),file=path.join(sourceRoot,'data/live-events/2026-10-22.ndjson');
  q.payload.bid_volume[0]=900;fs.writeFileSync(file,JSON.stringify(q)+'\n');
  const r=probeHistoricalDepthTail({sourceRoot,date:'2026-10-22',calendar});assert.equal(r.state,'BLOCKED');assert.deepEqual(r.groups,[]);
  fs.writeFileSync(file,JSON.stringify(quote())+'\n{broken}\n');assert.equal(probeHistoricalDepthTail({sourceRoot,date:'2026-10-22',calendar}).state,'BLOCKED');
});
test('CLI missing frozen corpus is BLOCKED, preserves evidence and refuses overwrite and outside output',t=>{
  const sourceRoot=setup(t),root=setup(t);
  fs.cpSync(path.join(repo,'src'),path.join(root,'src'),{recursive:true});fs.mkdirSync(path.join(root,'scripts'));
  fs.copyFileSync(path.join(repo,'scripts/run-t0-outcome-qualification.mjs'),path.join(root,'scripts/run-t0-outcome-qualification.mjs'));
  fs.mkdirSync(path.join(root,'data/research-validation'));
  const output=path.join(root,'data/research-validation/result.json');
  const run=out=>spawnSync(process.execPath,[path.join(root,'scripts/run-t0-outcome-qualification.mjs'),sourceRoot,out],{encoding:'utf8'});
  const r=run(output);assert.equal(r.status,2,r.stderr);const bytes=fs.readFileSync(output);const body=JSON.parse(bytes);
  assert.equal(body.linkage.state,'BLOCKED');assert.equal(body.linkage.summary,null);assert.equal(body.inventory.summary.qualifiedFullDays,null);
  assert.equal(run(output).status,2);assert.deepEqual(fs.readFileSync(output),bytes);
  const outside=path.join(sourceRoot,'forbidden.json');assert.equal(run(outside).status,2);assert.equal(fs.existsSync(outside),false);
});
