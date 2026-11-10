if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
  throw 'BOUND_START_WINDOWS_POWERSHELL_51_REQUIRED: Use C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile. PowerShell Core JSON timestamp conversion is unsupported.'
}
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Write-BoundExclusiveJson([string]$Path, $Value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 12)+"`n")
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
function Get-BoundSupervisionRoot([string]$BindingPath) {
  $full=[IO.Path]::GetFullPath($BindingPath)
  $sha=[Security.Cryptography.SHA256]::Create()
  try { $key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($full.ToLowerInvariant())))).Replace('-','') }
  finally { $sha.Dispose() }
  $localRoot=[Environment]::GetFolderPath('LocalApplicationData')
  if (-not $localRoot) { throw 'BOUND_START_DIAGNOSTIC_HOME_UNAVAILABLE' }
  return Join-Path $localRoot ('TaiwanStock\bound-startup\'+$key)
}
function Invoke-BoundSupervisedProcess {
  param([string]$Executable,[string]$Arguments,[string]$WorkingDirectory,
    [string]$AttemptDirectory,[ValidateRange(100,300000)][int]$TimeoutMs=90000)
  # Retain the Process handle we create. Never kill by a remembered PID or kill a tree.
  # This function is also exercised with disposable synthetic workers in tests.
  $p=New-Object Diagnostics.Process
  $p.StartInfo.FileName=$Executable; $p.StartInfo.Arguments=$Arguments
  $p.StartInfo.WorkingDirectory=$WorkingDirectory
  $p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true
  $p.StartInfo.RedirectStandardInput=$true
  $p.StartInfo.RedirectStandardOutput=$true; $p.StartInfo.RedirectStandardError=$true
  $started=$false; $outTask=$null; $errTask=$null
  $timer=[Diagnostics.Stopwatch]::StartNew()
  try {
    $started=$p.Start()
    if (-not $started) { throw 'BOUND_START_PROCESS_NOT_CREATED' }
    # Start drains BEFORE waiting; warning output must not deadlock startup.
    $outTask=$p.StandardOutput.ReadToEndAsync(); $errTask=$p.StandardError.ReadToEndAsync()
    $p.StandardInput.Close()
    Write-BoundExclusiveJson (Join-Path $AttemptDirectory 'process.json') @{
      pid=$p.Id;createdAt=$p.StartTime.ToUniversalTime().ToString('o');timeoutMs=$TimeoutMs
      executable=$Executable;at=[datetime]::UtcNow.ToString('o')
    }
    $finished=$p.WaitForExit($TimeoutMs)
    if (-not $finished) {
      # Only this launcher is terminated. Already launched applications survive.
      # Do not retry: caller persists a reconciliation guard before the next start.
      $p.Kill()
      $finished=$p.WaitForExit(3000)
      return [pscustomobject]@{timedOut=$true;exited=$finished;exitCode=124;pid=$p.Id;elapsedMs=$timer.ElapsedMilliseconds}
    }
    return [pscustomobject]@{timedOut=$false;exited=$true;exitCode=$p.ExitCode;pid=$p.Id;elapsedMs=$timer.ElapsedMilliseconds}
  } catch {
    # A diagnostics failure after creation must not leave our worker indefinitely active.
    if ($started -and -not $p.HasExited) {
      try { $p.Kill(); $null=$p.WaitForExit(3000) } catch { }
    }
    throw
  } finally {
    # No unbounded ReadToEnd/WaitForExit overload, including inherited pipe handles.
    foreach($item in @(@('stdout',$outTask),@('stderr',$errTask))) {
      try {
        $task=$item[1]
        if ($null -ne $task -and $task.Wait(1000)) {
          $text=[string]$task.Result
          if ($text.Length -gt 131072) { $text=$text.Substring(0,131072)+"`n[TRUNCATED]" }
          [IO.File]::WriteAllText((Join-Path $AttemptDirectory ($item[0]+'.log')),$text,[Text.Encoding]::UTF8)
        }
      } catch { }
    }
    $p.Dispose(); $timer.Stop()
  }
}
function Invoke-BoundStartupSupervisor {
  param([string]$EntryPath,[string]$BindingPath,[switch]$NoBrowser,[switch]$CheckOnly,
    [ValidateRange(5,300)][int]$DeadlineSeconds=90)
  foreach($value in @($EntryPath,$BindingPath)) {
    if (-not [IO.Path]::IsPathRooted($value) -or $value -match '["\r\n]') { throw 'BOUND_START_ARGUMENT_PATH_INVALID' }
  }
  $root=Get-BoundSupervisionRoot $BindingPath
  [IO.Directory]::CreateDirectory($root)|Out-Null
  $guard=Join-Path $root 'reconciliation-required.json'
  $pending=Join-Path $root 'pending-start.json'
  # Serialize the guard check, worker lifetime and terminal persistence together.
  # The worker's existing global application mutex remains independent.
  $mutex=New-Object Threading.Mutex($false,('Global\TwChipBoundSupervisorV1_'+(Split-Path $root -Leaf)))
  $owned=$false
  try {
  try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
  if (-not $owned) { return [pscustomobject]@{exitCode=3;state='BUSY_NOT_READY';ready=$false} }
  if ([IO.File]::Exists($guard) -or [IO.File]::Exists($pending)) {
    return [pscustomobject]@{exitCode=125;state='PRIOR_START_REQUIRES_RECONCILIATION';ready=$false;guard=$guard;pending=$pending}
  }
  $runId=[guid]::NewGuid().ToString()
  $attempt=Join-Path $root $runId
  [IO.Directory]::CreateDirectory($attempt)|Out-Null
  Write-BoundExclusiveJson (Join-Path $attempt 'intent.json') @{
    schema='bound-startup-supervision-v1';runId=$runId;at=[datetime]::UtcNow.ToString('o')
    binding=$BindingPath;deadlineSeconds=$DeadlineSeconds;checkOnly=[bool]$CheckOnly
  }
  # Persist uncertainty BEFORE creating a worker. If this supervisor disappears or
  # later diagnostics cannot be written, another invocation must not blindly retry.
  Write-BoundExclusiveJson $pending @{runId=$runId;attemptDirectory=$attempt;at=[datetime]::UtcNow.ToString('o');automaticRetry=$false}
  $exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments='-NoProfile -NonInteractive -File "'+$EntryPath+'" -BindingPath "'+$BindingPath+'" -InternalWorker -AttemptDirectory "'+$attempt+'"'
  if ($NoBrowser) { $arguments+=' -NoBrowser' }; if ($CheckOnly) { $arguments+=' -CheckOnly' }
  $state='FAILED';$code=1;$process=$null;$detail=$null;$settled=$false
  try {
    $process=Invoke-BoundSupervisedProcess $exe $arguments (Split-Path $EntryPath -Parent) $attempt ($DeadlineSeconds*1000)
    $code=[int]$process.exitCode
    $resultPath=Join-Path $attempt 'worker-result.json'
    if ([IO.File]::Exists($resultPath)) { $detail=[IO.File]::ReadAllText($resultPath)|ConvertFrom-Json }
    if ($process.timedOut) {
      $state='DEADLINE_EXCEEDED_RECONCILE_APPLICATIONS'
      if (-not [IO.File]::Exists($guard)) {
        Write-BoundExclusiveJson $guard @{runId=$runId;attemptDirectory=$attempt;at=[datetime]::UtcNow.ToString('o');reason=$state;automaticRetry=$false}
      }
    } else {
      $valid=$null -ne $detail -and $detail.pid -eq $process.pid -and $detail.exitCode -eq $code
      if ($valid -and $code -eq 0 -and $detail.state -ceq $(if($CheckOnly){'PREFLIGHT_PASS'}else{'BOUND_SOURCE_READY'})) { $state=$detail.state;$settled=$true }
      elseif ($valid -and $code -eq 3 -and $detail.state -ceq 'BUSY_NOT_READY') { $state='BUSY_NOT_READY';$settled=$true }
      elseif ($valid -and $code -ne 0 -and $detail.state -ceq 'FAILED') { $state='FAILED';$settled=$true }
      else {
        if ($code -eq 0) { $code=1 }
        $state='MISSING_OR_INVALID_TERMINAL_RECEIPT'
        Write-BoundExclusiveJson $guard @{runId=$runId;attemptDirectory=$attempt;at=[datetime]::UtcNow.ToString('o');reason=$state;automaticRetry=$false}
      }
    }
  } catch {
    $code=1; $state='SUPERVISOR_ERROR_RECONCILE'; $detail=@{errorType=$_.Exception.GetType().Name}
    if (-not [IO.File]::Exists($guard)) {
      Write-BoundExclusiveJson $guard @{runId=$runId;attemptDirectory=$attempt;at=[datetime]::UtcNow.ToString('o');reason=$state;automaticRetry=$false}
    }
  }
  $result=[pscustomobject]@{schema='bound-startup-supervision-v1';runId=$runId;state=$state;exitCode=$code;
    ready=($state -ceq 'BOUND_SOURCE_READY');at=[datetime]::UtcNow.ToString('o');attemptDirectory=$attempt;process=$process;worker=$detail}
  try {
    Write-BoundExclusiveJson (Join-Path $attempt 'result.json') $result
    if ($settled) {
      # Keep the intent as evidence rather than deleting it. Only a fully persisted,
      # matching terminal result settles the pending attempt, including known refusal.
      [IO.File]::Move($pending,(Join-Path $attempt 'settled-intent.json'))
    }
  } catch {
    if (-not [IO.File]::Exists($guard)) {
      Write-BoundExclusiveJson $guard @{runId=$runId;attemptDirectory=$attempt;at=[datetime]::UtcNow.ToString('o');reason='TERMINAL_PERSISTENCE_FAILED';automaticRetry=$false}
    }
    throw
  }
  return $result
  } finally { if ($owned) { $mutex.ReleaseMutex() };$mutex.Dispose() }
}
Export-ModuleMember -Function *-Bound*
