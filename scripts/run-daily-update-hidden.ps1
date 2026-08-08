$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$log = Join-Path $logDir "daily-update-${stamp}.log"

Push-Location $root
try {
  & $node 'v2\scripts\run-v3-daily-update.mjs' *>> $log
  exit $LASTEXITCODE
} finally {
  Pop-Location
}

