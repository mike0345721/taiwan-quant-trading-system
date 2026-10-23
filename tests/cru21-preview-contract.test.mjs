import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCru21PreviewVersion, validateCru21PreviewVersionTruth } from '../src/cru21-preview-contract.mjs';
const head='1'.repeat(40), base='2'.repeat(40), branch='codex/cru21-chatgpt-plan-preflight-v1';
const version=buildCru21PreviewVersion({runtimeVersion:{runtimeCommit:head,approvedMainCommit:base,syncState:'MISMATCH'},branch,dataMode:'LIVE'});
const options={expectedHead:head,expectedBaseMain:base,actualBranch:branch,sourceClean:true,host:'127.0.0.1',port:18722,inlineEnabled:true,candidateReadRoot:'governed-data',actualDataMode:'LIVE'};
test('unmerged exact candidate identity may be valid without claiming accepted or synced',()=>{
 assert.equal(validateCru21PreviewVersionTruth(version,options).ready,true);
 assert.equal(version.syncState,'MISMATCH');assert.equal(version.approvedMainCommit,base);assert.equal(version.complete,false);
});
test('candidate identity rejects wrong/missing head, base, branch and dirty source',()=>{
 for(const override of [{expectedHead:null},{expectedHead:base},{expectedBaseMain:head},{actualBranch:'main'},{sourceClean:false},{actualDataMode:'MOCK'},{actualDataMode:null}])assert.equal(validateCru21PreviewVersionTruth(version,{...options,...override}).ready,false);
 for(const override of [{runtimeCommit:base},{buildCommit:base},{exactHead:base},{approvedMainCommit:head},{baseMainCommit:head},{branch:'main'},{previewType:'INTEGRATION_OWNER_PREVIEW'},{dataMode:'MOCK'},{complete:true}])assert.equal(validateCru21PreviewVersionTruth({...version,...override},options).ready,false);
});
test('candidate identity cannot be used for formal or network-exposed startup',()=>{
 for(const override of [{host:'0.0.0.0'},{port:8787},{port:8790},{port:8791},{port:18723},{inlineEnabled:false},{candidateReadRoot:null}])assert.equal(validateCru21PreviewVersionTruth(version,{...options,...override}).ready,false);
});

test('unified release preview accepts its real branch with the same exact-source boundaries',()=>{
 const unified='codex/cru21-unified-release-20261014';
 const unifiedVersion=buildCru21PreviewVersion({runtimeVersion:{runtimeCommit:head,approvedMainCommit:base,syncState:'MISMATCH'},branch:unified,dataMode:'LIVE'});
 const unifiedOptions={...options,actualBranch:unified};
 assert.equal(validateCru21PreviewVersionTruth(unifiedVersion,unifiedOptions).ready,true);
 assert.equal(unifiedVersion.complete,false);assert.equal(unifiedVersion.syncState,'MISMATCH');
 for(const override of [{expectedHead:base},{expectedBaseMain:head},{sourceClean:false},{port:8787},{port:18723},{host:'0.0.0.0'},{inlineEnabled:false},{candidateReadRoot:null},{actualDataMode:'MOCK'}])assert.equal(validateCru21PreviewVersionTruth(unifiedVersion,{...unifiedOptions,...override}).ready,false);
});

test('unified preview cannot substitute a declared branch or admit an unrelated release branch',()=>{
 const unified='codex/cru21-unified-release-20261014';
 for(const [declared,actual] of [[branch,unified],[unified,branch],['codex/unrelated','codex/unrelated'],['codex/cru21-unified-release-20990101','codex/cru21-unified-release-20990101']]){
  const result=validateCru21PreviewVersionTruth({...version,branch:declared},{...options,actualBranch:actual});
  assert.equal(result.ready,false);assert.ok(result.reasons.includes('CRU21_BRANCH_MISMATCH'));
 }
});

