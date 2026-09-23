// Private read-only comparison. Run after timed measurements, not concurrently.
// Usage: node scripts/compare-cru55-performance-artifacts.mjs BASELINE_DIRECTORY CANDIDATE_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const stable = x => JSON.stringify(canonical(x));
function canonical(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(canonical);
  return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
}
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const equal = (a,b,label) => assert.equal(stable(a),stable(b),label);
const validHash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const frames = ['1m','5m','15m','30m','1h','4h'];
const safety = {formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false};

function load(directory) {
  directory=path.resolve(directory);
  const events=fs.readFileSync(path.join(directory,'cycles.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
  const start=events[0], receipt=json(path.join(directory,'receipt.json'));
  assert.equal(start.kind,'start'); assert(validHash(start.inputHash)); assert.equal(receipt.complete,true);
  const publications=events.filter(e=>['PUBLISHED','UNCHANGED'].includes(e.result?.state)).map(e=>e.result);
  assert(publications.length>0);
  const sealed=json(path.join(directory,'run','ingest.json')),ingest=sealed.value;
  assert.equal(sha(stable(ingest)),sealed.hash,'ingest seal');
  const artifacts=publications.map(p=>{
    assert(validHash(p.artifactHash));
    const artifact=json(path.join(directory,'run',p.artifactHash+'.stream-view.json'));
    const {artifactHash,...body}=artifact;
    assert.equal(artifactHash,p.artifactHash); assert.equal(sha(stable(body)),artifactHash,'artifact hash');
    assert.equal(artifact.schemaVersion,'cru55-stream-view-v2');
    assert.equal(artifact.generationHash,p.generationHash);
    equal(artifact.view.charts['1m'].cutoff,p.cutoff,'publication cutoff');
    assert.equal(artifact.sourceLedgerIdentity,p.cutoff.sourceLedgerIdentity);
    assert.equal(artifact.integrity.endByteOffset,p.endByteOffset);
    for(const [k,v] of Object.entries(safety))assert.equal(artifact[k],v,k);
    for(const group of ['charts','relationships','handoffs'])equal(Object.keys(artifact.view[group]).sort(),[...frames].sort(),'six frames');
    return {pointer:p,artifact};
  });
  const selected=new Set(artifacts.map(x=>x.pointer.cutoff.ledgerOrdinal));
  const physical=path.join(directory,'private-source.ndjson'),fd=fs.openSync(physical,'r');
  const originalHash=crypto.createHash('sha256');
  let offset=0,previousChunkHash=null,previousPageHash=null,ordinal=0,carry=Buffer.alloc(0),first=null;
  const rawCutoffs=new Map(),chunkCutoffs=new Map();
  try {
    assert.equal(fs.fstatSync(fd).size,start.inputBytes,'input length');
    for(let i=1;i<=ingest.index;i++) {
      const chunk=json(path.join(directory,'run','chunks',String(i).padStart(12,'0')+'.json'));
      const {chunkHash,...body}=chunk;
      assert.equal(sha(stable(body)),chunkHash,'chunk hash');
      assert.equal(chunk.index,i);assert.equal(chunk.offset,offset);
      assert.equal(chunk.previousChunkHash,previousChunkHash);assert.equal(chunk.previousPageHash,previousPageHash);
      assert.equal(chunk.sourceLedgerIdentity,ingest.sourceLedgerIdentity);assert.equal(chunk.resolverIdentity,ingest.resolverIdentity);
      assert(Number.isSafeInteger(chunk.length)&&chunk.length>0&&chunk.length<=512*1024);
      const bytes=Buffer.alloc(chunk.length);let n=0;
      while(n<bytes.length){const got=fs.readSync(fd,bytes,n,bytes.length-n,offset+n);assert(got>0,'truncated source');n+=got;}
      assert.equal(sha(bytes),chunk.rawHash,'original raw range hash');originalHash.update(bytes);
      const lines=Buffer.concat([carry,bytes]);let at=0,end;
      while((end=lines.indexOf(10,at))>=0){ordinal++;if(ordinal===1||selected.has(ordinal)){
        const row=JSON.parse(lines.subarray(at,end).toString('utf8'));if(ordinal===1)first=row;
        if(selected.has(ordinal))rawCutoffs.set(ordinal,{recordHash:row.recordHash,receivedAt:row.receivedAt});
      }at=end+1;}carry=lines.subarray(at);
      offset+=chunk.length;previousChunkHash=chunkHash;previousPageHash=chunk.pageHash;
      chunkCutoffs.set(offset,{chunkHash,index:i});
    }
    assert.equal(offset,start.inputBytes);assert.equal(carry.length,0);assert.equal(ordinal,ingest.lastOrdinal);
    assert.equal(previousChunkHash,ingest.lastChunkHash);assert.equal(previousPageHash,ingest.headPageHash);
    assert.equal(originalHash.digest('hex'),start.inputHash,'full original input hash');
    assert.equal(ingest.sourceLedgerIdentity,'sha256:'+sha(stable({schemaVersion:'cru34-live-ledger-generation-v1',firstRecordHash:first.recordHash,firstReceivedAt:first.receivedAt})));
  } finally { fs.closeSync(fd); }
  for(const {pointer:p,artifact:a} of artifacts){
    assert.equal(rawCutoffs.get(p.cutoff.ledgerOrdinal)?.recordHash,p.cutoff.recordHash,'original cutoff record hash');
    assert.equal(chunkCutoffs.get(p.endByteOffset)?.chunkHash,a.integrity.rawChunkHash,'artifact raw cutoff binding');
  }
  return {directory,start,receipt,ingest,artifacts};
}

function normalize(artifact,sequence,position) {
  const out=structuredClone(artifact),changes=[];
  const map=(parent,key,value,token,at)=>{
    assert.equal(parent[key],value,'identifier consistency '+at+'/'+key);
    changes.push({path:at+'/'+key,original:value,normalized:token});parent[key]=token;
  };
  const current=sequence[position].artifact,token='publication:'+position;
  const binding=(object,ref,id,at)=>{
    map(object,'generationHash',ref.generationHash,id+':generation',at);
    map(object,'projectionHash',ref.view.projectionHash,id+':projection',at);
  };
  map(out,'artifactHash',current.artifactHash,token+':artifact','');
  map(out,'generationHash',current.generationHash,token+':generation','');
  map(out.integrity,'rawChunkHash',current.integrity.rawChunkHash,token+':raw-chunk','/integrity');
  binding(out.view,current,token,'/view');
  binding(out.view.sessionContext,current,token,'/view/sessionContext');
  // Preserve null adjacency. Non-null references need a verified matching prior
  // artifact inside the supplied publication sequence; external priors fail closed.
  if(out.adjacentArtifactHash!==null){
    const index=sequence.findIndex((x,i)=>i<position&&x.artifact.artifactHash===out.adjacentArtifactHash);
    assert(index>=0,'unverified external adjacent artifact');
    map(out,'adjacentArtifactHash',sequence[index].artifact.artifactHash,'publication:'+index+':artifact','');
  }
  for(const frame of frames){
    for(const group of ['charts','relationships','handoffs'])binding(out.view[group][frame],current,token,'/view/'+group+'/'+frame);
    const h=out.view.handoffs[frame];
    if(h.current!==null)binding(h.current,current,token,'/view/handoffs/'+frame+'/current');
    if(h.prior!==null){
      const index=sequence.findIndex((x,i)=>i<position&&x.artifact.generationHash===h.prior.generationHash&&x.artifact.view.projectionHash===h.prior.projectionHash);
      assert(index>=0,'unverified handoff prior');
      equal(h.prior.sourceCutoff,sequence[index].artifact.view.charts[frame].cutoff,'prior cutoff binding');
      binding(h.prior,sequence[index].artifact,'publication:'+index,'/view/handoffs/'+frame+'/prior');
    }
  }
  return {out,changes};
}
function differences(a,b,p='',result=[]) {
  if(Object.is(a,b))return result;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)){
    result.push({path:p,baseline:a,candidate:b});return result;
  }
  for(const k of new Set([...Object.keys(a),...Object.keys(b)])){
    if(!(k in a)||!(k in b))result.push({path:p+'/'+k,missingFrom:k in a?'candidate':'baseline'});
    else differences(a[k],b[k],p+'/'+k,result);
  }
  return result;
}

