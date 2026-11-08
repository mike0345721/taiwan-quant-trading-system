# Dedicated task host: explicit system-only child environment; no policy override.
param(
  [Parameter(Mandatory=$true)][string]$BindingPath,
  [ValidateSet('preflight','dry-run','execute')][string]$Mode = 'preflight'
)
$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$entry = Join-Path $PSScriptRoot 'run-bound-daily-update.mjs'
if (-not [IO.Path]::IsPathRooted($BindingPath) -or $BindingPath.IndexOfAny([char[]]@([char]0,[char]10,[char]13,[char]34)) -ge 0) { throw 'BOUND_DAILY_BINDING_ARGUMENT_REJECTED' }
$BindingPath = [IO.Path]::GetFullPath($BindingPath)
if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or -not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'BOUND_DAILY_EXECUTABLE_MISSING' }
# Do not quietly discard settings that could select data/code or change enforcement.
foreach ($item in Get-ChildItem Env:) {
  if ($item.Name -match '^(NODE_OPTIONS|NODE_PATH|GIT_.*|V[123]_.*|DAILY_.*|DASHBOARD_.*|CRU[0-9]+_.*|__PSLockdownPolicy|PSExecutionPolicyPreference)$' -and $item.Value) {
    throw ('BOUND_DAILY_AMBIENT_OVERRIDE_REJECTED:' + $item.Name)
  }
}
$systemNames = @('SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC','ALLUSERSPROFILE','APPDATA','LOCALAPPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH','COMPUTERNAME','USERNAME','USERDOMAIN','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','PSMODULEPATH','HOME')
function New-DailyChild([string]$Action) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $node
  $info.Arguments = '"' + $entry + '" --binding "' + $BindingPath + '" --' + $Action
  $info.WorkingDirectory = $sourceRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
  $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
  $info.EnvironmentVariables.Clear()
  foreach ($name in $systemNames) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($null -ne $value) { $info.EnvironmentVariables[$name] = $value }
  }
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $info
  return $p
}
# Preflight returns only bounded source/storage metadata, never creates storage.
$probeAction = if ($Mode -eq 'dry-run') { 'dry-run' } else { 'preflight' }
$probe = New-DailyChild $probeAction
try {
  if (-not $probe.Start()) { throw 'BOUND_DAILY_PREFLIGHT_START_FAILED' }
  $stdout = $probe.StandardOutput.ReadToEndAsync()
  $stderr = $probe.StandardError.ReadToEndAsync()
  if (-not $probe.WaitForExit(120000)) {
    $probe.Kill()
    if (-not $probe.WaitForExit(10000)) { throw 'BOUND_DAILY_PREFLIGHT_STOP_UNVERIFIED' }
    throw 'BOUND_DAILY_PREFLIGHT_TIMEOUT'
  }
  $out = $stdout.GetAwaiter().GetResult()
  $err = $stderr.GetAwaiter().GetResult()
  $code = $probe.ExitCode
  if ($code -ne 0) { [Console]::Error.Write($err); exit $code }
  if ($Mode -ne 'execute') { [Console]::Out.Write($out); exit 0 }
  if ($out.Length -gt 16384) { throw 'BOUND_DAILY_PREFLIGHT_RESULT_LIMIT' }
  $plan = $out | ConvertFrom-Json
  if ($plan.mode -cne 'preflight' -or $plan.bound -ne $true -or [IO.Path]::GetFullPath($plan.sourceRoot) -ine [IO.Path]::GetFullPath($sourceRoot)) { throw 'BOUND_DAILY_PREFLIGHT_RESULT_REJECTED' }
} finally { $probe.Dispose() }
# The source-controlled entry rechecks the binding before opening any database.
$logRoot = Join-Path $plan.storageAppRoot 'v2\logs'
if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { throw 'BOUND_DAILY_LOG_ROOT_MISSING' }
$stem = 'bound-writer-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N')
$output = $null; $errors = $null; $child = $null
try {
  $output = [IO.File]::Open((Join-Path $logRoot ($stem + '.stdout.log')), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  $errors = [IO.File]::Open((Join-Path $logRoot ($stem + '.stderr.log')), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  $child = New-DailyChild 'execute'
  if (-not $child.Start()) { throw 'BOUND_DAILY_WRITER_START_FAILED' }
  $copyOut = $child.StandardOutput.BaseStream.CopyToAsync($output)
  $copyErr = $child.StandardError.BaseStream.CopyToAsync($errors)
  $child.WaitForExit()
  $copyOut.GetAwaiter().GetResult()
  $copyErr.GetAwaiter().GetResult()
  $code = $child.ExitCode
  $output.Flush(); $errors.Flush()
  Write-Output ('BOUND_DAILY_WRITER_EXIT=' + $code)
  exit $code
} finally {
  if ($null -ne $output) { $output.Dispose() }
  if ($null -ne $errors) { $errors.Dispose() }
  if ($null -ne $child) { $child.Dispose() }
}
