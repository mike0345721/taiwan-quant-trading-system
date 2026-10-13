Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-BoundJson([string]$Path) {
  if (-not [IO.File]::Exists($Path)) { return $null }
  return [IO.File]::ReadAllText($Path) | ConvertFrom-Json
}
function Assert-Bound([bool]$Condition, [string]$Reason) {
  if (-not $Condition) { throw "BOUND_START_$Reason" }
}
function Get-BoundProcess([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if (-not $p) { return $null }
  [pscustomobject]@{ pid=[int]$p.ProcessId; createdAt=$p.CreationDate.ToUniversalTime().ToString('o'); executable=$p.ExecutablePath; command=$p.CommandLine }
}
function Get-BoundListener([int]$Port) {
  $owners = @(& netstat.exe -ano -p tcp | ForEach-Object { if ($_ -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") { [int]$Matches[1] } } | Select-Object -Unique)
  Assert-Bound ($owners.Count -le 1) 'MULTIPLE_LISTENERS'
  if ($owners.Count) { return Get-BoundProcess $owners[0] }
  return $null
}
function Get-BoundHealth([int]$Port) {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/$(if ($Port -eq 8790) {'health'} else {'healthz'})" -TimeoutSec 20 } catch { return $null }
}
function Assert-BoundConsoleChildren($Dashboard, $Children) {
  $console=Join-Path $env:WINDIR 'System32\conhost.exe'
  foreach ($child in $Children) {
    # Windows creates this OS console host with a hidden console process.
    # Do not confuse it with an application child (Bridge/research/collector).
    $age=($child.CreationDate.ToUniversalTime()-[datetime]::Parse($Dashboard.createdAt).ToUniversalTime()).TotalSeconds
    Assert-Bound ($child.ExecutablePath -ieq $console -and $child.CommandLine -ieq ('\??\'+$console+' 0x4') -and $age -ge 0 -and $age -lt 1) 'DASHBOARD_HAS_APPLICATION_CHILDREN'
  }
}
function Assert-BoundSource($Source, [string[]]$AllowedDirty = @()) {
  Assert-Bound ([IO.Path]::IsPathRooted($Source.root) -and $Source.commit -cmatch '^[0-9a-f]{40}$') 'SOURCE_PIN_REQUIRED'
  $actual = & git -C $Source.root rev-parse HEAD
  Assert-Bound ($LASTEXITCODE -eq 0 -and $actual -ceq $Source.commit) 'SOURCE_SHA_MISMATCH'
  $dirty = @(& git -C $Source.root diff HEAD --name-only)
  Assert-Bound ($LASTEXITCODE -eq 0) 'SOURCE_INSPECTION_FAILED'
  foreach ($name in $dirty) { Assert-Bound ($AllowedDirty -ccontains $name) 'SOURCE_DIRTY' }
  # Untracked executable source could affect dynamic imports. Ignored local data/dependencies are separate.
  $untracked = @(& git -C $Source.root ls-files --others --exclude-standard)
  Assert-Bound ($LASTEXITCODE -eq 0 -and $untracked.Count -eq 0) 'SOURCE_UNTRACKED'
}
function Read-BoundPlan([string]$BindingPath, [string]$LauncherRoot) {
  $b = Read-BoundJson $BindingPath
  Assert-Bound ($null -ne $b) 'BINDING_MISSING'
  Assert-Bound ($b.schemaVersion -ceq 'cru21-bound-daily-use-v1' -and $b.authorizedScope -ceq 'PIN_EXISTING_PRODUCER_AND_REBIND_READER') 'SCOPE_REQUIRED'
  Assert-Bound ($b.launcher.root -ceq $LauncherRoot) 'LAUNCHER_ROOT_MISMATCH'
  Assert-Bound ($b.dashboard.allowedDirty.Count -le 1) 'DIRTY_ALLOWLIST'
  foreach ($name in $b.dashboard.allowedDirty) { Assert-Bound ($name -ceq 'v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md') 'DIRTY_ALLOWLIST' }
  Assert-BoundSource $b.launcher
  Assert-BoundSource $b.producer
  Assert-BoundSource $b.dashboard $b.dashboard.allowedDirty
  foreach ($value in @($b.dataRoot,$b.projectionRoot,$b.envFile,$b.node,$b.logRoot)) {
    Assert-Bound ([IO.Path]::IsPathRooted($value) -and ([IO.Path]::GetFullPath($value) -ceq $value)) 'ABSOLUTE_PATH_REQUIRED'
  }
  Assert-Bound ($b.projectionRoot -ceq (Join-Path $b.dataRoot 'runtime\cru34-live')) 'PROJECTION_ROOT_MISMATCH'
  Assert-Bound ($b.envFile -ceq (Join-Path $b.dashboard.root '.env')) 'ENV_ROOT_MISMATCH'
  Assert-Bound ($b.logRoot -ceq (Join-Path $b.dataRoot 'automation-logs\bound-daily-use')) 'LOG_ROOT_MISMATCH'
  foreach ($file in @($b.envFile,$b.node,(Join-Path $b.dashboard.root 'server.mjs'),(Join-Path $b.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1'),(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs'))) {
    Assert-Bound ([IO.File]::Exists($file)) 'SOURCE_FILE_MISSING'
  }
  # This package cannot activate a different collector, candidate, or CVD binding.
  $forbidden = '^(NODE_OPTIONS|NODE_PATH|CRU55_.*|CRU54_.*|FORWARD_SHADOW_.*|TXO_.*|CVD_.*|TX_CHART_.*|V2_RESEARCH_DATABASE_PATH|V2_BACKTEST_REPORT_PATH|DATA_OPERATIONS_OUTPUT_ROOT)$'
  foreach ($item in Get-ChildItem Env:) {
    if ($item.Name -match $forbidden) { Assert-Bound (-not $item.Value) 'UNEXPECTED_SHELL_ROUTING' }
  }
  foreach ($line in [IO.File]::ReadAllLines($b.envFile)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and $Matches[1] -match $forbidden) {
      Assert-Bound ([string]::IsNullOrWhiteSpace($line.Split('=',2)[1].Trim().Trim('"').Trim("'"))) 'UNEXPECTED_ENV_ROUTING'
    }
  }
  foreach ($file in @('data\cru55-runtime\binding.json','data\runtime\cru55-binding.json')) {
    Assert-Bound (-not [IO.File]::Exists((Join-Path $b.dashboard.root $file))) 'OTHER_BINDING_REQUIRES_REVIEW'
  }
  return $b
}
function Get-BoundPaths($b) {
  return @{ CRU34_LIVE_DATA_ROOT=$b.dataRoot; CRU34_LIVE_PROJECTION_ROOT=$b.projectionRoot;
    CRU34_LIVE_SNAPSHOT_PATH=(Join-Path $b.projectionRoot 'latest.json'); CRU34_LIVE_STATUS_PATH=(Join-Path $b.projectionRoot 'status.json') }
}
function Assert-BoundWorker($b, $Status, $Lock, $Process) {
  Assert-Bound ($null -ne $Status -and $null -ne $Lock -and $null -ne $Process) 'OWNER_UNVERIFIED'
  Assert-Bound ($Status.schemaVersion -ceq 'cru34-live-worker-status-v1') 'OWNER_SCHEMA'
  Assert-Bound ($Status.workerInstanceId -cmatch '^[0-9a-f-]{36}$' -and $Status.workerInstanceId -ceq $Lock.workerInstanceId -and $Status.pid -eq $Lock.pid -and $Process.pid -eq $Lock.pid) 'OWNER_IDENTITY'
  $paths = Get-BoundPaths $b
  Assert-Bound ($Status.dataRoot -ceq $b.dataRoot -and $Status.projectionRoot -ceq $b.projectionRoot -and $Status.snapshotPath -ceq $paths.CRU34_LIVE_SNAPSHOT_PATH -and $Status.statusPath -ceq $paths.CRU34_LIVE_STATUS_PATH -and $Lock.dataRoot -ceq $b.dataRoot -and $Lock.projectionRoot -ceq $b.projectionRoot) 'OWNER_PATHS'
  Assert-Bound ($Status.formalWeight -eq 0 -and $Status.researchOnly -eq $true -and $Status.executionAuthorized -eq $false -and $Status.orderRoutesEnabled -eq $false) 'OWNER_SAFETY'
  $runner = Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs'
  Assert-Bound ($Process.executable -ieq $b.node -and $Process.command.Trim() -ceq ('"' + $b.node + '" "' + $runner + '"')) 'OWNER_SOURCE'
  $age = ([datetime]::UtcNow - [datetime]::Parse($Status.observedAt).ToUniversalTime()).TotalSeconds
  $started = [datetime]::Parse($Status.workerStartedAt).ToUniversalTime()
  $created = [datetime]::Parse($Process.createdAt).ToUniversalTime()
  Assert-Bound ($age -ge -5 -and $age -le 15 -and ($started - $created).TotalSeconds -ge 0 -and ($started - $created).TotalSeconds -le 10 -and $Status.workerStartedAt -ceq $Lock.workerStartedAt) 'OWNER_LIFETIME'
}
function Assert-BoundDashboard($b, $Health, $Process, [switch]$MissingProducer) {
  Assert-Bound ($null -ne $Health -and $null -ne $Process) 'DASHBOARD_UNVERIFIED'
  $server = Join-Path $b.dashboard.root 'server.mjs'
  $expected = '"' + $b.node + '" --env-file="' + $b.envFile + '" "' + $server + '"'
  Assert-Bound ($Process.executable -ieq $b.node -and $Process.command.Trim() -ceq $expected) 'DASHBOARD_SOURCE'
  Assert-Bound ($Health.ok -eq $true -and $Health.service -ceq 'tw-chip-dashboard-v1' -and $Health.runtimeCommit -ceq $b.dashboard.commit -and $Health.approvedMainCommit -ceq $b.dashboard.commit -and $Health.runtimeIdentityStatus -ceq 'VERIFIED' -and $Health.syncState -ceq 'SYNCED') 'DASHBOARD_VERSION'
  $producer = $Health.runtimeEvidence.producer
  $refused=@('LIVE_PRODUCER_PATH_MISMATCH','LIVE_PRODUCER_INSTANCE_MISMATCH')
  # A clean worker exit removes its lock. Permit only that proven-dead case;
  # a real mismatched lock/instance or a live PID without a lock still fails.
  if ($MissingProducer -and $null -eq $producer.lock -and $null -ne $producer.worker -and
    $producer.worker.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $producer.worker.pid -gt 0 -and
    $null -eq (Get-BoundProcess ([int]$producer.worker.pid))) { $refused=@('LIVE_PRODUCER_PATH_MISMATCH') }
  if (-not $MissingProducer) { $refused+=@('LIVE_PRODUCER_PROCESS_MISSING','LIVE_PRODUCER_HEARTBEAT_STALE') }
  Assert-Bound (@($producer.reasons | Where-Object { $_ -in $refused }).Count -eq 0) 'DASHBOARD_IDENTITY_REJECTED'
  Assert-Bound ($producer.snapshot.path -ceq (Join-Path $b.projectionRoot 'latest.json') -and $producer.statusFile.path -ceq (Join-Path $b.projectionRoot 'status.json')) 'DASHBOARD_PATHS'
  if (-not $MissingProducer) { Assert-BoundWorker $b $producer.worker $producer.lock (Get-BoundProcess ([int]$producer.pid)) }
  # Market quality/readiness is reported as-is; no predicate or quality threshold is weakened.
}
function Start-BoundNode($b,[string]$Role,[string]$Arguments,[string]$WorkingRoot) {
  $id = [guid]::NewGuid().ToString()
  $stem = Join-Path $b.logRoot "$Role-$id"
  if ($Role -eq 'producer') {
    $env:CRU34_LIVE_WORKER_INSTANCE_ID = $id
    $env:CRU34_LIVE_STDOUT_PATH = "$stem.stdout.log"
    $env:CRU34_LIVE_STDERR_PATH = "$stem.stderr.log"
    $env:CRU34_LIVE_INCIDENT_PATH = "$stem.incident.ndjson"
  }
  $p = Start-Process -FilePath $b.node -ArgumentList $Arguments -WorkingDirectory $WorkingRoot -WindowStyle Hidden -RedirectStandardOutput "$stem.stdout.log" -RedirectStandardError "$stem.stderr.log" -PassThru
  $receipt = @{ at=[datetime]::UtcNow.ToString('o'); role=$Role; source=$(if ($Role -eq 'producer') {$b.producer} else {$b.dashboard}); process=(Get-BoundProcess $p.Id); logs=$stem }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$stem.launch.json" -Encoding UTF8
  return $p.Id
}
function Invoke-BoundStart($b,[switch]$NoBrowser) {
  # All incumbent checks precede any runtime change. No process is ever stopped here.
  $lock = Read-BoundJson (Join-Path $b.projectionRoot 'worker.lock')
  $status = Read-BoundJson (Join-Path $b.projectionRoot 'status.json')
  $owner = $null
  if ($lock) {
    Assert-Bound ($lock.pid -gt 0 -and $lock.workerInstanceId -cmatch '^[0-9a-f-]{36}$') 'LOCK_UNVERIFIED'
    $owner = Get-BoundProcess ([int]$lock.pid)
    if ($owner) { Assert-BoundWorker $b $status $lock $owner }
  }
  if (-not $owner -and $status) {
    Assert-Bound ($status.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $status.pid -gt 0) 'STATUS_UNVERIFIED'
    Assert-Bound ($null -eq (Get-BoundProcess ([int]$status.pid))) 'LIVE_STATUS_WITHOUT_OWNER_LOCK'
  }
  $dashboard = Get-BoundListener 8787
  if ($dashboard) { Assert-BoundDashboard $b (Get-BoundHealth 8787) $dashboard -MissingProducer:($null -eq $owner) }
  $bridge = Get-BoundListener 8790
  if ($bridge) {
    $health = Get-BoundHealth 8790
    Assert-Bound ($null -ne $health -and $health.ok -eq $true -and $health.mode -ceq 'market_data_only' -and $health.formalWeight -eq 0 -and $health.researchOnly -eq $true -and $health.executionAuthorized -eq $false -and $health.orderRoutesEnabled -eq $false) 'BRIDGE_UNVERIFIED'
  }
  New-Item -ItemType Directory -Path $b.logRoot -Force | Out-Null
  $paths = Get-BoundPaths $b
  foreach ($key in $paths.Keys) { [Environment]::SetEnvironmentVariable($key,$paths[$key],'Process') }
  $env:HOST = '127.0.0.1'; $env:PORT = '8787'
  # Preserve the existing standalone bridge starter; never run broad recovery/research automation.
  if (-not $bridge) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $b.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1')
    Assert-Bound ($LASTEXITCODE -eq 0) 'BRIDGE_START_FAILED'
  }
  if (-not $owner) {
    $newPid = Start-BoundNode $b 'producer' ('"' + (Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs') + '"') $b.producer.root
    $ready = $false
    foreach ($attempt in 1..60) {
      Start-Sleep -Milliseconds 500
      $lock = Read-BoundJson (Join-Path $b.projectionRoot 'worker.lock')
      if ($lock -and $lock.pid -eq $newPid) {
        try { $owner = Get-BoundProcess $newPid; Assert-BoundWorker $b (Read-BoundJson (Join-Path $b.projectionRoot 'status.json')) $lock $owner; $ready=$true; break } catch { }
      }
    }
    Assert-Bound $ready 'PRODUCER_START_UNVERIFIED'
  }
  if (-not $dashboard) {
    $newPid = Start-BoundNode $b 'dashboard' ('--env-file="' + $b.envFile + '" "' + (Join-Path $b.dashboard.root 'server.mjs') + '"') $b.dashboard.root
    $ready = $false
    foreach ($attempt in 1..12) {
      Start-Sleep -Milliseconds 500
      $dashboard = Get-BoundListener 8787
      if ($dashboard -and $dashboard.pid -eq $newPid) {
        try { Assert-BoundDashboard $b (Get-BoundHealth 8787) $dashboard; $ready=$true; break } catch { }
      }
    }
    Assert-Bound $ready 'DASHBOARD_START_UNVERIFIED'
  }
  $health = Get-BoundHealth 8787
  Assert-BoundDashboard $b $health (Get-BoundListener 8787)
  $result = @{ at=[datetime]::UtcNow.ToString('o'); result='BOUND_SOURCE_READY'; producer=$owner; dashboard=$dashboard; producerReady=$health.runtimeEvidence.producer.ready; producerReasons=$health.runtimeEvidence.producer.reasons; snapshot=$health.runtimeEvidence.producer.observedFlowIdentity; launcher=$b.launcher; producerSource=$b.producer; dashboardSource=$b.dashboard }
  $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $b.logRoot ("startup-"+[guid]::NewGuid().ToString()+'.json')) -Encoding UTF8
  if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8787' }
  return $result
}
Export-ModuleMember -Function *-Bound*
