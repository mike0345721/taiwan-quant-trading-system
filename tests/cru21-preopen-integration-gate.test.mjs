import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadOperatingCalendar} from '../src/operating-calendar.mjs';
import {buildCru21PreviewVersion,validateCru21PreviewVersionTruth}
  from '../src/cru21-preview-contract.mjs';
import {CRU21_EVIDENCE_HOME_PRODUCT_SURFACE,selectDashboardProductSurface}
  from '../src/dashboard-integration-contract.mjs';
import {evaluatePreopenCandidate,PREOPEN_BASE_MAIN,PREOPEN_BASE_PR94,PREOPEN_BRANCH}
  from '../scripts/check-cru21-preopen-readonly.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const calendar=loadOperatingCalendar(path.join(root,'config','taifex-official-calendar-2026.json'),
  {allowCandidate:true,dataRoot:path.join(root,'data')});
const head='1'.repeat(40);
const base={head,expectedHead:head,branch:PREOPEN_BRANCH,clean:true,
  approvedMainAncestor:true,reviewedBaseAncestor:true,calendar};

test('exact isolated pre-open source gate can pass WITHOUT claiming live-data or merge',()=>{
  const x=evaluatePreopenCandidate(base);
  assert.equal(x.state,'PREOPEN_SOURCE_GATES_PASSED_ONLY');
  assert.deepEqual(x.blockers,[]);
  assert.equal(x.calendar.typhoonClosed,true);
  assert.equal(x.calendar.date20261026Closed,true);
  assert.equal(x.calendar.date20261027ExpectedDay,true);
  assert.match(x.calendar.closureEvidenceHash,/^[a-f0-9]{64}$/);
  assert.equal(x.openMarketTickBidAskVerified,false);
  assert.equal(x.liveFlowAndChartParityVerified,false);
  assert.equal(x.normalAuthenticatedOwnerAccepted,false);
  assert.equal(x.independentExactHeadReviewVerified,false);
  assert.equal(x.fullCiThisExactHeadVerified,false);
  assert.equal(x.mergeAuthorized,false);assert.equal(x.productionDeployed,false);
  assert.equal(x.brokerLogins,0);assert.equal(x.modelRequests,0);assert.equal(x.orders,0);
  assert.equal(x.safety.executionAuthorized,false);assert.equal(x.safety.orderRoutesEnabled,false);
  assert.equal(x.base.approvedMain,PREOPEN_BASE_MAIN);
  assert.equal(x.base.reviewedP0,PREOPEN_BASE_PR94);
});
test('wrong head, branch, ancestors and dirty tree independently block the pre-open gate',()=>{
  const cases=[
    {expectedHead:'2'.repeat(40)},
    {head:'not-a-sha'},
    {branch:'main'},
    {branch:PREOPEN_BRANCH+'-lookalike'},
    {clean:false},
    {approvedMainAncestor:false},
    {reviewedBaseAncestor:false},
  ];
  for(const c of cases){
    const x=evaluatePreopenCandidate({...base,...c});
    assert.equal(x.state,'BLOCKED',JSON.stringify(c));
    assert.ok(x.blockers.length>0);
    assert.equal(x.mergeAuthorized,false);
  }
});
test('candidate cannot enable a normal-auth preview on formal/public port or in mock mode',()=>{
  const runtimeVersion={runtimeCommit:head,approvedMainCommit:PREOPEN_BASE_MAIN,syncState:'MISMATCH'};
  const version=buildCru21PreviewVersion({runtimeVersion,branch:PREOPEN_BRANCH,dataMode:'LIVE'});
  const valid={expectedHead:head,expectedBaseMain:PREOPEN_BASE_MAIN,actualBranch:PREOPEN_BRANCH,
    sourceClean:true,host:'127.0.0.1',port:18722,inlineEnabled:true,candidateReadRoot:path.join(root,'data'),
    actualDataMode:'LIVE'};
  assert.equal(validateCru21PreviewVersionTruth(version,valid).ready,true);
  for(const change of [{port:8787},{host:'0.0.0.0'},{actualDataMode:'MOCK'},
      {sourceClean:false},{candidateReadRoot:null},{actualBranch:'main'},
      {actualBranch:PREOPEN_BRANCH+'-other'}]){
    assert.equal(validateCru21PreviewVersionTruth(version,{...valid,...change}).ready,false,JSON.stringify(change));
  }
  assert.equal(selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:PREOPEN_BRANCH}),
    CRU21_EVIDENCE_HOME_PRODUCT_SURFACE);
  assert.equal(CRU21_EVIDENCE_HOME_PRODUCT_SURFACE.deliveryAccepted,false);
  assert.equal(selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:'main'}).schemaVersion,
    'cru46-dashboard-product-surface-v1');
});
test('unapproved closure or unknown calendar cannot become pre-open source PASS',()=>{
  const notApproved=loadOperatingCalendar(path.join(root,'config','taifex-official-calendar-2026.json'),
    {allowCandidate:false,dataRoot:path.join(root,'data')});
  const result=evaluatePreopenCandidate({...base,calendar:notApproved});
  assert.equal(result.state,'BLOCKED');
  assert.ok(result.blockers.includes('TYPHOON_EMERGENCY_CLOSURE_UNVERIFIED'));
  const missing=evaluatePreopenCandidate({...base,calendar:null});
  assert.equal(missing.state,'BLOCKED');
  assert.ok(missing.blockers.length>0);
});