test('PR87 P0 candidate accepts only its real branch with all existing identity and isolation gates',()=>{
 const p0='codex/cru21-decision-quality-p0-20261016';
 const p0Version=buildCru21PreviewVersion({runtimeVersion:{runtimeCommit:head,approvedMainCommit:base,syncState:'MISMATCH'},branch:p0,dataMode:'LIVE'});
 const p0Options={...options,actualBranch:p0};
 assert.equal(validateCru21PreviewVersionTruth(p0Version,p0Options).ready,true);
 assert.equal(p0Version.complete,false);
 assert.equal(p0Version.syncState,'MISMATCH');
 for(const override of [{expectedHead:null},{expectedHead:base},{expectedBaseMain:null},{expectedBaseMain:head},
  {sourceClean:false},{host:'0.0.0.0'},{host:'localhost'},{port:8787},{port:8790},{port:8791},{port:18723},
  {inlineEnabled:false},{candidateReadRoot:null},{actualDataMode:'MOCK'},{actualDataMode:null}]){
  assert.equal(validateCru21PreviewVersionTruth(p0Version,{...p0Options,...override}).ready,false,JSON.stringify(override));
 }
 for(const override of [{runtimeCommit:base},{buildCommit:base},{exactHead:base},{approvedMainCommit:head},
  {baseMainCommit:head},{complete:true},{dataMode:'MOCK'},{previewType:'INTEGRATION_OWNER_PREVIEW'}]){
  assert.equal(validateCru21PreviewVersionTruth({...p0Version,...override},p0Options).ready,false,JSON.stringify(override));
 }
 for(const [declared,actual] of [[p0,branch],[branch,p0],[p0,'main'],[p0,p0+'-other'],
  [p0+'-other',p0+'-other'],['codex/cru21-decision-quality-p0-20990101','codex/cru21-decision-quality-p0-20990101']]){
  const result=validateCru21PreviewVersionTruth({...p0Version,branch:declared},{...p0Options,actualBranch:actual});
  assert.equal(result.ready,false);assert.ok(result.reasons.includes('CRU21_BRANCH_MISMATCH'));
 }
});

for(const b of ['codex/cru21-ui-auth-acceptance-20261023','codex/cru21-emergency-market-calendar-qa-20261023','codex/cru21-preopen-integrated-candidate-20261023'])
test(`UI P1 exact-head candidate preserves original isolation boundaries: ${b}`,()=>{
 const v=buildCru21PreviewVersion({runtimeVersion:{runtimeCommit:head,approvedMainCommit:base,syncState:'MISMATCH'},branch:b,dataMode:'LIVE'});
 const o={...options,actualBranch:b};
 assert.equal(validateCru21PreviewVersionTruth(v,o).ready,true);
 assert.equal(v.complete,false);
 for(const override of [{host:'0.0.0.0'},{host:'localhost'},{port:8787},{port:8790},{port:18723},
   {inlineEnabled:false},{candidateReadRoot:null},{expectedHead:base},{expectedBaseMain:head},{sourceClean:false},{actualDataMode:'MOCK'}]){
    assert.equal(validateCru21PreviewVersionTruth(v,{...o,...override}).ready,false,JSON.stringify(override));
 }
 for(const [declared,actual] of [[b,'main'],[b,b+'-lookalike'],[b,'codex/cru21-ui-clarity-p1-20261022'],
   ['codex/cru21-ui-clarity-p1-20261022','codex/cru21-ui-clarity-p1-20261022']]){
    const bad=validateCru21PreviewVersionTruth({...v,branch:declared},{...o,actualBranch:actual});
    assert.equal(bad.ready,false);assert.ok(bad.reasons.includes('CRU21_BRANCH_MISMATCH'));
 }
 for(const override of [{runtimeCommit:base},{buildCommit:base},{exactHead:base},{approvedMainCommit:head},
  {baseMainCommit:head},{complete:true},{dataMode:'MOCK'},{previewType:'INTEGRATION_OWNER_PREVIEW'}])
    assert.equal(validateCru21PreviewVersionTruth({...v,...override},o).ready,false,JSON.stringify(override));
});
