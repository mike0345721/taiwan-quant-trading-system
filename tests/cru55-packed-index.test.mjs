import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {probeManagedProcess} from '../src/cru55-managed-owner.mjs';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY,stableJson,digest} from '../src/cvd-observation-core.mjs';
import {beginRangeAppend,beginRangeQueries,advanceRangeQueries,createRangeReader,INDEX_PACK_LIMITS} from '../src/cru55-projection-range-index.mjs';

function fixture(count=896,{dense=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-packed-')),sourcePath=path.join(root,'raw.ndjson');
  let hash='GENESIS';const rows=[];
  for(let n=0;n<count;n++){
    const time=new Date(Date.parse('2026-09-14T15:00:00+08:00')+n*1000).toISOString(),tx=dense||n%20===0||n===count-1;
    const row=buildLiveEventRecord({kind:'futures_tick',code:tx?'TXFI6':'MTXFI6',receivedAt:time,...SAFETY,payload:{_product_family:tx?'TX':'MTX',_target_code:tx?'TXFI6':'MTXFI6',timestamp:time,close:20000+n%11,volume:1,tick_type:1}},hash);
    hash=row.recordHash;rows.push(JSON.stringify(row));
  }
  fs.writeFileSync(sourcePath,rows.join('\n')+'\n');
  return {root,sourcePath,opts:{sourcePath,runRoot:path.join(root,'packed'),sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:8,indexLayout:'DERIVED_INDEX_PACK_V1'}};
}
function finish(opts,observe=()=>{}){for(let i=0;i<300;i++){const r=runStreamCycle(opts);assert.ok(r.metrics.pages<=opts.maxPages);assert.ok(r.metrics.bytes<=8*1024*1024);observe(r);if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;}throw Error('TEST_NO_PROGRESS');}
function dispose(root){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-packed-'));fs.rmSync(root,{recursive:true,force:true});}

test('packed checkpoint groups are bounded, legacy and full-scan artifacts are exact, and query reads shrink',t=>{
  const f=fixture();try{
    const reads={},bytes={};const read=fs.readFileSync;
    const run=(label,opts)=>{
      reads[label]=0;bytes[label]=0;
      const r=finish(opts,result=>assert.ok((result.metrics.projectionWork?.packs?.maxArchivePages??0)<=7));
      const checkpoint=JSON.parse(read(path.join(opts.runRoot,'projection-index.json'))).value;
      const specs=Array.from({length:45},(_,n)=>({kind:'display',filter:{lo:n*20+1,hi:Math.min(896,n*20+20)}}));
      const queries=advanceRangeQueries(beginRangeQueries(checkpoint.index.roots,specs),createRangeReader(h=>{const content=read(path.join(opts.runRoot,'projection-index',h+'.json'));reads[label]++;bytes[label]+=content.length;return JSON.parse(content);}));
      return {r,queries,artifact:JSON.parse(read(path.join(opts.runRoot,r.artifactHash+'.stream-view.json')))};
    };
    const legacy=run('legacy',{...f.opts,indexLayout:null,runRoot:path.join(f.root,'legacy')}),packed=run('packed',f.opts);
    assert.deepEqual(packed.artifact,legacy.artifact);assert.deepEqual(packed.queries.results,legacy.queries.results);
    const oracle=finish({...f.opts,indexLayout:null,projectionMode:'FULL_SCAN',runRoot:path.join(f.root,'oracle')});
    assert.deepEqual(packed.artifact,JSON.parse(read(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json'))));
    assert.ok(reads.packed<=reads.legacy/2,JSON.stringify(reads));assert.ok(bytes.packed<=bytes.legacy*1.1,JSON.stringify(bytes));
    assert.equal(packed.r.metrics.projectionWork.packs.maxArchivePages,7);
    assert.throws(()=>finish({...f.opts,indexLayout:null}),/INDEX_CHECKPOINT_BINDING|JOB_BINDING_CHANGED/);
    t.diagnostic(JSON.stringify({reads,bytes,packWork:packed.r.metrics.projectionWork.packs,artifactExact:true}));
  }finally{dispose(f.root);}
});

for(const fault of ['MID_GROUP_STAGE','BEFORE_INDEX_FSYNC','AFTER_INDEX_FSYNC','BEFORE_INDEX_LINK','AFTER_INDEX_LINK','AFTER_INDEX_LINK_ORPHAN','ORPHAN_CHANGED','FOREIGN_LINK','BEFORE_JOB_REPLACE','AFTER_JOB_REPLACE','COLLISION_CHANGED']){
  test('packed recovery preserves complete cursor and exact results: '+fault,t=>{
    const f=fixture();const link=fs.linkSync,rename=fs.renameSync,read=fs.readFileSync,open=fs.openSync,sync=fs.fsyncSync,unlink=fs.unlinkSync;let injected=false,target=null,oldCursor=null,staging=null,groupReads=0;const indexFds=new Set();
    try{
      fs.openSync=(file,...args)=>{const fd=open(file,...args);if(typeof file==='string'&&path.basename(path.dirname(file))==='projection-index'&&args[0]==='wx')indexFds.add(fd);return fd;};
      fs.fsyncSync=fd=>{if(!injected&&indexFds.has(fd)&&['BEFORE_INDEX_FSYNC','AFTER_INDEX_FSYNC'].includes(fault)){oldCursor=JSON.parse(read(path.join(f.opts.runRoot,'job.json'))).value.nextIndex;injected=true;if(fault==='AFTER_INDEX_FSYNC')sync(fd);throw Error('PACK_TEST_FAULT');}return sync(fd);};
      fs.readFileSync=(file,...args)=>{if(!injected&&fault==='MID_GROUP_STAGE'&&typeof file==='string'&&path.basename(path.dirname(file))==='pages'){
        const job=JSON.parse(read(path.join(f.opts.runRoot,'job.json'))).value;
        if(job.phase==='PROJECT'&&++groupReads===2){oldCursor=job.nextIndex;injected=true;throw Error('PACK_TEST_FAULT');}
      }return read(file,...args);};
      // Preserve exactly the link pair that process termination would leave;
      // unrelated pipeline lock cleanup still runs in this focused fault test.
      fs.unlinkSync=file=>{if(injected&&file===staging&&['AFTER_INDEX_LINK_ORPHAN','ORPHAN_CHANGED','FOREIGN_LINK'].includes(fault))return;return unlink(file);};
      fs.linkSync=(from,to)=>{
        if(!injected&&path.basename(path.dirname(to))==='projection-index'){
          target=to;staging=from;oldCursor=JSON.parse(read(path.join(f.opts.runRoot,'job.json'))).value.nextIndex;
          if(fault==='BEFORE_INDEX_LINK'){injected=true;throw Error('PACK_TEST_FAULT');}
          const result=link(from,to);
          if(['AFTER_INDEX_LINK','AFTER_INDEX_LINK_ORPHAN','ORPHAN_CHANGED','FOREIGN_LINK','COLLISION_CHANGED'].includes(fault)){injected=true;throw Error('PACK_TEST_FAULT');}
          return result;
        }return link(from,to);
      };
      fs.renameSync=(from,to)=>{
        if(!injected&&target&&path.basename(to)==='job.json'){
          const next=JSON.parse(read(from)).value;
          if(next.nextIndex>oldCursor){injected=true;if(fault==='AFTER_JOB_REPLACE')rename(from,to);throw Error('PACK_TEST_FAULT');}
        }return rename(from,to);
      };
      assert.throws(()=>finish(f.opts),/PACK_TEST_FAULT/);assert.ok(injected);
      fs.linkSync=link;fs.renameSync=rename;fs.openSync=open;fs.fsyncSync=sync;fs.readFileSync=read;fs.unlinkSync=unlink;
      const job=JSON.parse(read(path.join(f.opts.runRoot,'job.json'))).value;
      assert.equal(job.nextIndex,fault==='AFTER_JOB_REPLACE'?oldCursor+7:oldCursor);
      assert.equal(fs.existsSync(path.join(f.opts.runRoot,'stream-public.json')),false);
      if(['AFTER_INDEX_LINK_ORPHAN','ORPHAN_CHANGED','FOREIGN_LINK'].includes(fault))assert.equal(fs.statSync(target).nlink,2);
      if(fault==='FOREIGN_LINK'){rename(staging,staging+'.foreign');assert.throws(()=>finish(f.opts),/FILE_INVALID/);return;}
      if(['COLLISION_CHANGED','ORPHAN_CHANGED'].includes(fault)){
        const node=JSON.parse(read(target));node.nodes[0].summary.acc.buy++;fs.writeFileSync(target,stableJson(node));
        assert.throws(()=>finish(f.opts),/IMMUTABLE_COLLISION/);return;
      }
      const actual=finish(f.opts),oracle=finish({...f.opts,indexLayout:null,projectionMode:'FULL_SCAN',runRoot:path.join(f.root,'oracle')});
      if(fault==='AFTER_INDEX_LINK_ORPHAN'){assert.equal(fs.statSync(target).nlink,1);assert.equal(fs.existsSync(staging),false);}
      assert.deepEqual(JSON.parse(read(path.join(f.opts.runRoot,actual.artifactHash+'.stream-view.json'))),JSON.parse(read(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json'))));
      t.diagnostic(JSON.stringify({fault,oldCursor,recoveredCursor:job.nextIndex,exact:true}));
    }finally{fs.linkSync=link;fs.renameSync=rename;fs.openSync=open;fs.fsyncSync=sync;fs.readFileSync=read;fs.unlinkSync=unlink;dispose(f.root);}
  });
}

test('uncommitted range nodes roll back at 2MiB without changing the retained forest',()=>{
  const files=new Map(),b=beginRangeAppend([],(h,p)=>files.set(h,p));
  const append=i=>{const e={eventMs:i,availableMs:i,identityStatus:'USABLE',availabilityLineageStatus:'USABLE',payload:{close:1,volume:1}},p={ledgerOrdinal:i,recordHash:'x'.repeat(180000),eventTime:'t',availableAt:'t',value:i,buyProxyVolume:i,sellProxyVolume:0,reason:null};b.append(e,p,null,{buyProxyVolume:1,sellProxyVolume:0,totalExecutedVolume:1,unknownVolume:0});};
  append(1);const mark=b.mark(),size=b.byteLength();append(2);append(3);
  assert.ok(b.byteLength()>INDEX_PACK_LIMITS.pageBytes);b.rollback(mark);assert.equal(b.byteLength(),size);
  const roots=b.finish();assert.equal(roots.length,1);assert.equal(roots[0].summary.count,1);assert.equal(files.size,1);
  const only=[...files.values()][0];assert.equal(digest(stableJson(only)),roots[0].ref.hash);
});

test('real process exit after pack link recovers through normal managed ownership', {skip:process.platform!=='win32'},()=>{
  const f=fixture(896);try{
    const binding={bindingHash:'a'.repeat(64),runtimeCommit:'b'.repeat(40),configPath:path.join(f.root,'config.json'),outputRoot:f.root};
    const child=`import fs from 'node:fs';import {runStreamCycle} from ${JSON.stringify(new URL('../src/cru55-stream-pipeline.mjs',import.meta.url).href)};import {probeManagedProcess} from ${JSON.stringify(new URL('../src/cru55-managed-owner.mjs',import.meta.url).href)};
      const opts=JSON.parse(process.argv[1]);opts.ownerContext={...JSON.parse(process.argv[2]),...probeManagedProcess(process.pid),nonce:'child'};
      const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(b.includes('projection-index'))process.exit(71);return r;};
      for(let i=0;i<100;i++)runStreamCycle(opts);process.exit(72);`;
    const exit=spawnSync(process.execPath,['--input-type=module','-e',child,JSON.stringify(f.opts),JSON.stringify(binding)],{encoding:'utf8',windowsHide:true,timeout:60000});
    assert.equal(exit.status,71,exit.stderr||exit.error?.message);
    const index=path.join(f.opts.runRoot,'projection-index'),pending=fs.readdirSync(index).find(n=>n.endsWith('.pack-pending'));assert.ok(pending);
    const target=path.join(index,pending.slice(0,-'.pack-pending'.length));assert.equal(fs.statSync(target).nlink,2);
    const old=JSON.parse(fs.readFileSync(path.join(f.opts.runRoot,'job.json'))).value;assert.equal(old.nextIndex,1);
    const ownerContext={...binding,...probeManagedProcess(process.pid),nonce:'parent'};
    const actual=finish({...f.opts,ownerContext}),oracle=finish({...f.opts,indexLayout:null,projectionMode:'FULL_SCAN',runRoot:path.join(f.root,'oracle')});
    assert.equal(fs.statSync(target).nlink,1);assert.ok(fs.readdirSync(path.join(f.root,'managed-retired-locks')).length);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.opts.runRoot,actual.artifactHash+'.stream-view.json'))),JSON.parse(fs.readFileSync(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json'))));
  }finally{dispose(f.root);}
});

test('dense archive groups split at the byte cap and keep exact full-scan output',t=>{
  const f=fixture(896,{dense:true});try{
    const actual=finish(f.opts),oracle=finish({...f.opts,indexLayout:null,projectionMode:'FULL_SCAN',runRoot:path.join(f.root,'oracle')});
    const packs=actual.metrics.projectionWork.packs;
    assert.ok(packs.groups>1);assert.ok(packs.maxArchivePages<7);
    for(const file of fs.readdirSync(path.join(f.opts.runRoot,'projection-index')))assert.ok(fs.statSync(path.join(f.opts.runRoot,'projection-index',file)).size<=INDEX_PACK_LIMITS.pageBytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.opts.runRoot,actual.artifactHash+'.stream-view.json'))),JSON.parse(fs.readFileSync(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json'))));
    t.diagnostic(JSON.stringify({dense:true,packs,exact:true}));
  }finally{dispose(f.root);}
});

test('one-page and minimal read-budget groups make progress without relaxing limits',()=>{
  for(const count of [17,270]){
    const f=fixture(count);try{
      const result=finish({...f.opts,maxPages:2});
      assert.equal(result.cutoff.ledgerOrdinal,count);assert.equal(result.metrics.projectionWork.packs.maxArchivePages,1);
      assert.throws(()=>runStreamCycle({...f.opts,indexLayout:'unknown'}),/INDEX_LAYOUT_INVALID/);
      assert.throws(()=>runStreamCycle({...f.opts,projectionMode:'FULL_SCAN'}),/REQUIRES_INDEXED/);
    }finally{dispose(f.root);}
  }
});
