import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertFormalTargetEnvironment } from '../scripts/check-cru21-rollout-target-env.mjs';

const plan = Object.freeze({ schema:'cru21-rollout-plan-v3-formal-only', primary:'D:/fixture/development', formal:'D:/fixture/formal',
  oldRuntimeRoot:'D:/fixture/formal', readDataRoot:'D:/fixture/development/data', producerDataRoot:'D:/fixture/formal/data' });
const baseline = 'HOST=127.0.0.1\nPORT=8787\nMOCK_DATA=0\nNODE_ENV=production\nCOOKIE_SECURE=1\nDASHBOARD_PASSWORD_HASH=fixture-only-not-a-password\n';
const target = baseline + [
  'ASK_GPT_INLINE_ENABLED=1',
  'DASHBOARD_FORMAL_READ_ROOT=D:/fixture/development/data',
  'TX_CHART_DATA_ROOT=D:/fixture/development/data',
  'TX_CHART_CACHE_ROOT=D:/fixture/formal/data/dashboard-chart-cache',
  'CRU34_LIVE_DATA_ROOT=D:/fixture/formal/data',
  'CRU34_LIVE_SNAPSHOT_PATH=D:/fixture/formal/data/runtime/cru34-live/latest.json',
  'CRU34_LIVE_STATUS_PATH=D:/fixture/formal/data/runtime/cru34-live/status.json',
].join('\n') + '\n';

test('target env: parses exact split roots without mutating process environment', () => {
  const digest = () => createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort())).digest('hex');
  const before = digest();
  assert.deepEqual(assertFormalTargetEnvironment(plan, target, baseline), { ready:true, formalOnly:true, credentialsPrinted:false });
  assert.equal(digest(), before, 'checker must not mutate inherited environment');
});
test('target env: quotes, CRLF and Windows path spelling do not cause false mismatches', () => {
  const text = target.replaceAll('D:/fixture/', 'd:/fixture/').replaceAll('=d:/fixture/development/data', '="d:/fixture/development/data"').replaceAll('\n', '\r\n');
  assert.equal(assertFormalTargetEnvironment(plan, text, baseline).ready, true);
});

for (const [name, key, value] of [
  ['wrong port','PORT','18722'], ['public binding','HOST','0.0.0.0'], ['mock','MOCK_DATA','1'],
  ['development mode','NODE_ENV','development'], ['password replaced','DASHBOARD_PASSWORD_HASH','different-fixture-value'],
  ['insecure cookie','COOKIE_SECURE','0'], ['proxy relaxed','TRUST_PROXY','1'],
  ['preview identity','DASHBOARD_PREVIEW_TYPE','CRU21_OWNER_PREVIEW'],
  ['guest bypass','CRU21_GUEST_ENABLED','1'], ['alternate runtime','CRU55_RUNTIME_BINDING','D:/fixture/other.json'],
  ['extra source','FORWARD_SHADOW_RUNTIME_ROOT','D:/fixture/other'], ['candidate reader','ASK_GPT_CANDIDATE_READ_ROOT','D:/fixture/other'],
  ['credentials moved','LOCALAPPDATA','D:/fixture/new-account-root'], ['arbitrary Node preload','NODE_OPTIONS','--require=fixture'],
  ['TLS disabled','NODE_TLS_REJECT_UNAUTHORIZED','0'], ['chart source','TX_CHART_DATA_ROOT','D:/fixture/other'],
  ['shared cache write','TX_CHART_CACHE_ROOT','D:/fixture/development/data'],
  ['Producer redirected','CRU34_LIVE_DATA_ROOT','D:/fixture/other'],
  ['snapshot redirected','CRU34_LIVE_SNAPSHOT_PATH','D:/fixture/other.json'],
  ['status redirected','CRU34_LIVE_STATUS_PATH','D:/fixture/other.json'],
  ['research redirected','V2_RESEARCH_DATABASE_PATH','D:/fixture/other.sqlite'],
]) test('target env refuses '+name, () => {
  assert.throws(() => assertFormalTargetEnvironment(plan, target+`${key}=${value}\n`, baseline));
});

test('target env: absent password and stale plan type fail closed', () => {
  assert.throws(() => assertFormalTargetEnvironment(plan, target, baseline.replace(/DASHBOARD_PASSWORD_HASH=.*\n/, '')));
  assert.throws(() => assertFormalTargetEnvironment({...plan,schema:'cru21-rollout-plan-v2'}, target, baseline));
});
test('target env: rollback root cannot be the development directory', () => {
  assert.throws(() => assertFormalTargetEnvironment({...plan,oldRuntimeRoot:plan.primary}, target, baseline));
});
test('target env: ambiguous relative data bindings are not accepted', () => {
  assert.throws(() => assertFormalTargetEnvironment({...plan,readDataRoot:'data'}, target, baseline));
});
