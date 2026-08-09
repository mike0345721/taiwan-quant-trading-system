$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$python = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py.exe -ErrorAction SilentlyContinue }
if (-not $python) { throw 'Python is required for Market State read-only collection.' }

$collector = Join-Path $root 'broker\market_state_readonly_collector.py'
if (-not (Test-Path $collector)) { throw "Collector not found: $collector" }

if ($python.Name -eq 'py.exe') {
  & $python.Source -3 $collector
} else {
  & $python.Source $collector
}
if ($LASTEXITCODE -ne 0) { throw "Market State collector exited with code $LASTEXITCODE" }
