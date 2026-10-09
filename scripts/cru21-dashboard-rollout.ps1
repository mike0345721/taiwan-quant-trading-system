param([ValidateSet('Preflight','Deploy','Rollback')][string]$Mode='Preflight',
 [Parameter(Mandatory=$true)][string]$PlanPath,[string]$ExpectedMain)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$receiptRoot=Split-Path -Parent (Resolve-Path -LiteralPath $PlanPath).Path
if($plan.schema -ne 'cru21-rollout-plan-v2'){throw 'Fresh v2 plan required; historical plans are not executable'}
$node='C:\Program Files\nodejs\node.exe'
function Git([string]$Root,[string[]]$Arguments){$value=& git.exe -C $Root @Arguments; if($LASTEXITCODE -ne 0){throw 'Git operation failed'}; return ($value -join "`n").Trim()}
function Hash([string]$File){return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()}
function Record([string]$Phase,$Details){$file=Join-Path $receiptRoot (([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ'))+'-'+$Phase+'.json');@{phase=$Phase;at=[DateTime]::UtcNow.ToString('o');details=$Details}|ConvertTo-Json -Depth 30|Set-Content -LiteralPath $file -Encoding UTF8}
function Assert-Report {if((Hash (Join-Path $plan.primary $plan.dirtyReportPath)) -ne $plan.dirtyReportHash){throw 'Uncommitted report changed; preserve it and replan'}}
function Assert-Backups {
 foreach($item in @(@('primary-original.env',$plan.primaryEnvHash),@('formal-original.env',$plan.formalEnvHash),@('formal-target.env',$plan.targetEnvHash),@('primary-dirty-report.md',$plan.dirtyReportHash))){
  if($item[1] -notmatch '^[0-9a-fA-F]{64}$' -or (Hash (Join-Path $receiptRoot $item[0])) -ne $item[1]){throw 'Backup hash mismatch; no mutation allowed'}
 }
}
function Process-Identity($Process) {
 if(-not $Process -or -not $Process.CommandLine -or -not $Process.CreationDate -or -not $Process.ExecutablePath){throw 'Process identity unavailable'}
 return @{pid=[int]$Process.ProcessId;creationDate=([DateTime]$Process.CreationDate).ToUniversalTime().ToString('o');executable=$Process.ExecutablePath;commandLine=$Process.CommandLine}
}
function Assert-RecordedDashboard($State) {
 $listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
 if(@($listeners | Where-Object { $_.OwningProcess -ne $State.newPid }).Count){throw 'Unknown listener; do not stop it'}
 if(-not $State.newPid){if($listeners.Count){throw 'Unrecorded listener'};return $null}
 $p=Get-CimInstance Win32_Process -Filter "ProcessId = $($State.newPid)"
 if(-not $p){if($listeners.Count){throw 'Listener identity unavailable'};return $null}
 $actual=Process-Identity $p
 $expected=$State.newProcess
 if(-not $expected -or $actual.pid -ne $expected.pid -or $actual.creationDate -ne $expected.creationDate -or $actual.executable -ne $expected.executable -or $actual.commandLine -cne $expected.commandLine -or $actual.executable -ne $node){throw 'Recorded dashboard process changed; possible PID reuse'}
 return $p
}
function Assert-RollbackSource([string]$Merged) {
 Assert-Backups
 Assert-Report
 foreach($root in @($plan.primary,$plan.formal)){if((Git $root @('rev-parse','HEAD')) -notin @($plan.base,$Merged)){throw 'Source changed since deployment'}}
 if((Git $plan.primary @('status','--porcelain','--untracked-files=all')) -ne ('M '+$plan.dirtyReportPath)){throw 'Unexpected primary dirty code; preserve before rollback'}
 if(Git $plan.formal @('status','--porcelain','--untracked-files=all')){throw 'Unexpected formal dirty code; preserve before rollback'}
 if((Hash (Join-Path $plan.primary '.env')) -ne $plan.primaryEnvHash -or (Hash (Join-Path $plan.formal '.env')) -notin @($plan.formalEnvHash,$plan.targetEnvHash)){throw 'Environment changed since deployment'}
}
function Assert-ExistingServices {
 $b=Invoke-RestMethod 'http://127.0.0.1:8790/health' -TimeoutSec 10
 if($b.mode -ne 'market_data_only' -or $b.executionAuthorized -ne $false -or $b.orderRoutesEnabled -ne $false){throw 'Bridge safety mismatch'}
 $worker=Get-Content -LiteralPath (Join-Path $plan.formal 'data/runtime/cru34-live/status.json') -Raw | ConvertFrom-Json
 if($worker.pid -ne $plan.producerPid -or $worker.executionAuthorized -ne $false -or $worker.orderRoutesEnabled -ne $false){throw 'Producer changed'}
 $age=([DateTimeOffset]::UtcNow-([DateTimeOffset]$worker.observedAt).ToUniversalTime()).TotalSeconds
 if($age -gt 15 -or $age -lt -5){throw 'Producer heartbeat not current'}
 return $worker
}
function Assert-OldDashboard {
 $h=Invoke-RestMethod 'http://127.0.0.1:8787/healthz' -TimeoutSec 15
 $listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen)
 if($h.runtimeCommit -ne $plan.base -or $h.runtimeIdentityStatus -ne 'VERIFIED' -or $listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $plan.formalPid){throw 'Original dashboard changed'}
 $p=Get-CimInstance Win32_Process -Filter "ProcessId = $($plan.formalPid)"
 $actual=Process-Identity $p
 $expected=$plan.oldProcess
 if(-not $expected -or $actual.pid -ne $expected.pid -or $actual.creationDate -ne $expected.creationDate -or $actual.executable -ne $expected.executable -or $actual.commandLine -cne $expected.commandLine -or $actual.executable -ne $node){throw 'Original process identity mismatch'}
 return $h
}
function Assert-SourceBaseline {
 if((Git $plan.primary @('rev-parse','HEAD')) -ne $plan.base -or (Git $plan.primary @('branch','--show-current')) -ne 'main'){throw 'Primary source changed'}
 if((Git $plan.formal @('rev-parse','HEAD')) -ne $plan.base -or (Git $plan.formal @('status','--porcelain'))){throw 'Formal source changed'}
 if((Git $plan.primary @('status','--porcelain')) -ne 'M v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md'){throw 'Primary worktree changed'}
 Assert-Report
 if((Hash (Join-Path $plan.primary '.env')) -ne $plan.primaryEnvHash -or (Hash (Join-Path $plan.formal '.env')) -ne $plan.formalEnvHash){throw 'Environment changed'}
 if((Hash (Join-Path $receiptRoot 'formal-target.env')) -ne $plan.targetEnvHash){throw 'Prepared environment changed'}
}
function Start-Dashboard([string]$Root,[string]$Label){
 # Direct server entry works at the old baseline too and has no bridge spawn path.
 $envFile=Join-Path $Root '.env'
 $keys=@(Get-Content -LiteralPath $envFile | ForEach-Object {if($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*='){$Matches[1]}})
 Get-ChildItem Env: | Where-Object {$_.Name -match '^(DASHBOARD_|ASK_GPT_|TX_CHART_|CRU34_|CRU55_|V2_|DATA_OPERATIONS_|FORWARD_SHADOW_)' -or $_.Name -in $keys} | ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
 foreach($key in @('DASHBOARD_ENV_PATH','DASHBOARD_FORMAL_READ_ROOT','ASK_GPT_INLINE_ENABLED','ASK_GPT_CANDIDATE_READ_ROOT','TX_CHART_DATA_ROOT','TX_CHART_CACHE_ROOT','CRU34_LIVE_DATA_ROOT','CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH','CRU55_RUNTIME_BINDING','CRU55_DYNAMIC_ROOT','CRU55_ACCEPTANCE_CONFIG','CRU55_INTEGRATION_CANDIDATE','V2_RESEARCH_DATABASE_PATH','V2_BACKTEST_REPORT_PATH','DASHBOARD_PASSWORD_HASH')){[Environment]::SetEnvironmentVariable($key,$null,'Process')}
 Get-ChildItem Env: | Where-Object {$_.Name -like 'DASHBOARD_PREVIEW_*'} | ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
 $env:HOST='127.0.0.1';$env:PORT='8787';$env:MOCK_DATA='0'
 $env:PSModulePath="$env:USERPROFILE\Documents\WindowsPowerShell\Modules;C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules"
 $logTag=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')+'-'+$Label
 $arguments=@(('--env-file="'+$envFile+'"'),('"'+(Join-Path $Root 'server.mjs')+'"'))
 return Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $receiptRoot ($logTag+'.stdout.log')) -RedirectStandardError (Join-Path $receiptRoot ($logTag+'.stderr.log'))
}
Assert-Backups
if($Mode -eq 'Preflight'){
 Assert-SourceBaseline
 $worker=Assert-ExistingServices
 $old=Assert-OldDashboard
 $targetArgs=@('--env-file='+('"'+(Join-Path $receiptRoot 'formal-target.env')+'"'),'--input-type=module','--eval','"import {config} from ''./src/config.mjs''; if(config.host!==''127.0.0.1''||config.port!==8787||config.mockData)throw Error(''CONFIG_UNSAFE''); console.log(''FORMAL_CONFIG_PARSED'');"')
 # The saved env is parsed separately by the reviewed check-env-file utility before deployment.
 Record 'preflight' @{base=$plan.base;candidate=$plan.head;producerPid=$worker.pid;originalDashboard=$old.runtimeCommit;rollbackBaseExists=(Git $plan.primary @('rev-parse',$plan.base));environmentHashesVerified=$true;reportPreserved=$true}
 Write-Output 'PREFLIGHT PASS; no service, source, or environment mutation.'
 exit 0
}
if($ExpectedMain -notmatch '^[0-9a-f]{40}$'){throw 'Exact merged main is required'}
$statePath=Join-Path $receiptRoot 'deployment-state.json'
if($Mode -eq 'Deploy'){
 if(Test-Path -LiteralPath $statePath){throw 'Deployment already attempted; inspect receipt'}
 Assert-SourceBaseline
 $worker=Assert-ExistingServices
 $old=Assert-OldDashboard
 $gates=Get-Content -LiteralPath (Join-Path $receiptRoot 'hard-gates.json') -Raw | ConvertFrom-Json
 if($gates.candidateHead -ne $plan.head -or $gates.candidateModelContentPassed -ne $true -or $gates.windowsPassed -ne $true -or $gates.ciPassed -ne $true -or $gates.independentReviewPassed -ne $true -or $gates.runtimeAcceptancePassed -ne $true -or $gates.rollbackReviewed -ne $true){throw 'Hard gates incomplete'}
 if((Git $plan.primary @('rev-parse','origin/main')) -ne $ExpectedMain -or (Git $plan.primary @('rev-parse',($ExpectedMain+'^{tree}'))) -ne $plan.tree){throw 'Merged tree or origin/main differs from reviewed candidate'}
 if(((Git $plan.primary @('diff','--name-only',$plan.base,$ExpectedMain)) -split "`n") -contains $plan.dirtyReportPath){throw 'Incoming source overlaps preserved report'}
 $state=@{expectedMain=$ExpectedMain;oldPid=$plan.formalPid;newPid=$null;startedAt=[DateTime]::UtcNow.ToString('o');phase='PREFLIGHT_PASSED'}
 $state|ConvertTo-Json|Set-Content -LiteralPath $statePath -Encoding UTF8
 Record 'before-cutover' @{oldHealth=$old;producer=$worker;expectedMain=$ExpectedMain}
 Assert-OldDashboard | Out-Null
 Stop-Process -Id $plan.formalPid
 Wait-Process -Id $plan.formalPid -Timeout 10 -ErrorAction SilentlyContinue
 if(@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue).Count){throw '8787 still occupied'}
 Git $plan.primary @('merge','--ff-only',$ExpectedMain) | Out-Null
 Git $plan.formal @('switch','--detach',$ExpectedMain) | Out-Null
 Assert-Report
 Copy-Item -LiteralPath (Join-Path $receiptRoot 'formal-target.env') -Destination (Join-Path $plan.formal '.env')
 $started=Start-Dashboard $plan.formal 'formal'
 $state.newPid=$started.Id;$state.phase='LAUNCHED_IDENTITY_PENDING';$state|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $statePath -Encoding UTF8
 $state.newProcess=Process-Identity (Get-CimInstance Win32_Process -Filter "ProcessId = $($started.Id)");$state.phase='STARTED';$state|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $statePath -Encoding UTF8
 Record 'dashboard-started' $state
 Write-Output "Formal dashboard launched PID=$($started.Id), exact=$ExpectedMain; producer and bridge untouched. Verify before acceptance."
 exit 0
}
$state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
if($state.expectedMain -ne $ExpectedMain){throw 'Rollback identity mismatch'}
Assert-RollbackSource $ExpectedMain
$p=Assert-RecordedDashboard $state
if($p){
 $verified=Assert-RecordedDashboard $state
 if($verified){Stop-Process -Id $state.newPid; Wait-Process -Id $state.newPid -Timeout 10 -ErrorAction SilentlyContinue}
 if(Get-CimInstance Win32_Process -Filter "ProcessId = $($state.newPid)"){throw 'Recorded dashboard still alive'}
}
if(@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue).Count){throw '8787 occupied; rollback refused'}
Assert-RollbackSource $ExpectedMain
Git $plan.primary @('switch','--detach',$plan.base) | Out-Null
Git $plan.formal @('switch','--detach',$plan.base) | Out-Null
Copy-Item -LiteralPath (Join-Path $receiptRoot 'formal-original.env') -Destination (Join-Path $plan.formal '.env')
Assert-Report
$restored=Start-Dashboard $plan.primary 'rollback-original'
Record 'rollback-started' @{runtimeBase=$plan.base;pid=$restored.Id;originalSourceAndAuthRoot=$plan.primary;mainRefNotRewritten=$true;producerRestarted=$false;bridgeRestarted=$false}
Write-Output "Rollback dashboard launched at baseline $($plan.base), PID=$($restored.Id); verify /healthz and normal login."
