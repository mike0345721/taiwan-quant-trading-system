import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repository, 'scripts/cru21-dashboard-rollout.ps1');
const checker = path.join(repository, 'scripts/check-cru21-rollout-target-env.mjs');
const q = value => "'" + value.replaceAll("'", "''") + "'";
const cases = ['preflight', 'lifecycle', 'primary-head-drift', 'primary-branch-drift', 'formal-dirty',
  'corrupt-backup', 'missing-gate', 'wrong-owner-sha', 'wrong-tree', 'pid-reuse',
  'foreign-listener', 'wrong-old-root', 'wrong-routing', 'stop-failure', 'launch-failure',
  'rollback-no-listener', 'rollback-plan-drift', 'rollback-foreign-listener', 'rollback-primary-drift',
  'string-gate', 'wrong-main', 'rollback-pid-reuse'];

// The complete script is evaluated only inside this disposable fixture harness.
// Every process, network, Git mutation and Copy-Item operation is intercepted.
// No execution policy is changed. Only dummy configuration files are read.
test('formal-only rollout: isolated Windows lifecycle and refusal matrix', { skip: process.platform !== 'win32' }, async t => {
  const parent = path.join(repository, 'data');
  const root = fs.mkdtempSync(path.join(parent, 'rollout-formal-root-test-'));
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
 $original="HOST=127.0.0.1\nPORT=8787\nMOCK_DATA=0\nNODE_ENV=production\nCOOKIE_SECURE=1\nDASHBOARD_PASSWORD_HASH=fixture-only-not-a-password\n"
 $target=$original+"ASK_GPT_INLINE_ENABLED=1\nDASHBOARD_FORMAL_READ_ROOT=$readRoot\nTX_CHART_DATA_ROOT=$readRoot\nTX_CHART_CACHE_ROOT=$producerRoot/dashboard-chart-cache\nCRU34_LIVE_DATA_ROOT=$producerRoot\nCRU34_LIVE_SNAPSHOT_PATH=$producerRoot/runtime/cru34-live/latest.json\nCRU34_LIVE_STATUS_PATH=$producerRoot/runtime/cru34-live/status.json\n"
 if($case -eq 'wrong-routing'){$target=$target.Replace('PORT=8787','PORT=18722')}
 foreach($p in @((Join-Path $primary '.env'),(Join-Path $formal '.env'),(Join-Path $receipts 'primary-original.env'),(Join-Path $receipts 'formal-original.env'))){Put $p $original}
 Put (Join-Path $receipts 'formal-target.env') $target
 Put (Join-Path $primary $report) 'unchanged-development-report'
 Put (Join-Path $receipts 'primary-dirty-report.md') 'unchanged-development-report'
 Put (Join-Path $formal 'server.mjs') '// inert fixture'
 if(Test-Path -LiteralPath $checker){Put (Join-Path $candidate 'scripts/check-cru21-rollout-target-env.mjs') ([IO.File]::ReadAllText($checker))}
 $old=[pscustomobject]@{ProcessId=43210;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine=('node --env-file="'+(Join-Path $formal '.env')+'" "'+(Join-Path $formal 'server.mjs')+'"');CreationDate=[datetime]'2026-10-30T00:00:00Z'}
 $script:fixtureProcess=$old
 $identity=@{pid=43210;creationDate=$old.CreationDate.ToUniversalTime().ToString('o');executable=$old.ExecutablePath;commandLine=$old.CommandLine}
 $plan=@{schema='cru21-rollout-plan-v3-formal-only';primary=$primary;formal=$formal;candidate=$candidate;oldRuntimeRoot=$formal;primaryHead=('c'*40);primaryBranch='codex/fixture-development';base=('a'*40);head=('b'*40);tree=('e'*40);formalPid=43210;producerPid=43211;readDataRoot=$readRoot;producerDataRoot=$producerRoot;oldProcess=$identity;dirtyReportPath=$report;dirtyReportHash=(Sum (Join-Path $primary $report));primaryEnvHash=(Sum (Join-Path $primary '.env'));formalEnvHash=(Sum (Join-Path $formal '.env'));targetEnvHash=(Sum (Join-Path $receipts 'formal-target.env'))}
 if($case -eq 'wrong-old-root'){$plan.oldRuntimeRoot=$primary}
 $planPath=Join-Path $receipts 'plan.json';$plan|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $planPath -Encoding UTF8
 $gates=@{candidateHead=('b'*40);expectedMain=('b'*40);ownerDeploymentApproved=$true;candidateModelContentPassed=$true;windowsPassed=$true;ciPassed=$true;independentReviewPassed=$true;runtimeAcceptancePassed=$true;rollbackReviewed=$true}
 if($case -eq 'missing-gate'){$gates.candidateModelContentPassed=$false}
 if($case -eq 'wrong-owner-sha'){$gates.expectedMain=('c'*40)}
 if($case -eq 'string-gate'){$gates.ownerDeploymentApproved='true'}
 $gates|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $receipts 'hard-gates.json') -Encoding UTF8
 @{pid=43211;dataRoot=$producerRoot;projectionRoot=(Join-Path $producerRoot 'runtime/cru34-live');snapshotPath=(Join-Path $producerRoot 'runtime/cru34-live/latest.json');statusPath=(Join-Path $producerRoot 'runtime/cru34-live/status.json');executionAuthorized=$false;orderRoutesEnabled=$false;observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|ForEach-Object {Put (Join-Path $producerRoot 'runtime/cru34-live/status.json') $_}
 $script:actions=[Collections.Generic.List[string]]::new();$script:formalHead=('a'*40);$script:currentPid=43210;$script:alive=$true;$script:rollbackStage=$false
 $beforeEnv=Sum (Join-Path $primary '.env');$beforeReport=Sum (Join-Path $primary $report)
 if($case -eq 'corrupt-backup'){Put (Join-Path $receipts 'formal-original.env') 'corrupted'}
 function git.exe {
  $a=@($args);$global:LASTEXITCODE=0;$where=$a[1]
  if($a -contains 'rev-parse'){
   $last=$a[-1]
   if($last -like '*^{tree}') { if($case -eq 'wrong-tree'){return ('f'*40)};return ('e'*40) }
   if($last -eq 'origin/main'){if($case -eq 'wrong-main'){return ('d'*40)};return ('b'*40)}
   if($last -eq 'HEAD'){
    if($where -eq $primary){if($case -eq 'primary-head-drift' -or ($case -eq 'rollback-primary-drift' -and $script:rollbackStage)){return ('d'*40)};return ('c'*40)}
    if($where -eq $formal){return $script:formalHead};return ('b'*40)
   }
   return $last
  }
  if($a -contains 'branch'){if($case -eq 'primary-branch-drift'){return 'other'};return 'codex/fixture-development'}
  if($a -contains 'status'){if($where -eq $primary){return (' M '+$report)};if($case -eq 'formal-dirty' -and $where -eq $formal){return ' M server.mjs'};return ''}
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
  if($case -eq 'foreign-listener' -or ($case -eq 'rollback-foreign-listener' -and $script:rollbackStage)){return [pscustomobject]@{OwningProcess=98765}}
  if($case -eq 'rollback-no-listener' -and $script:rollbackStage){return}
  if($script:alive){[pscustomobject]@{OwningProcess=$script:currentPid}}
 }
 function Get-CimInstance {
  param($ClassName,$Filter)
  if(-not $script:alive){return}
  $creation=$script:fixtureProcess.CreationDate
  if($case -eq 'pid-reuse' -or ($case -eq 'rollback-pid-reuse' -and $script:rollbackStage)){$creation=$creation.AddSeconds(1)}
  [pscustomobject]@{ProcessId=$script:currentPid;ExecutablePath=$script:fixtureProcess.ExecutablePath;CommandLine=$script:fixtureProcess.CommandLine;CreationDate=$creation}
 }
 function Stop-Process {param($Id);if($Id -ne $script:currentPid){throw 'UNKNOWN_PID'};$script:actions.Add('stop:'+ $Id)|Out-Null;if($case -ne 'stop-failure'){$script:alive=$false}}
 function Wait-Process {param($Id,$Timeout,$ErrorAction)}
 function Copy-Item {
  param($LiteralPath,$Destination)
  if($Destination -ne (Join-Path $formal '.env') -or [IO.Path]::GetDirectoryName($LiteralPath) -ne $receipts){throw 'UNEXPECTED_FILE_COPY'}
  $script:actions.Add('copy-formal-env')|Out-Null;[IO.File]::WriteAllBytes($Destination,[IO.File]::ReadAllBytes($LiteralPath))
 }
 function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
  if($WorkingDirectory -ne $formal -or $ArgumentList.Count -ne 2 -or $ArgumentList[1] -notlike '*server.mjs*' -or ($ArgumentList -join ' ') -match 'launcher|bridge'){throw 'WRONG_RESTORE_ROOT_OR_ENTRY'}
  $script:actions.Add('start-formal')|Out-Null
  if($case -eq 'launch-failure'){throw 'FIXTURE_LAUNCH_FAILED'}
  $script:alive=$true;$script:currentPid=54321;[pscustomobject]@{Id=54321}
 }
 $failure=$null;$rollbackFailure=$null;$retryFailure=$null;$beforeRollback=@()
 try{
  if($case -eq 'preflight'){& $rollout -Mode Preflight -PlanPath $planPath | Out-Null}
  else{
   & $rollout -Mode Deploy -PlanPath $planPath -ExpectedMain ('b'*40) | Out-Null
   if($case -eq 'lifecycle' -or $case -like 'rollback-*'){
    $script:rollbackStage=$true;$beforeRollback=@($script:actions.ToArray())
    if($case -eq 'rollback-plan-drift'){Add-Content -LiteralPath $planPath -Value ' '}
    try { & $rollout -Mode Rollback -PlanPath $planPath -ExpectedMain ('b'*40) | Out-Null }catch{$rollbackFailure=$_.Exception.Message}
   }
  }
 }catch{
  $failure=$_.Exception.Message
  if($case -eq 'launch-failure'){try{& $rollout -Mode Deploy -PlanPath $planPath -ExpectedMain ('b'*40)|Out-Null}catch{$retryFailure=$_.Exception.Message}}
 }
 $results+=@{case=$case;failure=$failure;rollbackFailure=$rollbackFailure;retryFailure=$retryFailure;actions=@($script:actions.ToArray());beforeRollback=$beforeRollback;primaryUnchanged=((Sum (Join-Path $primary '.env')) -eq $beforeEnv -and (Sum (Join-Path $primary $report)) -eq $beforeReport);formalHead=$script:formalHead;stateExists=(Test-Path -LiteralPath (Join-Path $receipts 'deployment-state.json'))}
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
      assert.equal(row.primaryUnchanged, true, 'development report and environment must stay byte-identical');
      if (row.case === 'preflight') {
        assert.equal(row.failure, null); assert.deepEqual(row.actions, []);
      } else if (row.case === 'lifecycle' || row.case === 'rollback-no-listener') {
        assert.equal(row.failure, null); assert.equal(row.rollbackFailure, null);
        assert.deepEqual(row.actions, ['stop:43210', 'switch-formal:'+'b'.repeat(40), 'copy-formal-env', 'start-formal',
          'stop:54321', 'switch-formal:'+'a'.repeat(40), 'copy-formal-env', 'start-formal']);
        assert.equal(row.formalHead, 'a'.repeat(40));
      } else if (row.case.startsWith('rollback-')) {
        assert.equal(row.failure, null); assert.ok(row.rollbackFailure);
        assert.deepEqual(row.actions, row.beforeRollback, 'refused rollback must not stop even the candidate');
      } else if (row.case === 'launch-failure') {
        assert.match(row.failure, /FIXTURE_LAUNCH_FAILED/); assert.equal(row.stateExists, true);
        assert.match(row.retryFailure, /already attempted|reconcil/i);
        assert.equal(row.actions.filter(a => a === 'start-formal').length, 1);
      } else if (row.case === 'stop-failure') {
        assert.ok(row.failure); assert.deepEqual(row.actions, ['stop:43210']);
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
