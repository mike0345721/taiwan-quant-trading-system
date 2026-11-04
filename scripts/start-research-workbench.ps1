param(
  [string]$BindingPath=(Join-Path $PSScriptRoot 'binding.json'),
  [ValidateSet('CheckOnly','OpenExisting','Start','ReaderOnly')][string]$Mode='OpenExisting',
  [switch]$NoBrowser,[switch]$LibraryOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Assert-Daily([bool]$Value,[string]$Reason){if(-not $Value){throw ('RESEARCH_ENTRY_'+$Reason)}}
function Read-DailyJson([string]$Path){if(-not [IO.File]::Exists($Path)){return $null};return [IO.File]::ReadAllText($Path)|ConvertFrom-Json}
function Write-DailyReceipt([string]$Path,$Value){
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 20)+"`n")
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Get-DailyHealth([int]$Port){
  try{return Invoke-RestMethod -Uri ('http://127.0.0.1:'+ $Port + $(if($Port -eq 8790){'/health'}else{'/healthz'})) -TimeoutSec 3}catch{return $null}
}
function Get-DailyLeadership {
  try{return Invoke-RestMethod -Uri 'http://127.0.0.1:8790/leadership' -TimeoutSec 3}catch{return $null}
}
function Assert-DailySafety($Object){
  $safe=$false
  try{$safe=$Object.researchOnly -is [bool] -and $Object.researchOnly -eq $true -and $Object.executionAuthorized -is [bool] -and $Object.executionAuthorized -eq $false -and $Object.orderRoutesEnabled -is [bool] -and $Object.orderRoutesEnabled -eq $false -and ($Object.formalWeight -is [int] -or $Object.formalWeight -is [long] -or $Object.formalWeight -is [double]) -and $Object.formalWeight -eq 0}catch{}
  Assert-Daily $safe 'UNSAFE_OR_MISSING_FLAGS'
}
function Assert-DailyListener([int]$Port,$Process){
  $ports=@(Get-NetTCPConnection -State Listen -OwningProcess $Process.pid -ErrorAction SilentlyContinue)
  Assert-Daily ($ports.Count -eq 1 -and $ports[0].LocalPort -eq $Port -and $ports[0].LocalAddress -eq '127.0.0.1') 'LISTENER_BOUNDARY'
}
function Get-DailyFormalIdentity {
  $p=Get-BoundListener 8787
  if($null -eq $p){return [pscustomobject]@{present=$false}}
  return [pscustomobject]@{present=$true;pid=$p.pid;createdAt=$p.createdAt;executable=$p.executable;command=$p.command}
}
function Assert-DailyBridge($b,$Process,$Health){
  Assert-Daily ($null -ne $Process -and $null -ne $Health) 'BRIDGE_UNVERIFIED'
  $scriptPath=Join-Path $b.bridge.root 'broker\shioaji_readonly_bridge.py'
  $commands=@(('"'+$b.python+'" "'+$scriptPath+'"'),($b.python+' "'+$scriptPath+'"'))
  Assert-Daily ($Process.executable -ieq $b.python -and $commands -ccontains $Process.command.Trim()) 'BRIDGE_SOURCE_MISMATCH'
  Assert-DailyListener 8790 $Process
  Assert-Daily ($Health.ok -is [bool] -and $Health.ok -eq $true -and $Health.mode -ceq 'market_data_only' -and $Health.processId -eq $Process.pid) 'BRIDGE_HEALTH_IDENTITY'
  Assert-DailySafety $Health
  $leadership=Get-DailyLeadership
  Assert-Daily ($null -ne $leadership -and $leadership.mode -ceq 'market_data_only' -and $leadership.data.collectionEnabled -is [bool] -and $leadership.data.collectionEnabled -eq $true -and $b.ix0001LeadershipCollectionEnabled -ceq 'true' -and $leadership.executionAuthorized -is [bool] -and $leadership.executionAuthorized -eq $false -and $leadership.orderRoutesEnabled -is [bool] -and $leadership.orderRoutesEnabled -eq $false) 'BRIDGE_LEADERSHIP_BINDING'
}
function New-DailyBoundPlan($b){return [pscustomobject]@{producer=$b.producer;dashboard=$b.candidate;dataRoot=$b.dataRoot;projectionRoot=(Join-Path $b.dataRoot 'runtime\cru34-live');node=$b.node;envFile=$b.envFile;logRoot=$b.logRoot}}
function Get-DailyWorker($bound){
  $lock=Read-BoundJson (Join-Path $bound.projectionRoot 'worker.lock')
  $status=Read-BoundJson (Join-Path $bound.projectionRoot 'status.json')
  $owner=$null
  if($lock){
    Assert-Daily ($lock.pid -gt 0 -and $lock.workerInstanceId -cmatch '^[0-9a-f-]{36}$') 'LOCK_UNVERIFIED'
    $owner=Get-BoundProcess ([int]$lock.pid)
    if($owner){Assert-BoundWorker $bound $status $lock $owner;Assert-DailySafety $status}
  }
  if(-not $owner -and $status){
    Assert-Daily ($status.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $status.pid -gt 0) 'STATUS_UNVERIFIED'
    Assert-Daily ($null -eq (Get-BoundProcess ([int]$status.pid))) 'LIVE_STATUS_WITHOUT_LOCK'
  }
  return $owner
}
function Assert-DailyCandidate($b,$Process,$Health,[switch]$MissingProducer,[switch]$RequireReadOnly){
  Assert-Daily ($null -ne $Process -and $null -ne $Health) 'CANDIDATE_UNVERIFIED'
  $expected='"'+$b.node+'" --env-file="'+$b.envFile+'" "'+(Join-Path $b.candidate.root 'server.mjs')+'"'
  Assert-Daily ($Process.executable -ieq $b.node -and $Process.command.Trim() -ceq $expected) 'CANDIDATE_SOURCE_MISMATCH'
  Assert-DailyListener 18723 $Process
  Assert-Daily ($Health.ok -is [bool] -and $Health.ok -eq $true -and $Health.runtimeCommit -ceq $b.candidate.commit -and $Health.runtimeIdentityStatus -ceq 'VERIFIED' -and $Health.inlineAssistant.enabled -is [bool] -and $Health.inlineAssistant.enabled -eq $false) 'CANDIDATE_VERSION_OR_AI'
  if($RequireReadOnly){
    Assert-Daily ($null -ne $Health.PSObject.Properties['candidateReadOnly'] -and $Health.candidateReadOnly -is [bool] -and $Health.candidateReadOnly -eq $true) 'CANDIDATE_READ_ONLY_BOUNDARY_UNVERIFIED'
    # Warm reuse and cold acceptance must attest the running process's actual
    # reader binding; a fresh shell/Node check cannot prove an incumbent's input.
    $readerKnown=$false
    try{$reader=$Health.dataOperationsReader;$readerKnown=$reader.schemaVersion -ceq 'data-operations-reader-identity-v1' -and $reader.state -ceq 'VALIDATED' -and $reader.bindingIdentity.manifestSha256 -ceq 'b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b' -and $reader.bindingIdentity.calendarSha256 -ceq '77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21'}catch{}
    Assert-Daily $readerKnown 'CANDIDATE_OPERATIONS_BINDING_UNVERIFIED'
    $v2ReaderKnown=$false
    try{$v2Reader=$Health.v2Reader;$v2ReaderKnown=$v2Reader.schemaVersion -ceq 'v2-reader-identity-v1' -and $v2Reader.state -ceq 'VALIDATED' -and $v2Reader.bindingKind -ceq 'GOVERNED_ACTIVE_V1' -and $v2Reader.sourceRole -ceq 'GOVERNED_ACTIVE_APP' -and $v2Reader.bindingIdentity.manifestSha256 -ceq 'b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b' -and $v2Reader.bindingIdentity.calendarSha256 -ceq '77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21'}catch{}
    Assert-Daily $v2ReaderKnown 'CANDIDATE_V2_BINDING_UNVERIFIED'
  }
  Assert-DailySafety $Health.productSurface.safety
  $p=$Health.runtimeEvidence.producer
  Assert-Daily ($p.snapshot.path -ceq (Join-Path $b.dataRoot 'runtime\cru34-live\latest.json') -and $p.statusFile.path -ceq (Join-Path $b.dataRoot 'runtime\cru34-live\status.json')) 'CANDIDATE_READER_PATHS'
  $refused=@('LIVE_PRODUCER_PATH_MISMATCH','LIVE_PRODUCER_INSTANCE_MISMATCH')
  if($MissingProducer -and $null -eq $p.lock -and $null -ne $p.worker -and $p.worker.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $p.worker.pid -gt 0 -and $null -eq (Get-BoundProcess ([int]$p.worker.pid))){$refused=@('LIVE_PRODUCER_PATH_MISMATCH')}
  Assert-Daily (@($p.reasons|Where-Object{$_ -in $refused}).Count -eq 0) 'CANDIDATE_READER_IDENTITY'
}
function Assert-DailyNoUnownedRuntime([ValidateSet('bridge','producer','candidate')][string]$Role,$b){
  $processes=@(Get-CimInstance Win32_Process)
  if($Role -eq 'bridge'){$found=@($processes|Where-Object{$_.Name -match '^python(w)?\.exe$' -and (-not $_.CommandLine -or $_.CommandLine -match 'shioaji_readonly_bridge\.py')})}
  elseif($Role -eq 'producer'){$found=@($processes|Where-Object{$_.Name -eq 'node.exe' -and (-not $_.CommandLine -or $_.CommandLine -match 'run-cru34-live-projection\.mjs')})}
  else{$server=Join-Path $b.candidate.root 'server.mjs';$found=@($processes|Where-Object{$_.Name -eq 'node.exe' -and (-not $_.CommandLine -or $_.CommandLine.Contains($server))})}
  Assert-Daily ($found.Count -eq 0) ($Role.ToUpperInvariant()+'_UNOWNED_PROCESS')
}
function Test-DailyKnownManifestPath([string]$Value){
  # Only separator spelling may differ; no case folding, aliases, dot segments,
  # whitespace trimming or path discovery can expand this reviewed location.
  return ($Value.Replace('/','\') -ceq 'D:\Taiwan stock\approved-main-runtime\data\data-operations-binding-r1-8557124-20260928.json')
}
function Assert-DailyCleanEnvironment($b,[string]$RequestedMode='') {
  $forbidden='^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|DASHBOARD_RELEASE_SCOPE|DASHBOARD_TLS_.*|DASHBOARD_PREVIEW_.*|DASHBOARD_FORMAL_READ_ROOT|DASHBOARD_ENV_PATH|DASHBOARD_RUNTIME_COMMIT|ASK_GPT_CANDIDATE_READ_ROOT|CRU21_GUEST_.*|CRU55_.*|CRU54_.*|V2_RESEARCH_DATABASE_PATH|V2_BACKTEST_REPORT_PATH|DATA_OPERATIONS_OUTPUT_ROOT|DATA_OPERATIONS_MANIFEST_PATH|DASHBOARD_LIGHTWEIGHT_CHARTS_.*|DW4_.*|IX0001_.*|PYTHON.*|CRU34_LIVE_(POLL_MS|STALE_AFTER_MS|MAX_BATCH_BYTES|MAX_BATCH_RECORDS|WORKER_INSTANCE_ID|STDOUT_PATH|STDERR_PATH|INCIDENT_PATH)|FORWARD_SHADOW_.*|CRU34_SNAPSHOT_.*|TXO_.*|CVD_.*|TAIFEX_ALLOW_CANDIDATE_CLOSURE)$'
  foreach($item in Get-ChildItem Env:){
    if($item.Name -ieq 'IX0001_LEADERSHIP_COLLECTION_ENABLED'){Assert-Daily ($item.Value -ceq $b.ix0001LeadershipCollectionEnabled) 'LEADERSHIP_ENVIRONMENT_MISMATCH';continue}
    if($item.Name -ieq 'DATA_OPERATIONS_MANIFEST_PATH' -and $item.Value){Assert-Daily ($RequestedMode -ceq 'ReaderOnly' -and $item.Name -ceq 'DATA_OPERATIONS_MANIFEST_PATH' -and (Test-DailyKnownManifestPath $item.Value)) 'ENVIRONMENT_ROUTING_REJECTED';continue}
    if($item.Name -ieq 'DASHBOARD_CANDIDATE_V2_BINDING' -and $item.Value){Assert-Daily ($RequestedMode -ceq 'ReaderOnly' -and $item.Name -ceq 'DASHBOARD_CANDIDATE_V2_BINDING' -and $item.Value -ceq 'GOVERNED_ACTIVE_V1') 'ENVIRONMENT_ROUTING_REJECTED';continue}
    if($RequestedMode -ceq 'ReaderOnly' -and $item.Name -ieq 'V2_DATABASE_PATH' -and $item.Value){throw 'RESEARCH_ENTRY_ENVIRONMENT_ROUTING_REJECTED'}
    if($item.Name -match $forbidden -and $item.Value){throw 'RESEARCH_ENTRY_ENVIRONMENT_ROUTING_REJECTED'}
  }
  if($env:NODE_TLS_REJECT_UNAUTHORIZED -and $env:NODE_TLS_REJECT_UNAUTHORIZED -ne '1'){throw 'RESEARCH_ENTRY_TLS_RELAXATION_REJECTED'}
}
function Get-DailyEnvironment($b,[string]$RequestedMode=''){
  $map=@{
  HOST='127.0.0.1';PORT='18723';NODE_ENV='production';ASK_GPT_INLINE_ENABLED='0';COOKIE_SECURE='1';MOCK_DATA='0';REFRESH_INTERVAL_SECONDS='300';
  CRU34_LIVE_DATA_ROOT=$b.dataRoot;CRU34_LIVE_PROJECTION_ROOT=(Join-Path $b.dataRoot 'runtime\cru34-live');
  CRU34_LIVE_SNAPSHOT_PATH=(Join-Path $b.dataRoot 'runtime\cru34-live\latest.json');CRU34_LIVE_STATUS_PATH=(Join-Path $b.dataRoot 'runtime\cru34-live\status.json');
  TX_CHART_DATA_ROOT=$b.chartDataRoot;TX_CHART_CACHE_ROOT=(Join-Path $b.candidate.root 'data\dashboard-chart-cache')
  IX0001_LEADERSHIP_COLLECTION_ENABLED=$b.ix0001LeadershipCollectionEnabled
  }
  if($RequestedMode -eq 'ReaderOnly'){$map.DASHBOARD_CANDIDATE_READ_ONLY='1';$map.DASHBOARD_CANDIDATE_V2_BINDING='GOVERNED_ACTIVE_V1'}
  return $map
}
function Assert-DailyNoEnvPreload([string]$Path){
  # Inspect only key syntax before Node can act on startup options. Never emit
  # any line, value, hash or matched text. Conservative quoted-key handling and
  # matches inside multiline values may refuse harmless files, safely.
  $preloadKey='(?i)^[\s\uFEFF]*(?:export\s+)?["'']?(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|NODE_TLS_REJECT_UNAUTHORIZED)["'']?\s*='
  $reader=[IO.File]::OpenText($Path)
  try{while($null -ne ($line=$reader.ReadLine())){Assert-Daily (-not [regex]::IsMatch($line,$preloadKey)) 'ENV_PRELOAD_KEY_REJECTED'}}finally{$reader.Dispose()}
}
function Assert-DailyNodeConfiguration($b,[string]$RequestedMode=''){
  Assert-DailyNoEnvPreload $b.envFile
  # Node loads the existing approved env file as in normal startup. Only a fixed
  # PASS/FAIL marker is returned; no value, hash, password or account is printed.
  $validator=@'
// ENTRY_MANIFEST_R3_PURE_BEGIN: synthetic tests extract only this pure block.
const OPERATIONS_PIN = Object.freeze({
  candidateRoot: 'D:/Taiwan stock/standalone-v1/data/worktrees/cru21-unified-release-20261014',
  manifestPath: 'D:/Taiwan stock/approved-main-runtime/data/data-operations-binding-r1-8557124-20260928.json',
  manifestSha256: 'b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b',
  dataRoot: 'D:/Taiwan stock/approved-main-runtime/data',
  outputRoot: 'D:/Taiwan stock/approved-main-runtime/data/quality/daily-data-operations',
  evidenceRoot: 'D:/Taiwan stock/approved-main-runtime/data/quality/daily-collection-acceptance/a2b',
  calendarPath: 'D:/Taiwan stock/approved-main-runtime/config/taifex-official-calendar-2026.json',
  calendarSha256: '77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21',
  activeAppRoot: 'D:/Taiwan stock/standalone-v1',
  ledgerDataRoot: 'D:/Taiwan stock/standalone-v1/data',
  databasePath: 'D:/Taiwan stock/standalone-v1/v2/data/research-v2.sqlite',
  dailyStatusPath: 'D:/Taiwan stock/standalone-v1/v2/reports/v3-daily-update-status.json',
  registryPath: 'D:/Taiwan stock/approved-main-runtime/config/data-requirements-v1.json',
  registrySha256: '6eb202a74bc0295d067617ca9e2e32a927f071aa5847fb9a9b40e6d46894aa4c',
  derivedArtifactPath: 'D:/Taiwan stock/standalone-v1/data/runtime/cru34-live/latest.json',
  supersedesManifestSha256: '5bb279e71e705225d80e5d0a5943ad6d26ada9321c45e0278f08a18d0b034975',
  governanceReference: 'CRU-52 Owner formal rollout authorization https://github.com/mike0345721/taiwan-quant-trading-system/pull/74#issuecomment-5861839036; approved main 8557124bc4f5f5cd625327c1136ff9bf6353a8f7',
});
const pinnedPath = (actual, expected) => typeof actual === 'string' && actual.replaceAll('\\', '/') === expected;
const refuse = reason => { throw new Error(reason); };
function assertEntryRouting(environment, requestedMode) {
  const forbidden = /^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|DASHBOARD_RELEASE_SCOPE|DASHBOARD_TLS_.*|DASHBOARD_PREVIEW_.*|DASHBOARD_FORMAL_READ_ROOT|DASHBOARD_ENV_PATH|DASHBOARD_RUNTIME_COMMIT|ASK_GPT_CANDIDATE_READ_ROOT|CRU21_GUEST_.*|CRU55_.*|CRU54_.*|V2_RESEARCH_DATABASE_PATH|V2_BACKTEST_REPORT_PATH|DATA_OPERATIONS_OUTPUT_ROOT|DATA_OPERATIONS_MANIFEST_PATH|DASHBOARD_LIGHTWEIGHT_CHARTS_.*|DW4_.*|IX0001_.*|PYTHON.*|CRU34_LIVE_(POLL_MS|STALE_AFTER_MS|MAX_BATCH_BYTES|MAX_BATCH_RECORDS|WORKER_INSTANCE_ID|STDOUT_PATH|STDERR_PATH|INCIDENT_PATH)|FORWARD_SHADOW_.*|CRU34_SNAPSHOT_.*|TXO_.*|CVD_.*|TAIFEX_ALLOW_CANDIDATE_CLOSURE)$/i;
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === 'IX0001_LEADERSHIP_COLLECTION_ENABLED') { if (value !== 'true') refuse('LEADERSHIP_PIN'); continue; }
    if (key.toUpperCase() === 'DATA_OPERATIONS_MANIFEST_PATH' && value) {
      if (key !== 'DATA_OPERATIONS_MANIFEST_PATH' || requestedMode !== 'ReaderOnly'
        || !pinnedPath(value, OPERATIONS_PIN.manifestPath)) refuse('MANIFEST_ROUTE');
      continue;
    }
    if (key.toUpperCase() === 'DASHBOARD_CANDIDATE_V2_BINDING' && value) {
      if (key !== 'DASHBOARD_CANDIDATE_V2_BINDING' || requestedMode !== 'ReaderOnly' || value !== 'GOVERNED_ACTIVE_V1') refuse('V2_READER_ROUTE');
      continue;
    }
    if (value && (forbidden.test(key) || (requestedMode === 'ReaderOnly' && key.toUpperCase() === 'V2_DATABASE_PATH'))) refuse('ROUTING');
  }
  if (environment.IX0001_LEADERSHIP_COLLECTION_ENABLED !== 'true'
    || (environment.NODE_TLS_REJECT_UNAUTHORIZED && environment.NODE_TLS_REJECT_UNAUTHORIZED !== '1')) refuse('ENVIRONMENT');
  if (requestedMode === 'ReaderOnly' && !environment.DATA_OPERATIONS_MANIFEST_PATH) refuse('MANIFEST_REQUIRED');
  if (requestedMode === 'ReaderOnly' && environment.DASHBOARD_CANDIDATE_V2_BINDING !== 'GOVERNED_ACTIVE_V1') refuse('V2_READER_REQUIRED');
}
function assertPinnedOperationsSnapshot({ requestedMode, configuration, manifestPath, binding, registryHash, candidateCalendarHash, assertNoLinks }) {
  if (requestedMode !== 'ReaderOnly' || configuration?.candidateReadOnly !== true
    || configuration.candidateV2Binding !== 'GOVERNED_ACTIVE_V1'
    || !pinnedPath(configuration.appRoot, OPERATIONS_PIN.candidateRoot)) refuse('READER_BOUNDARY');
  if (!pinnedPath(manifestPath, OPERATIONS_PIN.manifestPath) || binding?.manifestSha256 !== OPERATIONS_PIN.manifestSha256) refuse('MANIFEST_IDENTITY');
  const manifest = binding.manifest, sources = manifest?.sourceBindings;
  if (manifest?.schemaVersion !== 'data-operations-input-index-v1' || manifest.governanceState !== 'GOVERNED'
    || manifest.governanceReference !== OPERATIONS_PIN.governanceReference || manifest.selection !== 'BUILD_A1'
    || manifest.supersedesManifestSha256 !== OPERATIONS_PIN.supersedesManifestSha256
    || manifest.operationsBinding?.schemaVersion !== 'data-operations-binding-v1') refuse('MANIFEST_GOVERNANCE');
  for (const key of ['dataRoot', 'outputRoot', 'calendarPath']) {
    if (!pinnedPath(binding[key], OPERATIONS_PIN[key]) || !pinnedPath(manifest.operationsBinding[key], OPERATIONS_PIN[key])) refuse('OPERATIONS_ROOT');
  }
  if (!pinnedPath(binding.evidenceRoot, OPERATIONS_PIN.evidenceRoot) || !pinnedPath(manifest.evidenceRoot, OPERATIONS_PIN.evidenceRoot)) refuse('EVIDENCE_ROOT');
  for (const key of ['activeAppRoot', 'ledgerDataRoot', 'databasePath', 'dailyStatusPath', 'registryPath']) {
    if (!pinnedPath(sources?.[key], OPERATIONS_PIN[key])) refuse('SOURCE_ROOT');
  }
  if (sources.batchEvidencePath || sources.registrySha256 !== OPERATIONS_PIN.registrySha256 || registryHash !== OPERATIONS_PIN.registrySha256) refuse('REGISTRY_IDENTITY');
  if (!Array.isArray(sources.derivedArtifactPaths) || sources.derivedArtifactPaths.length !== 1
    || !pinnedPath(sources.derivedArtifactPaths[0], OPERATIONS_PIN.derivedArtifactPath)) refuse('DERIVED_ROOT');
  for (const key of ['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT']) {
    const sessions = sources.sessionsByCheckpoint?.[key];
    if (!Array.isArray(sessions) || sessions.length !== 2 || sessions[0] !== 'DAY' || sessions[1] !== 'NIGHT') refuse('SESSION_TUPLE');
  }
  if (manifest.calendarSha256 !== OPERATIONS_PIN.calendarSha256 || binding.calendar?.fileHash !== OPERATIONS_PIN.calendarSha256
    || candidateCalendarHash !== OPERATIONS_PIN.calendarSha256) refuse('CALENDAR_IDENTITY');
  for (const key of ['manifestPath', 'dataRoot', 'outputRoot', 'evidenceRoot', 'calendarPath', 'activeAppRoot', 'ledgerDataRoot', 'databasePath', 'dailyStatusPath', 'registryPath', 'derivedArtifactPath']) assertNoLinks(OPERATIONS_PIN[key]);
  assertNoLinks(OPERATIONS_PIN.candidateRoot + '/config/taifex-official-calendar-2026.json');
}
// ENTRY_MANIFEST_R3_PURE_END
(async () => {
  const environment = process.env, candidateRoot = process.argv[1], requestedMode = process.argv[2];
  assertEntryRouting(environment, requestedMode);
  if (!pinnedPath(candidateRoot, OPERATIONS_PIN.candidateRoot)) refuse('CANDIDATE_SOURCE');
  const { pathToFileURL } = await import('node:url');
  const moduleUrl = relative => pathToFileURL(candidateRoot + '/' + relative).href;
  let configuration;
  if (requestedMode === 'ReaderOnly') {
    ({ config: configuration } = await import(moduleUrl('src/config.mjs')));
    if (configuration.candidateReadOnly !== true || configuration.candidateV2Binding !== 'GOVERNED_ACTIVE_V1' || !pinnedPath(configuration.appRoot, OPERATIONS_PIN.candidateRoot)) refuse('READER_BOUNDARY');
  }
  if (environment.DATA_OPERATIONS_MANIFEST_PATH) {
    const { validateOperationsBinding } = await import(moduleUrl('src/data-operations-binding.mjs'));
    const { readBoundedFile, sha256, noLinks } = await import(moduleUrl('src/daily-data-operations-files.mjs'));
    const manifestBytes = readBoundedFile(environment.DATA_OPERATIONS_MANIFEST_PATH, 1024 * 1024);
    // Authenticate the immutable bytes before the existing validator can follow
    // any path contained in the document. Reuse those same bytes, not a reread.
    if (sha256(manifestBytes) !== OPERATIONS_PIN.manifestSha256) refuse('MANIFEST_IDENTITY');
    const binding = validateOperationsBinding(environment.DATA_OPERATIONS_MANIFEST_PATH, manifestBytes);
    assertPinnedOperationsSnapshot({ requestedMode, configuration, manifestPath: environment.DATA_OPERATIONS_MANIFEST_PATH, binding,
      registryHash: sha256(readBoundedFile(OPERATIONS_PIN.registryPath, 1024 * 1024)),
      candidateCalendarHash: sha256(readBoundedFile(OPERATIONS_PIN.candidateRoot + '/config/taifex-official-calendar-2026.json', 1024 * 1024)),
      assertNoLinks: noLinks });
  }
  process.stdout.write('CONFIG_PASS');
})().catch(() => process.exit(2));
'@
  $answer=& $b.node ('--env-file='+$b.envFile) -e $validator $b.candidate.root $RequestedMode 2>$null
  Assert-Daily ($LASTEXITCODE -eq 0 -and ($answer -join '') -ceq 'CONFIG_PASS') 'NODE_CONFIGURATION_REJECTED'
}
function Read-DailyBinding([string]$Path){
  $b=Read-DailyJson $Path
  Assert-Daily ($null -ne $b -and $b.schema -ceq 'shiheng-research-entry-v1' -and $b.marketDataStartupAuthorized -is [bool] -and $b.marketDataStartupAuthorized -eq $true) 'BINDING_REQUIRED'
  Assert-Daily ($b.ix0001LeadershipCollectionEnabled -is [string] -and $b.ix0001LeadershipCollectionEnabled -ceq 'true') 'LEADERSHIP_PIN_REQUIRED'
  $expected=@{bridge='D:\Taiwan stock\standalone-v1';producer='D:\Taiwan stock\standalone-v1\data\worktrees\cru21-producer-snapshot-publication-20261013';candidate='D:\Taiwan stock\standalone-v1\data\worktrees\cru21-unified-release-20261014'}
  foreach($role in $expected.Keys){Assert-Daily ($b.$role.root -ceq $expected[$role] -and $b.$role.commit -cmatch '^[0-9a-f]{40}$') 'SOURCE_BINDING_REJECTED'}
  Assert-Daily ($b.node -ceq 'C:\Program Files\nodejs\node.exe' -and $b.python -ceq 'D:\Python\python.exe' -and $b.envFile -ceq 'D:\Taiwan stock\approved-main-runtime\.env' -and $b.dataRoot -ceq 'D:\Taiwan stock\approved-main-runtime\data' -and $b.chartDataRoot -ceq 'D:\Taiwan stock\standalone-v1\data' -and $b.logRoot -ceq (Join-Path $b.candidate.root 'data\research-entry')) 'PATH_BINDING_REJECTED'
  # Validate the candidate's exact source before importing its inert helper module.
  $actual=& git -C $b.candidate.root rev-parse HEAD
  Assert-Daily ($LASTEXITCODE -eq 0 -and $actual -ceq $b.candidate.commit) 'HELPER_SOURCE_CHANGED'
  $dirty=@(& git -C $b.candidate.root status --porcelain)
  Assert-Daily ($LASTEXITCODE -eq 0 -and $dirty.Count -eq 0) 'HELPER_SOURCE_DIRTY'
  Import-Module (Join-Path $b.candidate.root 'scripts\bound-daily-use.psm1') -Force -Global
  Assert-BoundSource $b.bridge @('v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md')
  Assert-BoundSource $b.producer
  Assert-BoundSource $b.candidate
  foreach($file in @($b.node,$b.python,$b.envFile)){Assert-Daily ([IO.File]::Exists($file)) 'REQUIRED_LOCAL_FILE_MISSING'}
  $ledgerLink=Get-Item -LiteralPath (Join-Path $b.dataRoot 'live-events') -Force
  Assert-Daily ($ledgerLink.LinkType -ceq 'Junction' -and @($ledgerLink.Target).Count -eq 1 -and $ledgerLink.Target[0] -ceq (Join-Path $b.chartDataRoot 'live-events')) 'LEDGER_SOURCE_ROUTE_CHANGED'
  return $b
}
function Wait-DailyService([scriptblock]$Probe,[string]$Reason){
  $last=$null
  foreach($attempt in 1..20){try{$last=& $Probe;if($null -ne $last){return $last}}catch{};Start-Sleep -Milliseconds 500}
  throw ('RESEARCH_ENTRY_'+$Reason)
}
function Get-DailyMarketGate($b){
  $market=& $b.node (Join-Path $b.candidate.root 'scripts\inspect-market-start-gate.mjs')
  Assert-Daily ($LASTEXITCODE -eq 0) 'MARKET_CLOSED_OR_UNVERIFIED_NO_BROKER_START'
  return $market|ConvertFrom-Json
}
function Start-DailyBridge($b){
  Assert-Daily ((Get-Command python.exe -ErrorAction Stop).Source -ieq $b.python) 'BRIDGE_PYTHON_PATH_MISMATCH'
  & (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $b.bridge.root 'scripts\start-shioaji-readonly-hidden.ps1')|Out-Null
  Assert-Daily ($LASTEXITCODE -eq 0) 'BRIDGE_START_FAILED'
}
function Backup-DailyBridgeLogs($b,[string]$AttemptPath){
  foreach($name in @('shioaji-readonly.log','shioaji-readonly-error.log')){
    $source=Join-Path (Join-Path $b.bridge.root 'data\automation-logs') $name
    if([IO.File]::Exists($source)){[IO.File]::Copy($source,(Join-Path $AttemptPath ('previous-'+$name)),$false)}
  }
}
function Invoke-DailyEntry($b,[string]$RequestedMode,[switch]$SuppressBrowser){
  $bound=New-DailyBoundPlan $b
  $formalBefore=Get-DailyFormalIdentity
  $bridge=Get-BoundListener 8790;$bridgeHealth=$null
  if($bridge){$bridgeHealth=Get-DailyHealth 8790;Assert-DailyBridge $b $bridge $bridgeHealth}
  $owner=Get-DailyWorker $bound
  $candidate=Get-BoundListener 18723;$candidateHealth=$null
  if($candidate){$candidateHealth=Get-DailyHealth 18723;Assert-DailyCandidate $b $candidate $candidateHealth -MissingProducer:($null -eq $owner) -RequireReadOnly:($RequestedMode -eq 'ReaderOnly')}
  $missing=@();if(-not $bridge){$missing+='bridge'};if(-not $owner){$missing+='producer'};if(-not $candidate){$missing+='candidate'}
  New-Item -ItemType Directory -Path $b.logRoot -Force|Out-Null
  $attemptPath=Join-Path $b.logRoot ([guid]::NewGuid().ToString());New-Item -ItemType Directory -Path $attemptPath|Out-Null
  Write-DailyReceipt (Join-Path $attemptPath 'before.json') @{at=[datetime]::UtcNow.ToString('o');mode=$RequestedMode;missing=$missing;formal=$formalBefore;bridge=$bridge;producer=$owner;candidate=$candidate}
  $pending=Join-Path $b.logRoot 'pending-start.json'
  $saved=@{};$startedRoles=@();$attemptedRoles=@();$envMap=Get-DailyEnvironment $b $RequestedMode
  try{
    # ReaderOnly is an explicit candidate-only operation. Missing data services
    # remain blockers; this mode must never start a collector or Producer.
    if($RequestedMode -eq 'ReaderOnly'){
      Assert-Daily ($null -ne $bridge) 'READER_ONLY_BRIDGE_UNAVAILABLE_NO_SOURCE_START'
      Assert-Daily ($null -ne $owner) 'READER_ONLY_PRODUCER_UNAVAILABLE_NO_SOURCE_START'
    }
    if($RequestedMode -in @('Start','ReaderOnly') -and $missing.Count -gt 0){
      Assert-DailyCleanEnvironment $b $RequestedMode
      Assert-Daily (-not [IO.File]::Exists($pending)) 'PRIOR_START_REQUIRES_RECONCILIATION'
      foreach($role in $missing){Assert-DailyNoUnownedRuntime $role $b}
      foreach($key in @($envMap.Keys)+@('CRU34_LIVE_WORKER_INSTANCE_ID','CRU34_LIVE_STDOUT_PATH','CRU34_LIVE_STDERR_PATH','CRU34_LIVE_INCIDENT_PATH')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
      foreach($key in $envMap.Keys){[Environment]::SetEnvironmentVariable($key,$envMap[$key],'Process')}
      Assert-DailyNodeConfiguration $b $RequestedMode
      if(-not $bridge){
        $gate=Get-DailyMarketGate $b
        Assert-Daily ($gate.marketShouldBeActive -is [bool] -and $gate.marketShouldBeActive -eq $true -and $gate.executionAuthorized -is [bool] -and $gate.executionAuthorized -eq $false -and $gate.orderRoutesEnabled -is [bool] -and $gate.orderRoutesEnabled -eq $false) 'MARKET_GATE_INVALID'
      }
      Write-DailyReceipt $pending @{attempt=$attemptPath;at=[datetime]::UtcNow.ToString('o');automaticRetry=$false}
      if(-not $bridge){
        Assert-Daily ($null -eq (Get-BoundListener 8790)) 'BRIDGE_APPEARED_RECONCILE'
        Assert-DailyNoUnownedRuntime 'bridge' $b
        Backup-DailyBridgeLogs $b $attemptPath
        $attemptedRoles+='bridge'
        Start-DailyBridge $b
        $bridge=Wait-DailyService { $p=Get-BoundListener 8790;if($p){Assert-DailyBridge $b $p (Get-DailyHealth 8790);return $p};return $null } 'BRIDGE_START_UNVERIFIED'
        $startedRoles+='bridge'
      }
      if(-not $owner){
        Assert-DailyNoUnownedRuntime 'producer' $b
        $attemptedRoles+='producer'
        $workerPid=Start-BoundNode $bound 'producer' ('"'+(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs')+'"') $b.producer.root
        $owner=Wait-DailyService {$p=Get-DailyWorker $bound;if($p){Assert-Daily ($p.pid -eq $workerPid) 'PRODUCER_NEW_IDENTITY';return $p};return $null} 'PRODUCER_START_UNVERIFIED'
        $startedRoles+='producer'
      }
      if(-not $candidate){
        Assert-Daily ($null -eq (Get-BoundListener 18723)) 'CANDIDATE_APPEARED_RECONCILE'
        Assert-DailyNoUnownedRuntime 'candidate' $b
        $attemptedRoles+='candidate'
        $candidatePid=Start-BoundNode $bound 'dashboard' ('--env-file="'+$b.envFile+'" "'+(Join-Path $b.candidate.root 'server.mjs')+'"') $b.candidate.root
        $candidate=Wait-DailyService {$p=Get-BoundListener 18723;if($p){Assert-Daily ($p.pid -eq $candidatePid) 'CANDIDATE_NEW_IDENTITY';Assert-DailyCandidate $b $p (Get-DailyHealth 18723) -RequireReadOnly:($RequestedMode -eq 'ReaderOnly');return $p};return $null} 'CANDIDATE_START_UNVERIFIED'
        $startedRoles+='candidate'
      }
    }
    $formalAfter=Get-DailyFormalIdentity
    Assert-Daily (($formalBefore|ConvertTo-Json -Compress) -ceq ($formalAfter|ConvertTo-Json -Compress)) 'FORMAL_IDENTITY_CHANGED'
    if($bridge){$finalBridge=Get-BoundListener 8790;Assert-DailyBridge $b $finalBridge (Get-DailyHealth 8790);Assert-Daily ($finalBridge.pid -eq $bridge.pid -and $finalBridge.createdAt -ceq $bridge.createdAt) 'BRIDGE_CHANGED'}
    if($owner){$finalOwner=Get-DailyWorker $bound;Assert-Daily ($null -ne $finalOwner -and $finalOwner.pid -eq $owner.pid -and $finalOwner.createdAt -ceq $owner.createdAt) 'PRODUCER_CHANGED'}
    if($candidate){$finalCandidate=Get-BoundListener 18723;$candidateHealth=Get-DailyHealth 18723;Assert-DailyCandidate $b $finalCandidate $candidateHealth -RequireReadOnly:($RequestedMode -eq 'ReaderOnly');Assert-Daily ($finalCandidate.pid -eq $candidate.pid -and $finalCandidate.createdAt -ceq $candidate.createdAt) 'CANDIDATE_CHANGED'}
    $candidateReadOnly=$null
    if($null -ne $candidateHealth -and $null -ne $candidateHealth.PSObject.Properties['candidateReadOnly'] -and $candidateHealth.candidateReadOnly -is [bool]){$candidateReadOnly=$candidateHealth.candidateReadOnly}
    $result=[ordered]@{at=[datetime]::UtcNow.ToString('o');state=$(if($candidate){'RESEARCH_UI_AVAILABLE'}else{'RESEARCH_UI_NOT_RUNNING'});url='http://127.0.0.1:18723/';mode=$RequestedMode;candidateReadOnly=$candidateReadOnly;attemptedRoles=$attemptedRoles;startedRoles=$startedRoles;formalUnchanged=$true;candidate=$candidate;producer=$owner;bridge=$bridge;runtimeReady=$(if($candidateHealth){$candidateHealth.runtimeReady.ready}else{$false});producerReady=$(if($candidateHealth){$candidateHealth.runtimeEvidence.producer.ready}else{$false});qualityReasons=$(if($candidateHealth){$candidateHealth.runtimeReady.reasons}else{@('CANDIDATE_NOT_RUNNING')});evidence=$attemptPath;deliveryAccepted=$false;executionAuthorized=$false;orderRoutesEnabled=$false}
    Write-DailyReceipt (Join-Path $attemptPath 'after.json') $result
    if($startedRoles.Count -gt 0 -and [IO.File]::Exists($pending)){[IO.File]::Move($pending,(Join-Path $attemptPath 'settled-start.json'))}
    if($RequestedMode -ne 'CheckOnly' -and -not $SuppressBrowser){Assert-Daily ($null -ne $candidate) 'CANDIDATE_NOT_RUNNING';Start-Process 'http://127.0.0.1:18723/'|Out-Null}
    return [pscustomobject]$result
  }catch{
    Write-DailyReceipt (Join-Path $attemptPath 'failure.json') @{at=[datetime]::UtcNow.ToString('o');errorType=$_.Exception.GetType().Name;reason=$_.Exception.Message;attemptedRoles=$attemptedRoles;startedRoles=$startedRoles;noProcessesStopped=$true;automaticRetry=$false}
    throw
  }finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}

if(-not $LibraryOnly){
  $mutex=New-Object Threading.Mutex($false,'Global\TwChipBoundDailyUseV1');$owned=$false
  try{
    try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
    Assert-Daily $owned 'ANOTHER_START_IS_ACTIVE'
    $binding=Read-DailyBinding $BindingPath
    $result=Invoke-DailyEntry $binding $Mode -SuppressBrowser:$NoBrowser
    $result|ConvertTo-Json -Depth 10
    Write-Host ('勢衡研究工作臺：'+$result.state+'；資料品質請以頁面標示為準。')
  }catch{Write-Error ('勢衡研究工作臺未啟動：'+$_.Exception.Message) -ErrorAction Continue;exit 1}
  finally{if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
}

