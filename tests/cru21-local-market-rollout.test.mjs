import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repository, 'scripts/cru21-dashboard-rollout.ps1');
const checker = path.join(repository, 'scripts/check-cru21-local-market-target-env.mjs');
const q = value => "'" + value.replaceAll("'", "''") + "'";
const cases = ['preflight', 'lifecycle', 'ambient-node-environment', 'missing-bundle', 'changed-bundle', 'missing-tls-proof',
  'stale-tls-proof', 'false-trust', 'wrong-tls-head', 'missing-gate', 'duplicate-reviewer',
  'wrong-review-head', 'model-gate-forged', 'runtime-gate-forged', 'wrong-owner-sha',
  'wrong-tree', 'pid-reuse', 'foreign-listener', 'wrong-routing', 'launch-failure',
  'rollback-missing-tls', 'rollback-pid-reuse', 'rollback-plan-drift'];

// Full entry-point execution, with every Git/process/network mutation intercepted.
// The TLS bundle and attestations below are plainly synthetic fixture bytes. They
// test refusal and lifecycle contracts; they are never certificate/trust evidence.
test('local-market rollout: Windows isolated lifecycle and refusal matrix', { skip: process.platform !== 'win32' }, async t => {
  const parent = path.join(repository, 'data');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'rollout-local-market-test-'));
  fs.writeFileSync(path.join(root, 'fixture-owned.marker'), 'synthetic-only');
  const env = { ...process.env }; delete env.PSModulePath;
  const ps = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$rollout=[ScriptBlock]::Create([IO.File]::ReadAllText(${q(script)}))
