// Build/security-contract checks only. These do not execute a Windows process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLICATION_PRODUCT, APPLICATION_FILES, applicationSHA256, buildApplicationBundle } from '../scripts/cru21-normal-candidate/application-isolation.mjs';
import { NORMAL_PRODUCT, NORMAL_SOURCE_MANIFEST_SHA256, normalSourceClosure } from '../scripts/cru21-normal-candidate/application-normal-entry.mjs';
import { PRODUCT } from '../scripts/cru21-normal-candidate/normal-guard.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = fs.readFileSync(path.join(repo, 'scripts/cru21-normal-candidate/windows-candidate/CandidateHost.cs'), 'utf8');
const artifactRoot = path.join(repo, 'scripts/cru21-normal-candidate');
// Tests may select a raw-byte fixture; this does not manufacture a Git checkout
// or replace the native runtime's source/namespace admission.
const productRoot = process.env.CRU21_PRODUCT_SOURCE_ROOT;
const nativeConstant = name => {
  const match = host.match(new RegExp('const string ' + name + ' = "([a-f0-9]{40,64})";'));
  assert.ok(match, 'Native host must freeze ' + name);
  return match[1];
};

test('native and JS pins bind PR104 and the same complete 356-file inventory', () => {
  assert.equal(APPLICATION_PRODUCT.head, '4ae16de9a5af0166744626d44a49cb5bcebed675');
  assert.equal(APPLICATION_PRODUCT.tree, 'ac2d522e6d42934dbb563599a04df61f56fc9145');
  assert.equal(APPLICATION_PRODUCT.branch, 'codex/cru21-repository-closeout-20261029');
  assert.equal(APPLICATION_PRODUCT.main, '4d8251686bdb4abbdb469bc00ae798717c0fd583');
  assert.deepEqual(PRODUCT, APPLICATION_PRODUCT);
  assert.deepEqual(NORMAL_PRODUCT, APPLICATION_PRODUCT);
  const closure = normalSourceClosure();
  assert.equal(Object.keys(closure.files).length, 356);
  assert.equal(applicationSHA256(JSON.stringify(closure)), NORMAL_SOURCE_MANIFEST_SHA256);
  assert.equal(NORMAL_SOURCE_MANIFEST_SHA256, 'b1391d7e3a971d72741053c159ea95acf772ca2a9d8f3970a4af098408fa947a');
  assert.equal(nativeConstant('NormalSourceManifestSHA256'), NORMAL_SOURCE_MANIFEST_SHA256);
  assert.equal(nativeConstant('ProductHead'), APPLICATION_PRODUCT.head);
  assert.equal(nativeConstant('ProductTree'), APPLICATION_PRODUCT.tree);
  assert.equal(nativeConstant('ExpectedEntrySHA256'), APPLICATION_FILES['server.mjs']);
  assert.equal(nativeConstant('ExpectedRunnerSHA256'), applicationSHA256(fs.readFileSync(path.join(artifactRoot, 'application-runner.mjs'))));
  assert.equal(nativeConstant('ExpectedIsolationSHA256'), applicationSHA256(fs.readFileSync(path.join(artifactRoot, 'application-isolation.mjs'))));
  assert.equal(nativeConstant('ExpectedNormalEntrySHA256'), applicationSHA256(fs.readFileSync(path.join(artifactRoot, 'application-normal-entry.mjs'))));
});

test('native bundle pin matches the selected exact raw-byte product fixture', {
  skip: !productRoot || !fs.existsSync(path.join(productRoot, 'server.mjs')) ? 'PR104 product fixture unavailable; no substitute source' : false,
}, () => {
  const bundle = JSON.stringify(buildApplicationBundle(productRoot)) + '\n';
  assert.equal(nativeConstant('ExpectedBundleSHA256'), applicationSHA256(bundle));
});

