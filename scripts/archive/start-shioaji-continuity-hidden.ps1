param(
  [switch]$OwnerApprovedActivation
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not $OwnerApprovedActivation -or $env:SHIOAJI_CONTINUITY_ACTIVATION_APPROVED -ne 'true') {
  Write-Output 'NOT_ACTIVE: Owner-approved continuity activation is required.'
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-shioaji-market-data-continuity.mjs'
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Start-Process -FilePath $node `
  -ArgumentList "`"$runner`" --root `"$root`" --owner-approved-activation" `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'shioaji-continuity-supervisor.log') `
  -RedirectStandardError (Join-Path $logDir 'shioaji-continuity-supervisor-error.log')
