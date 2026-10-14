param(
  [Parameter(Mandatory=$true)][string]$BindingPath,[switch]$NoBrowser,[switch]$CheckOnly,
  [switch]$InternalWorker,[string]$AttemptDirectory,
  [ValidateRange(5,300)][int]$DeadlineSeconds=90
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'bound-startup-supervision.psm1') -Force
if (-not $InternalWorker) {
  $result=Invoke-BoundStartupSupervisor -EntryPath $PSCommandPath -BindingPath $BindingPath -NoBrowser:$NoBrowser -CheckOnly:$CheckOnly -DeadlineSeconds $DeadlineSeconds
  $result|ConvertTo-Json -Depth 12
  exit $result.exitCode
}
# Internal workers always retain the same source, identity, and market checks.
# Calling this switch is not a way to bypass any incumbent validation.
if (-not [IO.Path]::IsPathRooted($AttemptDirectory) -or -not [IO.Directory]::Exists($AttemptDirectory)) { throw 'BOUND_START_ATTEMPT_DIRECTORY_REQUIRED' }
Import-Module (Join-Path $PSScriptRoot 'bound-daily-use.psm1') -Force
Set-BoundStartupTrace $AttemptDirectory
$mutex=New-Object Threading.Mutex($false,'Global\TwChipBoundDailyUseV1')
$owned=$false;$code=1;$state='FAILED';$payload=$null;$failureCode=$null
try {
  Write-BoundStartupStage 'ACQUIRE_MUTEX'
  try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
  if (-not $owned) { $state='BUSY_NOT_READY';$code=3;Write-Output 'BOUND_START_ALREADY_RUNNING' }
  else {
    Write-BoundStartupStage 'VALIDATE_BOUND_PLAN'
    $plan=Read-BoundPlan $BindingPath (Split-Path $PSScriptRoot -Parent)
    if ($CheckOnly) { $state='PREFLIGHT_PASS';$code=0 }
    else {
      $payload=Invoke-BoundStart $plan -NoBrowser:$NoBrowser
      if ($payload.result -cne 'BOUND_SOURCE_READY') { throw 'BOUND_START_INVALID_RESULT' }
      $state='BOUND_SOURCE_READY';$code=0
    }
  }
} catch {
  $match=[regex]::Match($_.Exception.Message,'BOUND_START_[A-Z0-9_]+')
  $failureCode=if($match.Success){$match.Value}else{$_.Exception.GetType().Name}
  $state='FAILED';$code=1
} finally {
  if ($owned) { $mutex.ReleaseMutex() };$mutex.Dispose()
}
Write-BoundStartupStage $state
Write-BoundExclusiveJson (Join-Path $AttemptDirectory 'worker-result.json') @{
  pid=$PID;state=$state;exitCode=$code;failureCode=$failureCode;at=[datetime]::UtcNow.ToString('o');result=$payload
}
exit $code
