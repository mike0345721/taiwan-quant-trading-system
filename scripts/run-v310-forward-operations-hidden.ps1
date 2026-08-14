$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$log = Join-Path $logDir "v310-forward-operations-${stamp}.log"
$lifecycle = Join-Path $root 'data\operational-lifecycle\v310-forward-operations.json'

Push-Location $root
try {
  & $node 'scripts\run-observed-forward-child.mjs' `
    '--name' 'V310_FORWARD_OPERATIONS' `
    '--script' 'scripts\run-v310-forward-operations.mjs' `
    '--after-script' 'scripts\audit-v310-forward-operations.mjs' `
    '--log' $log `
    '--status' $lifecycle
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
