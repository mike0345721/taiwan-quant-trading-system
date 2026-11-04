// Source bytes only. This never imports a product server or qualifies native/TLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as entry from '../scripts/cru21-normal-candidate/application-normal-entry.mjs';
const helper = fs.readFileSync(new URL('../scripts/cru21-normal-candidate/application-normal-entry.mjs',import.meta.url));
const native = fs.readFileSync(new URL('../scripts/cru21-normal-candidate/windows-candidate/CandidateHost.cs',import.meta.url),'utf8');
const sha = bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pin = name=>native.match(new RegExp('const string '+name+' = "([a-f0-9]{40,64})";'))?.[1];
const manifest=entry.normalSourceClosure({candidate:{}});
test('AI-off helper, native host and canonical source manifest agree on one exact product',()=>{
  assert.equal(entry.AI_DISABLED_PRODUCT.head,pin('AiDisabledProductHead'));
  assert.equal(entry.AI_DISABLED_PRODUCT.tree,pin('AiDisabledProductTree'));
  assert.equal(entry.AI_DISABLED_PRODUCT.branch,'codex/cru61-daily-use-repair-20261103');
  assert.equal(sha(helper),pin('ExpectedNormalEntrySHA256'));
  assert.equal(sha(JSON.stringify(manifest)),entry.AI_DISABLED_SOURCE_MANIFEST_SHA256);
  assert.equal(sha(JSON.stringify(manifest)),pin('AiDisabledSourceManifestSHA256'));
  assert.equal(Object.keys(manifest.files).length,Number(native.match(/const int AiDisabledSourceFileCount = (\d+);/)?.[1]));
  for(const name of ['src/dashboard-tx-chart-service.mjs','src/dashboard-tx-chart-worker.mjs','src/trend-strength-adx.mjs',
    'src/dashboard-v2-reader-binding.mjs','src/dashboard-data-operations-reader-identity.mjs']) assert.match(manifest.files[name],/^[a-f0-9]{64}$/);
  assert.ok(Object.keys(manifest.files).every(x=>!x.startsWith('v2/tests/')));
});
test('legacy fixed bytes and unapproved 15-minute safety gate remain separate',()=>{
  assert.equal(entry.NORMAL_PRODUCT.head,'4ae16de9a5af0166744626d44a49cb5bcebed675');
  assert.equal(Object.keys(entry.normalSourceClosure().files).length,356);
  assert.equal(sha(JSON.stringify(entry.normalSourceClosure())),'b1391d7e3a971d72741053c159ea95acf772ca2a9d8f3970a4af098408fa947a');
  const gate=entry.normalLiveEligibility();assert.equal(gate.allowed,false);assert.equal(gate.runtimeAllowed,false);assert.equal(gate.status,'HOLD');
  assert.match(native,/static bool NormalGateAllows\(\) \{ return false; \}/);
  assert.match(native,/ExpectedNormalOwnerApprovalSHA256 = "NOT_APPROVED"/);
  assert.match(native,/Number\(ticket, "durationMs"\) == 900000/);
});
const root=process.env.CRU21_CONVERGED_PRODUCT_GIT_ROOT;
test('selected inventory verifies every original Git blob at the converged product SHA', {skip:root?false:'NOT_RUN: exact product Git root not selected'},()=>{
  const git=args=>execFileSync('git',['--no-optional-locks','-C',root,...args],{maxBuffer:8*1024*1024});
  assert.equal(git(['rev-parse','HEAD']).toString().trim(),entry.AI_DISABLED_PRODUCT.head);
  assert.equal(git(['rev-parse','HEAD^{tree}']).toString().trim(),entry.AI_DISABLED_PRODUCT.tree);
  for(const [name,digest] of Object.entries(manifest.files)){
    assert.ok(/^[A-Za-z0-9._/-]+$/.test(name) && !name.split('/').includes('..'));
    const bytes=git(['show',entry.AI_DISABLED_PRODUCT.head+':'+name]);
    assert.equal(sha(bytes),digest,name);
  }
  const mutated=structuredClone(manifest);delete mutated.files['src/dashboard-tx-chart-worker.mjs'];
  assert.notEqual(sha(JSON.stringify(mutated)),entry.AI_DISABLED_SOURCE_MANIFEST_SHA256);
});
