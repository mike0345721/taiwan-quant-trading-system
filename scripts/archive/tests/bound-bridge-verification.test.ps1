param([string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$modulePath = Join-Path $ProjectRoot 'scripts\bound-daily-use.psm1'
$fixtureRoot = Join-Path $ProjectRoot ('data\bound-bridge-tests-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$script:passed = 0
$script:failures = @()
function Check([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Case([string]$Name, [scriptblock]$Body) {
  try { & $Body; $script:passed++; Write-Output "PASS $Name" }
  catch { $script:failures += "$Name`: $($_.Exception.Message)"; Write-Output "FAIL $Name`: $($_.Exception.Message)" }
}
function New-Fixture([string]$Mode) {
  $module = Import-Module $modulePath -Force -PassThru
  $state = [pscustomobject]@{ mode=$Mode; bridgePresent=($Mode -in @('existing','initial-unsafe','vanish','final-unsafe','identity-change','pid-reuse')); bridgeReads=0; starterCalls=0; starterArgs=@(); runtimeStarts=0 }
  $plan = [pscustomobject]@{
    dataRoot=$fixtureRoot; projectionRoot=(Join-Path $fixtureRoot 'runtime\cru34-live')
    logRoot=(Join-Path $fixtureRoot $Mode); launcher=@{root='synthetic'}; producer=@{root='synthetic'}
    dashboard=@{root='synthetic'}; envFile='synthetic-never-read'; node='synthetic-never-run'
  }
  & $module {
    param($State)
    $script:bridgeTest=$State
    function script:Read-BoundJson([string]$Path) {
      if ($Path.EndsWith('worker.lock')) { return [pscustomobject]@{pid=42420;workerInstanceId='11111111-1111-4111-8111-111111111111'} }
      return [pscustomobject]@{pid=42420}
    }
    function script:Get-BoundProcess([int]$ProcessId) { return [pscustomobject]@{pid=$ProcessId} }
    function script:Assert-BoundWorker { }
    function script:Assert-BoundDashboard { }
    function script:Get-BoundListener([int]$Port) {
      if ($Port -eq 8787) { return [pscustomobject]@{pid=42421} }
      if ($Port -ne 8790) { throw 'TEST_UNEXPECTED_PORT' }
      $script:bridgeTest.bridgeReads++
      if ($script:bridgeTest.mode -eq 'vanish' -and $script:bridgeTest.bridgeReads -gt 1) { return $null }
      if ($script:bridgeTest.mode -eq 'identity-change' -and $script:bridgeTest.bridgeReads -gt 1) { return [pscustomobject]@{pid=42423;createdAt='2026-11-02T01:01:00.000Z'} }
      if ($script:bridgeTest.mode -eq 'pid-reuse' -and $script:bridgeTest.bridgeReads -gt 1) { return [pscustomobject]@{pid=42422;createdAt='2026-11-02T01:01:00.000Z'} }
      if ($script:bridgeTest.bridgePresent) { return [pscustomobject]@{pid=42422;createdAt='2026-11-02T01:00:00.000Z'} }
      return $null
    }
    function script:Get-BoundHealth([int]$Port) {
      if ($Port -eq 8787) { return [pscustomobject]@{runtimeEvidence=[pscustomobject]@{producer=[pscustomobject]@{ready=$false;reasons=@('CURRENT_LEDGER_MISSING');observedFlowIdentity=$null}}} }
      if ($Port -ne 8790) { throw 'TEST_UNEXPECTED_PORT' }
      if ($script:bridgeTest.mode -eq 'unreachable') { return $null }
      $unsafe=($script:bridgeTest.mode -in @('initial-unsafe','new-unsafe') -or ($script:bridgeTest.mode -eq 'final-unsafe' -and $script:bridgeTest.bridgeReads -gt 1))
      return [pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$unsafe;orderRoutesEnabled=$false}
    }
    # Every possible process/network boundary is mocked; no broker or live service is used.
    function script:powershell.exe {
      $script:bridgeTest.starterCalls++
      $script:bridgeTest.starterArgs=@($args)
      $script:LASTEXITCODE=0
      if ($script:bridgeTest.mode -eq 'starter-failed') { $script:LASTEXITCODE=7 }
      if ($script:bridgeTest.mode -in @('new-safe','new-unsafe','unreachable')) { $script:bridgeTest.bridgePresent=$true }
    }
    function script:Start-BoundNode { $script:bridgeTest.runtimeStarts++; throw 'TEST_RUNTIME_LAUNCH_FORBIDDEN' }
    function script:Start-Process { throw 'TEST_PROCESS_LAUNCH_FORBIDDEN' }
    function script:Stop-Process { throw 'TEST_PROCESS_STOP_FORBIDDEN' }
    function script:Start-Sleep { }
  } $state
  return [pscustomobject]@{module=$module;state=$state;plan=$plan}
}
function Run-Fixture($Fixture) { return & $Fixture.module { param($Plan) Invoke-BoundStart $Plan -NoBrowser } $Fixture.plan }
function Must-Refuse($Fixture,[string]$Reason) {
  $caught=$null
  try { Run-Fixture $Fixture | Out-Null } catch { $caught=$_.Exception.Message }
  Check ($null -ne $caught -and $caught -like "*$Reason*") "Expected $Reason; got $caught"
  Check ($Fixture.state.runtimeStarts -eq 0) 'Refusal launched a runtime'
  Check (@(Get-ChildItem -LiteralPath $Fixture.plan.logRoot -Filter 'startup-*.json' -ErrorAction SilentlyContinue).Count -eq 0) 'Refusal persisted a success receipt'
}
$names=@('HOST','PORT','CRU34_LIVE_DATA_ROOT','CRU34_LIVE_PROJECTION_ROOT','CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH')
$saved=@{}
foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
  Case 'existing healthy Bridge is reused without invoking its starter' {
    $f=New-Fixture 'existing';$r=Run-Fixture $f
    Check ($r.result -ceq 'BOUND_SOURCE_READY' -and $f.state.starterCalls -eq 0 -and $f.state.runtimeStarts -eq 0) 'Existing Bridge was not reused'
    Check (-not $r.producerReady) 'Bridge readiness promoted missing market data'
  }
  Case 'zero-exit no-op starter cannot report readiness without a listener' {
    $f=New-Fixture 'no-op';Must-Refuse $f 'BRIDGE_START_UNVERIFIED'
    Check ($f.state.starterCalls -eq 1) 'Starter was repeated or skipped'
  }
  Case 'nonzero starter fails without launching another runtime' { $f=New-Fixture 'starter-failed';Must-Refuse $f 'BRIDGE_START_FAILED' }
  Case 'new listener must expose safe market-data-only health' { $f=New-Fixture 'new-unsafe';Must-Refuse $f 'BRIDGE_START_UNVERIFIED' }
  Case 'new listener with unreachable health is not ready' { $f=New-Fixture 'unreachable';Must-Refuse $f 'BRIDGE_START_UNVERIFIED' }
  Case 'verified safe starter outcome preserves broker authorization and OS policy' {
    $f=New-Fixture 'new-safe';$r=Run-Fixture $f
    Check ($r.result -ceq 'BOUND_SOURCE_READY' -and $f.state.starterCalls -eq 1) 'Safe new Bridge was not accepted'
    Check (($f.state.starterArgs -join ' ') -notmatch 'OwnerApprovedStart|ExecutionPolicy|Bypass') 'Starter expanded authorization or overrode policy'
    Check ($f.state.starterArgs -contains '-NonInteractive') 'Starter can prompt indefinitely'
  }
  Case 'unsafe incumbent Bridge refuses without starter invocation' {
    $f=New-Fixture 'initial-unsafe';Must-Refuse $f 'BRIDGE_UNVERIFIED'
    Check ($f.state.starterCalls -eq 0) 'Unsafe incumbent triggered another login'
  }
  Case 'Bridge disappearance before final receipt cannot report readiness' { $f=New-Fixture 'vanish';Must-Refuse $f 'BRIDGE_FINAL_UNVERIFIED' }
  Case 'Bridge safety change before final receipt cannot report readiness' { $f=New-Fixture 'final-unsafe';Must-Refuse $f 'BRIDGE_FINAL_UNVERIFIED' }
  Case 'Bridge listener replacement before final receipt cannot report readiness' { $f=New-Fixture 'identity-change';Must-Refuse $f 'BRIDGE_FINAL_UNVERIFIED' }
  Case 'Bridge PID reuse before final receipt cannot report readiness' { $f=New-Fixture 'pid-reuse';Must-Refuse $f 'BRIDGE_FINAL_UNVERIFIED' }
  foreach($field in @('ok','researchOnly','executionAuthorized','orderRoutesEnabled','formalWeight')) {
    foreach($invalidType in @('string','null')) {
      Case "Bridge $field as $invalidType cannot satisfy the safety contract" {
        $f=New-Fixture 'existing'
        $health=[pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}
        $health.$field = $(if($invalidType -eq 'string'){[string]$health.$field}else{$null})
        $caught=$null
        try { & $f.module {param($Health) Assert-BoundBridge ([pscustomobject]@{pid=42422;createdAt='2026-11-02T01:00:00.000Z'}) $Health} $health } catch { $caught=$_.Exception.Message }
        Check ($null -ne $caught -and $caught -like '*BRIDGE_UNVERIFIED*') 'Invalid typed flag was accepted'
      }
    }
  }
} finally {
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
  Remove-Module bound-daily-use -Force -ErrorAction SilentlyContinue
}
Write-Output "RESULT passed=$($script:passed) failed=$($script:failures.Count) fixtures=$fixtureRoot"
if($script:failures.Count){throw ($script:failures -join "`n")}
