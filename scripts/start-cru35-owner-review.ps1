[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [Parameter(Mandatory = $true)]
  [string]$PrerequisiteRoot,
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,
  [int]$Port = 8788
)

$ErrorActionPreference = 'Stop'

function Stop-ReviewLaunch([string]$Message) {
  Write-Error $Message
  exit 1
}

try {
  $project = (Resolve-Path -LiteralPath $ProjectRoot).Path
  $prerequisites = (Resolve-Path -LiteralPath $PrerequisiteRoot).Path
  $artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
} catch {
  Stop-ReviewLaunch 'ProjectRoot, PrerequisiteRoot, or ArtifactPath does not exist.'
}

$server = Join-Path $project 'server.mjs'
$environmentFile = Join-Path $prerequisites '.env'
$dependencyTarget = Join-Path $prerequisites 'node_modules'
$dependencyLink = Join-Path $project 'node_modules'

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { Stop-ReviewLaunch 'CRU-35 server.mjs is missing.' }
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { Stop-ReviewLaunch 'The CRU-34 artifact is not a file.' }
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { Stop-ReviewLaunch 'The existing local .env prerequisite is missing.' }
if (-not (Test-Path -LiteralPath $dependencyTarget -PathType Container)) { Stop-ReviewLaunch 'The existing node_modules prerequisite is missing.' }
if (($Port -lt 1024) -or ($Port -gt 65535)) { Stop-ReviewLaunch 'Port must be between 1024 and 65535.' }

if (-not (Test-Path -LiteralPath $dependencyLink)) {
  New-Item -ItemType Junction -Path $dependencyLink -Target $dependencyTarget | Out-Null
} else {
  $linkItem = Get-Item -LiteralPath $dependencyLink -Force
  if (($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -or -not $linkItem.Target) {
    Stop-ReviewLaunch 'The worktree node_modules path exists but is not the expected prerequisite junction.'
  }
  $linkTarget = (Resolve-Path -LiteralPath ([string]$linkItem.Target)).Path
  if (-not $linkTarget.Equals($dependencyTarget, [StringComparison]::OrdinalIgnoreCase)) {
    Stop-ReviewLaunch 'The worktree node_modules junction points to a different prerequisite root.'
  }
}

foreach ($rawLine in Get-Content -LiteralPath $environmentFile) {
  $line = $rawLine.Trim()
  if (-not $line -or $line.StartsWith('#')) { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { continue }
  $key = $line.Substring(0, $separator).Trim()
  if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
  $value = $line.Substring($separator + 1).Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}

$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:NODE_ENV = 'production'
$env:COOKIE_SECURE = '0'
$env:MOCK_DATA = '0'
$env:REFRESH_INTERVAL_SECONDS = '0'
$env:CRU34_SNAPSHOT_ARTIFACT_PATH = $artifact
$env:CRU34_SNAPSHOT_FRESHNESS_CUTOFF = ''

try { $node = (Get-Command node.exe -ErrorAction Stop).Source } catch { Stop-ReviewLaunch 'Node.js is not available.' }
$head = (& git -c "safe.directory=$project" -C $project rev-parse HEAD 2>$null).Trim()
$branch = (& git -c "safe.directory=$project" -C $project branch --show-current 2>$null).Trim()
if (-not $head) { Stop-ReviewLaunch 'The CRU-35 runtime commit could not be resolved.' }
if ($branch -ne 'codex/cru-35-observed-flow-evidence-ui-preview-v1') { Stop-ReviewLaunch "Unexpected branch: $branch" }

Push-Location $project
try {
  $probe = & $node -e "import('./src/dashboard-observed-flow.mjs').then(({loadDashboardObservedFlow})=>{const v=loadDashboardObservedFlow({artifactPath:process.env.CRU34_SNAPSHOT_ARTIFACT_PATH});console.log(JSON.stringify({sourceState:v.sourceState,reason:v.unavailableReason,sourceMode:v.source?.sourceMode,actualContract:v.identity?.actualContract,tradeDate:v.identity?.tradeDate,session:v.identity?.session,availableAt:v.source?.availableAt,quality:v.researchQuality?.status}));if(!['HISTORICAL','STALE'].includes(v.sourceState))process.exit(2)})"
  if ($LASTEXITCODE -ne 0) { Stop-ReviewLaunch "The governed CRU-34 reader rejected the artifact: $probe" }

  Write-Host "CRU-35 owner review runtime: $head"
  Write-Host "Observed Flow source: $probe"
  Write-Host "URL: http://127.0.0.1:$Port/"
  Write-Host "Health: http://127.0.0.1:$Port/healthz"
  Write-Host 'Mode: production server path; MOCK_DATA=0; bounded historical artifact; read-only UI observation.'
  Write-Host 'Keep this PowerShell window open during review. Press Ctrl+C when review is finished.'

  & $node $server
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
