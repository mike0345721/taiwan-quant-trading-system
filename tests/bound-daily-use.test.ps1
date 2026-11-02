param([string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$modulePath = Join-Path $ProjectRoot 'scripts\bound-daily-use.psm1'
$entryPath = Join-Path $ProjectRoot 'scripts\start-bound-daily-use.ps1'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('cru21-bound-start-tests-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$script:passed = 0
$script:failed = @()
function Check([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Case([string]$Name, [scriptblock]$Body) {
  try { & $Body; $script:passed++; Write-Output "PASS $Name" }
  catch { $script:failed += "$Name`: $($_.Exception.Message)"; Write-Output "FAIL $Name`: $($_.Exception.Message)" }
}
function Must-Throw([scriptblock]$Body, [string]$Reason) {
  $caught = $null
  try { & $Body | Out-Null } catch { $caught = $_.Exception.Message }
  Check ($null -ne $caught) "Expected rejection: $Reason"
  Check ($caught -like "*$Reason*") "Wrong rejection: expected $Reason; got $caught"
}
function Copy-Object($Value) { return $Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json }
function Save-Json([string]$File, $Value) { [IO.File]::WriteAllText($File, ($Value | ConvertTo-Json -Depth 20)) }
function New-Source([string]$Name) {
  $root = Join-Path $fixtureRoot $Name
  [IO.Directory]::CreateDirectory((Join-Path $root 'scripts')) | Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $root 'v2\reports')) | Out-Null
  [IO.File]::WriteAllText((Join-Path $root '.gitignore'), ".env`ndata/`n")
  [IO.File]::WriteAllText((Join-Path $root 'server.mjs'), '// synthetic source only')
  [IO.File]::WriteAllText((Join-Path $root 'scripts\run-cru34-live-projection.mjs'), '// synthetic source only')
  [IO.File]::WriteAllText((Join-Path $root 'scripts\start-shioaji-readonly-hidden.ps1'), "throw 'TEST_FIXTURE_MUST_NEVER_START_BRIDGE'")
  [IO.File]::WriteAllText((Join-Path $root 'v2\reports\V3_3_OI_NORMALIZATION_AUDIT.md'), 'existing report')
  [IO.File]::WriteAllText((Join-Path $root '.env'), "# synthetic; no credentials`nNODE_ENV=test`n")
  & git -C $root init -q
  if ($LASTEXITCODE -ne 0) { throw 'Fixture git init failed' }
  & git -C $root add .
  if ($LASTEXITCODE -ne 0) { throw 'Fixture git add failed' }
  & git -C $root -c user.name=BoundStartTest -c user.email=bound-test@example.invalid commit -qm fixture
  if ($LASTEXITCODE -ne 0) { throw 'Fixture git commit failed' }
  return [pscustomobject]@{ root=$root; commit=(& git -C $root rev-parse HEAD).Trim() }
}
function Load-Module { return Import-Module $modulePath -Force -PassThru }
function New-Runtime($Plan) {
  $created = [datetime]::UtcNow.AddSeconds(-2).ToString('o')
  $started = [datetime]::Parse($created).AddMilliseconds(100).ToString('o')
  $worker = [pscustomobject]@{
    schemaVersion='cru34-live-worker-status-v1'; status='AVAILABLE'; pid=42420
    workerInstanceId='11111111-1111-4111-8111-111111111111'; workerStartedAt=$started
    observedAt=[datetime]::UtcNow.ToString('o'); dataRoot=$Plan.dataRoot; projectionRoot=$Plan.projectionRoot
    snapshotPath=(Join-Path $Plan.projectionRoot 'latest.json'); statusPath=(Join-Path $Plan.projectionRoot 'status.json')
    formalWeight=0; researchOnly=$true; executionAuthorized=$false; orderRoutesEnabled=$false
  }
  $lock = [pscustomobject]@{ pid=$worker.pid; workerInstanceId=$worker.workerInstanceId; workerStartedAt=$started; dataRoot=$Plan.dataRoot; projectionRoot=$Plan.projectionRoot }
  $owner = [pscustomobject]@{ pid=$worker.pid; createdAt=$created; executable=$Plan.node; command=('"'+$Plan.node+'" "'+(Join-Path $Plan.producer.root 'scripts\run-cru34-live-projection.mjs')+'"') }
  $dashboard = [pscustomobject]@{ pid=42421; createdAt=$created; executable=$Plan.node; command=('"'+$Plan.node+'" --env-file="'+$Plan.envFile+'" "'+(Join-Path $Plan.dashboard.root 'server.mjs')+'"') }
  $health = [pscustomobject]@{ ok=$true; service='tw-chip-dashboard-v1'; runtimeCommit=$Plan.dashboard.commit; approvedMainCommit=$Plan.dashboard.commit; runtimeIdentityStatus='VERIFIED'; syncState='SYNCED';
    runtimeEvidence=[pscustomobject]@{producer=[pscustomobject]@{ ready=$true; reasons=@(); pid=$owner.pid; worker=$worker; lock=$lock;
      snapshot=[pscustomobject]@{path=$worker.snapshotPath}; statusFile=[pscustomobject]@{path=$worker.statusPath}; observedFlowIdentity=[pscustomobject]@{tradeDate='2026-10-14';session='NIGHT';actualContract='SYNTHETIC'} }} }
  return [pscustomobject]@{ worker=$worker; lock=$lock; owner=$owner; dashboard=$dashboard; health=$health; ownerPresent=$true; dashboardPresent=$true; starts=(New-Object Collections.ArrayList); browserStarts=0 }
}
function Mock-Runtime($Module, $Runtime) {
  & $Module {
    param($State)
    $script:testRuntime=$State
    function script:Get-BoundProcess([int]$ProcessId) {
      if ($script:testRuntime.ownerPresent -and $ProcessId -eq $script:testRuntime.owner.pid) { return $script:testRuntime.owner }
      if ($script:testRuntime.dashboardPresent -and $ProcessId -eq $script:testRuntime.dashboard.pid) { return $script:testRuntime.dashboard }
      return $null
    }
    function script:Read-BoundJson([string]$Path) {
      if ($Path.EndsWith('worker.lock')) { if ($script:testRuntime.ownerPresent) { return $script:testRuntime.lock }; return $null }
      if ($Path.EndsWith('status.json')) { return $script:testRuntime.worker }
      throw 'TEST_UNEXPECTED_READ'
    }
    function script:Get-BoundListener([int]$Port) {
      if ($Port -eq 8790) { return [pscustomobject]@{pid=42422;createdAt='2026-10-14T01:00:00.000Z'} }
      if ($Port -eq 8787 -and $script:testRuntime.dashboardPresent) { return $script:testRuntime.dashboard }
      return $null
    }
    function script:Get-BoundHealth([int]$Port) {
      if ($Port -eq 8790) { return [pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false} }
      return $script:testRuntime.health
    }
    function script:Start-BoundNode($b,[string]$Role,[string]$Arguments,[string]$WorkingRoot) {
      $script:testRuntime.starts.Add([pscustomobject]@{role=$Role;arguments=$Arguments;workingRoot=$WorkingRoot}) | Out-Null
      if ($Role -eq 'producer') { $script:testRuntime.ownerPresent=$true; return $script:testRuntime.owner.pid }
      if ($Role -eq 'dashboard') { $script:testRuntime.dashboardPresent=$true; return $script:testRuntime.dashboard.pid }
      throw 'TEST_UNEXPECTED_ROLE'
    }
    function script:Start-Sleep { }
    function script:Start-Process { throw 'TEST_RUNTIME_LAUNCH_FORBIDDEN' }
    function script:Stop-Process { throw 'TEST_RUNTIME_STOP_FORBIDDEN' }
  } $Runtime
}
$savedEnvironment = @{}
$environmentNames = @('HOST','PORT','NODE_OPTIONS','NODE_PATH') + @(Get-ChildItem Env: | Where-Object { $_.Name -match '^(CRU34_|CRU55_|CRU54_|FORWARD_SHADOW_|TXO_|CVD_|TX_CHART_|V2_RESEARCH_DATABASE_PATH$|V2_BACKTEST_REPORT_PATH$|DATA_OPERATIONS_OUTPUT_ROOT$)' } | ForEach-Object Name)
$environmentNames += @('CRU34_LIVE_DATA_ROOT','CRU34_LIVE_PROJECTION_ROOT','CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH')
foreach ($name in ($environmentNames | Select-Object -Unique)) { $savedEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
try {
  $launcher=New-Source 'launcher'; $producer=New-Source 'producer'; $dashboard=New-Source 'dashboard'
  $dashboard | Add-Member -NotePropertyName allowedDirty -NotePropertyValue @()
  $dataRoot=Join-Path $fixtureRoot 'data'
  $plan=[pscustomobject]@{schemaVersion='cru21-bound-daily-use-v1';authorizedScope='PIN_EXISTING_PRODUCER_AND_REBIND_READER';launcher=$launcher;producer=$producer;dashboard=$dashboard;
    dataRoot=$dataRoot;projectionRoot=(Join-Path $dataRoot 'runtime\cru34-live');envFile=(Join-Path $dashboard.root '.env');node=(Get-Command node.exe).Source;logRoot=(Join-Path $dataRoot 'automation-logs\bound-daily-use')}
  $bindingPath=Join-Path $fixtureRoot 'binding.json'
  Save-Json $bindingPath $plan
  $module=Load-Module
  Case 'verified Windows console child is distinct from a collector' {
    $parent=[pscustomobject]@{createdAt=[datetime]::UtcNow.AddSeconds(-2).ToString('o')}
    $console=Join-Path $env:WINDIR 'System32\conhost.exe'
    $child=[pscustomobject]@{ExecutablePath=$console;CommandLine=('\??\'+$console+' 0x4');CreationDate=[datetime]::Parse($parent.createdAt).AddMilliseconds(15)}
    & $module {param($p,$c) Assert-BoundConsoleChildren $p @($c)} $parent $child
  }
  Case 'application child blocks consumer cutover' {
    $parent=[pscustomobject]@{createdAt=[datetime]::UtcNow.AddSeconds(-2).ToString('o')}
    $child=[pscustomobject]@{ExecutablePath='D:\Python\python.exe';CommandLine='python bridge.py';CreationDate=[datetime]::Parse($parent.createdAt).AddMilliseconds(15)}
    Must-Throw { & $module {param($p,$c) Assert-BoundConsoleChildren $p @($c)} $parent $child } 'DASHBOARD_HAS_APPLICATION_CHILDREN'
  }
  Case 'lookalike console from a foreign path is rejected' {
    $parent=[pscustomobject]@{createdAt=[datetime]::UtcNow.AddSeconds(-2).ToString('o')}
    $child=[pscustomobject]@{ExecutablePath='D:\foreign\conhost.exe';CommandLine='\??\D:\foreign\conhost.exe 0x4';CreationDate=[datetime]::Parse($parent.createdAt).AddMilliseconds(15)}
    Must-Throw { & $module {param($p,$c) Assert-BoundConsoleChildren $p @($c)} $parent $child } 'DASHBOARD_HAS_APPLICATION_CHILDREN'
  }
  Case 'real clean source pins and complete plan pass' { $actual=& $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root; Check ($actual.producer.commit -ceq $producer.commit) 'wrong source' }
  Case 'wrong source SHA fails closed' { $bad=Copy-Object $producer; $bad.commit='0'*40; Must-Throw { & $module {param($s) Assert-BoundSource $s} $bad } 'SOURCE_SHA_MISMATCH' }
  Case 'relative source root fails closed' { $bad=Copy-Object $producer; $bad.root='relative'; Must-Throw { & $module {param($s) Assert-BoundSource $s} $bad } 'SOURCE_PIN_REQUIRED' }
  Case 'tracked source edit fails closed' {
    $file=Join-Path $producer.root 'server.mjs'; [IO.File]::WriteAllText($file,'changed')
    try { Must-Throw { & $module {param($s) Assert-BoundSource $s} $producer } 'SOURCE_DIRTY' } finally { [IO.File]::WriteAllText($file,'// synthetic source only') }
  }
  Case 'untracked executable source fails closed' {
    $file=Join-Path $producer.root 'extra.mjs'; [IO.File]::WriteAllText($file,'// untracked')
    try { Must-Throw { & $module {param($s) Assert-BoundSource $s} $producer } 'SOURCE_UNTRACKED' } finally { [IO.File]::Delete($file) }
  }
  Case 'ignored data does not invalidate a source pin' {
    [IO.Directory]::CreateDirectory((Join-Path $producer.root 'data')) | Out-Null; [IO.File]::WriteAllText((Join-Path $producer.root 'data\fixture.txt'),'synthetic ignored state')
    & $module {param($s) Assert-BoundSource $s} $producer
  }
  Case 'only expressly allowed report edit is accepted' {
    $file=Join-Path $dashboard.root 'v2\reports\V3_3_OI_NORMALIZATION_AUDIT.md'; [IO.File]::WriteAllText($file,'existing modified report')
    try { & $module {param($s) Assert-BoundSource $s @('v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md')} $dashboard } finally { [IO.File]::WriteAllText($file,'existing report') }
  }
  Case 'missing binding fails closed' { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} (Join-Path $fixtureRoot 'missing.json') $launcher.root } 'BINDING_MISSING' }
  Case 'launcher root mismatch fails before actions' { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $producer.root } 'LAUNCHER_ROOT_MISMATCH' }
  Case 'unsupported scope fails closed' { $bad=Copy-Object $plan; $bad.authorizedScope='WHOLE_PR82'; Save-Json $bindingPath $bad; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'SCOPE_REQUIRED' } finally { Save-Json $bindingPath $plan } }
  Case 'foreign dotenv path is rejected' { $bad=Copy-Object $plan; $bad.envFile=Join-Path $producer.root '.env'; Save-Json $bindingPath $bad; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'ENV_ROOT_MISMATCH' } finally { Save-Json $bindingPath $plan } }
  Case 'projection outside the bound data root is rejected' { $bad=Copy-Object $plan; $bad.projectionRoot=Join-Path $producer.root 'data\runtime\cru34-live'; Save-Json $bindingPath $bad; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'PROJECTION_ROOT_MISMATCH' } finally { Save-Json $bindingPath $plan } }
  Case 'missing executable is rejected' { $bad=Copy-Object $plan; $bad.node=Join-Path $fixtureRoot 'missing-node.exe'; Save-Json $bindingPath $bad; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'SOURCE_FILE_MISSING' } finally { Save-Json $bindingPath $plan } }
  Case 'shell NODE_OPTIONS injection is rejected' { $env:NODE_OPTIONS='--trace-warnings'; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'UNEXPECTED_SHELL_ROUTING' } finally { $env:NODE_OPTIONS=$null } }
  Case 'dotenv candidate routing is rejected' { [IO.File]::WriteAllText($plan.envFile,"CRU55_INTEGRATION_CANDIDATE=1`n"); try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'UNEXPECTED_ENV_ROUTING' } finally { [IO.File]::WriteAllText($plan.envFile,"# synthetic; no credentials`nNODE_ENV=test`n") } }
  Case 'unapproved dirty allowlist cannot expand scope' { $bad=Copy-Object $plan; $bad.dashboard.allowedDirty=@('server.mjs'); Save-Json $bindingPath $bad; try { Must-Throw { & $module {param($f,$r) Read-BoundPlan $f $r} $bindingPath $launcher.root } 'DIRTY_ALLOWLIST' } finally { Save-Json $bindingPath $plan } }
  foreach ($scenario in @('source','path','instance','lifetime','heartbeat','safety')) {
    Case "incumbent $scenario mismatch refuses all starts" {
      $module=Load-Module; $runtime=New-Runtime $plan; Mock-Runtime $module $runtime
      switch ($scenario) {
        source { $runtime.owner.command='"unknown-node" "unknown-runner"'; $reason='OWNER_SOURCE' }
        path { $runtime.worker.dataRoot+='-alias'; $reason='OWNER_PATHS' }
        instance { $runtime.lock.workerInstanceId='22222222-2222-4222-8222-222222222222'; $reason='OWNER_IDENTITY' }
        lifetime { $runtime.owner.createdAt=[datetime]::UtcNow.AddMinutes(1).ToString('o'); $reason='OWNER_LIFETIME' }
        heartbeat { $runtime.worker.observedAt=[datetime]::UtcNow.AddMinutes(-1).ToString('o'); $reason='OWNER_LIFETIME' }
        safety { $runtime.worker.executionAuthorized=$true; $reason='OWNER_SAFETY' }
      }
      Must-Throw { & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan } $reason
      Check ($runtime.starts.Count -eq 0) 'Refusal launched a process'
    }
  }
  Case 'normal repeated startup reuses the same exact owner and dashboard' {
    $module=Load-Module; $runtime=New-Runtime $plan; Mock-Runtime $module $runtime
    $one=& $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan
    $two=& $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan
    Check ($runtime.starts.Count -eq 0) 'Repeated invocation launched a duplicate'
    Check ($one.producer.pid -eq $two.producer.pid -and $one.dashboard.pid -eq $two.dashboard.pid) 'Owner identity changed'
  }
  Case 'cold start selects exactly pinned absolute producer and original dashboard' {
    $module=Load-Module; $runtime=New-Runtime $plan; $runtime.ownerPresent=$false; $runtime.dashboardPresent=$false; Mock-Runtime $module $runtime
    & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan | Out-Null
    Check ($runtime.starts.Count -eq 2) 'Expected exactly producer and dashboard'
    Check ($runtime.starts[0].role -ceq 'producer' -and $runtime.starts[0].workingRoot -ceq $plan.producer.root -and $runtime.starts[0].arguments -ceq ('"'+(Join-Path $plan.producer.root 'scripts\run-cru34-live-projection.mjs')+'"')) 'Producer source was not pinned'
    Check ($runtime.starts[1].role -ceq 'dashboard' -and $runtime.starts[1].workingRoot -ceq $plan.dashboard.root -and $runtime.starts[1].arguments -ceq ('--env-file="'+$plan.envFile+'" "'+(Join-Path $plan.dashboard.root 'server.mjs')+'"')) 'Dashboard source or env changed'
    Check ($env:CRU34_LIVE_DATA_ROOT -ceq $plan.dataRoot -and $env:CRU34_LIVE_SNAPSHOT_PATH -ceq (Join-Path $plan.projectionRoot 'latest.json')) 'Reader binding was not applied'
  }
  Case 'missing producer recovers while the correctly bound dashboard stays alive' {
    $module=Load-Module; $runtime=New-Runtime $plan; $runtime.ownerPresent=$false; Mock-Runtime $module $runtime
    & $module {
      function script:Get-BoundHealth([int]$Port) {
        if ($Port -eq 8790) { return [pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false} }
        $script:testRuntime.health.runtimeEvidence.producer.reasons = $(if ($script:testRuntime.ownerPresent) {@()} else {@('LIVE_PRODUCER_PROCESS_MISSING','LIVE_PRODUCER_HEARTBEAT_STALE','LIVE_PRODUCER_INSTANCE_MISMATCH')})
        $script:testRuntime.health.runtimeEvidence.producer.lock = $(if ($script:testRuntime.ownerPresent) {$script:testRuntime.lock} else {$null})
        return $script:testRuntime.health
      }
    }
    & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan | Out-Null
    Check ($runtime.starts.Count -eq 1 -and $runtime.starts[0].role -ceq 'producer') 'Must recover only the pinned producer'
  }
  Case 'a live status PID without an ownership lock refuses startup' {
    $module=Load-Module; $runtime=New-Runtime $plan; Mock-Runtime $module $runtime
    & $module { function script:Read-BoundJson([string]$Path) { if ($Path.EndsWith('worker.lock')) { return $null }; return $script:testRuntime.worker } }
    Must-Throw { & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan } 'LIVE_STATUS_WITHOUT_OWNER_LOCK'
    Check ($runtime.starts.Count -eq 0) 'Missing lock with live PID caused a launch'
  }
  foreach ($reason in @('LIVE_PRODUCER_PATH_MISMATCH','LIVE_PRODUCER_INSTANCE_MISMATCH')) {
    Case "dashboard $reason cannot report bound readiness" {
      $module=Load-Module; $runtime=New-Runtime $plan; $runtime.health.runtimeEvidence.producer.ready=$false; $runtime.health.runtimeEvidence.producer.reasons=@($reason); Mock-Runtime $module $runtime
      $caught=$false
      try { & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan | Out-Null } catch { $caught=$true }
      Check $caught 'Identity mismatch was reported as BOUND_SOURCE_READY'
      Check ($runtime.starts.Count -eq 0) 'Mismatched incumbent caused a launch'
    }
  }
  Case 'unknown dashboard command refuses before producer startup' {
    $module=Load-Module; $runtime=New-Runtime $plan; $runtime.ownerPresent=$false; $runtime.dashboard.command='"unknown-service"'; Mock-Runtime $module $runtime
    Must-Throw { & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan } 'DASHBOARD_SOURCE'
    Check ($runtime.starts.Count -eq 0) 'Unknown dashboard caused a launch'
  }
  Case 'unsafe occupied bridge refuses before any new runtime starts' {
    $module=Load-Module; $runtime=New-Runtime $plan; $runtime.ownerPresent=$false; $runtime.dashboardPresent=$false; Mock-Runtime $module $runtime
    & $module { function script:Get-BoundHealth([int]$Port) { return [pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$true;orderRoutesEnabled=$false} } }
    Must-Throw { & $module {param($b) Invoke-BoundStart $b -NoBrowser} $plan } 'BRIDGE_UNVERIFIED'
    Check ($runtime.starts.Count -eq 0) 'Unsafe bridge caused a launch'
  }
  Case 'Windows named mutex serializes a second actual entry process' {
    $mutex=New-Object Threading.Mutex($false,'Global\TwChipBoundDailyUseV1'); $owned=$false
    try {
      try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
      Check $owned 'Another real startup is active; contention test did not acquire mutex'
      # The missing binding ensures even a broken mutex cannot reach runtime actions.
      $output=& powershell.exe -NoProfile -NonInteractive -File $entryPath -BindingPath (Join-Path $fixtureRoot 'never-exists.json') -NoBrowser 2>&1
      Check ($LASTEXITCODE -eq 3 -and ($output -join "`n") -match 'BUSY_NOT_READY') 'Second process was not serialized'
    } finally { if ($owned) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
  }
} finally {
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process') }
  Remove-Module bound-daily-use -Force -ErrorAction SilentlyContinue
}
Write-Output "RESULT passed=$($script:passed) failed=$($script:failed.Count) fixtures=$fixtureRoot"
if ($script:failed.Count) { throw ($script:failed -join "`n") }
