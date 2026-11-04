# Synthetic entry-control regression derived from immutable r2 fixture.
# Dot-sources only function definitions. Every runtime/network/process/config
# boundary is mocked; files written below are new synthetic receipt directories.
# Node/environment routing validation is covered by research-entry-manifest.test.mjs.
param([string]$EntryPath=(Join-Path $PSScriptRoot '../scripts/start-research-workbench.ps1'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. $EntryPath -LibraryOnly
# No real env-file validator or Node process runs in this fixture.
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('daily-entry-fixtures-'+[guid]::NewGuid());New-Item -ItemType Directory -Path $testRoot|Out-Null
$passed=0;$failed=@()
function Test-Case([string]$Name,[scriptblock]$Body){try{& $Body;$script:passed++;Write-Output "PASS $Name"}catch{$script:failed+="$Name`: $($_.Exception.Message)";Write-Output "FAIL $Name`: $($_.Exception.Message)"}}
function Check([bool]$Ok,[string]$Message){if(-not $Ok){throw $Message}}
function Throws([scriptblock]$Body,[string]$Reason){$caught=$null;try{& $Body|Out-Null}catch{$caught=$_.Exception.Message};Check ($caught -like "*$Reason*") "Expected $Reason, got $caught"}
function Fixture {
  $script:b=[pscustomobject]@{bridge=[pscustomobject]@{root='D:\synthetic bridge';commit=('a'*40)};producer=[pscustomobject]@{root='D:\synthetic producer';commit=('b'*40)};candidate=[pscustomobject]@{root='D:\synthetic candidate';commit=('c'*40)};node='C:\synthetic\node.exe';python='D:\synthetic\python.exe';envFile='D:\synthetic\never-read.env';dataRoot='D:\synthetic data';chartDataRoot='D:\synthetic chart';logRoot=(Join-Path $testRoot ([guid]::NewGuid()))}
  $b|Add-Member -NotePropertyName ix0001LeadershipCollectionEnabled -NotePropertyValue 'true'
  $script:s=[pscustomobject]@{bridge=$true;owner=$true;candidate=$true;starts=(New-Object Collections.ArrayList);browser=0;bridgeNoOp=$false;bridgeUnsafe=$false;marketOpen=$true;pollution=$false;unknown=$false;formalChanges=$false;formalReads=0;candidateWrong=$false;candidateReadOnly=$true;candidateReadOnlyMissing=$false;capturedReaderFlag=$null;ignoreReaderFlag=$false;readerProblem='';readerCalls=0;finalReaderProblem='';v2Problem='';finalV2Problem='';capturedV2Flag=$null;preflightCalls=0;cleanCalls=0}
}
function Get-BoundProcess([int]$id){
  if($id -eq 300 -and $s.owner){return [pscustomobject]@{pid=300;createdAt='2026-11-02T02:00:00.000Z';executable=$b.node;command=('"'+$b.node+'" "'+(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs')+'"')}}
  return $null
}
function Get-BoundListener([int]$Port){
  if($Port -eq 8787){$s.formalReads++;return [pscustomobject]@{pid=$(if($s.formalChanges -and $s.formalReads -gt 1){999}else{100});createdAt='2026-11-01T01:00:00.000Z';executable=$b.node;command='synthetic formal'}}
  if($Port -eq 8790 -and $s.bridge){return [pscustomobject]@{pid=200;createdAt='2026-11-02T02:00:00.000Z';executable=$b.python;command=('"'+$b.python+'" "'+(Join-Path $b.bridge.root 'broker\shioaji_readonly_bridge.py')+'"')}}
  if($Port -eq 18723 -and $s.candidate){return [pscustomobject]@{pid=400;createdAt='2026-11-02T02:00:00.000Z';executable=$b.node;command=$(if($s.candidateWrong){'foreign candidate'}else{'"'+$b.node+'" --env-file="'+$b.envFile+'" "'+(Join-Path $b.candidate.root 'server.mjs')+'"'})}}
  return $null
}
function Read-BoundJson([string]$Path){
  if(-not $s.owner){return $null}
  if($Path.EndsWith('worker.lock')){return [pscustomobject]@{pid=300;workerInstanceId='11111111-1111-4111-8111-111111111111'}}
  return [pscustomobject]@{schemaVersion='cru34-live-worker-status-v1';pid=300;formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}
}
function Assert-BoundWorker($Plan,$Status,$Lock,$Process){Check ($Process.pid -eq 300 -and $Lock.pid -eq 300 -and $Status.pid -eq 300) 'SYNTHETIC_WORKER_IDENTITY'}
function Get-NetTCPConnection {param($State,$OwningProcess,$ErrorAction) if($OwningProcess -eq 200){return [pscustomobject]@{LocalPort=8790;LocalAddress='127.0.0.1'}};if($OwningProcess -eq 400){return [pscustomobject]@{LocalPort=18723;LocalAddress='127.0.0.1'}};throw 'UNEXPECTED_NETWORK_QUERY'}
function Get-CimInstance {param($ClassName) if($s.unknown){return [pscustomobject]@{Name='python.exe';CommandLine='unknown shioaji_readonly_bridge.py'}};return @()}
function Get-DailyHealth([int]$Port){
  if($Port -eq 8790){return [pscustomobject]@{ok=$true;mode='market_data_only';processId=200;formalWeight=0;researchOnly=$true;executionAuthorized=$s.bridgeUnsafe;orderRoutesEnabled=$false}}
  if($Port -ne 18723){throw 'UNEXPECTED_HEALTH_PORT'}
  $health=[pscustomobject]@{ok=$true;runtimeCommit=$b.candidate.commit;runtimeIdentityStatus='VERIFIED';inlineAssistant=[pscustomobject]@{enabled=$false};productSurface=[pscustomobject]@{safety=[pscustomobject]@{formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}};runtimeReady=[pscustomobject]@{ready=$false;reasons=@('BROWSER_PROOF_MISSING')};runtimeEvidence=[pscustomobject]@{producer=[pscustomobject]@{ready=$s.owner;pid=$(if($s.owner){300}else{$null});reasons=@();worker=$null;lock=$null;snapshot=[pscustomobject]@{path=(Join-Path $b.dataRoot 'runtime\cru34-live\latest.json')};statusFile=[pscustomobject]@{path=(Join-Path $b.dataRoot 'runtime\cru34-live\status.json')}}}}
  if(-not $s.candidateReadOnlyMissing){$health|Add-Member -NotePropertyName candidateReadOnly -NotePropertyValue $s.candidateReadOnly}
  $s.readerCalls++
  $problem=if($s.readerCalls -gt 1 -and $s.finalReaderProblem){$s.finalReaderProblem}else{$s.readerProblem}
  if($problem -ne 'missing'){
    $reader=[pscustomobject]@{schemaVersion='data-operations-reader-identity-v1';state='VALIDATED';bindingIdentity=[pscustomobject]@{manifestSha256='b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b';calendarSha256='77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21'}}
    switch($problem){
      'manifest' {$reader.bindingIdentity.manifestSha256='f'*64}
      'calendar' {$reader.bindingIdentity.calendarSha256='e'*64}
      'schema' {$reader.schemaVersion='different-v1'}
      'unverified' {$reader.state='UNVERIFIED'}
      'missing-identity' {$reader.PSObject.Properties.Remove('bindingIdentity')}
    }
    $health|Add-Member -NotePropertyName dataOperationsReader -NotePropertyValue $reader
  }
  $v2Problem=if($s.readerCalls -gt 1 -and $s.finalV2Problem){$s.finalV2Problem}else{$s.v2Problem}
  if($v2Problem -ne 'missing'){
    # Missing observations remain visible and must not fail a valid binding.
    $v2=[pscustomobject]@{schemaVersion='v2-reader-identity-v1';state='VALIDATED';bindingKind='GOVERNED_ACTIVE_V1';sourceRole='GOVERNED_ACTIVE_APP';bindingIdentity=[pscustomobject]@{manifestSha256='b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b';calendarSha256='77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21'};artifacts=[pscustomobject]@{forwardLedger=[pscustomobject]@{state='MISSING'}}}
    switch($v2Problem){
      'manifest' {$v2.bindingIdentity.manifestSha256='f'*64}
      'calendar' {$v2.bindingIdentity.calendarSha256='e'*64}
      'schema' {$v2.schemaVersion='different-v1'}
      'kind' {$v2.bindingKind='different'}
      'role' {$v2.sourceRole='different'}
      'unverified' {$v2.state='UNVERIFIED'}
      'missing-identity' {$v2.PSObject.Properties.Remove('bindingIdentity')}
    }
    $health|Add-Member -NotePropertyName v2Reader -NotePropertyValue $v2
  }
  return $health
}
# Avoid host environment enumeration and all real env/config/manifest reads.
function Assert-DailyCleanEnvironment($Plan,[string]$RequestedMode){$s.cleanCalls++;Check ($RequestedMode -ceq 'ReaderOnly') 'WRONG_PREFLIGHT_MODE'}
function Assert-DailyNodeConfiguration($Plan,[string]$RequestedMode){$s.preflightCalls++;Check ($RequestedMode -ceq 'ReaderOnly') 'WRONG_NODE_MODE';if($s.pollution){throw 'RESEARCH_ENTRY_NODE_CONFIGURATION_REJECTED'}}
function Get-DailyLeadership {return [pscustomobject]@{mode='market_data_only';data=[pscustomobject]@{collectionEnabled=$true};executionAuthorized=$false;orderRoutesEnabled=$false}}
function Get-DailyMarketGate($Plan){if(-not $s.marketOpen){throw 'RESEARCH_ENTRY_MARKET_CLOSED_OR_UNVERIFIED_NO_BROKER_START'};return [pscustomobject]@{marketShouldBeActive=$true;executionAuthorized=$false;orderRoutesEnabled=$false}}
function Start-DailyBridge($Plan){throw 'NO_COLLECTOR_START_ALLOWED'}
function Start-BoundNode($Plan,[string]$Role,[string]$Arguments,[string]$WorkingRoot){
  Check ($env:CRU34_LIVE_DATA_ROOT -ceq $b.dataRoot) 'MISSING_BOUND_DATA_ROOT'
  if($Role -eq 'producer'){throw 'NO_PRODUCER_START_ALLOWED'}
  Check ($Role -eq 'dashboard' -and $WorkingRoot -ceq $b.candidate.root -and $env:PORT -eq '18723' -and $env:COOKIE_SECURE -eq '1' -and $env:ASK_GPT_INLINE_ENABLED -eq '0') 'WRONG_CANDIDATE_CONFIGURATION'
  $s.capturedReaderFlag=[Environment]::GetEnvironmentVariable('DASHBOARD_CANDIDATE_READ_ONLY','Process')
  $s.capturedV2Flag=[Environment]::GetEnvironmentVariable('DASHBOARD_CANDIDATE_V2_BINDING','Process')
  $s.candidateReadOnly=(-not $s.ignoreReaderFlag -and $s.capturedReaderFlag -ceq '1')
  $s.starts.Add('candidate')|Out-Null;$s.candidate=$true;return 400
}
function Start-Process {param($FilePath) Check ($FilePath -ceq 'http://127.0.0.1:18723/') 'FORBIDDEN_PROCESS_LAUNCH';$s.browser++}
function Stop-Process {throw 'NO_RUNTIME_STOP_ALLOWED'}
function Start-Sleep { }
Test-Case 'default remains OpenExisting and source keeps policy and runtime controls unchanged' {
  $text=[IO.File]::ReadAllText($EntryPath)
  Check ($text -match "\[string\]\`$Mode='OpenExisting'") 'DEFAULT_MODE_CHANGED'
  Check ($text -notmatch 'ExecutionPolicy|Stop-Process|\.Kill\(') 'FORBIDDEN_RUNTIME_CONTROL'
  Check ($text -match 'Global\\TwChipBoundDailyUseV1') 'SHARED_MUTEX_MISSING'
  $bytes=[IO.File]::ReadAllBytes($EntryPath)
  Check ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) 'UTF8_BOM_MISSING'
}
Test-Case 'ReaderOnly warm repeat attests actual health without env validator or start' {
  Fixture
  $one=Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser
  $two=Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser
  Check ($s.starts.Count -eq 0 -and $s.browser -eq 0 -and $s.preflightCalls -eq 0 -and $s.cleanCalls -eq 0) 'WARM_REUSE_SIDE_EFFECT'
  Check ($one.candidate.pid -eq $two.candidate.pid -and $s.readerCalls -eq 4) 'WARM_ACTUAL_HEALTH_NOT_CHECKED'
  Check (-not $two.deliveryAccepted -and -not $two.runtimeReady -and $two.formalUnchanged) 'FALSE_DELIVERY_ACCEPTANCE'
}
foreach($case in @('missing','manifest','calendar','schema','unverified','missing-identity')){
  Test-Case ('ReaderOnly warm rejects actual reader identity: '+$case) {
    Fixture;$s.readerProblem=$case
    Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_OPERATIONS_BINDING_UNVERIFIED'
    Check ($s.starts.Count -eq 0 -and $s.browser -eq 0 -and $s.preflightCalls -eq 0) 'WRONG_WARM_IDENTITY_MUTATED_RUNTIME'
  }
}
Test-Case 'ReaderOnly validates actual health again before returning warm success' {
  Fixture;$s.finalReaderProblem='manifest'
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_OPERATIONS_BINDING_UNVERIFIED'
  Check ($s.starts.Count -eq 0 -and $s.readerCalls -eq 2) 'FINAL_IDENTITY_NOT_CHECKED'
}
Test-Case 'ReaderOnly cold start injects fence and starts only candidate' {
  Fixture;$s.candidate=$false
  $r=Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser
  Check (($s.starts -join ',') -ceq 'candidate' -and $s.preflightCalls -eq 1 -and $s.cleanCalls -eq 1) 'WRONG_COLD_START_SCOPE'
  Check ($s.capturedReaderFlag -ceq '1' -and $s.capturedV2Flag -ceq 'GOVERNED_ACTIVE_V1' -and $r.candidateReadOnly -eq $true) 'READER_FENCE_MISSING'
  Check ($s.readerCalls -eq 2 -and $r.formalUnchanged -and -not $r.deliveryAccepted -and -not $r.runtimeReady) 'FALSE_COLD_ACCEPTANCE'
  Check (-not (Test-Path -LiteralPath (Join-Path $b.logRoot 'pending-start.json'))) 'VALID_START_NOT_SETTLED'
}
foreach($case in @('missing','manifest','calendar','unverified')){
  Test-Case ('ReaderOnly cold candidate retains pending when actual identity is '+$case) {
    Fixture;$s.candidate=$false;$s.readerProblem=$case
    Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_START_UNVERIFIED'
    Check (($s.starts -join ',') -ceq 'candidate' -and $s.browser -eq 0) 'WRONG_FAILED_START_SCOPE'
    Check (Test-Path -LiteralPath (Join-Path $b.logRoot 'pending-start.json')) 'UNVERIFIED_START_SETTLED'
  }
}
Test-Case 'ReaderOnly rejects identity changing after cold readiness' {
  Fixture;$s.candidate=$false;$s.finalReaderProblem='calendar'
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_OPERATIONS_BINDING_UNVERIFIED'
  Check (($s.starts -join ',') -ceq 'candidate' -and $s.readerCalls -eq 2) 'COLD_FINAL_CHECK_MISSING'
  Check (Test-Path -LiteralPath (Join-Path $b.logRoot 'pending-start.json')) 'CHANGED_IDENTITY_SETTLED'
}
Test-Case 'ReaderOnly missing Bridge refuses before preflight or any start' {
  Fixture;$s.bridge=$false;$s.candidate=$false
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'READER_ONLY_BRIDGE_UNAVAILABLE_NO_SOURCE_START'
  Check ($s.starts.Count -eq 0 -and $s.preflightCalls -eq 0) 'SOURCE_START_ATTEMPTED'
}
Test-Case 'ReaderOnly missing Producer refuses before preflight or any start' {
  Fixture;$s.owner=$false;$s.candidate=$false
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'READER_ONLY_PRODUCER_UNAVAILABLE_NO_SOURCE_START'
  Check ($s.starts.Count -eq 0 -and $s.preflightCalls -eq 0) 'PRODUCER_START_ATTEMPTED'
}
Test-Case 'ReaderOnly foreign listener cannot be replaced' {
  Fixture;$s.candidateWrong=$true
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_SOURCE_MISMATCH'
  Check ($s.starts.Count -eq 0) 'FOREIGN_RUNTIME_REPLACED'
}
Test-Case 'ReaderOnly preflight rejection occurs before mocked candidate start' {
  Fixture;$s.candidate=$false;$s.pollution=$true
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'NODE_CONFIGURATION_REJECTED'
  Check ($s.starts.Count -eq 0 -and $s.preflightCalls -eq 1) 'PREFLIGHT_NOT_ENFORCED'
}
Test-Case 'ReaderOnly keeps actual boolean fence and missing fence fail-closed' {
  foreach($flag in @($false,'true')){
    Fixture;$s.candidateReadOnly=$flag
    Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_READ_ONLY_BOUNDARY_UNVERIFIED'
    Check ($s.starts.Count -eq 0) 'MISSING_FENCE_MUTATION'
  }
  Fixture;$s.candidateReadOnlyMissing=$true
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_READ_ONLY_BOUNDARY_UNVERIFIED'
}
Test-Case 'ReaderOnly cold candidate ignoring actual fence cannot settle' {
  Fixture;$s.candidate=$false;$s.ignoreReaderFlag=$true
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_START_UNVERIFIED'
  Check (Test-Path -LiteralPath (Join-Path $b.logRoot 'pending-start.json')) 'MISSING_COLD_FENCE_SETTLED'
}
Test-Case 'CheckOnly keeps unavailable identity unknown and never starts a service' {
  Fixture;$s.candidateReadOnlyMissing=$true;$s.readerProblem='missing'
  $r=Invoke-DailyEntry $b 'CheckOnly'
  Check ($null -eq $r.candidateReadOnly -and $s.starts.Count -eq 0 -and $s.browser -eq 0) 'CHECK_ONLY_CONTRACT_CHANGED'
}
Test-Case 'default OpenExisting behavior does not require the optional ReaderOnly identity' {
  Fixture;$s.candidateReadOnly=$false;$s.readerProblem='missing'
  $r=Invoke-DailyEntry $b 'OpenExisting'
  Check ($s.starts.Count -eq 0 -and $s.browser -eq 1 -and $s.preflightCalls -eq 0 -and -not $r.candidateReadOnly) 'OPEN_EXISTING_CONTRACT_CHANGED'
}
foreach($case in @('missing','manifest','calendar','schema','kind','role','unverified','missing-identity')){
  Test-Case ('ReaderOnly warm rejects actual V2 identity: '+$case) {
    Fixture;$s.v2Problem=$case
    Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_V2_BINDING_UNVERIFIED'
    Check ($s.starts.Count -eq 0 -and $s.browser -eq 0 -and $s.preflightCalls -eq 0) 'INVALID_V2_WARM_MUTATION'
  }
}
foreach($case in @('missing','manifest','unverified')){
  Test-Case ('ReaderOnly cold retains pending for V2 identity: '+$case) {
    Fixture;$s.candidate=$false;$s.v2Problem=$case
    Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_START_UNVERIFIED'
    Check (($s.starts -join ',') -ceq 'candidate' -and $s.browser -eq 0) 'INVALID_V2_COLD_SCOPE'
    Check (Test-Path -LiteralPath (Join-Path $b.logRoot 'pending-start.json')) 'INVALID_V2_START_SETTLED'
  }
}
Test-Case 'ReaderOnly rechecks actual V2 identity at final acceptance' {
  Fixture;$s.finalV2Problem='calendar'
  Throws {Invoke-DailyEntry $b 'ReaderOnly' -SuppressBrowser} 'CANDIDATE_V2_BINDING_UNVERIFIED'
  Check ($s.readerCalls -eq 2 -and $s.starts.Count -eq 0) 'V2_FINAL_CHECK_MISSING'
}
Test-Case 'ReaderOnly has exact V2 opt-in and other entry modes keep their environment maps' {
  Fixture
  Check ((Get-DailyEnvironment $b 'ReaderOnly').DASHBOARD_CANDIDATE_V2_BINDING -ceq 'GOVERNED_ACTIVE_V1') 'V2_OPT_IN_MISSING'
  foreach($mode in @('Start','CheckOnly','OpenExisting')){
    Check (-not (Get-DailyEnvironment $b $mode).ContainsKey('DASHBOARD_CANDIDATE_V2_BINDING')) 'DEFAULT_ENV_CHANGED'
  }
}
Write-Output "RESULT passed=$passed failed=$($failed.Count) fixtures=$testRoot"
if($failed.Count){throw ($failed -join "`n")}
