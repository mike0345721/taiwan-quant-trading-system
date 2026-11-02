// Pure source contracts only: no server, socket, native process or private data.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertLocalMarketMode } from '../src/dashboard-local-tls.mjs';
import { buildCru21PreviewVersion, validateCru21PreviewVersionTruth } from '../src/cru21-preview-contract.mjs';
import { resolveDashboardReadDataRoot } from '../src/dashboard-source-binding.mjs';
import {
  MARKET_CANDIDATE_SCOPE, MARKET_CANDIDATE_PREVIEW, MARKET_CANDIDATE_BRANCH,
  assertMarketCandidateMode, assertMarketCandidateRoots,
  buildMarketCandidateVersion, validateMarketCandidateVersionTruth,
  marketCandidateRouteAllowed,
} from '../src/cru21-market-candidate.mjs';

const head = '1'.repeat(40), tree = '2'.repeat(40), base = '3'.repeat(40);
const branch = 'codex/cru21-ai-off-candidate-20261102';
const legacyBranch = 'codex/cru21-repository-closeout-20261029';
const candidateScope = 'MARKET_RESEARCH_AI_DISABLED_CANDIDATE';
const candidatePreview = 'CRU21_MARKET_RESEARCH_CANDIDATE';
const config = () => ({ host: '127.0.0.1', port: 18723, nodeEnv: 'production', cookieSecure: true,
  mockData: false, trustProxy: false, cru55Candidate: false, cru55Acceptance: null });
const env = () => ({ DASHBOARD_RELEASE_SCOPE: candidateScope, ASK_GPT_INLINE_ENABLED: '0',
  DASHBOARD_PREVIEW_TYPE: candidatePreview, DASHBOARD_PREVIEW_BRANCH: branch,
  DASHBOARD_PREVIEW_EXPECTED_HEAD: head, DASHBOARD_PREVIEW_EXPECTED_TREE: tree,
  DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN: base,
  DASHBOARD_TLS_BUNDLE: path.resolve('synthetic-only/tls.dpapi'), DASHBOARD_TLS_BUNDLE_SHA256: 'b'.repeat(64),
  DASHBOARD_TLS_CERT_SHA256: 'a'.repeat(64) });

test('baseline: formal AI-disabled contract rejects a new 18723 candidate scope', () => {
  assert.throws(() => assertLocalMarketMode(env(), config()));
  assert.throws(() => assertLocalMarketMode({ ...env(), DASHBOARD_RELEASE_SCOPE: 'MARKET_RESEARCH_AI_DISABLED' }, config()));
});

test('baseline: old full-AI preview cannot admit AI-disabled 18723', () => {
  const version = buildCru21PreviewVersion({ runtimeVersion: { runtimeCommit: head, approvedMainCommit: base,
    syncState: 'MISMATCH' }, branch: legacyBranch, dataMode: 'LIVE' });
  const observation = { expectedHead: head, expectedBaseMain: base, actualBranch: legacyBranch, sourceClean: true,
    host: '127.0.0.1', port: 18723, inlineEnabled: false, candidateReadRoot: path.resolve('synthetic-read'), actualDataMode: 'LIVE' };
  assert.equal(validateCru21PreviewVersionTruth(version, observation).ready, false);
  assert.equal(validateCru21PreviewVersionTruth(version, { ...observation, port: 18722, inlineEnabled: true }).ready, true);
});

test('baseline: old candidate read binding requires enabled inline AI', () => {
  assert.throws(() => resolveDashboardReadDataRoot({ dataDir: path.resolve('synthetic-private/data'),
    host: '127.0.0.1', port: 18723, actualDataMode: 'LIVE', inlineEnabled: false,
    candidateReadRoot: path.resolve('synthetic-read') }), /INLINE_CANDIDATE_READ_ROOT_REJECTED/);
});

test('AI-disabled candidate has distinct, fixed identifiers', () => {
  assert.equal(MARKET_CANDIDATE_SCOPE, candidateScope);
  assert.equal(MARKET_CANDIDATE_PREVIEW, candidatePreview);
  assert.equal(MARKET_CANDIDATE_BRANCH, branch);
});

test('strict 18723 candidate accepts explicit AI-disabled normal HTTPS configuration', () => {
  assert.equal(assertMarketCandidateMode(env(), config()), true);
});

test('candidate checker does not absorb legacy or formal release scope', () => {
  assert.equal(assertMarketCandidateMode({}, config()), false);
  assert.equal(assertMarketCandidateMode({ DASHBOARD_RELEASE_SCOPE: 'MARKET_RESEARCH_AI_DISABLED' },
    { ...config(), port: 8787 }), false);
});

for (const [name, patch] of Object.entries({
  publicHost: { host: '0.0.0.0' }, hostnameAlias: { host: 'localhost' }, formalPort: { port: 8787 },
  fullAiPort: { port: 18722 }, arbitraryPort: { port: 18724 }, bridgePort: { port: 8790 },
  development: { nodeEnv: 'development' }, insecureCookie: { cookieSecure: false },
  mockData: { mockData: true }, proxy: { trustProxy: true },
  cru55Candidate: { cru55Candidate: true }, cru55Acceptance: { cru55Acceptance: {} },
})) {
  test(`AI-disabled candidate refuses ${name}`, () => {
    assert.throws(() => assertMarketCandidateMode(env(), { ...config(), ...patch }));
  });
}

