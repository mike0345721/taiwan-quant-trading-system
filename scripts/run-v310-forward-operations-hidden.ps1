$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$log = Join-Path $logDir "v310-forward-operations-${stamp}.log"

Push-Location $root
try {
  & $node 'scripts\run-v310-forward-operations.mjs' *>> $log
  $observerExit = $LASTEXITCODE
  & $node 'scripts\audit-v310-forward-operations.mjs' *>> $log
  $auditExit = $LASTEXITCODE
  if ($observerExit -ne 0) { exit $observerExit }
  exit $auditExit
} finally {
  Pop-Location
}
