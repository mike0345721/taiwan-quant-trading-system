import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyAcceptanceSweep } from '../src/daily-collection-acceptance-sweep.mjs';
const file = (date, bytes, records) => ({file: `${date}.ndjson`,cutoffBytes:bytes,physicalRecords:records,prefixSha256:'a'.repeat(64)});
function report(date, files) { return {schemaVersion:'daily-collection-acceptance-v1',tradeDate:date,generatedAt:'2026-09-12T12:00:00Z',sessions:['DAY','NIGHT'],summary:{},sourceArtifactIdentity:{files},feeds:[],safety:{formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}}; }
test('sweep deduplicates overlapping calendar ledgers and preserves physical scope / N', () => {
 const a=file('2026-09-08',100,10),b=file('2026-09-09',200,20),c=file('2026-09-10',600,60);
 const sweep=buildDailyAcceptanceSweep([report('2026-09-10',[b,c]),report('2026-09-09',[a,b])]);
 assert.equal(sweep.storageStatistics.N,3); assert.equal(sweep.storageStatistics.medianDailyRawBytes,200);
 assert.equal(sweep.storageStatistics.p95DailyRawBytes,600); assert.equal(sweep.storageStatistics.medianRecords,20);
 assert.equal(sweep.storageStatistics.forecast,'NOT_VERIFIED');
 assert.deepEqual(sweep,buildDailyAcceptanceSweep([report('2026-09-09',[a,b]),report('2026-09-10',[b,c])]));
});
test('conflicting physical cutoff or duplicate date fails closed',()=>{
 assert.throws(()=>buildDailyAcceptanceSweep([report('2026-09-09',[file('2026-09-09',1,1)]),report('2026-09-10',[file('2026-09-09',2,2)])]),/CONFLICTING/);
 assert.throws(()=>buildDailyAcceptanceSweep([report('2026-09-09',[]),report('2026-09-09',[])]),/DUPLICATE/);
});
test('empty/missing storage stays null; missing record count has its own N',()=>{
 const empty=buildDailyAcceptanceSweep([report('2026-09-12',[])]).storageStatistics;
 assert.equal(empty.N,0); assert.equal(empty.medianDailyRawBytes,null); assert.equal(empty.p95Records,null);
 const f=file('2026-09-09',8,undefined),s=buildDailyAcceptanceSweep([report('2026-09-09',[f])]).storageStatistics;
 assert.equal(s.N,1);assert.equal(s.recordSampleCount,0);assert.equal(s.medianRecords,null);
});
test('evidence gap rows retain nonfailure reasons and canonical ID absence',()=>{
 const r=report('2026-09-09',[]);r.feeds=[{datasetId:null,technicalLabelEn:'MTX Tick',session:'DAY',expectedState:'UNKNOWN',captureState:'PASS',persistenceState:'PASS',integrityState:'UNKNOWN',researchEligibility:'UNKNOWN',reasonCodes:['CANONICAL_DATASET_ID_UNAVAILABLE','NATIVE_SEQUENCE_UNAVAILABLE'],reasonZh:['缺少身分','無原生序號']}];
 const row=buildDailyAcceptanceSweep([r]).evidenceGapMatrix[0].rows[0];assert.deepEqual(row.categories,['CANONICAL_ID_MISSING','NATIVE_SEQUENCE_UNAVAILABLE']);assert.equal(row.captureState,'PASS');
});
