param([Parameter(Mandatory=$true)][string]$PlanFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$projectRoot = Split-Path $PSScriptRoot -Parent
# Separate from daily startup. This candidate has no production activation mode.
& node (Join-Path $PSScriptRoot 'update-local.mjs') $PlanFile
exit $LASTEXITCODE
