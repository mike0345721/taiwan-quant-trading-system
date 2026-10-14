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
$state=if($CheckOnly){'PREFLIGHT_PASS'}elseif($mode -eq 'busy'){'BUSY_NOT_READY'}elseif($mode -eq 'wrong-state'){'NOT_READY'}else{'BOUND_SOURCE_READY'}
$reportedPid=if($mode -eq 'wrong-pid'){0}else{$PID}
@{state=$state;pid=$reportedPid}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $AttemptDirectory 'worker-result.json') -Encoding UTF8
if($mode -eq 'busy'){exit 3};exit 0
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
Write-Output ('RESULT passed='+$script:passed+' failed='+$script:failures.Count+' fixtureRoot='+$root)
if($script:failures.Count){throw ($script:failures -join "`n")}
