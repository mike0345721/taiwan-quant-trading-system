import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');
const installer = path.join(root, 'scripts/install-market-state-forward-shadow-automation.ps1');
const wrapper = path.join(root, 'scripts/run-market-state-forward-shadow-hidden.ps1');

test('pre-launch scheduler definition is 08:25, WakeToRun, IgnoreNew and remains disabled', () => {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
  ], { cwd: root, encoding: 'utf8' });
  const definition = JSON.parse(output);
  assert.equal(definition.schedule, 'Monday-Friday 08:25 Asia/Taipei');
  assert.equal(definition.multipleInstances, 'IgnoreNew');
  assert.equal(definition.wakeToRun, true);
  assert.equal(definition.formalSchedulerEnabled, false);
  assert.equal(definition.executionAuthorized, false);
});

test('scheduler installation requires both explicit install and Owner approval inputs', () => {
  const source = fs.readFileSync(installer, 'utf8');
  assert.match(source, /\[switch\]\$Install/);
  assert.match(source, /FORWARD_SHADOW_READY_MANIFEST_REQUIRED/);
  assert.match(source, /FORWARD_SHADOW_OWNER_APPROVAL_ARTIFACT_REQUIRED/);
  assert.match(source, /validate-market-state-forward-shadow-launch\.mjs/);
  assert.match(source, /-Mode FORWARD_SHADOW/);
  assert.match(source, /-LaunchManifestPath/);
  assert.match(source, /-OwnerApprovalPath/);
  assert.doesNotMatch(source, /\[switch\]\$OwnerApproved/);
  assert.doesNotMatch(source, /executionAuthorized\s*=\s*\$true/i);
});

test('wrapper defaults to NOT_ACTIVE and cannot write evidence without a test input', () => {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
  ], { cwd: root, encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.status, 'NOT_ACTIVE');
  assert.equal(result.collectorActive, false);
  assert.equal(result.officialEvidenceWritten, false);
  assert.equal(result.executionAuthorized, false);
});

test('official wrapper cannot start with a boolean or without governed artifacts', () => {
  assert.throws(() => execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-Mode', 'FORWARD_SHADOW',
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), /Command failed/);
  const source = fs.readFileSync(wrapper, 'utf8');
  assert.match(source, /FORWARD_SHADOW_GOVERNANCE_ARTIFACTS_REQUIRED/);
  assert.doesNotMatch(source, /owner-approved/i);
});

test('observer runtime is D-only and project runtime directory is git ignored', () => {
  const ignoredPath = 'data/market-state/forward-shadow/cru22-ignore-proof/probe.json';
  const result = execFileSync('git', ['check-ignore', ignoredPath], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(result.replaceAll('\\', '/'), ignoredPath);
  const observerConfig = JSON.parse(fs.readFileSync(path.join(root, 'config/market-state-forward-shadow-observer.json'), 'utf8'));
  assert.match(observerConfig.runtimeRootTemplate, /^D:\\/i);
  assert.equal(observerConfig.secondaryBackupCandidate, 'D:\\Taiwan stock\\forward-shadow-backup\\<runId>');
  assert.equal(observerConfig.secondaryBackupClass, 'OPERATIONAL_SECOND_COPY_NOT_DISASTER_RESILIENT');
  assert.equal(observerConfig.secondaryBackupStatus, 'NOT_CONFIGURED');
  assert.equal(observerConfig.formalSchedulerEnabled, false);
  assert.equal(observerConfig.executionAuthorized, false);
});
