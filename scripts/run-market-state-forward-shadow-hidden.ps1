param(
  [ValidateSet('NOT_ACTIVE','DRY_RUN','MANUAL_TEST','TEST_FIXTURE')]
  [string]$Mode = 'NOT_ACTIVE',
  [ValidateSet('STATE','OUTCOME')]
  [string]$Phase = 'STATE',
  [string]$InputFile = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-market-state-forward-shadow-observer.mjs'

if ($Mode -ne 'NOT_ACTIVE' -and [string]::IsNullOrWhiteSpace($InputFile)) {
  throw 'FORWARD_SHADOW_INPUT_REQUIRED'
}

$arguments = @($runner, '--mode', $Mode, '--phase', $Phase)
if ($Mode -ne 'NOT_ACTIVE') {
  $resolvedInput = (Resolve-Path -LiteralPath $InputFile).Path
  $arguments += @('--input', $resolvedInput)
}

Push-Location $projectRoot
try {
  & $node @arguments
  if ($LASTEXITCODE -ne 0) { throw "FORWARD_SHADOW_OBSERVER_EXIT_$LASTEXITCODE" }
} finally {
  Pop-Location
}