for (const [name, patch] of Object.entries({
  enabledAI: { ASK_GPT_INLINE_ENABLED: '1' }, absentAI: { ASK_GPT_INLINE_ENABLED: undefined },
  wrongPreview: { DASHBOARD_PREVIEW_TYPE: 'CRU21_OWNER_PREVIEW' },
  missingPreview: { DASHBOARD_PREVIEW_TYPE: undefined },
  wrongBranch: { DASHBOARD_PREVIEW_BRANCH: 'main' }, missingBranch: { DASHBOARD_PREVIEW_BRANCH: undefined },
  missingHead: { DASHBOARD_PREVIEW_EXPECTED_HEAD: undefined }, badHead: { DASHBOARD_PREVIEW_EXPECTED_HEAD: 'declared-head' },
  missingTree: { DASHBOARD_PREVIEW_EXPECTED_TREE: undefined }, badTree: { DASHBOARD_PREVIEW_EXPECTED_TREE: 'a'.repeat(64) },
  missingBase: { DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN: undefined },
  guest: { CRU21_GUEST_ENABLED: '1' }, managedAcceptance: { CRU55_ACCEPTANCE_CONFIG: '/synthetic/never-opened.json' },
  managedBinding: { CRU55_RUNTIME_BINDING: '/synthetic/never-opened.json' },
  caseAliasManaged: { cru55_dynamic_root: '/synthetic/never-opened' },
  forwardRoot: { FORWARD_SHADOW_RUNTIME_ROOT: '/synthetic/never-opened' },
  preload: { NODE_OPTIONS: '--require=synthetic-never-loaded' },
  moduleSearchPath: { NODE_PATH: '/synthetic/never-loaded' },
  relaxedTLS: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  missingBundle: { DASHBOARD_TLS_BUNDLE: undefined }, relativeBundle: { DASHBOARD_TLS_BUNDLE: 'relative.dpapi' },
  uncBundle: { DASHBOARD_TLS_BUNDLE: '//foreign/share/test.dpapi' },
  missingBundleHash: { DASHBOARD_TLS_BUNDLE_SHA256: undefined }, invalidBundleHash: { DASHBOARD_TLS_BUNDLE_SHA256: 'not-a-hash' },
  missingPin: { DASHBOARD_TLS_CERT_SHA256: undefined }, invalidPin: { DASHBOARD_TLS_CERT_SHA256: 'not-a-pin' },
})) {
  test(`AI-disabled candidate rejects environment ${name} before any store or TLS read`, () => {
    assert.throws(() => assertMarketCandidateMode({ ...env(), ...patch }, config()));
  });
}

test('candidate preview cannot be selected without its exact release scope', () => {
  for (const scope of [undefined, '', 'MARKET_RESEARCH_AI_DISABLED', 'OTHER']) {
    assert.throws(() => assertMarketCandidateMode({ ...env(), DASHBOARD_RELEASE_SCOPE: scope }, config()));
  }
});

const runtimeVersion = () => ({ runtimeCommit: head, approvedMainCommit: base, runtimeTree: tree, syncState: 'MISMATCH' });
const version = () => buildMarketCandidateVersion({ runtimeVersion: runtimeVersion(), branch, dataMode: 'LIVE' });
const truth = () => ({ expectedHead: head, expectedTree: tree, actualTree: tree, expectedBaseMain: base,
  actualBranch: branch, sourceClean: true, host: '127.0.0.1', port: 18723, inlineEnabled: false,
  candidateReadRoot: path.resolve('synthetic-read'), actualDataMode: 'LIVE' });

test('exact unmerged AI-disabled candidate identity is truthful without formal acceptance', () => {
  const v = version();
  assert.equal(validateMarketCandidateVersionTruth(v, truth()).ready, true);
  assert.equal(v.previewType, candidatePreview);
  assert.equal(v.complete, false);
  assert.equal(v.deliveryAccepted, false);
  assert.equal(v.aiEnabled, false);
  assert.equal(v.syncState, 'MISMATCH');
  assert.equal(v.runtimeCommit, head);
  assert.equal(v.approvedMainCommit, base);
  assert.equal(v.runtimeTree, tree);
  assert.equal(v.exactTree, tree);
  assert.equal(v.buildTree, tree);
});

for (const [name, patch] of Object.entries({
  missingHead: { expectedHead: null }, wrongHead: { expectedHead: base },
  missingTree: { expectedTree: null }, wrongTree: { expectedTree: head }, actualTree: { actualTree: head },
  missingBase: { expectedBaseMain: null }, wrongBase: { expectedBaseMain: head },
  declaredBranch: { actualBranch: 'main' }, dirtySource: { sourceClean: false },
  publicHost: { host: '0.0.0.0' }, fullAiPort: { port: 18722 }, formalPort: { port: 8787 },
  enabledAI: { inlineEnabled: true }, missingReadRoot: { candidateReadRoot: null }, mockData: { actualDataMode: 'MOCK' },
})) {
  test(`candidate truth rejects observed ${name}`, () => {
    assert.equal(validateMarketCandidateVersionTruth(version(), { ...truth(), ...patch }).ready, false);
  });
}

