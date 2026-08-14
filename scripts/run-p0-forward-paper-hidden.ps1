$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$log = Join-Path $logDir "p0-forward-paper-${stamp}.log"
$lifecycle = Join-Path $root 'data\operational-lifecycle\p0-forward-paper.json'

Push-Location $root
try {
  # The P0 observer depends on the existing market-data-only Shioaji bridge.
  # This helper is idempotent: if the bridge is already healthy it exits immediately.
  & (Join-Path $PSScriptRoot 'start-shioaji-readonly-hidden.ps1') *>> $log

  & $node 'scripts\run-observed-forward-child.mjs' `
    '--name' 'P0_FORWARD_PAPER' `
    '--script' 'scripts\run-p0-forward-paper-observer.mjs' `
    '--log' $log `
    '--status' $lifecycle
  $observerExit = $LASTEXITCODE

  if ($observerExit -ne 0) {
    exit $observerExit
  }

  exit 0
} finally {
  Pop-Location
}
