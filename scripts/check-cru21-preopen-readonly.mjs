// P0 product pre-open gate: read-only local source/identity/calendar evidence.
// No market login, network, file writes, scheduler changes, paid model, or orders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadOperatingCalendar} from '../src/operating-calendar.mjs';
import {assessTaifexMarketSession} from '../src/taifex-market-operation.mjs';
import {buildCru21PreviewVersion,validateCru21PreviewVersionTruth}
  from '../src/cru21-preview-contract.mjs';
import {CRU21_EVIDENCE_HOME_PRODUCT_SURFACE,selectDashboardProductSurface}
  from '../src/dashboard-integration-contract.mjs';

export const PREOPEN_BASE_MAIN='4d8251686bdb4abbdb469bc00ae798717c0fd583';
export const PREOPEN_BASE_PR94='c7cf3e77f543cbeda85fca5270d8a4ade1130472';
export const PREOPEN_BRANCH='codex/cru21-preopen-integrated-candidate-20261023';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha=/^[a-f0-9]{40}$/;
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function evaluatePreopenCandidate({
  head, expectedHead, branch, clean, approvedMainAncestor, reviewedBaseAncestor,calendar,
}={}){
  const blockers=[];
  if(!sha.test(head||'')||head!==expectedHead)blockers.push('EXACT_SOURCE_HEAD_MISMATCH');
  if(branch!==PREOPEN_BRANCH)blockers.push('ISOLATED_BRANCH_NOT_VERIFIED');
  if(!clean)blockers.push('WORKTREE_NOT_CLEAN');
  if(!approvedMainAncestor)blockers.push('APPROVED_MAIN_NOT_ANCESTOR');
  if(!reviewedBaseAncestor)blockers.push('PR94_BASE_NOT_ANCESTOR');
  let closure=null,holiday=null,reopen=null;
  try{
    closure=assessTaifexMarketSession(new Date('2026-10-23T09:30:00+08:00'),calendar);
    holiday=assessTaifexMarketSession(new Date('2026-10-26T09:30:00+08:00'),calendar);
    reopen=assessTaifexMarketSession(new Date('2026-10-27T09:00:00+08:00'),calendar);
    if(closure.state!=='MARKET_CLOSED'||closure.reasonCode!=='EXCHANGE_EMERGENCY_CLOSURE'
       ||closure.marketShouldBeActive!==false||!closure.evidenceFileHash)
      blockers.push('TYPHOON_EMERGENCY_CLOSURE_UNVERIFIED');
    if(holiday.state!=='MARKET_CLOSED'||holiday.marketShouldBeActive!==false)
      blockers.push('HOLIDAY_CALENDAR_UNVERIFIED');
    if(reopen.state!=='DAY'||reopen.marketShouldBeActive!==true)
      blockers.push('NEXT_PLANNED_DAY_SESSION_UNVERIFIED');
  }catch{blockers.push('OPERATING_CALENDAR_UNVERIFIED');}
  const v=buildCru21PreviewVersion({
    runtimeVersion:{runtimeCommit:head,approvedMainCommit:PREOPEN_BASE_MAIN,syncState:'MISMATCH'},
    branch,dataMode:'LIVE',
  });
  const identity=validateCru21PreviewVersionTruth(v,{
    expectedHead,expectedBaseMain:PREOPEN_BASE_MAIN,actualBranch:branch,sourceClean:clean,
    host:'127.0.0.1',port:18722,inlineEnabled:true,
    candidateReadRoot:path.join(root,'data'),actualDataMode:'LIVE',
  });
  if(!identity.ready)blockers.push(...identity.reasons);
  const surface=selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:branch});
  if(surface!==CRU21_EVIDENCE_HOME_PRODUCT_SURFACE||surface.deliveryAccepted!==false
     ||surface.safety?.executionAuthorized!==false||surface.safety?.orderRoutesEnabled!==false
     ||surface.safety?.formalWeight!==0||surface.dataQualificationDeclared!==false)
    blockers.push('PRODUCT_SURFACE_OR_EXECUTION_SAFETY_UNVERIFIED');
  return Object.freeze({
    schemaVersion:'cru21-preopen-candidate-gate-v1',
    state:blockers.length?'BLOCKED':'PREOPEN_SOURCE_GATES_PASSED_ONLY',
    base:{approvedMain:PREOPEN_BASE_MAIN,reviewedP0:PREOPEN_BASE_PR94},
    source:{head:sha.test(head||'')?head:null,expectedHead,branch,clean:Boolean(clean),
      approvedMainAncestor:Boolean(approvedMainAncestor),reviewedBaseAncestor:Boolean(reviewedBaseAncestor)},
    calendar:{typhoonClosed:closure?.state==='MARKET_CLOSED',date20261026Closed:holiday?.state==='MARKET_CLOSED',
      date20261027ExpectedDay:reopen?.state==='DAY',
      closureEvidenceHash:closure?.evidenceFileHash||null,
      reopenRequiresNewOfficialNoticeCheck:true},
    previewIdentityPassed:identity.ready,
    safety:{researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false},
    openMarketTickBidAskVerified:false,normalAuthenticatedOwnerAccepted:false,
    liveFlowAndChartParityVerified:false,fullCiThisExactHeadVerified:false,
    independentExactHeadReviewVerified:false,productionDeployed:false,
    mergeAuthorized:false,actionsTaken:[],brokerLogins:0,modelRequests:0,orders:0,
    blockers:Object.freeze(blockers),
  });
}

function git(args){
  const run=spawnSync('git',args,{cwd:root,encoding:'utf8',timeout:12000,windowsHide:true});
  if(run.status!==0||run.error)throw Error('GIT_READ_FAILED:'+args[0]);
  return String(run.stdout||'').trim();
}
function isAncestor(commit,head){
  const run=spawnSync('git',['merge-base','--is-ancestor',commit,head],
    {cwd:root,timeout:12000,windowsHide:true});
  return run.status===0;
}
function run(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--expected-head'||!sha.test(args[1]))
    throw Error('USAGE: node scripts/check-cru21-preopen-readonly.mjs --expected-head <40-hex-sha>');
  const head=git(['rev-parse','HEAD']);
  const branch=git(['symbolic-ref','--short','HEAD']);
  const clean=!git(['status','--porcelain']);
  const calendar=loadOperatingCalendar(path.join(root,'config','taifex-official-calendar-2026.json'),
    {allowCandidate:true,dataRoot:path.join(root,'data')});
  const report=evaluatePreopenCandidate({head,expectedHead:args[1],branch,clean,
    approvedMainAncestor:isAncestor(PREOPEN_BASE_MAIN,head),
    reviewedBaseAncestor:isAncestor(PREOPEN_BASE_PR94,head),calendar});
  const sourceFingerprints=Object.fromEntries([
    'server.mjs','public/home-workspace.js','public/home-workspace.css',
    'src/cru21-preview-contract.mjs','src/operating-calendar.mjs',
    'src/dashboard-integration-contract.mjs'
  ].map(f=>[f,sha256(fs.readFileSync(path.join(root,f)))]));
  console.log(JSON.stringify({...report,sourceFingerprints},null,2));
  if(report.state!=='PREOPEN_SOURCE_GATES_PASSED_ONLY')process.exitCode=2;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{run();}
  catch(e){
    console.error('CRU21_PREOPEN_GATE_ERROR:'+String(e?.message||e));
    process.exitCode=2;
  }
}
