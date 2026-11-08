// Synthetic subprocess only: actual startup roots, handler, auth and stores; no listener.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import * as owner from '../../src/owner-local-acceptance.mjs';
import * as candidate from '../../src/cru21-market-candidate.mjs';
import { prepareOwnerRoots } from '../../src/owner-local-startup.mjs';
import * as security from '../../src/security.mjs';
import * as httpUtils from '../../src/http-utils.mjs';
import * as journal from '../../src/decision-journal.mjs';
import { createDecisionSnapshot } from '../../src/dashboard-decision-workspace.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { binding, previous, write } = JSON.parse(input);
const password = crypto.randomBytes(24).toString('base64url');
const runId = crypto.randomUUID();
const consent = { accepted: true, riskVersion: owner.OWNER_RISK_VERSION, password };
owner.assertOwnerConsent(consent);
const roots = prepareOwnerRoots(binding, runId);
owner.admitOwner(consent, binding, runId);
const sessionPath = path.join(roots.privateDataRoot, 'sessions.json');
const source = fs.readFileSync(new URL('../../server.mjs', import.meta.url), 'utf8');
const context = { ...owner, ...candidate, ...security, ...httpUtils, ...journal, path,
  ownerLocal: true, marketCandidate: true, marketCandidateStartup: { roots }, cru55: null, formalEntry: null,
  config: { dataDir: roots.privateDataRoot, passwordHash: owner.ownerAdmission().passwordHash,
    cookieSecure: true, trustProxy: false, nodeEnv: 'production', sessionTtlMs: 60000, rememberedSessionTtlMs: 60000 },
  sessions: new security.SessionStore(60000, { filePath: sessionPath }), loginLimiter: new security.LoginRateLimiter(),
  inlineHandler: async () => false, crypto, URL, console: { error() {} },
  setTimeout: fn => { queueMicrotask(fn); return { unref() {} }; } };
// Execute the product's path selection too, so a store-only fix cannot pass.
const paths = source.slice(source.indexOf('const decisionJournalPath ='), source.indexOf('const forwardShadowBaseRoot ='));
const auth = source.slice(source.indexOf('function getSession(req)'), source.indexOf('const inlineEnabled ='));
const handler = source.slice(source.indexOf('const requestHandler ='), source.indexOf('const server ='));
vm.runInNewContext(`${paths}\n${auth}\n${handler}\nglobalThis.handle=requestHandler;`, context);
async function request(method, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, socket: { remoteAddress: '127.0.0.1' }, headers: {
    host: 'localhost:18723', origin: owner.OWNER_ORIGIN, 'sec-fetch-site': 'same-origin',
    'content-type': 'application/json', ...headers } });
  const result = { headers: {} };
  await context.handle(req, { setHeader(k, v) { result.headers[k.toLowerCase()] = v; },
    writeHead(status, values) { result.status = status; for (const [k, v] of Object.entries(values || {})) this.setHeader(k, v); },
    end(bytes) { result.raw = Buffer.from(bytes).toString('utf8'); } });
  result.json = () => JSON.parse(result.raw); return result;
}
assert.equal((await request('GET', '/api/v1/decision-journal')).status, 401);
if (previous) {
  assert.equal((await request('GET', '/api/v1/decision-journal', undefined, { cookie: previous.cookie })).status, 401);
  assert.equal((await request('POST', '/api/auth/login', { password: previous.password })).status, 401);
}
const login = await request('POST', '/api/auth/login', { password });
assert.equal(login.status, 200, login.raw);
for (const attr of ['Secure', 'HttpOnly', 'SameSite=Strict']) assert.ok(login.headers['set-cookie'].includes(attr));
const cookie = login.headers['set-cookie'].split(';')[0];
assert.ok(cookie.startsWith(owner.OWNER_COOKIE + '='));
const headers = { cookie, 'x-csrf-token': login.json().csrfToken };
if (write) {
  const now = '2026-11-08T00:00:00.000Z';
  const snapshot = createDecisionSnapshot({ snapshot: { dataMode: 'live', asOfDate: '2026-11-08', generatedAt: now,
    futuresMarket: { ok: false }, marketBreadth: { ok: false }, options: { ok: false }, marketOverview: { ok: false } },
    dataHealth: { schemaVersion: 'dashboard-data-health-v1', generatedAt: now, overall: 'UNAVAILABLE',
      staleCount: 0, unavailableCount: 1, counts: {}, items: [], formalWeight: 0, researchOnly: true, executionAuthorized: false }, snapshotTime: now });
  const body = { intent: 'NO_TRADE', reason: 'Synthetic persistence test', snapshot };
  assert.equal((await request('POST', '/api/v1/decision-journal', body, { cookie })).status, 403);
  const saved = await request('POST', '/api/v1/decision-journal', body, headers);
  assert.equal(saved.status, 201, saved.raw);
  const outcome = await request('POST', '/api/v1/decision-journal/outcomes', {
    decisionRecordHash: saved.json().data.recordHash, executionStatus: 'NOT_EXECUTED',
    thesisStatus: 'NOT_APPLICABLE', outcomeNote: 'Synthetic cross-process review' }, headers);
  assert.equal(outcome.status, 201, outcome.raw);
}
const read = await request('GET', '/api/v1/decision-journal', undefined, headers);
assert.equal(read.status, 200, read.raw);
// Tokens only travel through parent/child pipes, never logs/evidence/files.
console.log(JSON.stringify({ pid: process.pid, roots, password, cookie, review: read.json() }));
