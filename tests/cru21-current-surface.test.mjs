import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as contracts from '../src/dashboard-integration-contract.mjs';
const branch='codex/cru21-decision-quality-p0-20261016';
test('current evidence home describes six independent rolling windows without changing frozen surfaces',()=>{
 assert.equal(typeof contracts.selectDashboardProductSurface,'function');
 const v=contracts.selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:branch});
 assert.equal(v.schemaVersion,'cru21-evidence-home-product-surface-v1');
 assert.deepEqual(v.observedFlow.governed,['1m','5m','15m','30m','1h','4h']);
 assert.deepEqual(v.observedFlow.pending,['tradingDay']);
 assert.equal(v.observedFlow.synchronizedWithChart,false);
 assert.equal(v.observedFlow.comparisonScope,'ROLLING_TIME_WINDOW');
 assert.equal(v.failClosed.rvol,'COMPLETED_5M_SOURCE_AND_BASELINE_GATED');
 assert.equal(v.dataQualificationDeclared,false);assert.equal(v.deliveryAccepted,false);
 assert.deepEqual(v.safety,contracts.CRU46_PRODUCT_SURFACE_CONTRACT.safety);
 assert.deepEqual(contracts.CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.governed,['1m','5m']);
 assert.equal(contracts.CRU46_PRODUCT_SURFACE_CONTRACT.observedFlow.synchronizedWithChart,true);
 assert.equal(contracts.CRU44_PRODUCT_SURFACE_CONTRACT.observedFlow.synchronizedWithChart,true);
 assert.ok(Object.isFrozen(v)&&Object.isFrozen(v.observedFlow)&&Object.isFrozen(v.failClosed));
 assert.throws(()=>{v.observedFlow.governed.push('synthetic');});
});
test('current candidate metadata cannot activate on formal, older preview or lookalike branches',()=>{
 assert.equal(typeof contracts.selectDashboardProductSurface,'function');
 for(const x of [{},{previewType:'CRU21_OWNER_PREVIEW',actualBranch:'main'},{previewType:'CRU21_OWNER_PREVIEW',actualBranch:branch+'-other'},{previewType:'INTEGRATION_OWNER_PREVIEW',actualBranch:branch}])assert.equal(contracts.selectDashboardProductSurface(x),contracts.CRU46_PRODUCT_SURFACE_CONTRACT);
 assert.equal(contracts.selectDashboardProductSurface({previewType:'CRU44_OWNER_PREVIEW'}),contracts.CRU44_PRODUCT_SURFACE_CONTRACT);
});
test('server publishes one selected contract to health, workspace and discussion without changing readiness or auth',()=>{
 const s=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(s,/const productSurfaceContract = selectDashboardProductSurface\(/);
 assert.match(s,/actualBranch: cru21IdentityOptions\?\.actualBranch/);
 assert.ok((s.match(/productSurface: productSurfaceContract/g)||[]).length>=4);
 assert.match(s,/validateCru21PreviewVersionTruth\(runtimeVersion, cru21IdentityOptions\)/);
 assert.match(s,/if \(!requireCsrf\(req, res, session\)\) return/);
});

test('UI P1 normal authenticated candidate retains the same frozen research-only product surface',()=>{
 const gate='codex/cru21-ui-auth-acceptance-20261023';
 const p=contracts.selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:gate});
 assert.equal(p,contracts.CRU21_EVIDENCE_HOME_PRODUCT_SURFACE);
 assert.equal(p.schemaVersion,'cru21-evidence-home-product-surface-v1');
 assert.equal(p.safety.executionAuthorized,false);
 assert.equal(p.safety.orderRoutesEnabled,false);
 assert.equal(p.safety.formalWeight,0);
 assert.equal(p.deliveryAccepted,false);
 assert.deepEqual(p.observedFlow.governed,['1m','5m','15m','30m','1h','4h']);
 for(const fake of [gate+'-lookalike','codex/cru21-ui-clarity-p1-20261022','main']){
   assert.equal(contracts.selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:fake}),contracts.CRU46_PRODUCT_SURFACE_CONTRACT);
 }
});

test('offline compatibility follow-up selects current candidate metadata only for its exact preview branch',()=>{
 const branch='codex/cru21-offline-compatibility-20261027';
 assert.equal(contracts.selectDashboardProductSurface({previewType:'CRU21_OWNER_PREVIEW',actualBranch:branch}),contracts.CRU21_EVIDENCE_HOME_PRODUCT_SURFACE);
 for(const inputs of [{actualBranch:branch},{previewType:'INTEGRATION_OWNER_PREVIEW',actualBranch:branch},
  {previewType:'CRU21_OWNER_PREVIEW',actualBranch:branch+'-lookalike'},
  {previewType:'CRU21_OWNER_PREVIEW',actualBranch:'main'}])
   assert.equal(contracts.selectDashboardProductSurface(inputs),contracts.CRU46_PRODUCT_SURFACE_CONTRACT);
});