const [baseDir,candidateDir,...extra]=process.argv.slice(2);
if(!baseDir||!candidateDir||extra.length)throw Error('Usage: node compare-artifacts.mjs BASELINE_DIRECTORY CANDIDATE_DIRECTORY');
const baseline=load(baseDir),candidate=load(candidateDir);
equal(baseline.start.inputHash,candidate.start.inputHash,'same original input');
equal(baseline.start.inputBytes,candidate.start.inputBytes,'same original size');
equal(baseline.ingest.sourceLedgerIdentity,candidate.ingest.sourceLedgerIdentity,'source ledger identity is NEVER normalized');
assert.equal(baseline.artifacts.length,candidate.artifacts.length,'same publication sequence');
const comparisons=[];
for(let i=0;i<baseline.artifacts.length;i++){
  const b=baseline.artifacts[i],c=candidate.artifacts[i];
  for(const field of ['session','tradeDate','cutoff','endByteOffset','availableAt'])equal(b.pointer[field],c.pointer[field],'same cutoff '+field);
  const bn=normalize(b.artifact,baseline.artifacts,i),cn=normalize(c.artifact,candidate.artifacts,i);
  equal(bn.changes.map(x=>x.path),cn.changes.map(x=>x.path),'same exact normalization paths');
  comparisons.push({session:b.pointer.session,cutoff:b.pointer.cutoff,normalizations:bn.changes.map((x,j)=>({...x,candidateOriginal:cn.changes[j].original})),differences:differences(bn.out,cn.out)});
}
const pass=comparisons.every(c=>c.differences.length===0);
console.log(JSON.stringify({pass,scope:'DIRECT_ARTIFACT_SEMANTICS_ONLY_NOT_RUNTIME_OR_PERFORMANCE_ACCEPTANCE',fullInputHashesVerified:true,artifactHashesVerified:true,rawChunkHashesAndBytesVerified:true,archivePagesAudited:false,comparison:'EXACT_NO_FLOAT_TOLERANCE',baselineInputHash:baseline.start.inputHash,sourceLedgerIdentity:baseline.ingest.sourceLedgerIdentity,resolvers:{baseline:baseline.ingest.resolverIdentity,candidate:candidate.ingest.resolverIdentity},physicalSourceBindingExcludedFromProductComparison:true,comparisons},null,2));
if(!pass)process.exitCode=1;
