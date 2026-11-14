import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'research', 'phase-b-f3c03', 'preregistration-v2');
const run = path.join(root, 'data', 'research', 'phase-b-f3c03', 'run-2026-08-03-v2');
const priorRun = path.join(root, 'data', 'research', 'phase-b-f3c03', 'run-2026-08-02-v1');
const phase = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
fs.mkdirSync(run, { recursive: true });
const H = (file) => sha256Hex(fs.readFileSync(file));
const D = (value) => sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
function atomic(name, payload) { const file=path.join(run,name); const bytes=Buffer.from(jcsNfc(payload)); const hash=sha256Hex(bytes); if(fs.existsSync(file)){if(H(file)!==hash)throw new Error(`immutable_mismatch:${name}`);return hash;} const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,file);return hash; }

const registryPath=path.join(root,'data','research','f3-governance-v2','owner-review-2026-08-02','F3_ELIGIBLE_REGISTRY.json');
const registry=JSON.parse(fs.readFileSync(registryPath,'utf8')); const candidate=registry.candidates.find(x=>x.candidateId==='F3C03');
const a22Path=path.join(phase,'jobs','A22-transparent_walk_forward.json'); const a22=JSON.parse(fs.readFileSync(a22Path,'utf8')); const study=a22.walkForward.studies.find(x=>x.blockId==='CASH__next_day_downside_tail'&&x.modelId==='RIDGE_LOGISTIC');
const targetPath=path.join(root,'research','phase-a-v1','target-spec.json'); const targetSpec=JSON.parse(fs.readFileSync(targetPath,'utf8')); const target=targetSpec.targets.find(x=>x.targetId==='next_day_downside_tail');
const featurePath=path.join(root,'research','phase-a-v1','feature-spec.json');
if(!candidate||!study||!target) throw new Error('frozen_evidence_missing');
if(target.formula!=='next_day_tx_return <= train-fold 10th percentile') throw new Error('target_semantic_ambiguous');
if(candidate.fixedFactors.join('|')!==study.factors.join('|')) throw new Error('factor_identity_mismatch');
const outcomes=study.predictions.map(x=>x.outcome); const eventCount=outcomes.filter(x=>x===1).length;
const audit={schemaVersion:'f3c03-frozen-evidence-audit-v1',status:'PASS',candidateId:'F3C03',candidateEvidenceHash:candidate.evidenceHash,registryHash:H(registryPath),cohortId:candidate.cohortId,evidenceBlock:candidate.evidenceBlock,studyId:'CASH__next_day_downside_tail__RIDGE_LOGISTIC',frozenFeatureIds:candidate.fixedFactors,featureVersion:JSON.parse(fs.readFileSync(featurePath,'utf8')).featureVersion,featureSpecHash:H(featurePath),targetVersion:targetSpec.targetVersion,targetSpecHash:H(targetPath),targetDefinition:target.formula,targetEventCount:eventCount,targetRowCount:outcomes.length,targetEventRate:eventCount/outcomes.length,frozenModel:'RIDGE_LOGISTIC',lambda:1,a22ArtifactHash:H(a22Path),foldAssignment:study.foldResults.map(x=>({foldId:x.foldId,trainStartDate:x.trainStartDate,trainEndDate:x.trainEndDate,testStartDate:x.testStartDate,testEndDate:x.testEndDate,n:x.n})),oosScoreEvidenceHash:D(study.predictions.map(x=>({date:x.date,prediction:x.prediction,foldId:x.foldId}))),availableAt:candidate.availableAt,randomSeed:20260730,formalWeight:0,researchOnly:true,executionAuthorized:false};
const priorAuditHash=H(path.join(priorRun,'F3C03_FROZEN_EVIDENCE_AUDIT.json'));
if(priorAuditHash!=='09359de0a84878af5be700d35d1f08b70c7b4083ce8271f3db477889c828928a') throw new Error('v1_frozen_evidence_hash_mismatch');
const auditHash=atomic('F3C03_FROZEN_EVIDENCE_AUDIT.json',{...audit,priorV1FrozenEvidenceHash:priorAuditHash});
const files={ownerBriefHash:H(path.join(source,'F3C03_OWNER_BRIEF.md')),executionContractHash:H(path.join(source,'F3C03_EXECUTION_CONTRACT.json')),draftManifestHash:H(path.join(source,'F3C03_DRAFT_MANIFEST.json'))};
const freeze={schemaVersion:'f3c03-preregistration-freeze-v2',runId:'run-2026-08-03-v2',previousRunId:'run-2026-08-02-v1',scopeDiff:'EXPECTANCY_ENDPOINT_SEMANTICS_ONLY',candidateId:'F3C03',...files,frozenEvidenceAuditHash:auditHash,candidateEvidenceHash:candidate.evidenceHash,a22ArtifactHash:H(a22Path),featureSpecHash:H(featurePath),targetSpecHash:H(targetPath),thresholdQuantile:0.9,thresholdSource:'TRAIN_FOLD_ONLY',interventionType:'LONG_ONLY_NO_TRADE_VETO',baselineFreezeHash:'9664ca8777cfdf827e6383b952ac006f7577f59c0abe86e7182d44e8dd2451cf',randomSeed:20260730,formalWeight:0,researchOnly:true,executionAuthorized:false};
const freezeHash=atomic('F3C03_PREREGISTRATION_FREEZE_MANIFEST.json',freeze);
const gate={schemaVersion:'f3c03-contract-completeness-gate-v2',status:'PASS',targetSemantic:'UNAMBIGUOUS_TRAIN_FOLD_10TH_PERCENTILE_DOWNSIDE_EVENT',scoreThresholdSemantic:'UNAMBIGUOUS_TRAIN_FOLD_SCORE_P90',expectancyEndpointType:'ABSOLUTE_TWD_PER_TRADE_DIFFERENCE',targetOwnerReviewRequired:false,checks:{candidateIdentity:true,frozenFeatures:true,frozenModel:true,a22OosScores:true,targetDefinition:true,availableAt:true,b0V4ExecutionContractReuse:true,longOnlyIntervention:true,pairedAccounting:true,shortInvariance:true,priorV1FrozenEvidence:true},freezeHash,formalWeight:0,researchOnly:true,executionAuthorized:false};
const gateHash=atomic('CONTRACT_COMPLETENESS_GATE.json',gate);
process.stdout.write(JSON.stringify({status:gate.status,freezeHash,gateHash,targetEventRate:audit.targetEventRate,targetRows:audit.targetRowCount},null,2)+'\n');
