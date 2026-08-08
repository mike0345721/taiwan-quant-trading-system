$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs\p0-forward-paper'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd'
$log = Join-Path $logDir "p0-forward-paper-$stamp.log"
$node = (Get-Command node -ErrorAction Stop).Source
Set-Location $root
& $node 'scripts\run-p0-forward-paper-observer.mjs' *>> $log
exit $LASTEXITCODE
