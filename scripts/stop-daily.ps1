# Stop the daily watchdog, Dashboard and Producer (Windows PowerShell 5.1).
# Each process is matched by its full command line before it is stopped. The Bridge is never stopped.
param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent),
  [string]$WatchdogScript = '',
  [string]$ProducerScript = '',
  [string]$DashboardScript = ''
)
$ErrorActionPreference = 'Stop'
if (-not $WatchdogScript) { $WatchdogScript = Join-Path $Root 'scripts\start-daily.ps1' }
if (-not $ProducerScript) { $ProducerScript = Join-Path $Root 'scripts\run-cru34-live-projection.mjs' }
if (-not $DashboardScript) { $DashboardScript = Join-Path $Root 'server.mjs' }

function Stop-Matching([string]$Label, [string[]]$Names, [string]$ScriptPath) {
  $needle = $ScriptPath.ToLowerInvariant()
  $found = @(Get-CimInstance Win32_Process | Where-Object {
    $Names -contains $_.Name -and $_.ProcessId -ne $PID -and
    $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) })
  if (-not $found.Count) { Write-Output "$Label not running"; return }
  foreach ($p in $found) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
      Write-Output "$Label stopped pid $($p.ProcessId) ($($p.Name))"
    } catch { Write-Output "$Label pid $($p.ProcessId) could not be stopped: $($_.Exception.Message)" }
  }
}

# Watchdog first so it cannot restart the others.
Stop-Matching 'watchdog' @('powershell.exe') $WatchdogScript
Stop-Matching 'dashboard' @('node.exe', 'cmd.exe') $DashboardScript
Stop-Matching 'producer' @('node.exe', 'cmd.exe') $ProducerScript
Write-Output 'bridge left running'
