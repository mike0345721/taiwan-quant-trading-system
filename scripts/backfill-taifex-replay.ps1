param(
  [ValidateRange(1, 30)][int]$Limit = 30,
  [ValidateRange(1000, 15000)][int]$DelayMs = 3000,
  [switch]$ForceRebuild
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot -Parent
$storageRoot = $root
if (Test-Path Env:DAILY_WRITER_BINDING_PATH) {
  if ($Limit -ne 30 -or $DelayMs -ne 3000 -or $ForceRebuild) { throw 'DAILY_ARGUMENT_REJECTED' }
  $boundNode = (Get-Command node -ErrorAction Stop).Source
  $resolvedStorage = & $boundNode (Join-Path $root 'scripts\resolve-daily-storage-root.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'DAILY_STORAGE_PREFLIGHT_FAILED' }
  $storageRoot = [string]$resolvedStorage
}
$rawDir = Join-Path $storageRoot 'data\intraday\raw'
$archiveDir = Join-Path $storageRoot 'data\intraday\archive'
$statusPath = Join-Path $storageRoot 'data\intraday\taifex-backfill-status.json'
$pageUrl = 'https://www.taifex.com.tw/cht/3/futPrevious30DaysSalesData'
New-Item -ItemType Directory -Force $rawDir, $archiveDir | Out-Null

function Assert-ChildPath([string]$Parent, [string]$Child) {
  $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $childPath = [IO.Path]::GetFullPath($Child)
  if (-not $childPath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe child path: $childPath" }
  return $childPath
}

function Write-Utf8Json([string]$FilePath, $Value) {
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($FilePath, $json + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
}

function Read-Audit([string]$TradeDate) {
  $auditPath = Join-Path $archiveDir "$TradeDate-audit.json"
  if (-not (Test-Path $auditPath)) { return $null }
  try { return Get-Content -LiteralPath $auditPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

$mutex = New-Object Threading.Mutex($false, 'Local\TwStockTaifexReplayBackfill')
$ownsMutex = $false
try {
  $ownsMutex = $mutex.WaitOne(0)
  if (-not $ownsMutex) { throw 'Another TAIFEX replay backfill is already running. Wait for it to finish before starting again.' }

$node = (Get-Command node -ErrorAction Stop).Source
$html = (Invoke-WebRequest -UseBasicParsing -Uri $pageUrl -TimeoutSec 45).Content
$pattern = '(?:https://www\.taifex\.com\.tw)?(/file/taifex/Dailydownload/DailydownloadCSV/Daily_(\d{4})_(\d{2})_(\d{2})\.zip)'
$matches = [regex]::Matches($html, $pattern)
$todayTaipei = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Taipei Standard Time').ToString('yyyy-MM-dd')
$discovered = @($matches | ForEach-Object {
  $relativeUrl = $_.Groups[1].Value
  [pscustomobject]@{
    Url = "https://www.taifex.com.tw$relativeUrl"
    Date = "$($_.Groups[2].Value)-$($_.Groups[3].Value)-$($_.Groups[4].Value)"
    File = "Daily_$($_.Groups[2].Value)_$($_.Groups[3].Value)_$($_.Groups[4].Value).zip"
  }
} | Where-Object { $_.Date -lt $todayTaipei } | Group-Object Date | ForEach-Object { $_.Group[0] } | Sort-Object Date -Descending)
if (-not $discovered.Count) { throw 'No TAIFEX official tick files were discovered.' }

$results = @()
$accepted = 0
foreach ($item in $discovered) {
  if ($accepted -ge $Limit) { break }
  $dayArchive = Join-Path $archiveDir "$($item.Date)-day.json"
  $existingAudit = Read-Audit $item.Date
  if (-not $ForceRebuild -and $existingAudit -and $existingAudit.state -like 'passed*' -and (Test-Path $dayArchive)) {
    $results += [pscustomobject]@{ TradeDate = $item.Date; State = 'verified_existing'; Contract = $existingAudit.contract; Bars = $existingAudit.bars; Error = $null }
    $accepted += 1
    continue
  }

  $zipPath = Assert-ChildPath $rawDir (Join-Path $rawDir $item.File)
  $downloadPath = Assert-ChildPath $rawDir "$zipPath.download"
  $tempDir = Assert-ChildPath $rawDir (Join-Path $rawDir ("extract-" + $item.Date))
  try {
    # A file published before the day session has finished can contain only the
    # night session.  Always download an unaudited day again instead of reusing
    # a permanently partial ZIP.
    Invoke-WebRequest -UseBasicParsing -Uri $item.Url -OutFile $downloadPath -TimeoutSec 120
    Move-Item -LiteralPath $downloadPath -Destination $zipPath -Force
    if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir -Force
    $csv = Get-ChildItem -LiteralPath $tempDir -Filter '*.csv' -File | Select-Object -First 1
    if (-not $csv) { throw "CSV missing for $($item.Date)" }

    & $node (Join-Path $root 'scripts\build-taifex-replay.mjs') --input $csv.FullName --trade-date $item.Date
    if ($LASTEXITCODE -ne 0) { throw "Replay build failed for $($item.Date)" }
    & $node (Join-Path $root 'scripts\audit-taifex-replay.mjs') --trade-date $item.Date
    if ($LASTEXITCODE -ne 0) { throw "Replay audit failed for $($item.Date)" }
    $audit = Read-Audit $item.Date
    if (-not $audit -or $audit.state -notlike 'passed*') { throw "Replay audit did not pass for $($item.Date)" }
    $results += [pscustomobject]@{ TradeDate = $item.Date; State = $audit.state; Contract = $audit.contract; Bars = $audit.bars; Error = $null }
    $accepted += 1
  } catch {
    $results += [pscustomobject]@{ TradeDate = $item.Date; State = 'skipped_or_failed'; Contract = $null; Bars = 0; Error = $_.Exception.Message }
  } finally {
    if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
    if (Test-Path $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
  }
  Start-Sleep -Milliseconds $DelayMs
}

$verified = @(Get-ChildItem -LiteralPath $archiveDir -Filter '*-audit.json' -File | ForEach-Object {
  try {
    $audit = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($audit.state -like 'passed*') { [pscustomobject]@{ TradeDate = $audit.tradeDate; Contract = $audit.contract; Bars = $audit.bars } }
  } catch { }
} | Sort-Object TradeDate)
$latestVerified = $verified | Select-Object -Last 1
if ($latestVerified) {
  $latestDay = Join-Path $archiveDir "$($latestVerified.TradeDate)-day.json"
  if (Test-Path $latestDay) { Copy-Item -LiteralPath $latestDay -Destination (Join-Path $storageRoot 'data\intraday\replay-bars.json') -Force }
}

$status = [ordered]@{
  state = if ($accepted -ge [Math]::Min($Limit, $discovered.Count)) { 'completed' } else { 'partial' }
  generatedAt = [DateTime]::UtcNow.ToString('o')
  requestedDays = $Limit
  officialAvailableDays = $discovered.Count
  acceptedDays = $accepted
  verifiedArchiveDays = $verified.Count
  latestVerifiedDate = $latestVerified.TradeDate
  delayMs = $DelayMs
  source = $pageUrl
  results = $results
  executionAuthorized = $false
}
Write-Utf8Json $statusPath $status
$status | ConvertTo-Json -Depth 8
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
