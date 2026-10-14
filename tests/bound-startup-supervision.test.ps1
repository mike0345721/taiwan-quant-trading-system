param([string]$ProjectRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
Import-Module (Join-Path $ProjectRoot 'scripts\bound-startup-supervision.psm1') -Force
$root=Join-Path ([IO.Path]::GetTempPath()) ('bound-supervision-tests-'+[guid]::NewGuid())
[IO.Directory]::CreateDirectory($root)|Out-Null
$worker=Join-Path $root 'synthetic-worker.ps1'
$body=@'
param([string]$BindingPath,[switch]$InternalWorker,[string]$AttemptDirectory,[switch]$NoBrowser,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
$mode=[IO.File]::ReadAllText($BindingPath).Trim()
[IO.File]::WriteAllText((Join-Path $AttemptDirectory 'stage-before.json'),('{"stage":"SYNTHETIC_BEFORE","pid":'+$PID+'}'))
if($mode -eq 'prompt'){Read-Host 'SYNTHETIC_DO_NOT_PROMPT';exit 7}
if($mode -eq 'hang'){Start-Sleep -Seconds 30;exit 9}
if($mode -eq 'nonzero'){exit 7}
if($mode -eq 'missing'){exit 0}
if($mode -eq 'warning'){[Console]::Error.WriteLine('synthetic nonfatal warning')}
if($mode -eq 'flood'){for($i=0;$i -lt 2048;$i++){[Console]::Out.WriteLine(('o'*128));[Console]::Error.WriteLine(('e'*128))}}
$state=if($CheckOnly){'PREFLIGHT_PASS'}elseif($mode -eq 'busy'){'BUSY_NOT_READY'}elseif($mode -eq 'known-failure'){'FAILED'}elseif($mode -eq 'wrong-state'){'NOT_READY'}else{'BOUND_SOURCE_READY'}
$reportedPid=if($mode -eq 'wrong-pid'){0}else{$PID}
$code=if($mode -eq 'busy'){3}elseif($mode -eq 'known-failure'){7}else{0}
if($mode -eq 'result-conflict'){[IO.Directory]::CreateDirectory((Join-Path $AttemptDirectory 'result.json'))|Out-Null}
@{state=$state;pid=$reportedPid;exitCode=$(if($mode -eq 'wrong-exit'){7}else{$code})}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $AttemptDirectory 'worker-result.json') -Encoding UTF8
exit $code
'@
[IO.File]::WriteAllText($worker,$body)
$script:passed=0;$script:failures=@()
function Check($condition,[string]$why){if(-not $condition){throw $why}}
function Case([string]$name,[scriptblock]$test){try{& $test;$script:passed++;Write-Output ('PASS '+$name)}catch{$script:failures+=($name+': '+$_.Exception.Message);Write-Output ('FAIL '+$name+': '+$_.Exception.Message)}}
function Fixture([string]$mode){$p=Join-Path $root (([guid]::NewGuid().ToString())+'.json');[IO.File]::WriteAllText($p,$mode);return $p}
function Run([string]$path,[switch]$CheckOnly){return Invoke-BoundStartupSupervisor -EntryPath $worker -BindingPath $path -NoBrowser -CheckOnly:$CheckOnly -DeadlineSeconds 5}
Case 'success needs matching terminal receipt and records an owned process' {
  $r=Run (Fixture 'ok');Check ($r.exitCode -eq 0 -and $r.ready -eq $true) 'not ready'
  Check ([IO.File]::Exists((Join-Path $r.attemptDirectory 'process.json'))) 'missing process evidence'
  Check ([IO.File]::Exists((Join-Path $r.attemptDirectory 'result.json'))) 'missing terminal evidence'
}
Case 'preflight success is not application readiness' {
  $r=Run (Fixture 'ok') -CheckOnly;Check ($r.exitCode -eq 0 -and $r.state -ceq 'PREFLIGHT_PASS' -and -not $r.ready) 'preflight promoted'
}
Case 'busy worker is explicit nonzero and never ready' {
  $r=Run (Fixture 'busy');Check ($r.exitCode -eq 3 -and $r.state -ceq 'BUSY_NOT_READY' -and -not $r.ready) 'busy promoted'
}
Case 'worker nonzero exit is preserved' {
  $r=Run (Fixture 'nonzero');Check ($r.exitCode -eq 7 -and -not $r.ready) 'nonzero lost'
}
Case 'exit zero without a terminal receipt is not success' {
  $r=Run (Fixture 'missing');Check ($r.exitCode -eq 1 -and $r.state -ceq 'MISSING_OR_INVALID_TERMINAL_RECEIPT') 'missing receipt accepted'
}
Case 'wrong terminal state is rejected' {
  $r=Run (Fixture 'wrong-state');Check ($r.exitCode -eq 1 -and -not $r.ready) 'state accepted'
}
Case 'receipt from another PID is rejected' {
  $r=Run (Fixture 'wrong-pid');Check ($r.exitCode -eq 1 -and -not $r.ready) 'foreign receipt accepted'
}
Case 'noninteractive worker rejects Read-Host rather than waiting' {
  $r=Run (Fixture 'prompt');Check ($r.exitCode -ne 0 -and -not $r.process.timedOut -and -not $r.ready) 'prompt hung or passed'
}
Case 'stderr warning cannot turn a successful worker into a PowerShell native error' {
  $r=Run (Fixture 'warning');Check ($r.exitCode -eq 0 -and $r.ready) 'warning changed success'
  Check ([IO.File]::ReadAllText((Join-Path $r.attemptDirectory 'stderr.log')).Contains('synthetic nonfatal warning')) 'warning not preserved'
}
Case 'both output pipes drain without deadlock and logs are capped' {
  $r=Run (Fixture 'flood');Check ($r.exitCode -eq 0 -and -not $r.process.timedOut) 'output pipe deadlock'
  foreach($name in @('stdout','stderr')){Check (([IO.File]::ReadAllText((Join-Path $r.attemptDirectory ($name+'.log')))).Length -le 131100) 'uncapped log'}
}
Case 'deadline terminates only the owned launcher and records last stage' {
  $r=Run (Fixture 'hang');Check ($r.exitCode -eq 124 -and $r.process.timedOut -and -not $r.ready) 'deadline not reported'
  Check ($r.process.exited -and $r.process.elapsedMs -lt 10000) 'owned child not ended in bounded wait'
  Check ([IO.File]::Exists((Join-Path $r.attemptDirectory 'stage-before.json'))) 'last progress lost'
  Check (-not (Get-Process -Id $r.process.pid -ErrorAction SilentlyContinue)) 'owned child still alive'
}
Case 'timed-out attempts block a blind repeat before any new process starts' {
  $binding=Fixture 'hang';$r=Run $binding;$again=Run $binding
  Check ($again.exitCode -eq 125 -and $again.state -ceq 'PRIOR_START_REQUIRES_RECONCILIATION' -and -not $again.ready) 'repeat not blocked'
  Check ([IO.File]::Exists($again.guard)) 'reconciliation guard absent'
}
Case 'failed diagnostic receipt cannot leave the owned process running' {
  $attempt=Join-Path $root ('diagnostic-fail-'+[guid]::NewGuid());[IO.Directory]::CreateDirectory($attempt)|Out-Null
  [IO.File]::WriteAllText((Join-Path $attempt 'process.json'),'existing fixture')
  $binding=Fixture 'hang';$exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$worker+'" -BindingPath "'+$binding+'" -AttemptDirectory "'+$attempt+'"'
  $threw=$false
  try{Invoke-BoundSupervisedProcess $exe $args $root $attempt 5000|Out-Null}catch{$threw=$true}
  Check $threw 'diagnostic failure swallowed'
  Check ([IO.File]::ReadAllText((Join-Path $attempt 'process.json')) -ceq 'existing fixture') 'overwrote prior receipt'
}
Case 'timeout preserves a worker application child instead of killing the process tree' {
  $desc=Join-Path $root 'descendant-worker.ps1'
  $content=@'
param([string]$BindingPath,[switch]$InternalWorker,[string]$AttemptDirectory,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$pi=New-Object Diagnostics.ProcessStartInfo
$pi.FileName=$exe;$pi.Arguments='-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 45"'
$pi.UseShellExecute=$false;$pi.CreateNoWindow=$true
$child=[Diagnostics.Process]::Start($pi)
@{pid=$child.Id;created=$child.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content (Join-Path $AttemptDirectory 'synthetic-child.json')
Start-Sleep -Seconds 30
'@
  [IO.File]::WriteAllText($desc,$content)
  $r=Invoke-BoundStartupSupervisor -EntryPath $desc -BindingPath (Fixture 'child') -NoBrowser -DeadlineSeconds 5
  Check ($r.exitCode -eq 124) 'worker did not time out'
  $record=[IO.File]::ReadAllText((Join-Path $r.attemptDirectory 'synthetic-child.json'))|ConvertFrom-Json
  $child=[Diagnostics.Process]::GetProcessById([int]$record.pid)
  Check ($child.StartTime.ToUniversalTime().ToString('o') -ceq $record.created) 'synthetic child identity mismatch; refuse cleanup'
  try { Check (-not $child.HasExited) 'supervisor killed application descendant' }
  finally { if(-not $child.HasExited){$child.Kill();$null=$child.WaitForExit(2000)};$child.Dispose() }
}

Case 'same binding resolves to a stable diagnosis location' {
  $b=Fixture 'ok';Check ((Get-BoundSupervisionRoot $b) -ceq (Get-BoundSupervisionRoot $b.ToUpperInvariant())) 'unstable binding identity'
}
Case 'unknown terminal outcomes block same-binding retry and preserve pending intent' {
  foreach($mode in @('missing','wrong-state','wrong-pid','wrong-exit','nonzero')) {
    $binding=Fixture $mode;$r=Run $binding;$dir=Get-BoundSupervisionRoot $binding
    Check (-not $r.ready -and $r.exitCode -ne 0) ('accepted '+$mode)
    Check ([IO.File]::Exists((Join-Path $dir 'pending-start.json'))) ('pending lost '+$mode)
    Check ([IO.File]::Exists((Join-Path $dir 'reconciliation-required.json'))) ('guard lost '+$mode)
    [IO.File]::WriteAllText($binding,'ok')
    $again=Run $binding;Check ($again.exitCode -eq 125 -and -not $again.ready) ('blind retry '+$mode)
  }
}
Case 'known terminal refusal settles intent without hiding its failure code' {
  $binding=Fixture 'known-failure';$r=Run $binding
  Check ($r.exitCode -eq 7 -and $r.state -ceq 'FAILED' -and -not $r.ready) 'failure changed'
  Check ([IO.File]::Exists((Join-Path $r.attemptDirectory 'settled-intent.json'))) 'intent evidence missing'
  [IO.File]::WriteAllText($binding,'ok');$again=Run $binding
  Check ($again.exitCode -eq 0 -and $again.ready) 'known completed refusal stayed uncertain'
}
Case 'final result persistence failure retains retry protection' {
  $binding=Fixture 'result-conflict';$threw=$false
  try { Run $binding|Out-Null } catch { $threw=$true }
  Check $threw 'final write failure hidden'
  $dir=Get-BoundSupervisionRoot $binding
  Check ([IO.File]::Exists((Join-Path $dir 'pending-start.json'))) 'pending evidence missing'
  Check ([IO.File]::Exists((Join-Path $dir 'reconciliation-required.json'))) 'write failure guard missing'
  [IO.File]::WriteAllText($binding,'ok');$again=Run $binding
  Check ($again.exitCode -eq 125 -and -not $again.ready) 'write failure permits blind retry'
}
Case 'unsettled prelaunch intent alone prevents a new worker' {
  $binding=Fixture 'ok';$dir=Get-BoundSupervisionRoot $binding
  [IO.Directory]::CreateDirectory($dir)|Out-Null
  Write-BoundExclusiveJson (Join-Path $dir 'pending-start.json') @{runId='synthetic-interrupted';automaticRetry=$false}
  $r=Run $binding
  Check ($r.exitCode -eq 125 -and -not $r.ready) 'unsettled attempt retried'
  Check (@(Get-ChildItem -LiteralPath $dir -Directory).Count -eq 0) 'new attempt created'
}
Case 'concurrent supervisor cannot pass the guard check before a prior timeout settles' {
  $binding=Fixture 'hang';$caller=Join-Path $root 'synthetic-caller.ps1';$receipt=Join-Path $root 'concurrent-result.json'
  $callerBody=@'
param([string]$ModulePath,[string]$WorkerPath,[string]$BindingPath,[string]$ResultPath)
$ErrorActionPreference='Stop'
Import-Module $ModulePath -Force
$r=Invoke-BoundStartupSupervisor -EntryPath $WorkerPath -BindingPath $BindingPath -NoBrowser -DeadlineSeconds 5
$r|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $ResultPath -Encoding UTF8
'@
  [IO.File]::WriteAllText($caller,$callerBody)
  $pi=New-Object Diagnostics.ProcessStartInfo
  $pi.FileName=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $pi.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$caller+'" -ModulePath "'+(Join-Path $ProjectRoot 'scripts\bound-startup-supervision.psm1')+'" -WorkerPath "'+$worker+'" -BindingPath "'+$binding+'" -ResultPath "'+$receipt+'"'
  $pi.UseShellExecute=$false;$pi.CreateNoWindow=$true
  $child=[Diagnostics.Process]::Start($pi)
  try {
    $pending=Join-Path (Get-BoundSupervisionRoot $binding) 'pending-start.json'
    $limit=[Diagnostics.Stopwatch]::StartNew()
    while(-not [IO.File]::Exists($pending) -and -not $child.HasExited -and $limit.ElapsedMilliseconds -lt 4000){Start-Sleep -Milliseconds 50}
    Check ([IO.File]::Exists($pending)) 'first supervisor did not start'
    $second=Run $binding
    Check ($second.exitCode -eq 3 -and $second.state -ceq 'BUSY_NOT_READY') 'second supervisor admitted a worker'
    Check ($child.WaitForExit(10000)) 'synthetic caller did not finish'
    $first=[IO.File]::ReadAllText($receipt)|ConvertFrom-Json
    Check ($first.exitCode -eq 124) 'first attempt did not time out'
    $third=Run $binding
    Check ($third.exitCode -eq 125) 'timeout guard bypassed'
  } finally { if(-not $child.HasExited){$child.Kill();$null=$child.WaitForExit(2000)};$child.Dispose() }
}
Write-Output ('RESULT passed='+$script:passed+' failed='+$script:failures.Count+' fixtureRoot='+$root)
if($script:failures.Count){throw ($script:failures -join "`n")}
