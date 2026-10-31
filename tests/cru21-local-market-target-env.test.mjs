import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertLocalMarketTargetEnvironment as check } from '../scripts/check-cru21-local-market-target-env.mjs';

const plan = Object.freeze({ schema:'cru21-rollout-plan-v4-local-market', scope:'MARKET_RESEARCH_AI_DISABLED', head:'b'.repeat(40),
  primary:'D:/fixture/development', formal:'D:/fixture/formal', oldRuntimeRoot:'D:/fixture/formal',
  readDataRoot:'D:/fixture/development/data', producerDataRoot:'D:/fixture/formal/data',
  tlsBundle:'D:/fixture/private-tls/bundle.dpapi', tlsCertSha256:'a'.repeat(64) });
const original = 'HOST=127.0.0.1\nPORT=8787\nMOCK_DATA=0\nNODE_ENV=production\nCOOKIE_SECURE=1\nDASHBOARD_PASSWORD_HASH=synthetic-not-an-account\n';
const target = original + [
  'ASK_GPT_INLINE_ENABLED=0', 'DASHBOARD_RELEASE_SCOPE=MARKET_RESEARCH_AI_DISABLED',
  'DASHBOARD_TLS_BUNDLE='+plan.tlsBundle, 'DASHBOARD_TLS_CERT_SHA256='+plan.tlsCertSha256,
  'DASHBOARD_FORMAL_READ_ROOT='+plan.readDataRoot, 'TX_CHART_DATA_ROOT='+plan.readDataRoot,
  'TX_CHART_CACHE_ROOT=D:/fixture/formal/data/dashboard-chart-cache',
  'CRU34_LIVE_DATA_ROOT='+plan.producerDataRoot,
  'CRU34_LIVE_SNAPSHOT_PATH=D:/fixture/formal/data/runtime/cru34-live/latest.json',
  'CRU34_LIVE_STATUS_PATH=D:/fixture/formal/data/runtime/cru34-live/status.json',
].join('\n')+'\n';
const digest = value => createHash('sha256').update(value).digest('hex');

test('local market target keeps inputs and inherited environment unchanged', () => {
  const before = digest(JSON.stringify(Object.entries(process.env).sort()));
  const result = check(plan, target, original);
  assert.deepEqual(result, {ready:true, formalOnly:true, scope:plan.scope, credentialsPrinted:false});
  assert.equal(Object.isFrozen(result), true);
  assert.equal(digest(JSON.stringify(Object.entries(process.env).sort())), before);
});

test('Windows lowercase keys, quoted paths and CRLF retain exact routing', () => {
  const lower = text => text.replace(/^([A-Z_]+)=/gm, (_, key) => key.toLowerCase()+'=')
    .replaceAll('=D:/fixture/development/data', '="d:/fixture/development/data"').replaceAll('\n','\r\n');
  assert.equal(check(plan, lower(target), lower(original)).ready, true);
});

for (const [name, key, value] of [
  ['AI enabled','ASK_GPT_INLINE_ENABLED','1'], ['full AI scope','DASHBOARD_RELEASE_SCOPE','FULL_AI'],
  ['public host','HOST','0.0.0.0'], ['different port','PORT','18722'], ['mock data','MOCK_DATA','1'],
  ['development mode','NODE_ENV','development'], ['insecure cookie','COOKIE_SECURE','0'],
  ['password substitution','DASHBOARD_PASSWORD_HASH','different'], ['proxy','TRUST_PROXY','1'],
  ['guest','CRU21_GUEST_ENABLED','1'], ['invalid guest','CRU21_GUEST_ENABLED','other'],
  ['preview','DASHBOARD_PREVIEW_TYPE','CRU21_OWNER_PREVIEW'], ['acceptance','CRU55_ACCEPTANCE_CONFIG','D:/other.json'],
  ['runtime binding','CRU55_RUNTIME_BINDING','D:/other.json'], ['shadow routing','FORWARD_SHADOW_RUNTIME_ROOT','D:/other'],
  ['candidate reader','ASK_GPT_CANDIDATE_READ_ROOT','D:/other'], ['env-file redirect','DASHBOARD_ENV_PATH','D:/other'],
  ['runtime identity override','DASHBOARD_RUNTIME_COMMIT','c'.repeat(40)], ['TLS bypass','NODE_TLS_REJECT_UNAUTHORIZED','0'],
  ['Node preload','NODE_OPTIONS','--require=fixture'], ['module search','NODE_PATH','D:/other'],
  ['account root','LOCALAPPDATA','D:/other'], ['account profile','USERPROFILE','D:/other'], ['system path','SYSTEMROOT','D:/other'],
  ['certificate override','NODE_EXTRA_CA_CERTS','D:/other.pem'], ['TLS bundle substitution','DASHBOARD_TLS_BUNDLE','D:/other.dpapi'],
  ['TLS pin substitution','DASHBOARD_TLS_CERT_SHA256','c'.repeat(64)],
  ['chart source','TX_CHART_DATA_ROOT','D:/other'], ['shared write cache','TX_CHART_CACHE_ROOT',plan.readDataRoot],
  ['producer root','CRU34_LIVE_DATA_ROOT','D:/other'], ['producer snapshot','CRU34_LIVE_SNAPSHOT_PATH','D:/other.json'],
  ['producer status','CRU34_LIVE_STATUS_PATH','D:/other.json'], ['research database','V2_RESEARCH_DATABASE_PATH','D:/other.sqlite'],
  ['session lifetime','SESSION_TTL_MINUTES','900'], ['remember lifetime','REMEMBER_SESSION_DAYS','90'],
]) test('local market target refuses '+name, () => assert.throws(() => check(plan,target+`${key}=${value}\n`,original)));

