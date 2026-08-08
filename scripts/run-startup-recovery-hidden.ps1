$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$statusPath = Join-Path $root 'v2\reports\v3-daily-update-status.json'
$lockPath = Join-Path $root 'v2\data\.v3-daily-update.lock'
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'startup-recovery.log'

function Write-RecoveryLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "[$(Get-Date -Format o)] $Message" -Encoding UTF8
}

function Get-PreviousWeekday([datetime]$Date) {
  $candidate = $Date.Date.AddDays(-1)
  while ($candidate.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)) {
    $candidate = $candidate.AddDays(-1)
  }
  return $candidate
}

function Get-ExpectedCompletionTime([datetime]$Now) {
  if ($Now.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)) {
    return (Get-PreviousWeekday $Now).AddHours(21).AddMinutes(15)
  }
  $morning = $Now.Date.AddHours(8).AddMinutes(30)
  $evening = $Now.Date.AddHours(21).AddMinutes(15)
  if ($Now -ge $evening) { return $evening }
  if ($Now -ge $morning) { return $morning }
  return (Get-PreviousWeekday $Now).AddHours(21).AddMinutes(15)
}

if (Test-Path $lockPath) {
  Write-RecoveryLog 'Skipped: the daily update is already running.'
  exit 0
}

$expected = Get-ExpectedCompletionTime (Get-Date)
$completed = $null
if (Test-Path $statusPath) {
  try {
    $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
    if ($status.state -in @('completed', 'completed_with_warnings')) {
      $completed = [datetime]::Parse($status.completedAt).ToLocalTime()
    }
  } catch {
    Write-RecoveryLog 'The status file could not be parsed; recovery will run.'
  }
}

if ($completed -and $completed -ge $expected) {
  Write-RecoveryLog "Skipped: completed=$($completed.ToString('o')) already covers expected=$($expected.ToString('o'))."
  exit 0
}

Write-RecoveryLog "Starting recovery: completed=$completed; expected=$($expected.ToString('o'))."
& (Join-Path $PSScriptRoot 'run-daily-update-hidden.ps1')
$exitCode = $LASTEXITCODE
Write-RecoveryLog "Recovery finished with exit code=$exitCode."
exit $exitCode