for (const [name, patch] of Object.entries({
  runtimeHead: { runtimeCommit: base }, exactHead: { exactHead: base }, buildHead: { buildCommit: base },
  runtimeTree: { runtimeTree: head }, exactTree: { exactTree: head }, buildTree: { buildTree: head },
  base: { approvedMainCommit: head }, declaredBase: { baseMainCommit: head }, branch: { branch: 'main' },
  preview: { previewType: 'CRU21_OWNER_PREVIEW' }, scope: { releaseScope: 'MARKET_RESEARCH_AI_DISABLED' },
  mockData: { dataMode: 'MOCK' }, accepted: { complete: true }, delivered: { deliveryAccepted: true },
  enabledAI: { aiEnabled: true },
})) {
  test(`candidate truth rejects altered declaration ${name}`, () => {
    assert.equal(validateMarketCandidateVersionTruth({ ...version(), ...patch }, truth()).ready, false);
  });
}

test('read-only candidate routing blocks collection, child scripts, setup and model/account operations', () => {
  for (const pathname of ['/api/v1/refresh', '/api/v2/daily-update', '/api/v1/ask-gpt/accounts',
    '/api/v1/ask-gpt/models', '/api/v1/ask-gpt/setup', '/api/v1/ask-gpt/analyse', '/api/v1/unlisted-write']) {
    assert.equal(marketCandidateRouteAllowed('POST', pathname), false, pathname);
  }
  for (const pathname of ['/api/v1/ask-gpt/accounts', '/api/v1/ask-gpt/models', '/api/v1/ask-gpt/setup',
    '/api/v1/ask-gpt/requests/00000000-0000-4000-8000-000000000000']) {
    assert.equal(marketCandidateRouteAllowed('GET', pathname), false, pathname);
  }
});

test('private writes and read-only disabled status retain explicit method boundaries', () => {
  for (const pathname of ['/api/auth/login', '/api/auth/logout', '/api/v1/decision-journal',
    '/api/v1/decision-journal/outcomes', '/api/v1/cru46-browser-runtime-proof']) {
    assert.equal(marketCandidateRouteAllowed('POST', pathname), true, pathname);
    for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal(marketCandidateRouteAllowed(method, pathname), false);
  }
  assert.equal(marketCandidateRouteAllowed('GET', '/api/v1/ask-gpt/status'), true);
  assert.equal(marketCandidateRouteAllowed('POST', '/api/v1/ask-gpt/status'), false);
  assert.equal(marketCandidateRouteAllowed('GET', '/api/v2/daily-update'), true);
});

const roots = () => ({ sourceRoot: path.resolve('synthetic-candidate'),
  privateDataRoot: path.resolve('synthetic-candidate/data'),
  readDataRoot: path.resolve('synthetic-read'), producerDataRoot: path.resolve('synthetic-producer'),
  chartCacheRoot: path.resolve('synthetic-candidate/data/dashboard-chart-cache') });

test('private Session/journal/cache root stays under the dedicated source tree', () => {
  assert.doesNotThrow(() => assertMarketCandidateRoots(roots()));
  // Prefixes are not containment: a separate sibling must remain admissible.
  assert.doesNotThrow(() => assertMarketCandidateRoots({ ...roots(), readDataRoot: roots().sourceRoot + '-read' }));
});

for (const [name, patch] of Object.entries({
  relativeSource: { sourceRoot: 'relative-source' }, relativeRead: { readDataRoot: 'relative-read' },
  missingProducer: { producerDataRoot: undefined }, foreignPrivate: { privateDataRoot: path.resolve('synthetic-foreign') },
  sourceAsPrivate: { privateDataRoot: roots().sourceRoot },
  foreignCache: { chartCacheRoot: path.resolve('synthetic-foreign-cache') },
  readEqualsSource: { readDataRoot: roots().sourceRoot },
  readInsideSource: { readDataRoot: path.join(roots().sourceRoot, 'shared-input') },
  sourceInsideRead: { readDataRoot: path.dirname(roots().sourceRoot) },
  producerEqualsSource: { producerDataRoot: roots().sourceRoot },
  producerInsideSource: { producerDataRoot: path.join(roots().sourceRoot, 'shared-producer') },
  producerEqualsRead: { producerDataRoot: roots().readDataRoot },
  producerInsideRead: { producerDataRoot: path.join(roots().readDataRoot, 'producer') },
  readInsideProducer: { readDataRoot: path.join(roots().producerDataRoot, 'read') },
})) {
  test(`split roots reject ${name} without filesystem effects`, () => {
    assert.throws(() => assertMarketCandidateRoots({ ...roots(), ...patch }));
  });
}