test('native source has no PID attachment arbitrary shell network or permission APIs', () => {
  // This is a source security lint, not proof of runtime cleanup or Windows ACLs.
  const probeStart = host.indexOf('static bool? ObserveNormalPortFree('), probeEnd = host.indexOf('static int Run(', probeStart);
  assert.ok(probeStart > 0 && probeEnd > probeStart);
  const withoutFixedProbe = host.slice(0, probeStart) + host.slice(probeEnd);
  assert.doesNotMatch(withoutFixedProbe, /\b(?:OpenProcess|ProcessStartInfo|Process\.Start|GetProcessById|Socket|TcpClient|HttpClient|SetNamedSecurityInfo|SetFileSecurity|icacls)\s*(?:\(|\.)/);
  const probe = host.slice(probeStart, probeEnd);
  assert.match(probe, /Require\(NormalCandidate && NormalCloseProbeApproved/);
  assert.match(probe, /probe\.ExclusiveAddressUse = true/);
  assert.match(probe, /probe\.Bind\(new System\.Net\.IPEndPoint\(System\.Net\.IPAddress\.Loopback, 18722\)\)/);
  assert.doesNotMatch(probe, /\.(?:Listen|Connect|Send|Receive)\s*\(/);
  assert.equal((probe.match(/new System\.Net\.Sockets\.Socket\(/g) || []).length, 1);
  assert.match(host, /const string NodePath = @"C:\\Program Files\\nodejs\\node\.exe";/);
  assert.match(host, /Args\(NodePath, "--input-type=module", "--experimental-vm-modules", "-", Root, WindowId, Nonce\)/);
  assert.match(host, /HARD_DEADLINE_FAULT_MODEL_UNRESOLVED/);
  assert.match(host, /"hardDeadlineProven", false/);
  assert.match(host, /"runtimeAllowed", false/);
});

test('native handoff source authenticates the inherited pipe before publishing path receipts', () => {
  // Preserve the reviewed protocol boundary; dynamic native proof is separate.
  assert.match(host, /N\.CreatePipe/);
  assert.match(host, /N\.SetHandleInformation\(outputRead, 1, 0\)/);
  assert.match(host, /handles\.Add\(outputWrite\)/);
  assert.match(host, /startup\.Startup\.Flags = 0x100/);
  const run = host.slice(host.indexOf('static int Run('), host.indexOf('static int HostDeathSuite('));
  assert.ok(run.indexOf('ReadPipeLine(child') < run.indexOf('VerifyHandshake(h, child'));
  assert.ok(run.indexOf('VerifyHandshake(h, child') < run.indexOf('Write(Window, "app-handshake.json"'));
  assert.doesNotMatch(run.slice(0, run.indexOf('VerifyHandshake(h, child')), /Read\(Window, "app-handshake\.json"/);
  assert.match(host, /Length == 11/);
  assert.match(host, /"PRIVATE_WRITE_ALLOWLIST_REJECTED"/);
});

test('normal launch is refused before manifest evaluation and its planner cannot spawn', () => {
  const main = host.slice(host.indexOf('static int Main('), host.indexOf('sealed class Dir'));
  assert.ok(main.indexOf('args[0] == "run-normal"') < main.indexOf('Configure(args[1])'));
  const plan = host.slice(host.indexOf('static int PlanNormal('), host.indexOf('static int Main('));
  assert.doesNotMatch(plan, /\b(?:Spawn|Run|ResumeThread|CreateProcess)\s*\(/);
  assert.match(plan, /application-normal-entry\.mjs/);
  assert.match(plan, /normal-ticket\.json/);
  assert.match(plan, /ISOLATED_MANIFEST_NOT_NORMAL_AUTHORIZATION/);
});

test('native code namespace policy separates outer ancestors from source and vendor additions', () => {
  // Regression lint for the reviewed role distinction; not a Windows ACL test.
  assert.match(host, /if \(directory && existingAncestor\) allowed \|= 4u;/);
  assert.match(host, /CheckCodeSecurity\(Directories\[p\]\.Handle, true, !SamePath\(p, current\)\)/);
  assert.match(host, /CheckCodeSecurity\(Directories\[current\]\.Handle, true, !SamePath\(current, parent\)\)/);
  assert.match(host, /dir = Child\(dir, parts\[i\], false\); CheckCodeSecurity\(dir\.Handle, true\)/);
  assert.match(host, /EnumerateVendor\(Dir dir[\s\S]*?CheckCodeSecurity\(dir\.Handle, true\)/);
  assert.match(host, /ace != null && !ace\.IsCallback/);
});

test('normal source pipeline is connected behind both closed source approval gates', () => {
  // Integration source checks, not compiled Windows/process evidence.
  assert.match(host, /static bool NormalGateAllows\(\) \{ return false; \}/);
  assert.match(host, /ExpectedNormalOwnerApprovalSHA256 = "NOT_APPROVED"/);
  assert.match(host, /if \(!NormalGateAllows\(\)\) return LiveGate\(\);[\s\S]*?Configure\(args\[1\], true\)[\s\S]*?PrepareNormalAuthority\(\); return Run\(IntPtr\.Zero\)/);
  const run = host.slice(host.indexOf('static int Run('), host.indexOf('static int HostDeathSuite('));
  assert.ok(run.indexOf('CreateNormalTicket(intentHash)') < run.indexOf('child = Spawn('));
  assert.ok(run.indexOf('NormalProgram(normalTicket, child)') < run.indexOf('N.ResumeThread('));
  assert.ok(run.indexOf('N.ResumeThread(') < run.indexOf('inputWriter.Start()'));
  assert.match(run, /VerifyNormalHandshake\(h, child, intentHash\)/);
  assert.ok(run.indexOf('AwaitExit(child.Process, 5000)') < run.indexOf('ObserveNormalPortFree()'));
  assert.ok(run.indexOf('ObserveNormalPortFree()') < run.indexOf('long elapsed = Mono - start'));
  assert.match(host, /var record = BuildNormalAdmission\(ticketBytes, child\)/);
  assert.match(host, /const CRU21_NORMAL_INPUT_PACKET=JSON\.parse/);
  assert.match(host, /await bootstrapNormalEntry/);
});

test('native qualification source refuses remote namespaces and requests read control', () => {
  // Prevent source regressions pending the unavailable native execution lane.
  assert.match(host, /new DriveInfo\(drive\)\.DriveType == DriveType\.Fixed/);
  assert.match(host, /foreach \(string key in roots\.Keys\) RequireLocalFixedPath/);
  assert.match(host, /writable \? 0x001200a7u : 0x001200a1u/);
  assert.doesNotMatch(host, /0x001000a[17]/);
  assert.match(host, /GetSecurityInfo\(handle, 1, 5/);
  assert.match(host, /actualFiles\.SetEquals\(vendorFiles\.Keys\)/);
});
