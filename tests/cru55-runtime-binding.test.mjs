import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateRuntimeBinding } from '../src/cru55-runtime-binding.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
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
