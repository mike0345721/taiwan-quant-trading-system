import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateRuntimeBinding } from '../src/cru55-runtime-binding.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
import { CATCHUP_PUBLICATION_SCHEDULE } from '../src/cru55-publication-schedule.mjs';

test('publication scheduling is explicit and requires a new versioned stream binding',()=>{
  const root=path.resolve('candidate'),data=path.join(root,'data'),head='a'.repeat(40),output=path.join(data,'cru55-runtime/output/stream-prefix-v1');
  const b={schemaVersion:'cru55-runtime-binding-v1',state:'PROPOSED',runtimeRoot:root,runtimeCommit:head,dataRoot:data,sourceRoot:path.join(data,'live-events'),outputRoot:output,readerRoot:output,outputVersion:'stream-prefix-v1',producer:'STREAM_PAGED_V2',sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',sourceAlias:{kind:'PLAIN',physicalRoot:path.join(data,'live-events'),targetIdentity:{dev:'1',ino:'2',birthtimeNs:'3'}},sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-24'},...SAFETY};
  const opts={runtimeRoot:root,head};
  assert.equal(validateRuntimeBinding(b,opts).publicationSchedule,null);
  assert.equal(validateRuntimeBinding(b,opts).indexLayout,null);
  assert.equal(validateRuntimeBinding({...b,indexLayout:'DERIVED_INDEX_PACK_V1'},opts).indexLayout,'DERIVED_INDEX_PACK_V1');
  assert.throws(()=>validateRuntimeBinding({...b,indexLayout:'unknown'},opts),/INDEX_LAYOUT_INVALID/);
  assert.throws(()=>validateRuntimeBinding({...b,indexLayout:'DERIVED_INDEX_PACK_V1'},{...opts,activation:true}),/OWNER_MAIN_GATE/);
  assert.deepEqual(validateRuntimeBinding({...b,publicationSchedule:CATCHUP_PUBLICATION_SCHEDULE},opts).publicationSchedule,CATCHUP_PUBLICATION_SCHEDULE);
  assert.throws(()=>validateRuntimeBinding({...b,publicationSchedule:{version:'unknown',maxRecords:32768}},opts),/SCHEDULE_INVALID/);
  const legacy={...b,producer:'BOUNDED_ACCEPTED_V1',sourceVerification:'FULL_PREFIX_EACH_BATCH',outputVersion:undefined,outputRoot:path.join(data,'runtime/cru55-overview'),readerRoot:path.join(data,'runtime/cru55-overview'),publicationSchedule:CATCHUP_PUBLICATION_SCHEDULE};
  assert.throws(()=>validateRuntimeBinding(legacy,opts),/SCHEDULE_REQUIRES_VERSIONED_STREAM/);
  assert.throws(()=>validateRuntimeBinding({...legacy,publicationSchedule:null,indexLayout:'DERIVED_INDEX_PACK_V1'},opts),/INDEX_LAYOUT_REQUIRES_VERSIONED_STREAM/);
  assert.throws(()=>validateRuntimeBinding({...b,publicationSchedule:CATCHUP_PUBLICATION_SCHEDULE},{...opts,activation:true}),/OWNER_MAIN_GATE/);
});
test('persistent binding proposal binds exact whole version, source, producer and reader without activating',()=>{
  const root=path.resolve('candidate'),data=path.join(root,'data'),head='a'.repeat(40);
  const b={schemaVersion:'cru55-runtime-binding-v1',state:'PROPOSED',runtimeRoot:root,runtimeCommit:head,dataRoot:data,
    sourceRoot:path.join(data,'live-events'),outputRoot:path.join(data,'runtime','cru55-overview'),
    readerRoot:path.join(data,'runtime','cru55-overview'),sourceVerification:'FULL_PREFIX_EACH_BATCH',producer:'BOUNDED_ACCEPTED_V1',...SAFETY};
  const options={runtimeRoot:root,head,approvedMain:'b'.repeat(40)};
  const plan=validateRuntimeBinding(JSON.parse(JSON.stringify(b)),options);
  assert.equal(plan.activationReady,false);assert.equal(plan.fullDayReady,false);
  assert.throws(()=>validateRuntimeBinding(b,{...options,activation:true}),/OWNER_MAIN_GATE/);
  assert.throws(()=>validateRuntimeBinding({...b,readerRoot:root},options),/READER_WRITER/);
  assert.throws(()=>validateRuntimeBinding(b,{...options,head:'b'.repeat(40)}),/HEAD_MISMATCH/);
  assert.throws(()=>validateRuntimeBinding({...b,sourceVerification:'ASSUME_APPEND_ONLY'},options),/UNREVIEWED_PRODUCER/);
  const approved={...b,state:'OWNER_APPROVED',ownerDecisionUrl:'https://github.com/owner/repo/pull/71#approved'};
  assert.equal(validateRuntimeBinding(approved,{...options,approvedMain:head,activation:true}).activationReady,true);
});
