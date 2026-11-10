param([string]$ProjectRoot=(Split-Path $PSScriptRoot -Parent),[string]$CorePath=(Get-Command pwsh.exe -ErrorAction Stop).Source)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw 'Run tests with Windows PowerShell 5.1'}
$modulePath=Join-Path $ProjectRoot 'scripts\bound-daily-use.psm1'
$module=Import-Module $modulePath -Force -PassThru
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('bound-research-tests-'+[guid]::NewGuid())
$script:passed=0;$script:failures=@()
function Check($ok,$message){if(-not $ok){throw $message}}
function Case($description,[scriptblock]$test){try{& $test;$script:passed++;Write-Output "PASS $description"}catch{$script:failures+="$description : $($_.Exception.Message)";Write-Output "FAIL $description : $($_.Exception.Message)"}}
function Reject([scriptblock]$test,$reason){$message=$null;try{& $test|Out-Null}catch{$message=$_.Exception.Message};Check ($message -like "*$reason*") "Expected $reason; got $message"}
function Clone($b){$b|ConvertTo-Json -Depth 12|ConvertFrom-Json}
function Inert($path,$text='SYNTHETIC_NOT_A_DATABASE'){[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path));[IO.File]::WriteAllText($path,$text)}
$b=[pscustomobject]@{schemaVersion='cru21-bound-daily-use-v1';authorizedScope='PIN_EXISTING_PRODUCER_AND_REBIND_READER';
 launcher=[pscustomobject]@{root=(Join-Path $fixture 'launcher');commit=('a'*40)};
 producer=[pscustomobject]@{root=(Join-Path $fixture 'producer');commit=('b'*40)};
 dashboard=[pscustomobject]@{root=(Join-Path $fixture 'dashboard');commit=('c'*40);allowedDirty=@()};
 dataRoot=(Join-Path $fixture 'data');projectionRoot=(Join-Path $fixture 'data\runtime\cru34-live');
 envFile=(Join-Path $fixture 'dashboard\.env');node=(Join-Path $fixture 'inert-node.exe');logRoot=(Join-Path $fixture 'data\automation-logs\bound-daily-use')}
