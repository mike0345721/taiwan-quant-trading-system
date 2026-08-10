param(
  [ValidateSet('NOT_ACTIVE','DRY_RUN','MANUAL_TEST','TEST_FIXTURE','FORWARD_SHADOW')]
  [string]$Mode = 'NOT_ACTIVE',
  [ValidateSet('STATE','OUTCOME')]
  [string]$Phase = 'STATE',
  [string]$InputFile = '',
  [string]$LaunchManifestPath = '',
  [string]$OwnerApprovalPath = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-market-state-forward-shadow-observer.mjs'

if ($Mode -notin @('NOT_ACTIVE','FORWARD_SHADOW') -and [string]::IsNullOrWhiteSpace($InputFile)) {
  throw 'FORWARD_SHADOW_INPUT_REQUIRED'
}
if ($Mode -eq 'FORWARD_SHADOW' -and ([string]::IsNullOrWhiteSpace($LaunchManifestPath) -or [string]::IsNullOrWhiteSpace($OwnerApprovalPath))) {
  throw 'FORWARD_SHADOW_GOVERNANCE_ARTIFACTS_REQUIRED'
}

$arguments = @($runner, '--mode', $Mode, '--phase', $Phase)
if ($Mode -eq 'FORWARD_SHADOW') {
  $arguments += @(
    '--launch-manifest', (Resolve-Path -LiteralPath $LaunchManifestPath).Path,
    '--owner-approval', (Resolve-Path -LiteralPath $OwnerApprovalPath).Path
  )
} elseif ($Mode -ne 'NOT_ACTIVE') {
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
