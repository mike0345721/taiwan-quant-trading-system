param([Parameter(Mandatory=$true)][string]$Data, [Parameter(Mandatory=$true)][string]$SessionFile)
$ErrorActionPreference = 'Stop'
$experiment = Get-Content -LiteralPath (Join-Path $Data 'experiment.json') -Raw | ConvertFrom-Json
$session = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
if ($session.head -ne $experiment.head -or $session.url -notmatch '^http://127\.0\.0\.1:\d+$' -or ([uri]$session.url).Port -eq 8787) { throw 'PERF_RESOURCE_SESSION' }
$managed = Join-Path (Split-Path $experiment.configPath) ('managed/' + (Split-Path $Data -Leaf))
$owner = Get-Content -LiteralPath (Join-Path $managed 'managed-owner.lock/owner.json') -Raw | ConvertFrom-Json
$writer = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid)"
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$($session.serverPid)"
if (-not $writer -or -not $server -or $owner.runtimeCommit -ne $session.head -or $writer.CommandLine -cne $owner.commandLine -or $writer.CreationDate.ToUniversalTime().Ticks -ne ([datetime]$owner.startTime).ToUniversalTime().Ticks) { throw 'PERF_RESOURCE_OWNER' }
$expected = @{}; $expected[[int]$writer.ProcessId] = $writer.CreationDate.ToUniversalTime().Ticks; $expected[[int]$server.ProcessId] = $server.CreationDate.ToUniversalTime().Ticks
$output = Join-Path $Data 'resources.ndjson'
if (Test-Path -LiteralPath $output) { throw 'PERF_RESOURCE_EXISTS' }
$deadline = [datetime]::UtcNow.AddMilliseconds($experiment.warmupDeadlineMs + $experiment.durationMs + $experiment.drainMs + 60000)
while ([datetime]::UtcNow -lt $deadline) {
  $rows = @(Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.pid) OR ProcessId=$($session.serverPid)")
  foreach ($row in $rows) { if ($expected[[int]$row.ProcessId] -ne $row.CreationDate.ToUniversalTime().Ticks) { throw 'PERF_RESOURCE_PID_REUSED' } }
  $sample = [ordered]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();hostCpuPercent=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;processes=@($rows | Select-Object ProcessId,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount,ReadOperationCount,WriteOperationCount)}
  ($sample | ConvertTo-Json -Depth 5 -Compress) | Add-Content -LiteralPath $output -Encoding utf8
  if ((Test-Path -LiteralPath (Join-Path $Data 'performance-summary.json')) -or $rows.Count -ne 2) { break }
  Start-Sleep -Seconds 5
}
Write-Output 'PERF_RESOURCE_SAMPLING_COMPLETE'
