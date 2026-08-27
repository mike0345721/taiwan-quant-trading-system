import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

test('PR CI runs locked install, secret scan, and the repository test suite without masking failures', () => {
  const workflow = read('.github', 'workflows', 'pr-ci.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /node-version:\s*['"]22['"]/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run security:scan/);
  assert.match(workflow, /run: npm test/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});

test('safe diagnostics is an allowlist wrapper over governed project-status and does not inspect process secrets', () => {
  const collector = read('scripts', 'collect-development-diagnostics.mjs');
  assert.match(collector, /collectProjectStatus/);
  assert.match(collector, /data[^\n]*diagnostics/);
  assert.match(collector, /allowlistOnly:\s*true/);
  assert.match(collector, /readsEnvironmentSecrets:\s*false/);
  assert.match(collector, /readsCredentialFiles:\s*false/);
  assert.match(collector, /readsRawLedgerBody:\s*false/);
  assert.doesNotMatch(collector, /process\.env/);
  assert.doesNotMatch(collector, /exec(?:File|Sync)?\s*\(/);
  assert.doesNotMatch(collector, /spawn\s*\(/);
});

test('Windows diagnostics entrypoint and package script invoke the same bounded collector', () => {
  const batch = read('COLLECT_DIAGNOSTICS.bat');
  const pkg = JSON.parse(read('package.json'));
  assert.match(batch, /scripts\\collect-development-diagnostics\.mjs/);
  assert.equal(pkg.scripts.diagnostics, 'node scripts/collect-development-diagnostics.mjs');
});

test('development-loop contract keeps GPT, Codex, Owner, PR evidence, and execution safety boundaries explicit', () => {
  const doc = read('docs', 'operations', 'DEVELOPMENT_LOOP_STABILIZATION_V1.md');
  assert.match(doc, /ChatGPT — Project Brain \/ Tech Lead \/ Reviewer/);
  assert.match(doc, /Codex — Local Runtime Engineer/);
  assert.match(doc, /Product Owner/);
  assert.match(doc, /Draft PR/);
  assert.match(doc, /executionAuthorized=false/);
  assert.match(doc, /orderRoutesEnabled=false/);
  assert.match(doc, /Playwright/);
});
