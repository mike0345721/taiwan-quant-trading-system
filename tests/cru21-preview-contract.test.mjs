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
