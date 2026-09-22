param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [Parameter(Mandatory=$true)][string]$BindingFile,
  [switch]$Candidate,
  [int]$CandidateCycles = 0
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$BindingFile = (Resolve-Path -LiteralPath $BindingFile).Path
$worker = Join-Path $ProjectRoot 'scripts\run-cru55-managed.mjs'
$flags = @(); if ($Candidate) { $flags += '--candidate' }
if ($CandidateCycles -ne 0) {
  if (-not $Candidate -or $CandidateCycles -lt 1 -or $CandidateCycles -gt 100) { throw 'CRU55_MANAGED_CYCLE_BUDGET' }
  $flags += "--cycles=$CandidateCycles"
}
$planText = & node $worker $BindingFile @flags --inspect
if ($LASTEXITCODE -ne 0) { throw 'CRU55_MANAGED_PREFLIGHT_FAILED' }
$plan = $planText | ConvertFrom-Json
$lock = Join-Path $plan.outputRoot 'managed-owner.lock'
function Read-Cru55SharedJson([string]$File) {
  $stream = [System.IO.File]::Open($File, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
  try { $reader = [System.IO.StreamReader]::new($stream); try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } } finally { $stream.Dispose() }
}

function Test-Cru55ManagedOwner($Owner, $Process, $Plan, [string]$ConfigPath, [string]$WorkerPath) {
  return $Owner -and $Process -and ($Owner.schemaVersion -eq 'cru55-managed-owner-v1') -and
    ($Owner.pid -eq $Process.ProcessId) -and
    ($Owner.startTime -eq $Process.CreationDate.ToUniversalTime().ToString('o')) -and
    ($Owner.commandLine -ceq $Process.CommandLine) -and
    ($Owner.bindingHash -eq $Plan.bindingHash) -and ($Owner.runtimeCommit -eq $Plan.runtimeCommit) -and
    ($Owner.configPath -eq $ConfigPath) -and
    ($Process.CommandLine.Contains('"' + $WorkerPath + '"')) -and
    ($Process.CommandLine.Contains('"' + $ConfigPath + '"'))
}
function Wait-Cru55ManagedReady([int]$WorkerPid) {
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $ownerFile = Join-Path $lock 'owner.json'
  $statusFile = Join-Path $plan.outputRoot 'stream-managed-status.json'
  do {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $WorkerPid" -OperationTimeoutSec 5
    if (-not $processInfo) { throw 'CRU55_MANAGED_START_EXITED' }
    if (Test-Path -LiteralPath $ownerFile -PathType Leaf) {
      $currentOwner = Read-Cru55SharedJson $ownerFile
      if (-not (Test-Cru55ManagedOwner $currentOwner $processInfo $plan $BindingFile $worker)) { throw 'CRU55_MANAGED_OWNER_MISMATCH_NO_KILL' }
      if (Test-Path -LiteralPath $statusFile -PathType Leaf) {
        $status = Read-Cru55SharedJson $statusFile
        if ($status.ownerNonce -eq $currentOwner.nonce -and $status.ownerPid -eq $WorkerPid -and $status.bindingHash -eq $plan.bindingHash -and $status.runtimeCommit -eq $plan.runtimeCommit) {
          if ($status.state -eq 'BLOCKED') { throw 'CRU55_MANAGED_START_BLOCKED' }
          if ($status.state -in @('PENDING','PUBLISHED','UNCHANGED','WAITING_FOR_SOURCE','WAITING_FOR_COMPLETE_RECORD','WAITING_FOR_ELIGIBLE_TRADE')) { return }
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'CRU55_MANAGED_START_NOT_VERIFIED_NO_KILL'
}
if (Test-Path -LiteralPath $lock) {
  $ownerFile = Join-Path $lock 'owner.json'
  if (-not (Test-Path -LiteralPath $ownerFile -PathType Leaf)) { throw 'CRU55_MANAGED_UNKNOWN_LOCK' }
  $owner = Read-Cru55SharedJson $ownerFile
  if ($owner.schemaVersion -ne 'cru55-managed-owner-v1' -or -not $owner.pid -or -not $owner.startTime -or -not $owner.commandLine -or -not $owner.nonce) { throw 'CRU55_MANAGED_UNKNOWN_OWNER' }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$owner.pid)" -OperationTimeoutSec 5
  if (Test-Cru55ManagedOwner $owner $processInfo $plan $BindingFile $worker) { Wait-Cru55ManagedReady ([int]$owner.pid); Write-Output 'CRU55 managed writer already matches persistent configuration and reported cycle status.'; exit 0 }
  if ($processInfo) { throw 'CRU55_MANAGED_OWNER_MISMATCH_NO_KILL' }
  if ($owner.bindingHash -ne $plan.bindingHash -or $owner.runtimeCommit -ne $plan.runtimeCommit -or $owner.configPath -ne $BindingFile) { throw 'CRU55_MANAGED_STALE_CONFIG_REQUIRES_REVIEW' }
  # Proven absent PID, exact same config/head: preserve stale ownership evidence,
  # never remove an unknown lock or kill an unrelated/reused process.
  $resolvedLock = (Resolve-Path -LiteralPath $lock).Path
  $resolvedOutput = [System.IO.Path]::GetFullPath($plan.outputRoot).TrimEnd('\')
  if ([System.IO.Path]::GetDirectoryName($resolvedLock) -ne $resolvedOutput) { throw 'CRU55_MANAGED_LOCK_ESCAPE' }
  $retired = Join-Path $resolvedOutput ('managed-owner.retired-' + [guid]::NewGuid().ToString())
  Move-Item -LiteralPath $resolvedLock -Destination $retired
}
$logRoot = Join-Path $plan.outputRoot 'managed-logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$node = (Get-Command node.exe -ErrorAction Stop).Source
function Quote-Cru55Arg([string]$Value) { if ($Value.Contains('"')) { throw 'CRU55_MANAGED_ARGUMENT_QUOTES' }; return '"' + $Value + '"' }
$arguments = @((Quote-Cru55Arg $worker),(Quote-Cru55Arg $BindingFile)) + $flags
$runStamp = [guid]::NewGuid().ToString()
$child = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "$runStamp.stdout.log") -RedirectStandardError (Join-Path $logRoot "$runStamp.stderr.log")
Wait-Cru55ManagedReady $child.Id
Write-Output 'CRU55 managed writer started with verified owner identity and reported cycle status.'