for (const [name, patch] of [
  ['V3 plan',{schema:'cru21-rollout-plan-v3-formal-only'}], ['scope missing',{scope:undefined}],
  ['head missing',{head:undefined}], ['short head',{head:'short'}], ['pin absent',{tlsCertSha256:undefined}],
  ['pin malformed',{tlsCertSha256:'pending'}], ['bundle absent',{tlsBundle:undefined}], ['bundle UNC',{tlsBundle:'//server/share/bundle'}],
  ['rollback development root',{oldRuntimeRoot:plan.primary}], ['wrong data root',{readDataRoot:'D:/other'}],
  ['overlapping roots',{formal:plan.primary+'/nested'}],
]) test('local market target refuses '+name, () => assert.throws(() => check({...plan,...patch},target,original)));

test('unsafe values retained in both configurations remain rejected', () => {
  for (const [key,value] of [['localappdata','D:/other'],['node_options','--require=fixture'],['trust_proxy','1'],['cru21_guest_enabled','1']]) {
    const extra = `${key}=${value}\n`;
    assert.throws(() => check(plan,target+extra,original+extra));
  }
});

test('Windows case aliases cannot shadow checked values', () => {
  assert.throws(() => check(plan,target+'cookie_secure=0\n',original));
  assert.throws(() => check(plan,target,original+'dashboard_password_hash=other\n'));
});

test('missing original authentication is not introduced by deployment', () => {
  assert.throws(() => check(plan,target,original.replace(/DASHBOARD_PASSWORD_HASH=.*\n/,'')));
});

const legacy = original.replace('COOKIE_SECURE=1','COOKIE_SECURE=0');
const migration = Object.freeze({schema:'cru21-secure-cookie-migration-v1', candidateHead:plan.head,
  from:'0', to:'1', ownerApproved:true, httpsOrigin:'https://127.0.0.1:8787', transportEvidenceSha256:'e'.repeat(64)});
const migratedPlan = () => ({...plan,cookieMigration:{...migration}});

test('explicit local HTTPS cookie upgrade preserves immutable legacy configuration', () => {
  const before=digest(legacy);
  assert.equal(check(migratedPlan(),target,legacy).ready,true);
  assert.equal(digest(legacy),before);
});

for (const [name, patch] of [
  ['wrong schema',{schema:'other'}], ['missing approval',{ownerApproved:undefined}], ['string approval',{ownerApproved:'true'}],
  ['foreign head',{candidateHead:'c'.repeat(40)}], ['wrong origin',{httpsOrigin:'https://localhost:8787'}],
  ['public origin',{httpsOrigin:'https://example.com'}], ['HTTP',{httpsOrigin:'http://127.0.0.1:8787'}],
  ['different port',{httpsOrigin:'https://127.0.0.1:18722'}], ['origin path',{httpsOrigin:'https://127.0.0.1:8787/login'}],
  ['missing evidence',{transportEvidenceSha256:undefined}], ['malformed evidence',{transportEvidenceSha256:'pending'}],
  ['wrong from',{from:'1'}], ['wrong to',{to:'0'}],
]) test('local HTTPS migration refuses '+name, () => {
  const p=migratedPlan();Object.assign(p.cookieMigration,patch);
  assert.throws(() => check(p,target,legacy));
});

test('implicit upgrade, downgrade and irrelevant migration are rejected', () => {
  assert.throws(() => check(plan,target,legacy));
  assert.throws(() => check(migratedPlan(),target.replace('COOKIE_SECURE=1','COOKIE_SECURE=0'),original));
  assert.throws(() => check(migratedPlan(),target,original));
});
