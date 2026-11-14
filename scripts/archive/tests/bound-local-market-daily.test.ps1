param([string]$ModulePath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\bound-daily-use.psm1'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$module=Import-Module $ModulePath -Force -PassThru
$script:passed=0;$script:failures=@()
function Case($name,[scriptblock]$body){try{& $body;$script:passed++;Write-Output "PASS $name"}catch{$script:failures+=("$name : "+$_.Exception.Message);Write-Output "FAIL $name : $($_.Exception.Message)"}}
function Check($ok,$message){if(-not $ok){throw $message}}
function Reject([scriptblock]$body,$reason){$message=$null;try{& $body|Out-Null}catch{$message=$_.Exception.Message};Check ($message -like "*$reason*") "Expected $reason, got $message"}
function Clone($value){$value|ConvertTo-Json -Depth 15|ConvertFrom-Json}
$root=Join-Path ([IO.Path]::GetTempPath()) ('bound-v4-fixture-'+[guid]::NewGuid())
# No actual source, config, credentials or TLS files are read. All service calls
# and process functions are intercepted below; only new synthetic logs are written.
$b=[pscustomobject]@{dashboard=[pscustomobject]@{root='D:\fixture-formal';commit=('a'*40);allowedDirty=@()};
 producer=[pscustomobject]@{root='D:\fixture-producer';commit=('b'*40)};launcher=[pscustomobject]@{root='D:\fixture-launcher';commit=('c'*40)};
 dataRoot='D:\fixture-formal\data';projectionRoot='D:\fixture-formal\data\runtime\cru34-live';
 envFile='D:\fixture-formal\.env';node='C:\fixture\node.exe';logRoot=$root;
 localMarket=[pscustomobject]@{schema='cru21-bound-local-market-v1';readDataRoot='D:\fixture-read';
 chartCacheRoot='D:\fixture-formal\data\dashboard-chart-cache';tlsBundle='D:\fixture-tls\bundle.dpapi';tlsCertSha256=('d'*64)}}
$lines=@('HOST=127.0.0.1','PORT=8787','NODE_ENV=production','MOCK_DATA=0','COOKIE_SECURE=1','TRUST_PROXY=0','ASK_GPT_INLINE_ENABLED=0',
 'DASHBOARD_RELEASE_SCOPE=MARKET_RESEARCH_AI_DISABLED','DASHBOARD_FORMAL_READ_ROOT=D:\fixture-read',
 'TX_CHART_DATA_ROOT=D:\fixture-read','TX_CHART_CACHE_ROOT=D:\fixture-formal\data\dashboard-chart-cache',
 'DASHBOARD_TLS_BUNDLE=D:\fixture-tls\bundle.dpapi',('DASHBOARD_TLS_CERT_SHA256='+('d'*64)))
Case 'fixed V4 origin is HTTPS; legacy remains HTTP' {
 $legacy=Clone $b;$legacy.PSObject.Properties.Remove('localMarket')
 Check ((& $module {param($x)Get-BoundDashboardOrigin $x} $b) -ceq 'https://127.0.0.1:8787') 'wrong HTTPS origin'
 Check ((& $module {param($x)Get-BoundDashboardOrigin $x} $legacy) -ceq 'http://127.0.0.1:8787') 'legacy changed'
}
Case 'complete exact V4 route set is accepted' {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b $lines}
foreach($proxy in @('MISSING','','0','false')){
 Case ("existing safe TRUST_PROXY "+$proxy+" is accepted without changing config") {
  $safe=@($lines|Where-Object{-not $_.StartsWith('TRUST_PROXY=')});if($proxy -cne 'MISSING'){$safe+=('TRUST_PROXY='+$proxy)}
  & $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b $safe
 }
}
Case 'inline comments and quoted Windows routes retain semantic values' {
 $commented=@($lines|ForEach-Object{if($_ -eq 'HOST=127.0.0.1'){'HOST=127.0.0.1 # ordinary comment'}elseif($_.StartsWith('TX_CHART_DATA_ROOT=')){'TX_CHART_DATA_ROOT="D:\fixture-read" # route'}else{$_}})
 & $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b $commented
}
Case 'ambient trust proxy cannot enable forwarded authentication' {
 $shell=@([pscustomobject]@{Name='TRUST_PROXY';Value='true'})
 Reject {& $module {param($x,$l,$s)Assert-BoundLocalMarketEnvironment $x $l $s} $b $lines $shell} 'LOCAL_MARKET_SHELL_MISMATCH'
}
foreach($key in @('HOST','PORT','NODE_ENV','MOCK_DATA','COOKIE_SECURE','TRUST_PROXY','ASK_GPT_INLINE_ENABLED','DASHBOARD_RELEASE_SCOPE','DASHBOARD_FORMAL_READ_ROOT','TX_CHART_DATA_ROOT','TX_CHART_CACHE_ROOT','DASHBOARD_TLS_CERT_SHA256')){
 Case ("wrong "+$key+" is rejected") {
  $wrong=@($lines|ForEach-Object{if($_.StartsWith($key+'=')){$key+'=wrong'}else{$_}})
  Reject {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b $wrong} 'LOCAL_MARKET_ENV_MISMATCH'
 }
}
Case 'missing route rejected' {Reject {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b $lines[1..12]} 'LOCAL_MARKET_ENV_MISSING'}
Case 'duplicate route rejected' {Reject {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b ($lines+@('PORT=8787'))} 'LOCAL_MARKET_ENV_MISMATCH'}
Case 'legacy binding cannot silently use TLS env' {$legacy=Clone $b;$legacy.PSObject.Properties.Remove('localMarket');Reject {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $legacy $lines} 'LOCAL_MARKET_BINDING_REQUIRED'}
foreach($key in @('NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','DASHBOARD_PREVIEW_TYPE','DASHBOARD_CANDIDATE_READ_ROOT')){
 Case ("unsafe env "+$key+" rejected") {Reject {& $module {param($x,$l)Assert-BoundLocalMarketEnvironment $x $l @()} $b ($lines+@($key+'=unsafe'))} 'LOCAL_MARKET_ENV_REJECTED'}
}
Case 'ambient route drift rejected' {$shell=@([pscustomobject]@{Name='TX_CHART_DATA_ROOT';Value='D:\foreign'});Reject {& $module {param($x,$l,$s)Assert-BoundLocalMarketEnvironment $x $l $s} $b $lines $shell} 'LOCAL_MARKET_SHELL_MISMATCH'}
Case 'missing explicit local binding schema rejected' {$bad=Clone $b;$bad.localMarket.PSObject.Properties.Remove('schema');Reject {& $module {param($x)Get-BoundDashboardOrigin $x} $bad} 'LOCAL_MARKET_BINDING_REQUIRED'}
Case 'private cache root drift rejected' {$bad=Clone $b;$bad.localMarket.chartCacheRoot='D:\foreign';Reject {& $module {param($x)Get-BoundDashboardOrigin $x} $bad} 'LOCAL_MARKET_CACHE_ROOT'}
Case 'untrusted HTTPS failure does not retry HTTP' {
 & $module { $script:urls=@();function script:Invoke-RestMethod {param($Uri,$TimeoutSec)$script:urls+=@($Uri);throw 'SYNTHETIC_TLS_REJECTED'} }
 $health=& $module {param($x)Get-BoundDashboardHealth $x} $b
 Check ($null -eq $health) 'TLS error accepted'
 $urls=@(& $module {$script:urls});Check ($urls.Count -eq 1 -and $urls[0] -ceq 'https://127.0.0.1:8787/healthz') 'fallback or wrong request'
}
# Exercise actual Read-BoundPlan routing with fresh inert files only. Git source
# inspection and ambient environment enumeration are intercepted; nothing runs.
$plan=Clone $b
$plan|Add-Member NoteProperty schemaVersion 'cru21-bound-daily-use-v1'
$plan|Add-Member NoteProperty authorizedScope 'PIN_EXISTING_PRODUCER_AND_REBIND_READER'
$plan.dashboard.root=Join-Path $root 'formal';$plan.producer.root=Join-Path $root 'producer';$plan.launcher.root=Join-Path $root 'launcher'
$plan.dataRoot=Join-Path $plan.dashboard.root 'data';$plan.projectionRoot=Join-Path $plan.dataRoot 'runtime\cru34-live'
$plan.envFile=Join-Path $plan.dashboard.root '.env';$plan.node=Join-Path $root 'inert-node.exe'
$plan.logRoot=Join-Path $plan.dataRoot 'automation-logs\bound-daily-use'
$plan.localMarket.chartCacheRoot=Join-Path $plan.dataRoot 'dashboard-chart-cache'
$planFile=Join-Path $root 'synthetic-binding.json'
foreach($file in @($plan.envFile,$plan.node,(Join-Path $plan.dashboard.root 'server.mjs'),(Join-Path $plan.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1'),(Join-Path $plan.producer.root 'scripts\run-cru34-live-projection.mjs'))){
 [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file));[IO.File]::WriteAllText($file,'SYNTHETIC_INERT_ONLY')
}
$planLines=@($lines|ForEach-Object{if($_.StartsWith('TX_CHART_CACHE_ROOT=')){'TX_CHART_CACHE_ROOT='+$plan.localMarket.chartCacheRoot}else{$_}})
[IO.File]::WriteAllText($planFile,($plan|ConvertTo-Json -Depth 15))
[IO.File]::WriteAllLines($plan.envFile,$planLines)
& $module {function script:Assert-BoundSource {} ;function script:Get-ChildItem {param($Path)if($Path -cne 'Env:'){throw 'FORBIDDEN_ENUMERATION'};return @()}}
Case 'Read-BoundPlan accepts exactly bound local market routes' {
 $result=& $module {param($p,$r)Read-BoundPlan $p $r} $planFile $plan.launcher.root
 Check ($result.localMarket.chartCacheRoot -ceq $plan.localMarket.chartCacheRoot) 'plan not retained'
}
Case 'Read-BoundPlan still rejects an unbound TX chart option' {
 [IO.File]::WriteAllLines($plan.envFile,($planLines+@('TX_CHART_UNKNOWN=foreign')))
 Reject {& $module {param($p,$r)Read-BoundPlan $p $r} $planFile $plan.launcher.root} 'UNEXPECTED_ENV_ROUTING'
}
Case 'Read-BoundPlan rejects changed reader root before service use' {
 [IO.File]::WriteAllLines($plan.envFile,@($planLines|ForEach-Object{if($_.StartsWith('TX_CHART_DATA_ROOT=')){'TX_CHART_DATA_ROOT=D:\foreign'}else{$_}}))
 Reject {& $module {param($p,$r)Read-BoundPlan $p $r} $planFile $plan.launcher.root} 'LOCAL_MARKET_ENV_MISMATCH'
}
Remove-Module $module -Force
$module=Import-Module $ModulePath -Force -PassThru
$names=@('HOST','PORT','CRU34_LIVE_DATA_ROOT','CRU34_LIVE_PROJECTION_ROOT','CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH')
$saved=@{};foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
 $created=[datetime]::UtcNow.AddSeconds(-2).ToString('o');$started=[datetime]::Parse($created).AddMilliseconds(100).ToString('o')
 $worker=[pscustomobject]@{schemaVersion='cru34-live-worker-status-v1';workerInstanceId='11111111-1111-4111-8111-111111111111';pid=42420;workerStartedAt=$started;observedAt=[datetime]::UtcNow.ToString('o');
 dataRoot=$b.dataRoot;projectionRoot=$b.projectionRoot;snapshotPath=(Join-Path $b.projectionRoot 'latest.json');statusPath=(Join-Path $b.projectionRoot 'status.json');formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}
 $owner=[pscustomobject]@{pid=42420;createdAt=$created;executable=$b.node;command=('"'+$b.node+'" "'+(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs')+'"')}
 $dash=[pscustomobject]@{pid=42421;createdAt=$created;executable=$b.node;command=('"'+$b.node+'" --env-file="'+$b.envFile+'" "'+(Join-Path $b.dashboard.root 'server.mjs')+'"')}
 $bridge=[pscustomobject]@{pid=42422;createdAt=$created}
 $health=[pscustomobject]@{ok=$true;service='tw-chip-dashboard-v1';runtimeCommit=$b.dashboard.commit;approvedMainCommit=$b.dashboard.commit;runtimeIdentityStatus='VERIFIED';syncState='SYNCED';
 localRelease=[pscustomobject]@{scope='MARKET_RESEARCH_AI_DISABLED';transport='HTTPS';certificateSha256=$b.localMarket.tlsCertSha256};inlineAssistant=[pscustomobject]@{enabled=$false};
 runtimeEvidence=[pscustomobject]@{producer=[pscustomobject]@{ready=$true;reasons=@();pid=$owner.pid;worker=$worker;lock=$worker;snapshot=[pscustomobject]@{path=$worker.snapshotPath};statusFile=[pscustomobject]@{path=$worker.statusPath};observedFlowIdentity=[pscustomobject]@{tradeDate='2026-11-04';session='DAY'}}}}
 $state=[pscustomobject]@{worker=$worker;owner=$owner;dashboard=$dash;bridge=$bridge;health=$health;urls=(New-Object Collections.ArrayList);browsers=(New-Object Collections.ArrayList);starts=0}
 & $module {param($s)
  $script:fixture=$s
  function script:Get-BoundProcess([int]$ProcessId){if($ProcessId -eq 42420){return $script:fixture.owner};throw 'FORBIDDEN_PROCESS'}
  function script:Get-BoundListener([int]$Port){if($Port -eq 8787){return $script:fixture.dashboard};if($Port -eq 8790){return $script:fixture.bridge};throw 'FORBIDDEN_PORT'}
  function script:Read-BoundJson([string]$Path){if($Path.EndsWith('worker.lock') -or $Path.EndsWith('status.json')){return $script:fixture.worker};throw 'FORBIDDEN_READ'}
  function script:Get-BoundHealth([int]$Port){if($Port -ne 8790){throw 'FORBIDDEN_HTTP_DASHBOARD'};return [pscustomobject]@{ok=$true;mode='market_data_only';formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}}
  function script:Invoke-RestMethod {param($Uri,$TimeoutSec)[void]$script:fixture.urls.Add($Uri);return $script:fixture.health}
  function script:Start-BoundNode {$script:fixture.starts++;throw 'FORBIDDEN_SERVICE_START'}
  function script:Start-Process {param($FilePath)[void]$script:fixture.browsers.Add($FilePath)}
  function script:Stop-Process {throw 'FORBIDDEN_SERVICE_STOP'}
  function script:Start-Sleep {throw 'FORBIDDEN_WAIT'}
 } $state
 Case 'healthy V4 entry and repeat reuse Bridge Producer dashboard with HTTPS browser' {
  1..2|ForEach-Object{$null=& $module {param($x)Invoke-BoundStart $x} $b}
  Check ($state.starts -eq 0) 'service duplicated'
  Check ($state.browsers.Count -eq 2 -and @($state.browsers|Where-Object{$_ -cne 'https://127.0.0.1:8787'}).Count -eq 0) 'wrong browser URI'
  Check ($state.urls.Count -eq 4 -and @($state.urls|Where-Object{$_ -cne 'https://127.0.0.1:8787/healthz'}).Count -eq 0) 'wrong health URI'
 }
 Case 'wrong HTTPS certificate health pin fails before starting anything' {
  $state.health.localRelease.certificateSha256='e'*64
  Reject {& $module {param($x)Invoke-BoundStart $x -NoBrowser} $b} 'LOCAL_MARKET_HEALTH_IDENTITY'
  Check ($state.starts -eq 0) 'rejection started a service'
 }
 Case 'string false is not an AI-disabled health proof' {
  $state.health.localRelease.certificateSha256=$b.localMarket.tlsCertSha256
  $state.health.inlineAssistant.enabled='false'
  Reject {& $module {param($x)Invoke-BoundStart $x -NoBrowser} $b} 'LOCAL_MARKET_HEALTH_IDENTITY'
  Check ($state.starts -eq 0) 'invalid health started a service'
 }
}finally{
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
 Remove-Module $module -Force
}
Write-Output "RESULT passed=$script:passed failed=$($script:failures.Count)"
if($script:failures.Count){throw ($script:failures -join '; ')}