$bound=Clone $b;$bound|Add-Member NoteProperty researchRoot (Join-Path $fixture 'research root')
$db=Join-Path $bound.researchRoot 'data\research-v2.sqlite';$report=Join-Path $bound.researchRoot 'reports\latest-backtest.json'
foreach($file in @($b.envFile,$b.node,(Join-Path $b.dashboard.root 'server.mjs'),(Join-Path $b.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1'),(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs'),$db)){Inert $file}
Inert $b.envFile '# synthetic fixture only; no credentials'
[void][IO.Directory]::CreateDirectory((Split-Path $report -Parent));[void][IO.Directory]::CreateDirectory($b.logRoot)
$binding=Join-Path $fixture 'synthetic-binding.json'
function Plan($value){[IO.File]::WriteAllText($binding,($value|ConvertTo-Json -Depth 12)); & $module {param($p,$r)Read-BoundPlan $p $r} $binding $b.launcher.root}
# Source/ambient enumeration and runtime calls are isolated; real path metadata
# validation still runs on these freshly created fixtures. Never read real .env.
& $module {
 $script:shellFixture=@();$script:launches=@();$script:failLaunch=$false
 function script:Assert-BoundSource {}
 function script:Get-ChildItem {param($Path)if($Path -cne 'Env:'){throw 'TEST_UNEXPECTED_ENUMERATION'};return $script:shellFixture}
 function script:Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  $script:launches+=@([pscustomobject]@{database=$env:V2_RESEARCH_DATABASE_PATH;report=$env:V2_BACKTEST_REPORT_PATH;arguments=$ArgumentList;root=$WorkingDirectory;node=$FilePath})
  if($script:failLaunch){throw 'SYNTHETIC_START_FAILURE'};return [pscustomobject]@{Id=42421}
 }
 function script:Get-BoundProcess {param($ProcessId)return [pscustomobject]@{pid=$ProcessId;createdAt='2026-11-10T00:00:00.000Z'}}
 function script:Stop-Process {throw 'TEST_STOP_FORBIDDEN'}
}
$envNames=@('V2_RESEARCH_DATABASE_PATH','V2_BACKTEST_REPORT_PATH','CRU34_LIVE_WORKER_INSTANCE_ID','CRU34_LIVE_STDOUT_PATH','CRU34_LIVE_STDERR_PATH','CRU34_LIVE_INCIDENT_PATH')
$saved=@{};foreach($name in $envNames){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$null,'Process')}
try{
 Case 'absent field keeps legacy plan and child environment unchanged' {
  $p=Plan $b;Check (-not $p.PSObject.Properties['researchRoot']) 'legacy plan acquired a root'
  & $module {param($x)Start-BoundNode $x dashboard 'synthetic argv' $x.dashboard.root} $p|Out-Null
  $last=& $module {$script:launches[-1]};Check (-not $last.database -and -not $last.report) 'legacy environment changed'
 }
 Case 'valid binding injects exact dashboard paths without reading database contents' {
  $p=Plan $bound
  & $module {param($x)Start-BoundNode $x dashboard 'synthetic argv' $x.dashboard.root} $p|Out-Null
  $last=& $module {$script:launches[-1]};Check ($last.database -ceq $db -and $last.report -ceq $report) 'dashboard did not receive bound paths'
  Check ($last.arguments -ceq 'synthetic argv' -and $last.root -ceq $b.dashboard.root) 'source or argv changed'
  Check (-not $env:V2_RESEARCH_DATABASE_PATH -and -not $env:V2_BACKTEST_REPORT_PATH) 'routes leaked to parent'
  Check (-not [IO.File]::Exists($report)) 'missing report was fabricated'
 }
 Case 'research paths never enter producer environment' {
  & $module {param($x)Start-BoundNode $x producer 'synthetic argv' $x.producer.root} $bound|Out-Null
  $last=& $module {$script:launches[-1]};Check (-not $last.database -and -not $last.report) 'producer inherited research paths'
 }
 Case 'failed dashboard spawn restores research environment' {
  & $module {$script:failLaunch=$true}
  try{Reject {& $module {param($x)Start-BoundNode $x dashboard 'synthetic argv' $x.dashboard.root} $bound} 'SYNTHETIC_START_FAILURE'}finally{& $module {$script:failLaunch=$false}}
  $last=& $module {$script:launches[-1]};Check ($last.database -ceq $db -and $last.report -ceq $report) 'failure did not exercise injected routes'
  Check (-not $env:V2_RESEARCH_DATABASE_PATH -and -not $env:V2_BACKTEST_REPORT_PATH) 'failed start leaked routes'
 }
 foreach($case in @(
  @{name='null';value=$null},@{name='array';value=@($bound.researchRoot)},@{name='relative';value='relative\v2'},
  @{name='UNC';value='\\server\share\v2'},@{name='device';value='\\?\C:\v2'},
  @{name='dot';value=($bound.researchRoot+'\.');},@{name='parent';value=($bound.researchRoot+'\..\research root')},
  @{name='trailing space';value=($bound.researchRoot+' ')},@{name='ADS';value=($bound.researchRoot+':other')},
  @{name='duplicate separator';value=($bound.researchRoot+'\\data')}
 )){
  Case ("reject root syntax: "+$case.name) {$bad=Clone $bound;$bad.researchRoot=$case.value;Reject {Plan $bad} 'RESEARCH_ROOT_REJECTED'}
 }
 Case 'missing root never falls back to appRoot' {$bad=Clone $bound;$bad.researchRoot=Join-Path $fixture 'missing';Reject {Plan $bad} 'RESEARCH_PATH_UNAVAILABLE'}
 Case 'missing database is rejected' {[IO.File]::Move($db,$db+'.saved');try{Reject {Plan $bound} 'RESEARCH_PATH_UNAVAILABLE'}finally{[IO.File]::Move($db+'.saved',$db)}}
 Case 'directory at database file path is rejected' {[IO.File]::Move($db,$db+'.saved');[void][IO.Directory]::CreateDirectory($db);try{Reject {Plan $bound} 'RESEARCH_PATH_ALIAS'}finally{[IO.Directory]::Delete($db);[IO.File]::Move($db+'.saved',$db)}}
 Case 'junction research root is rejected' {
  $alias=Join-Path $fixture 'root-junction';New-Item -ItemType Junction -Path $alias -Target $bound.researchRoot|Out-Null
  $bad=Clone $bound;$bad.researchRoot=$alias;Reject {Plan $bad} 'RESEARCH_PATH_ALIAS'
 }
 Case 'junction ancestor is rejected' {
  $alias=Join-Path $fixture 'parent-junction';New-Item -ItemType Junction -Path $alias -Target $fixture|Out-Null
  $bad=Clone $bound;$bad.researchRoot=Join-Path $alias 'research root';Reject {Plan $bad} 'RESEARCH_PATH_ALIAS'
 }
 Case 'hard-linked database is rejected' {
  $alias=Join-Path $fixture 'db-hardlink';New-Item -ItemType HardLink -Path $alias -Target $db|Out-Null
  try{Reject {Plan $bound} 'RESEARCH_PATH_ALIAS'}finally{[IO.File]::Delete($alias)}
 }
 Case 'optional report alias is rejected' {
  $source=Join-Path $fixture 'foreign-report.json';Inert $source '{}';New-Item -ItemType HardLink -Path $report -Target $source|Out-Null
  try{Reject {Plan $bound} 'RESEARCH_PATH_ALIAS'}finally{[IO.File]::Delete($report)}
 }
 foreach($key in @('V2_RESEARCH_DATABASE_PATH','V2_BACKTEST_REPORT_PATH')){
  Case ("direct launch rejects ambient route without overwriting it: "+$key) {
   [Environment]::SetEnvironmentVariable($key,'SYNTHETIC_AMBIENT','Process');$before=& $module {$script:launches.Count}
   try{
    Reject {& $module {param($x)Start-BoundNode $x dashboard 'synthetic argv' $x.dashboard.root} $bound} 'UNEXPECTED_SHELL_ROUTING'
    Check ([Environment]::GetEnvironmentVariable($key,'Process') -ceq 'SYNTHETIC_AMBIENT') 'ambient value overwritten'
    Check ((& $module {$script:launches.Count}) -eq $before) 'ambient injection spawned a child'
   }finally{[Environment]::SetEnvironmentVariable($key,$null,'Process')}
  }
  foreach($plan in @($b,$bound)){
   Case ("shell route remains forbidden: "+$key+' bound='+[bool]$plan.PSObject.Properties['researchRoot']) {
    & $module {param($k,$v)$script:shellFixture=@([pscustomobject]@{Name=$k;Value=$v})} $key $db
    try{Reject {Plan $plan} 'UNEXPECTED_SHELL_ROUTING'}finally{& $module {$script:shellFixture=@()}}
   }
   Case ("dotenv route remains forbidden: "+$key+' bound='+[bool]$plan.PSObject.Properties['researchRoot']) {
    Inert $b.envFile ($key+'='+$db)
    try{Reject {Plan $plan} 'UNEXPECTED_ENV_ROUTING'}finally{Inert $b.envFile '# synthetic fixture only'}
   }
  }
 }
 Case 'launch revalidates research path before Start-Process' {
  $p=Plan $bound;[IO.File]::Move($db,$db+'.saved');$before=& $module {$script:launches.Count}
  try{Reject {& $module {param($x)Start-BoundNode $x dashboard 'synthetic argv' $x.dashboard.root} $p} 'RESEARCH_PATH_UNAVAILABLE'}finally{[IO.File]::Move($db+'.saved',$db)}
  Check ((& $module {$script:launches.Count}) -eq $before) 'invalid path spawned a child'
 }
 Case 'existing dashboard cannot silently claim the new binding' {
  & $module {
   function script:Read-BoundJson {return $null}
   function script:Get-BoundListener {param($Port)if($Port -eq 8787){return [pscustomobject]@{pid=42421}};throw 'TEST_LATE_LISTENER'}
   function script:Assert-BoundDashboard {throw 'TEST_UNVERIFIED_DASHBOARD_HEALTH'}
   function script:Get-BoundDashboardHealth {throw 'TEST_UNEXPECTED_HTTP'}
  }
  Reject {& $module {param($x)Invoke-BoundStart $x -NoBrowser} $bound} 'RESEARCH_INCUMBENT_UNVERIFIED'
 }
 foreach($name in @('bound-daily-use','bound-startup-supervision')){
  Case ("Core module import is explicitly rejected: "+$name) {
   $path=Join-Path $ProjectRoot ('scripts\'+$name+'.psm1')
   $command='$ErrorActionPreference="Stop";try{Import-Module '''+$path.Replace("'","''")+''' -Force;Write-Output "UNEXPECTED_CORE_IMPORT";exit 0}catch{[Console]::Out.WriteLine($_.Exception.Message);exit 23}'
   $output=& $CorePath -NoProfile -NonInteractive -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))
   Check ($LASTEXITCODE -eq 23 -and ($output -join "`n") -match 'BOUND_START_WINDOWS_POWERSHELL_51_REQUIRED.*powershell.exe') ("Core did not get actionable rejection: exit=$LASTEXITCODE output="+($output -join ' | '))
  }
 }
}finally{
 foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
 Remove-Module $module -Force
}
Write-Output "RESULT passed=$script:passed failed=$($script:failures.Count) fixtures=$fixture"
if($script:failures.Count){throw ($script:failures -join "`n")}
