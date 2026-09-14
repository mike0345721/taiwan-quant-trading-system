param(
  [string]$DataRoot,
  [string]$ProjectionRoot,
  [string]$WorkingRoot,
  [switch]$RestartMismatched
)

$ErrorActionPreference = 'Stop'
$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$root = [System.IO.Path]::GetFullPath($(if ($WorkingRoot) { $WorkingRoot } else { Split-Path $PSScriptRoot -Parent }))
$dataRoot = [System.IO.Path]::GetFullPath($(if ($DataRoot) { $DataRoot } else { Join-Path $root 'data' }))
$projectionRoot = [System.IO.Path]::GetFullPath($(if ($ProjectionRoot) { $ProjectionRoot } else { Join-Path $root 'data\runtime\cru34-live' }))
$lockPath = Join-Path $projectionRoot 'worker.lock'
$snapshotPath = Join-Path $projectionRoot 'latest.json'
$statusPath = Join-Path $projectionRoot 'status.json'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $projectionRoot, $logDir | Out-Null

function Read-JsonFile([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Test-SamePath([string]$Left, [string]$Right) {
  if (-not $Left -or -not $Right) { return $false }
  try {
    return [System.IO.Path]::GetFullPath($Left).TrimEnd('\') -eq [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
  } catch { return $false }
}

function Test-Cru34ProducerMatch($Status, $Lock, [datetime]$Now = (Get-Date)) {
  if (-not $Status -or -not $Lock) { return $false }
  $observedAt = [datetime]::MinValue
  if (-not [datetime]::TryParse([string]$Status.observedAt, [ref]$observedAt)) { return $false }
  $heartbeatAge = ($Now.ToUniversalTime() - $observedAt.ToUniversalTime()).TotalSeconds
  return ($Status.schemaVersion -eq 'cru34-live-worker-status-v1') -and
    ($Status.status -eq 'AVAILABLE') -and
    ([int]$Status.pid -eq [int]$Lock.pid) -and
    ([int]$Status.pid -gt 0) -and
    ($Status.workerInstanceId -eq $Lock.workerInstanceId) -and
    ($Status.workerInstanceId -match '^[0-9a-f-]{36}$') -and
    (Test-SamePath $Status.dataRoot $dataRoot) -and
    (Test-SamePath $Status.projectionRoot $projectionRoot) -and
    (Test-SamePath $Status.snapshotPath $snapshotPath) -and
    (Test-SamePath $Status.statusPath $statusPath) -and
    (Test-SamePath $Lock.dataRoot $dataRoot) -and
    (Test-SamePath $Lock.projectionRoot $projectionRoot) -and
    ($Status.formalWeight -eq 0) -and ($Status.researchOnly -eq $true) -and
    ($Status.executionAuthorized -eq $false) -and ($Status.orderRoutesEnabled -eq $false) -and
    ($heartbeatAge -ge -5) -and ($heartbeatAge -le 15)
}

if (Test-Path -LiteralPath $lockPath) {
  $lock = Read-JsonFile $lockPath
  # Unknown records may belong to an initializing runner. Only the runner
  # mutates worker.lock, under its shared mutation guard.
  if (-not $lock -or -not ($lock.pid -is [long] -or $lock.pid -is [int]) -or
      $lock.pid -le 0 -or -not ($lock.workerInstanceId -is [string]) -or
      [string]::IsNullOrWhiteSpace($lock.workerInstanceId)) {
    throw 'CRU34_LIVE_PRODUCER_INCUMBENT_UNVERIFIED'
  }
  $incumbentPid = if ($lock) { [int]$lock.pid } else { 0 }
  $incumbent = if ($incumbentPid -gt 0) { Get-Process -Id $incumbentPid -ErrorAction SilentlyContinue } else { $null }
  if ($incumbent) {
    $status = Read-JsonFile $statusPath
    if (Test-Cru34ProducerMatch $status $lock) { exit 0 }
    $verifiedOwnedInstance = $status -and ($status.schemaVersion -eq 'cru34-live-worker-status-v1') -and
      ([int]$status.pid -eq $incumbentPid) -and ($status.workerInstanceId -eq $lock.workerInstanceId) -and
      ($status.executionAuthorized -eq $false) -and ($status.orderRoutesEnabled -eq $false)
    if (-not $RestartMismatched) { throw 'CRU34_LIVE_PRODUCER_MISMATCH' }
    if (-not $verifiedOwnedInstance) { throw 'CRU34_LIVE_PRODUCER_INCUMBENT_UNVERIFIED' }
    Stop-Process -Id $incumbentPid
    foreach ($attempt in 1..20) {
      Start-Sleep -Milliseconds 250
      if (-not (Get-Process -Id $incumbentPid -ErrorAction SilentlyContinue)) { break }
    }
    if (Get-Process -Id $incumbentPid -ErrorAction SilentlyContinue) { throw 'CRU34_LIVE_PRODUCER_RESTART_STOP_TIMEOUT' }
  }
  # Dead-owner takeover belongs to acquireCru34WorkerLockSync in the runner.
  # Concurrent launchers may spawn contenders; only one obtains write rights.
}

$env:CRU34_LIVE_DATA_ROOT = $dataRoot
$env:CRU34_LIVE_PROJECTION_ROOT = $projectionRoot
$env:CRU34_LIVE_SNAPSHOT_PATH = $snapshotPath
$env:CRU34_LIVE_STATUS_PATH = $statusPath

$launchId = [guid]::NewGuid().ToString()
$launchStamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$logStem = "cru34-live-projection-$launchStamp-$launchId"
$stdout = Join-Path $logDir "$logStem.stdout.log"
$stderr = Join-Path $logDir "$logStem.stderr.log"
$incidentDir = Join-Path $logDir 'cru34-live-incidents'
New-Item -ItemType Directory -Force -Path $incidentDir | Out-Null
$incident = Join-Path $incidentDir "$logStem.incident.ndjson"
$env:CRU34_LIVE_WORKER_INSTANCE_ID = $launchId
$env:CRU34_LIVE_STDOUT_PATH = $stdout
$env:CRU34_LIVE_STDERR_PATH = $stderr
$env:CRU34_LIVE_INCIDENT_PATH = $incident
Start-Process -FilePath $node -ArgumentList 'scripts/run-cru34-live-projection.mjs' `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

foreach ($attempt in 1..120) {
  Start-Sleep -Milliseconds 500
  $status = Read-JsonFile $statusPath
  $lock = Read-JsonFile $lockPath
  if ((Test-Cru34ProducerMatch $status $lock) -and
      (Get-Process -Id ([int]$status.pid) -ErrorAction SilentlyContinue)) { exit 0 }
}
throw 'CRU34_LIVE_PRODUCER_NOT_READY'