$root=${q(root)}
$checker=${q(checker)}
$results=@()
function Put($p,$s){[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;[IO.File]::WriteAllText($p,$s)}
function Sum($p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
foreach($case in @(${cases.map(q).join(',')})){
 $caseRoot=Join-Path $root $case
 $primary=Join-Path $caseRoot 'development';$formal=Join-Path $caseRoot 'formal';$candidate=Join-Path $caseRoot 'candidate';$receipts=Join-Path $caseRoot 'receipts'
 foreach($dir in @($primary,$formal,$candidate,$receipts)){[IO.Directory]::CreateDirectory($dir)|Out-Null}
 $report='v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md'
 $readRoot=Join-Path $primary 'data';$producerRoot=Join-Path $formal 'data'
 $bundle=Join-Path $receipts 'fixture-tls.dpapi'
 Put $bundle 'synthetic-encrypted-TLS-fixture-not-a-real-certificate'
 $pin='f'*64
 $original="HOST=127.0.0.1\nPORT=8787\nMOCK_DATA=0\nNODE_ENV=production\nCOOKIE_SECURE=1\nTRUST_PROXY=0\nDASHBOARD_PASSWORD_HASH=fixture-only-not-a-password\n"
 $target=$original+"ASK_GPT_INLINE_ENABLED=0\nDASHBOARD_RELEASE_SCOPE=MARKET_RESEARCH_AI_DISABLED\nDASHBOARD_TLS_BUNDLE=$bundle\nDASHBOARD_TLS_CERT_SHA256=$pin\nDASHBOARD_FORMAL_READ_ROOT=$readRoot\nTX_CHART_DATA_ROOT=$readRoot\nTX_CHART_CACHE_ROOT=$producerRoot/dashboard-chart-cache\nCRU34_LIVE_DATA_ROOT=$producerRoot\nCRU34_LIVE_SNAPSHOT_PATH=$producerRoot/runtime/cru34-live/latest.json\nCRU34_LIVE_STATUS_PATH=$producerRoot/runtime/cru34-live/status.json\n"
 if($case -eq 'wrong-routing'){$target=$target.Replace('ASK_GPT_INLINE_ENABLED=0','ASK_GPT_INLINE_ENABLED=1')}
 foreach($p in @((Join-Path $primary '.env'),(Join-Path $formal '.env'),(Join-Path $receipts 'primary-original.env'),(Join-Path $receipts 'formal-original.env'))){Put $p $original}
 Put (Join-Path $receipts 'formal-target.env') $target
 Put (Join-Path $primary $report) 'unchanged-development-report'
 Put (Join-Path $receipts 'primary-dirty-report.md') 'unchanged-development-report'
 Put (Join-Path $formal 'server.mjs') '// inert fixture'
 Put (Join-Path $candidate 'scripts/check-cru21-local-market-target-env.mjs') ([IO.File]::ReadAllText($checker))
 $old=[pscustomobject]@{ProcessId=43210;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine=('node --env-file="'+(Join-Path $formal '.env')+'" "'+(Join-Path $formal 'server.mjs')+'"');CreationDate=[datetime]'2026-10-30T00:00:00Z'}
 $script:fixtureProcess=$old
 $identity=@{pid=43210;creationDate=$old.CreationDate.ToUniversalTime().ToString('o');executable=$old.ExecutablePath;commandLine=$old.CommandLine}
 $tls=@{schema='cru21-local-tls-preflight-v1';scope='MARKET_RESEARCH_AI_DISABLED';candidateHead=('b'*40);tlsCertSha256=$pin;tlsBundleSha256=(Sum $bundle);windowsTrustVerified=$true;pfxLeafPinVerified=$true;loopbackHandshakeVerified=$true;hostnameVerified=$true;observedAt=[DateTime]::UtcNow.ToString('o')}
 if($case -eq 'stale-tls-proof'){$tls.observedAt=[DateTime]::UtcNow.AddHours(-2).ToString('o')}
 if($case -eq 'false-trust'){$tls.windowsTrustVerified=$false}
 if($case -eq 'wrong-tls-head'){$tls.candidateHead='d'*40}
 $tls|ConvertTo-Json|ForEach-Object {Put (Join-Path $receipts 'local-tls-preflight.json') $_}
 $plan=@{schema='cru21-rollout-plan-v4-local-market';scope='MARKET_RESEARCH_AI_DISABLED';tlsBundle=$bundle;tlsCertSha256=$pin;tlsBundleSha256=(Sum $bundle);tlsEvidenceSha256=(Sum (Join-Path $receipts 'local-tls-preflight.json'));primary=$primary;formal=$formal;candidate=$candidate;oldRuntimeRoot=$formal;primaryHead=('c'*40);primaryBranch='codex/fixture-development';base=('a'*40);head=('b'*40);tree=('e'*40);formalPid=43210;producerPid=43211;readDataRoot=$readRoot;producerDataRoot=$producerRoot;oldProcess=$identity;dirtyReportPath=$report;dirtyReportHash=(Sum (Join-Path $primary $report));primaryEnvHash=(Sum (Join-Path $primary '.env'));formalEnvHash=(Sum (Join-Path $formal '.env'));targetEnvHash=(Sum (Join-Path $receipts 'formal-target.env'))}
 $planPath=Join-Path $receipts 'plan.json';$plan|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $planPath -Encoding UTF8
 $reviews=@(@{reviewer='independent-one';candidateHead=('b'*40);verdict='APPROVE';evidenceSha256=('1'*64)},@{reviewer='independent-two';candidateHead=('b'*40);verdict='APPROVE';evidenceSha256=('2'*64)})
 $gates=@{schema='cru21-local-market-hard-gates-v1';scope='MARKET_RESEARCH_AI_DISABLED';candidateHead=('b'*40);expectedMain=('b'*40);ownerDeploymentApproved=$true;windowsPassed=$true;ciPassed=$true;authorReviewPassed=$true;rollbackReviewed=$true;independentReviews=$reviews}
 if($case -eq 'missing-gate'){$gates.ciPassed=$false}
 if($case -eq 'duplicate-reviewer'){$reviews[1].reviewer='independent-one'}
 if($case -eq 'wrong-review-head'){$reviews[1].candidateHead='d'*40}
 if($case -eq 'model-gate-forged'){$gates.candidateModelContentPassed=$true}
 if($case -eq 'runtime-gate-forged'){$gates.runtimeAcceptancePassed=$true}
 if($case -eq 'wrong-owner-sha'){$gates.expectedMain='d'*40}
 $gates|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $receipts 'hard-gates.json') -Encoding UTF8
 @{pid=43211;dataRoot=$producerRoot;projectionRoot=(Join-Path $producerRoot 'runtime/cru34-live');snapshotPath=(Join-Path $producerRoot 'runtime/cru34-live/latest.json');statusPath=(Join-Path $producerRoot 'runtime/cru34-live/status.json');executionAuthorized=$false;orderRoutesEnabled=$false;observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|ForEach-Object {Put (Join-Path $producerRoot 'runtime/cru34-live/status.json') $_}
 if($case -eq 'missing-bundle'){[IO.File]::Delete($bundle)}
 if($case -eq 'changed-bundle'){Put $bundle 'changed-synthetic-bundle'}
 if($case -eq 'missing-tls-proof'){[IO.File]::Delete((Join-Path $receipts 'local-tls-preflight.json'))}
 $script:actions=[Collections.Generic.List[string]]::new();$script:formalHead=('a'*40);$script:currentPid=43210;$script:alive=$true;$script:rollbackStage=$false
 $beforeEnv=Sum (Join-Path $primary '.env');$beforeReport=Sum (Join-Path $primary $report)
 function git.exe {
  $a=@($args);$global:LASTEXITCODE=0;$where=$a[1]
  if($a -contains 'rev-parse'){
   $last=$a[-1]
   if($last -like '*^{tree}') {if($case -eq 'wrong-tree'){return ('f'*40)};return ('e'*40)}
   if($last -eq 'origin/main'){return ('b'*40)}
   if($last -eq 'HEAD'){if($where -eq $primary){return ('c'*40)};if($where -eq $formal){return $script:formalHead};return ('b'*40)}
   return $last
  }
  if($a -contains 'branch'){return 'codex/fixture-development'}
  if($a -contains 'status'){if($where -eq $primary){return (' M '+$report)};return ''}
  if($a -contains 'diff'){return ''}
  if($a -contains 'switch'){if($where -ne $formal){throw 'PRIMARY_MUTATION_FORBIDDEN'};$script:actions.Add('switch-formal:'+ $a[-1])|Out-Null;$script:formalHead=$a[-1];return ''}
  throw 'UNEXPECTED_GIT_MUTATION'
 }
 function Invoke-RestMethod {
  param($Uri,$TimeoutSec)
  if($Uri -eq 'http://127.0.0.1:8790/health'){return [pscustomobject]@{mode='market_data_only';executionAuthorized=$false;orderRoutesEnabled=$false}}
  if($Uri -eq 'http://127.0.0.1:8787/healthz'){return [pscustomobject]@{runtimeCommit=('a'*40);runtimeIdentityStatus='VERIFIED'}}
  throw 'UNEXPECTED_NETWORK_REQUEST'
 }
 function Get-NetTCPConnection {
  param($LocalPort,$State,$ErrorAction)
  if($LocalPort -ne 8787){throw 'UNEXPECTED_PORT'}
  if($case -eq 'foreign-listener'){return [pscustomobject]@{OwningProcess=98765}}
  if($script:alive){[pscustomobject]@{OwningProcess=$script:currentPid}}
 }
 function Get-CimInstance {
  param($ClassName,$Filter)
  if(-not $script:alive){return}
  $creation=$script:fixtureProcess.CreationDate
  if($case -eq 'pid-reuse' -or ($case -eq 'rollback-pid-reuse' -and $script:rollbackStage)){$creation=$creation.AddSeconds(1)}
  [pscustomobject]@{ProcessId=$script:currentPid;ExecutablePath=$script:fixtureProcess.ExecutablePath;CommandLine=$script:fixtureProcess.CommandLine;CreationDate=$creation}
 }
 function Stop-Process {param($Id);if($Id -ne $script:currentPid){throw 'UNKNOWN_PID'};$script:actions.Add('stop:'+ $Id)|Out-Null;$script:alive=$false}
 function Wait-Process {param($Id,$Timeout,$ErrorAction)}
 function Copy-Item {
  param($LiteralPath,$Destination)
  if($Destination -ne (Join-Path $formal '.env') -or [IO.Path]::GetDirectoryName($LiteralPath) -ne $receipts){throw 'UNEXPECTED_FILE_COPY'}
  $script:actions.Add('copy-formal-env')|Out-Null;[IO.File]::WriteAllBytes($Destination,[IO.File]::ReadAllBytes($LiteralPath))
 }
 function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
  if($WorkingDirectory -ne $formal -or $WindowStyle -ne 'Hidden' -or $ArgumentList.Count -ne 2 -or $ArgumentList[1] -notlike '*server.mjs*' -or ($ArgumentList -join ' ') -match 'launcher|bridge'){throw 'WRONG_RESTORE_ROOT_OR_ENTRY'}
  foreach($name in @('NODE_PATH','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')){if([Environment]::GetEnvironmentVariable($name,'Process')){throw 'AMBIENT_NODE_CONFIGURATION_SURVIVED'}}
  $script:actions.Add('start-formal')|Out-Null
  if($case -eq 'launch-failure' -and -not $script:rollbackStage){throw 'FIXTURE_LAUNCH_FAILED'}
  $script:alive=$true;$script:currentPid=54321;[pscustomobject]@{Id=54321}
 }
 $failure=$null;$rollbackFailure=$null;$retryFailure=$null;$beforeRollback=@();$startedPhase=$null;$accepted=$null
 if($case -eq 'ambient-node-environment'){foreach($name in @('NODE_PATH','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')){[Environment]::SetEnvironmentVariable($name,(Join-Path $root 'inert-nonexistent-fixture'),'Process')}}
 try{
  if($case -eq 'preflight'){& $rollout -Mode Preflight -PlanPath $planPath | Out-Null}
  else{
   & $rollout -Mode Deploy -PlanPath $planPath -ExpectedMain ('b'*40) | Out-Null
   $state=Get-Content -LiteralPath (Join-Path $receipts 'deployment-state.json') -Raw|ConvertFrom-Json
   $startedPhase=$state.phase;$accepted=$state.accepted
   if($case -eq 'lifecycle' -or $case -eq 'ambient-node-environment' -or $case -like 'rollback-*'){
    $script:rollbackStage=$true;$beforeRollback=@($script:actions.ToArray())
    if($case -eq 'rollback-plan-drift'){Add-Content -LiteralPath $planPath -Value ' '}
    if($case -eq 'rollback-missing-tls'){[IO.File]::Delete($bundle);[IO.File]::Delete((Join-Path $receipts 'local-tls-preflight.json'))}
    try { & $rollout -Mode Rollback -PlanPath $planPath -ExpectedMain ('b'*40) | Out-Null }catch{$rollbackFailure=$_.Exception.Message}
   }
  }
 }catch{
  $failure=$_.Exception.Message
  if($case -eq 'launch-failure'){
   try{& $rollout -Mode Deploy -PlanPath $planPath -ExpectedMain ('b'*40)|Out-Null}catch{$retryFailure=$_.Exception.Message}
   $script:rollbackStage=$true
   try{& $rollout -Mode Rollback -PlanPath $planPath -ExpectedMain ('b'*40)|Out-Null}catch{$rollbackFailure=$_.Exception.Message}
  }
 }
 $results+=@{case=$case;failure=$failure;rollbackFailure=$rollbackFailure;retryFailure=$retryFailure;startedPhase=$startedPhase;accepted=$accepted;actions=@($script:actions.ToArray());beforeRollback=$beforeRollback;primaryUnchanged=((Sum (Join-Path $primary '.env')) -eq $beforeEnv -and (Sum (Join-Path $primary $report)) -eq $beforeReport);formalHead=$script:formalHead;formalEnvironmentRestored=((Sum (Join-Path $formal '.env')) -eq $plan.formalEnvHash);stateExists=(Test-Path -LiteralPath (Join-Path $receipts 'deployment-state.json'))}
}
$results|ConvertTo-Json -Depth 8 -Compress
`;
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', windowsHide: true, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rows = JSON.parse(result.stdout.trim());
    assert.equal(rows.length, cases.length);
    for (const row of rows) await t.test(row.case, () => {
      assert.equal(row.primaryUnchanged, true, 'development environment/report must remain byte-identical');
      if (row.case === 'preflight') {
        assert.equal(row.failure, null); assert.deepEqual(row.actions, []);
      } else if (row.case === 'lifecycle' || row.case === 'ambient-node-environment' || row.case === 'rollback-missing-tls') {
        assert.equal(row.failure, null); assert.equal(row.rollbackFailure, null);
        assert.equal(row.startedPhase, 'STARTED_UNACCEPTED'); assert.equal(row.accepted, false);
        assert.deepEqual(row.actions, ['stop:43210', 'switch-formal:'+'b'.repeat(40), 'copy-formal-env', 'start-formal',
          'stop:54321', 'switch-formal:'+'a'.repeat(40), 'copy-formal-env', 'start-formal']);
        assert.equal(row.formalHead, 'a'.repeat(40)); assert.equal(row.formalEnvironmentRestored, true);
      } else if (row.case.startsWith('rollback-')) {
        assert.equal(row.failure, null); assert.ok(row.rollbackFailure);
        assert.deepEqual(row.actions, row.beforeRollback, 'refused rollback must not stop candidate');
      } else if (row.case === 'launch-failure') {
        assert.match(row.failure, /FIXTURE_LAUNCH_FAILED/); assert.equal(row.stateExists, true);
        assert.match(row.retryFailure, /already attempted|reconcil/i);
        assert.equal(row.rollbackFailure, null); assert.equal(row.formalHead, 'a'.repeat(40));
        assert.equal(row.formalEnvironmentRestored, true);
        assert.deepEqual(row.actions, ['stop:43210', 'switch-formal:'+'b'.repeat(40), 'copy-formal-env', 'start-formal',
          'switch-formal:'+'a'.repeat(40), 'copy-formal-env', 'start-formal']);
      } else {
        assert.ok(row.failure); assert.deepEqual(row.actions, []);
      }
    });
  } finally {
    assert.equal(path.dirname(root), parent);
    assert.equal(fs.readFileSync(path.join(root, 'fixture-owned.marker'), 'utf8'), 'synthetic-only');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
