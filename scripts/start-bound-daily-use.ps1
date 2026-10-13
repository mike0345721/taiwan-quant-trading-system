param([Parameter(Mandatory=$true)][string]$BindingPath,[switch]$NoBrowser,[switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'bound-daily-use.psm1') -Force
# A machine-wide startup name serializes every installed entry, even path aliases.
# Windows releases the mutex if the launching process crashes; no stale file deletion.
$mutex = New-Object Threading.Mutex($false, 'Local\TwChipBoundDailyUseV1')
$owned = $false
try {
  try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
  if (-not $owned) { Write-Output 'BOUND_START_ALREADY_RUNNING'; exit 0 }
  $plan = Read-BoundPlan $BindingPath (Split-Path $PSScriptRoot -Parent)
  if ($CheckOnly) { Write-Output 'BOUND_PREFLIGHT_PASS'; exit 0 }
  Invoke-BoundStart $plan -NoBrowser:$NoBrowser | ConvertTo-Json -Depth 10
} finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
