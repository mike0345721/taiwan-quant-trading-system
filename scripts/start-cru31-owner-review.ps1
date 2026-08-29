[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [Parameter(Mandatory = $true)]
  [string]$PrerequisiteRoot,
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
} catch {
  Stop-ReviewLaunch 'ProjectRoot or PrerequisiteRoot does not exist.'
}

$server = Join-Path $project 'server.mjs'
$environmentFile = Join-Path $prerequisites '.env'
$dependencyTarget = Join-Path $prerequisites 'node_modules'
$dependencyLink = Join-Path $project 'node_modules'

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { Stop-ReviewLaunch 'CRU-31 server.mjs is missing.' }
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) { Stop-ReviewLaunch 'The existing local .env prerequisite is missing.' }
if (-not (Test-Path -LiteralPath $dependencyTarget -PathType Container)) { Stop-ReviewLaunch 'The existing node_modules prerequisite is missing.' }
if (($Port -lt 1024) -or ($Port -gt 65535)) { Stop-ReviewLaunch 'Port must be between 1024 and 65535.' }

if (-not (Test-Path -LiteralPath $dependencyLink)) {
  New-Item -ItemType Junction -Path $dependencyLink -Target $dependencyTarget | Out-Null
} else {
  $linkItem = Get-Item -LiteralPath $dependencyLink -Force
  if (($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -or -not $linkItem.Target) {
    Stop-ReviewLaunch 'The worktree node_modules path already exists but is not the expected prerequisite junction.'
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

try { $node = (Get-Command node.exe -ErrorAction Stop).Source } catch { Stop-ReviewLaunch 'Node.js is not available.' }
$head = (& git -c "safe.directory=$project" -C $project rev-parse HEAD 2>$null).Trim()
if (-not $head) { Stop-ReviewLaunch 'The CRU-31 runtime commit could not be resolved.' }

Write-Host "CRU-31 owner review runtime: $head"
Write-Host "URL: http://127.0.0.1:$Port/"
Write-Host "Health: http://127.0.0.1:$Port/healthz"
Write-Host 'Mode: production server path; MOCK_DATA=0; read-only UI observation.'
Write-Host 'Keep this PowerShell window open during review. Press Ctrl+C when review is finished.'

Push-Location $project
try {
  & $node $server
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
