import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {beginPriorVerification,advancePriorVerification,priorStillVerified,readPriorArtifact} from '../src/cru55-stream-prior-verifier.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';

function fixture(){
  const parent=path.resolve('data');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'cru55-prior-test-'));
  return {root,cleanup(){
    const resolved=fs.realpathSync(root),relative=path.relative(fs.realpathSync(parent),resolved);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!relative.includes(path.sep)&&path.basename(resolved).startsWith('cru55-prior-test-'),'cleanup stays inside this test fixture');
    assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(resolved,{recursive:true,force:true});
  }};
}
function append(source,start,count,{night=false,previous='GENESIS'}={}){
  const origin=Date.parse(night?'2026-09-11T20:00:00+08:00':'2026-09-14T09:00:00+08:00');
  for(let i=start;i<start+count;i++){
    const eventTime=new Date(origin+i*10000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(origin+i*10000+1).toISOString(),...SAFETY,
      payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',session:night?'NIGHT':'DAY',tradeDate:'2026-09-14',eventTime,datetime:eventTime,close:20000+i,volume:1,tick_type:1}},previous);
    fs.appendFileSync(source,JSON.stringify(row)+'\n');previous=row.recordHash;
  }return previous;
}
function finish(options){
  for(let i=0;i<100;i++){const r=runStreamCycle(options);if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;assert.equal(r.state,'PENDING');}
  assert.fail('small prior fixture did not settle');
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const reference=(runRoot,publication)=>({artifactHash:publication.artifactHash,artifactPath:path.join(runRoot,publication.artifactHash+'.stream-view.json')});
function budget(cap){return {bytes:0,rawRanges:0,canTake(n,page=false){assert.equal(page,false);return this.bytes+n<=cap;},take(n,page=false){assert.equal(page,false);assert.ok(this.canTake(n,false),'prior reads never exceed caller budget');this.bytes+=n;this.rawRanges++;}};}

test('adding a verified opposite session republishes identical current cutoff; exact retry is unchanged and prior raw tampering blocks',()=>{
  const f=fixture(),priorSource=path.join(f.root,'night.ndjson'),currentSource=path.join(f.root,'day.ndjson'),priorRoot=path.join(f.root,'night'),currentRoot=path.join(f.root,'day');
  try{
    append(priorSource,0,3,{night:true});append(currentSource,0,3);
    const opts={sourcePath:currentSource,runRoot:currentRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2};
    const initial=finish(opts),initialArtifact=read(reference(currentRoot,initial).artifactPath);
    assert.equal(initialArtifact.integrity.adjacentRawPrefixVerified,null);assert.equal(initialArtifact.view.handoffs['1m'].pairing.state,'NOT_COMPARABLE');
    const prior=finish({sourcePath:priorSource,runRoot:priorRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2}),ref=reference(priorRoot,prior),priorBytes=fs.readFileSync(ref.artifactPath);
    const added=finish({...opts,priorPublication:ref}),artifact=read(reference(currentRoot,added).artifactPath);
    assert.equal(added.state,'PUBLISHED');assert.notEqual(added.artifactHash,initial.artifactHash);assert.deepEqual(added.cutoff,initial.cutoff);assert.equal(added.generationHash,initial.generationHash);
    assert.equal(artifact.integrity.originalRawPrefixVerified,true);assert.equal(artifact.integrity.adjacentRawPrefixVerified,true);assert.equal(artifact.adjacentArtifactHash,prior.artifactHash);assert.equal(artifact.view.handoffs['1m'].pairing.state,'COMPARABLE');
    assert.equal(finish({...opts,priorPublication:ref}).state,'UNCHANGED');
    const mapped=finish({...opts,priorPublications:{night:ref,day:null}});assert.equal(mapped.state,'UNCHANGED');assert.equal(mapped.artifactHash,added.artifactHash);
    // Change the original raw prefix without touching its immutable candidate artifact.
    const fd=fs.openSync(priorSource,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,10);}finally{fs.closeSync(fd);}
    assert.deepEqual(fs.readFileSync(ref.artifactPath),priorBytes);assert.equal(readPriorArtifact(ref).artifactHash,prior.artifactHash);
    assert.throws(()=>finish({...opts,priorPublications:{night:ref}}),/STREAM_PRIOR_RAW_PREFIX_CHANGED/);
    assert.equal(read(path.join(currentRoot,'lifecycle-status.json')).state,'BLOCKED');assert.equal(read(path.join(currentRoot,'stream-public.json')).artifactHash,added.artifactHash);
  }finally{f.cleanup();}
});

test('prior original-byte verification is byte bounded and resumes across immutable ranges',()=>{
  const f=fixture(),sourcePath=path.join(f.root,'night.ndjson'),runRoot=path.join(f.root,'night');
  try{
    const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2};let previous='GENESIS',publication;
    for(let i=0;i<3;i++){previous=append(sourcePath,i,1,{night:true,previous});publication=finish(opts);}
    const ref=reference(runRoot,publication),first=read(path.join(runRoot,'chunks','000000000001.json'));
    let state=beginPriorVerification(ref);const short=budget(first.length-1),pending=advancePriorVerification(state,{budget:short,maxRanges:1});
    assert.equal(pending.complete,false);assert.equal(pending.ranges,0);assert.equal(pending.state.offset,0);assert.equal(short.bytes,0);assert.equal(priorStillVerified(pending.state),false);
    state=JSON.parse(JSON.stringify(pending.state));let total=0;
    for(let i=1;i<=3;i++){
      const chunk=read(path.join(runRoot,'chunks',String(i).padStart(12,'0')+'.json')),work=budget(chunk.length);
      const next=advancePriorVerification(state,{budget:work,maxRanges:1});assert.equal(next.ranges,1);assert.equal(work.rawRanges,1);assert.equal(work.bytes,chunk.length);assert.equal(next.state.offset,state.offset+chunk.length);assert.equal(next.complete,i===3);
      total+=work.bytes;state=JSON.parse(JSON.stringify(next.state));
    }
    assert.equal(total,fs.statSync(sourcePath).size);assert.equal(state.offset,state.targetOffset);assert.equal(priorStillVerified(state),true);
    // A changed stamp invalidates completion and triggers a full-prefix restart.
    const fd=fs.openSync(sourcePath,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,10);}finally{fs.closeSync(fd);}
    assert.equal(priorStillVerified(state),false);assert.throws(()=>advancePriorVerification(state,{budget:budget(first.length),maxRanges:1}),/STREAM_PRIOR_RAW_PREFIX_CHANGED/);
  }finally{f.cleanup();}
});
