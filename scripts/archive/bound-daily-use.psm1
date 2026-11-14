if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
  throw 'BOUND_START_WINDOWS_POWERSHELL_51_REQUIRED: Use C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile. PowerShell Core JSON timestamp conversion is unsupported.'
}
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:BoundStartupTraceDirectory=$null
function Set-BoundStartupTrace([string]$Directory) { $script:BoundStartupTraceDirectory=$Directory }
function Write-BoundStartupStage([string]$Stage) {
  if (-not $script:BoundStartupTraceDirectory) { return }
  if ($Stage -cnotmatch '^[A-Z0-9_]+$') { throw 'BOUND_START_INVALID_STAGE' }
  $record=@{at=[datetime]::UtcNow.ToString('o');pid=$PID;stage=$Stage}|ConvertTo-Json -Compress
  [IO.File]::AppendAllText((Join-Path $script:BoundStartupTraceDirectory 'stages.ndjson'),$record+"`n",[Text.Encoding]::UTF8)
}

function Read-BoundJson([string]$Path) {
  if (-not [IO.File]::Exists($Path)) { return $null }
  return [IO.File]::ReadAllText($Path) | ConvertFrom-Json
}
function Assert-Bound([bool]$Condition, [string]$Reason) {
  if (-not $Condition) { throw "BOUND_START_$Reason" }
}
function Get-BoundProcess([int]$ProcessId) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  if (-not $p) { return $null }
  [pscustomobject]@{ pid=[int]$p.ProcessId; createdAt=$p.CreationDate.ToUniversalTime().ToString('o'); executable=$p.ExecutablePath; command=$p.CommandLine }
}
function Get-BoundListener([int]$Port) {
  $owners = @(& netstat.exe -ano -p tcp | ForEach-Object { if ($_ -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") { [int]$Matches[1] } } | Select-Object -Unique)
  Assert-Bound ($owners.Count -le 1) 'MULTIPLE_LISTENERS'
  if ($owners.Count) { return Get-BoundProcess $owners[0] }
  return $null
}
function Get-BoundHealth([int]$Port, [ValidateRange(1,20)][int]$TimeoutSeconds = 20) {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/$(if ($Port -eq 8790) {'health'} else {'healthz'})" -TimeoutSec $TimeoutSeconds } catch { return $null }
}
function Get-BoundLocalMarketExpected($b) {
  if (-not $b.PSObject.Properties['localMarket']) { return $null }
  $m=$b.localMarket
  Assert-Bound ($null -ne $m) 'LOCAL_MARKET_BINDING_REQUIRED'
  foreach ($key in @('schema','readDataRoot','chartCacheRoot','tlsBundle','tlsCertSha256')) { Assert-Bound ($m.PSObject.Properties.Name -ccontains $key) 'LOCAL_MARKET_BINDING_REQUIRED' }
  Assert-Bound ($m.schema -ceq 'cru21-bound-local-market-v1') 'LOCAL_MARKET_BINDING_REQUIRED'
  foreach ($value in @($m.readDataRoot,$m.chartCacheRoot,$m.tlsBundle)) {
    Assert-Bound ($value -is [string] -and [IO.Path]::IsPathRooted($value) -and $value -cnotmatch '^[\\/]{2}' -and [IO.Path]::GetFullPath($value) -ceq $value) 'LOCAL_MARKET_PATH_REJECTED'
  }
  Assert-Bound ($m.chartCacheRoot -ceq (Join-Path $b.dataRoot 'dashboard-chart-cache')) 'LOCAL_MARKET_CACHE_ROOT'
  Assert-Bound ($m.tlsCertSha256 -cmatch '^[a-f0-9]{64}$' -and $b.dashboard.allowedDirty.Count -eq 0) 'LOCAL_MARKET_IDENTITY_REQUIRED'
  return @{HOST='127.0.0.1';PORT='8787';NODE_ENV='production';MOCK_DATA='0';COOKIE_SECURE='1';ASK_GPT_INLINE_ENABLED='0';
    DASHBOARD_RELEASE_SCOPE='MARKET_RESEARCH_AI_DISABLED';DASHBOARD_FORMAL_READ_ROOT=$m.readDataRoot;
    TX_CHART_DATA_ROOT=$m.readDataRoot;TX_CHART_CACHE_ROOT=$m.chartCacheRoot;
    DASHBOARD_TLS_BUNDLE=$m.tlsBundle;DASHBOARD_TLS_CERT_SHA256=$m.tlsCertSha256}
}
function Read-BoundRoutingValue([string]$Raw) {
  # Restricted single-line dotenv syntax for routing keys only. Unknown auth
  # fields are never parsed/output here. Ambiguous multiline/escape syntax fails
  # closed; Node remains the runtime's full dotenv parser.
  $value=$Raw.Trim()
  if ($value.StartsWith('"') -or $value.StartsWith("'")) {
    $quote=$value.Substring(0,1);$end=$value.IndexOf($quote,1)
    Assert-Bound ($end -gt 0 -and $value.Substring($end+1).Trim() -match '^(#.*)?$') 'ENV_ROUTING_FORMAT_UNSUPPORTED'
    $value=$value.Substring(1,$end-1)
    Assert-Bound (-not ($quote -ceq '"' -and $value -match '\\[nr]')) 'ENV_ROUTING_FORMAT_UNSUPPORTED'
    return $value
  }
  Assert-Bound (-not $value.StartsWith('`')) 'ENV_ROUTING_FORMAT_UNSUPPORTED'
  return $value.Split('#',2)[0].Trim()
}
function Assert-BoundLocalMarketEnvironment($b,[string[]]$Lines,$ShellItems) {
  $expected=Get-BoundLocalMarketExpected $b
  $seen=@{};$proxySeen=$false
  foreach ($line in $Lines) {
    if ($line -notmatch '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }
    $name=$Matches[1];$raw=$Matches[2]
    if (-not (($expected -and ($expected.ContainsKey($name) -or $name -ieq 'TRUST_PROXY')) -or
        $name -match '^(DASHBOARD_RELEASE_SCOPE|DASHBOARD_TLS_BUNDLE|DASHBOARD_TLS_CERT_SHA256|DASHBOARD_PREVIEW_.*|DASHBOARD_CANDIDATE_.*|ASK_GPT_CANDIDATE_READ_ROOT|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$')) { continue }
    $value=Read-BoundRoutingValue $raw
    if ($expected -and $expected.ContainsKey($name)) {
      Assert-Bound (($expected.Keys -ccontains $name) -and -not $seen.ContainsKey($name) -and $value -ceq $expected[$name]) 'LOCAL_MARKET_ENV_MISMATCH'
      $seen[$name]=$true
    } elseif ($expected -and $name -ieq 'TRUST_PROXY') {
      Assert-Bound ($name -ceq 'TRUST_PROXY' -and -not $proxySeen -and @('','0','false') -ccontains $value) 'LOCAL_MARKET_ENV_MISMATCH'
      $proxySeen=$true
    } elseif ($name -match '^(DASHBOARD_RELEASE_SCOPE|DASHBOARD_TLS_BUNDLE|DASHBOARD_TLS_CERT_SHA256)$') {
      Assert-Bound ([string]::IsNullOrWhiteSpace($value)) 'LOCAL_MARKET_BINDING_REQUIRED'
    }
    if ($expected -and $name -match '^(DASHBOARD_PREVIEW_.*|DASHBOARD_CANDIDATE_.*|ASK_GPT_CANDIDATE_READ_ROOT|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$') {
      Assert-Bound ([string]::IsNullOrWhiteSpace($value)) 'LOCAL_MARKET_ENV_REJECTED'
    }
  }
  if ($expected) {
    Assert-Bound ($seen.Count -eq $expected.Count) 'LOCAL_MARKET_ENV_MISSING'
    foreach ($item in $ShellItems) {
      if ($expected.ContainsKey($item.Name) -and $item.Value) { Assert-Bound ($item.Value -ceq $expected[$item.Name]) 'LOCAL_MARKET_SHELL_MISMATCH' }
      if ($item.Name -ieq 'TRUST_PROXY') { Assert-Bound (@('','0','false') -ccontains $item.Value) 'LOCAL_MARKET_SHELL_MISMATCH' }
      if ($item.Name -match '^(DASHBOARD_PREVIEW_.*|DASHBOARD_CANDIDATE_.*|ASK_GPT_CANDIDATE_READ_ROOT|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$') {
        Assert-Bound (-not $item.Value) 'LOCAL_MARKET_SHELL_REJECTED'
      }
    }
  }
}
function Get-BoundDashboardOrigin($b) {
  if (Get-BoundLocalMarketExpected $b) { return 'https://127.0.0.1:8787' }
  return 'http://127.0.0.1:8787'
}
function Get-BoundDashboardHealth($b) {
  if (-not (Get-BoundLocalMarketExpected $b)) { return Get-BoundHealth 8787 }
  # Normal Windows TLS validation only; failure stays unavailable, no HTTP retry.
  try { return Invoke-RestMethod -Uri ((Get-BoundDashboardOrigin $b)+'/healthz') -TimeoutSec 20 } catch { return $null }
}
function Assert-BoundBridge($Listener, $Health, [string]$Reason = 'BRIDGE_UNVERIFIED') {
  $safe = $false
  if ($null -ne $Listener -and $null -ne $Health) {
    try {
      $typedFlags = $Health.ok -is [bool] -and $Health.researchOnly -is [bool] -and $Health.executionAuthorized -is [bool] -and $Health.orderRoutesEnabled -is [bool]
      $numericWeight = $Health.formalWeight -is [int] -or $Health.formalWeight -is [long] -or $Health.formalWeight -is [double] -or $Health.formalWeight -is [decimal]
      $safe = $Listener.pid -gt 0 -and $Listener.createdAt -is [string] -and -not [string]::IsNullOrWhiteSpace($Listener.createdAt) -and $typedFlags -and $numericWeight -and $Health.ok -eq $true -and $Health.mode -is [string] -and $Health.mode -ceq 'market_data_only' -and $Health.formalWeight -eq 0 -and $Health.researchOnly -eq $true -and $Health.executionAuthorized -eq $false -and $Health.orderRoutesEnabled -eq $false
    } catch { $safe = $false }
  }
  Assert-Bound $safe $Reason
}
function Assert-BoundConsoleChildren($Dashboard, $Children) {
  $console=Join-Path $env:WINDIR 'System32\conhost.exe'
  foreach ($child in $Children) {
    # Windows creates this OS console host with a hidden console process.
    # Do not confuse it with an application child (Bridge/research/collector).
    $age=($child.CreationDate.ToUniversalTime()-[datetime]::Parse($Dashboard.createdAt).ToUniversalTime()).TotalSeconds
    Assert-Bound ($child.ExecutablePath -ieq $console -and $child.CommandLine -ieq ('\??\'+$console+' 0x4') -and $age -ge 0 -and $age -lt 1) 'DASHBOARD_HAS_APPLICATION_CHILDREN'
  }
}
function Assert-BoundSource($Source, [string[]]$AllowedDirty = @()) {
  Assert-Bound ([IO.Path]::IsPathRooted($Source.root) -and $Source.commit -cmatch '^[0-9a-f]{40}$') 'SOURCE_PIN_REQUIRED'
  $actual = & git -C $Source.root rev-parse HEAD
  Assert-Bound ($LASTEXITCODE -eq 0 -and $actual -ceq $Source.commit) 'SOURCE_SHA_MISMATCH'
  $dirty = @(& git -C $Source.root diff HEAD --name-only)
  Assert-Bound ($LASTEXITCODE -eq 0) 'SOURCE_INSPECTION_FAILED'
  foreach ($name in $dirty) { Assert-Bound ($AllowedDirty -ccontains $name) 'SOURCE_DIRTY' }
  # Untracked executable source could affect dynamic imports. Ignored local data/dependencies are separate.
  $untracked = @(& git -C $Source.root ls-files --others --exclude-standard)
  Assert-Bound ($LASTEXITCODE -eq 0 -and $untracked.Count -eq 0) 'SOURCE_UNTRACKED'
}
function Get-BoundResearchMetadata([string]$Path) {
  # Metadata handles only: never open SQLite or read research/credential contents.
  # Final DOS paths detect short names, mapped/substituted drives and aliases;
  # OPEN_REPARSE_POINT also exposes dangling leaf links instead of treating them as absent.
  if (-not ('TwChip.BoundResearchPathV1' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
namespace TwChip {
  public static class BoundResearchPathV1 {
    [StructLayout(LayoutKind.Sequential)] private struct FileInfo {
      public uint Attributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
      public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    public sealed class Metadata { public int Error; public uint Attributes, Links; public string FinalPath; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    public static Metadata Read(string path) {
      using (var handle=CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
        if(handle.IsInvalid) return new Metadata { Error=Marshal.GetLastWin32Error() };
        FileInfo info;
        if(!GetFileInformationByHandle(handle,out info)) return new Metadata { Error=Marshal.GetLastWin32Error() };
        var name=new StringBuilder(32768);
        uint length=GetFinalPathNameByHandle(handle,name,(uint)name.Capacity,0);
        if(length==0) return new Metadata { Error=Marshal.GetLastWin32Error() };
        if(length>=name.Capacity) return new Metadata { Error=206 };
        return new Metadata { Attributes=info.Attributes, Links=info.Links, FinalPath=name.ToString() };
      }
    }
  }
}
'@
  }
  return [TwChip.BoundResearchPathV1]::Read($Path)
}
function Assert-BoundResearchPath([string]$Path,[bool]$Directory,[switch]$Optional) {
  # Validate ancestors before the leaf, including ancestors of an absent optional file.
  $parent=[IO.Path]::GetDirectoryName($Path)
  if ($parent -and $parent -cne $Path) {
    if (-not (Assert-BoundResearchPath $parent $true -Optional:$Optional)) { return $false }
  }
  $meta=Get-BoundResearchMetadata $Path
  if ($Optional -and $meta.Error -in @(2,3)) { return $false }
  Assert-Bound ($meta.Error -eq 0) 'RESEARCH_PATH_UNAVAILABLE'
  Assert-Bound (($meta.Attributes -band 0x400) -eq 0 -and (($meta.Attributes -band 0x10) -ne 0) -eq $Directory) 'RESEARCH_PATH_ALIAS'
  Assert-Bound ($meta.FinalPath.StartsWith('\\?\') -and $meta.FinalPath.Substring(4).TrimEnd('\') -ieq $Path.TrimEnd('\')) 'RESEARCH_PATH_ALIAS'
  if (-not $Directory) { Assert-Bound ($meta.Links -eq 1) 'RESEARCH_PATH_ALIAS' }
  return $true
}
function Get-BoundResearchPaths($b) {
  if (-not $b.PSObject.Properties['researchRoot']) { return @{} }
  $root=$b.researchRoot
  Assert-Bound ($root -is [string] -and $root -cmatch '^[A-Za-z]:\\' -and $root -cnotmatch '[\x00-\x1f/"<>|?*]' -and $root.Substring(2) -notmatch ':' -and
    @($root.Substring(3).Split('\') | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -match '[ .]$' -or $_ -eq '' }).Count -eq 0) 'RESEARCH_ROOT_REJECTED'
  Assert-Bound ([IO.Path]::GetFullPath($root) -ieq $root) 'RESEARCH_ROOT_REJECTED'
  $database=Join-Path $root 'data\research-v2.sqlite'
  $reportRoot=Join-Path $root 'reports'
  $null=Assert-BoundResearchPath $root $true
  $null=Assert-BoundResearchPath $database $false
  $null=Assert-BoundResearchPath $reportRoot $true
  # Fixed reader inputs only, not discovery. Missing optional evidence stays missing.
  foreach ($name in @('latest-backtest.json','basis-term-structure-research.json','no-trade-veto.json','holding-selector.json',
      'paired-incremental.json','v3-forward-status.json','oi-normalization-audit.json','v3.4-forward-status.json',
      'foreign-risk-group-v3.4.json','v3-6-2-extended-factor-research.json','v3-6-2-cross-market-research.json',
      'v3-6-2-collection-audit.json','v3-daily-update-status.json')) {
    $null=Assert-BoundResearchPath (Join-Path $reportRoot $name) $false -Optional
  }
  $null=Assert-BoundResearchPath (Join-Path $root 'data\forward\paper-ledger-v2.9.4.jsonl') $false -Optional
  # Metadata preflight is not protection against later filesystem replacement.
  return @{ V2_RESEARCH_DATABASE_PATH=$database; V2_BACKTEST_REPORT_PATH=(Join-Path $reportRoot 'latest-backtest.json') }
}
function Read-BoundPlan([string]$BindingPath, [string]$LauncherRoot) {
  $b = Read-BoundJson $BindingPath
  Assert-Bound ($null -ne $b) 'BINDING_MISSING'
  Assert-Bound ($b.schemaVersion -ceq 'cru21-bound-daily-use-v1' -and $b.authorizedScope -ceq 'PIN_EXISTING_PRODUCER_AND_REBIND_READER') 'SCOPE_REQUIRED'
  Assert-Bound ($b.launcher.root -ceq $LauncherRoot) 'LAUNCHER_ROOT_MISMATCH'
  Assert-Bound ($b.dashboard.allowedDirty.Count -le 1) 'DIRTY_ALLOWLIST'
  foreach ($name in $b.dashboard.allowedDirty) { Assert-Bound ($name -ceq 'v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md') 'DIRTY_ALLOWLIST' }
  Write-BoundStartupStage 'SOURCE_LAUNCHER'
  Assert-BoundSource $b.launcher
  Write-BoundStartupStage 'SOURCE_PRODUCER'
  Assert-BoundSource $b.producer
  Write-BoundStartupStage 'SOURCE_DASHBOARD'
  Assert-BoundSource $b.dashboard $b.dashboard.allowedDirty
  foreach ($value in @($b.dataRoot,$b.projectionRoot,$b.envFile,$b.node,$b.logRoot)) {
    Assert-Bound ([IO.Path]::IsPathRooted($value) -and ([IO.Path]::GetFullPath($value) -ceq $value)) 'ABSOLUTE_PATH_REQUIRED'
  }
  Assert-Bound ($b.projectionRoot -ceq (Join-Path $b.dataRoot 'runtime\cru34-live')) 'PROJECTION_ROOT_MISMATCH'
  Assert-Bound ($b.envFile -ceq (Join-Path $b.dashboard.root '.env')) 'ENV_ROOT_MISMATCH'
  Assert-Bound ($b.logRoot -ceq (Join-Path $b.dataRoot 'automation-logs\bound-daily-use')) 'LOG_ROOT_MISMATCH'
  foreach ($file in @($b.envFile,$b.node,(Join-Path $b.dashboard.root 'server.mjs'),(Join-Path $b.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1'),(Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs'))) {
    Assert-Bound ([IO.File]::Exists($file)) 'SOURCE_FILE_MISSING'
  }
  $null=Get-BoundResearchPaths $b
  # This package cannot activate a different collector, candidate, or CVD binding.
  $localExpected=Get-BoundLocalMarketExpected $b
  $envLines=[IO.File]::ReadAllLines($b.envFile)
  $shellItems=@(Get-ChildItem Env:)
  Assert-BoundLocalMarketEnvironment $b $envLines $shellItems
  $forbidden = '^(NODE_OPTIONS|NODE_PATH|CRU55_.*|CRU54_.*|FORWARD_SHADOW_.*|TXO_.*|CVD_.*|TX_CHART_.*|V2_RESEARCH_DATABASE_PATH|V2_BACKTEST_REPORT_PATH|DATA_OPERATIONS_OUTPUT_ROOT)$'
  foreach ($item in $shellItems) {
    if ($localExpected -and $localExpected.ContainsKey($item.Name)) { continue }
    if ($item.Name -match $forbidden) { Assert-Bound (-not $item.Value) 'UNEXPECTED_SHELL_ROUTING' }
  }
  foreach ($line in $envLines) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$' -and $Matches[1] -match $forbidden) {
      if ($localExpected -and $localExpected.ContainsKey($Matches[1])) { continue }
      Assert-Bound ([string]::IsNullOrWhiteSpace((Read-BoundRoutingValue $line.Split('=',2)[1]))) 'UNEXPECTED_ENV_ROUTING'
    }
  }
  foreach ($file in @('data\cru55-runtime\binding.json','data\runtime\cru55-binding.json')) {
    Assert-Bound (-not [IO.File]::Exists((Join-Path $b.dashboard.root $file))) 'OTHER_BINDING_REQUIRES_REVIEW'
  }
  return $b
}
function Get-BoundPaths($b) {
  return @{ CRU34_LIVE_DATA_ROOT=$b.dataRoot; CRU34_LIVE_PROJECTION_ROOT=$b.projectionRoot;
    CRU34_LIVE_SNAPSHOT_PATH=(Join-Path $b.projectionRoot 'latest.json'); CRU34_LIVE_STATUS_PATH=(Join-Path $b.projectionRoot 'status.json') }
}
function Assert-BoundWorker($b, $Status, $Lock, $Process) {
  Assert-Bound ($null -ne $Status -and $null -ne $Lock -and $null -ne $Process) 'OWNER_UNVERIFIED'
  Assert-Bound ($Status.schemaVersion -ceq 'cru34-live-worker-status-v1') 'OWNER_SCHEMA'
  Assert-Bound ($Status.workerInstanceId -cmatch '^[0-9a-f-]{36}$' -and $Status.workerInstanceId -ceq $Lock.workerInstanceId -and $Status.pid -eq $Lock.pid -and $Process.pid -eq $Lock.pid) 'OWNER_IDENTITY'
  $paths = Get-BoundPaths $b
  Assert-Bound ($Status.dataRoot -ceq $b.dataRoot -and $Status.projectionRoot -ceq $b.projectionRoot -and $Status.snapshotPath -ceq $paths.CRU34_LIVE_SNAPSHOT_PATH -and $Status.statusPath -ceq $paths.CRU34_LIVE_STATUS_PATH -and $Lock.dataRoot -ceq $b.dataRoot -and $Lock.projectionRoot -ceq $b.projectionRoot) 'OWNER_PATHS'
  Assert-Bound ($Status.formalWeight -eq 0 -and $Status.researchOnly -eq $true -and $Status.executionAuthorized -eq $false -and $Status.orderRoutesEnabled -eq $false) 'OWNER_SAFETY'
  $runner = Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs'
  Assert-Bound ($Process.executable -ieq $b.node -and $Process.command.Trim() -ceq ('"' + $b.node + '" "' + $runner + '"')) 'OWNER_SOURCE'
  $age = ([datetime]::UtcNow - [datetime]::Parse($Status.observedAt).ToUniversalTime()).TotalSeconds
  $started = [datetime]::Parse($Status.workerStartedAt).ToUniversalTime()
  $created = [datetime]::Parse($Process.createdAt).ToUniversalTime()
  Assert-Bound ($age -ge -5 -and $age -le 15 -and ($started - $created).TotalSeconds -ge 0 -and ($started - $created).TotalSeconds -le 10 -and $Status.workerStartedAt -ceq $Lock.workerStartedAt) 'OWNER_LIFETIME'
}
function Assert-BoundResearchReader($b,$Health) {
  if (-not $b.PSObject.Properties['researchRoot']) { return }
  $expected=Get-BoundResearchPaths $b
  Assert-Bound ($null -ne $Health -and $null -ne $Health.PSObject.Properties['researchReaderPaths']) 'RESEARCH_INCUMBENT_UNVERIFIED'
  $actual=$Health.researchReaderPaths
  Assert-Bound ($null -ne $actual -and $null -ne $actual.PSObject.Properties['databasePath'] -and
    $null -ne $actual.PSObject.Properties['reportPath'] -and
    $actual.databasePath -is [string] -and $actual.reportPath -is [string] -and
    $actual.databasePath -ceq $expected.V2_RESEARCH_DATABASE_PATH -and
    $actual.reportPath -ceq $expected.V2_BACKTEST_REPORT_PATH) 'RESEARCH_INCUMBENT_UNVERIFIED'
}
function Assert-BoundDashboard($b, $Health, $Process, [switch]$MissingProducer) {
  Assert-Bound ($null -ne $Health -and $null -ne $Process) 'DASHBOARD_UNVERIFIED'
  Assert-BoundResearchReader $b $Health
  if (Get-BoundLocalMarketExpected $b) {
    Assert-Bound ($Health.localRelease.scope -ceq 'MARKET_RESEARCH_AI_DISABLED' -and $Health.localRelease.transport -ceq 'HTTPS' -and
      $Health.localRelease.certificateSha256 -ceq $b.localMarket.tlsCertSha256 -and
      $Health.inlineAssistant.enabled -is [bool] -and $Health.inlineAssistant.enabled -eq $false) 'LOCAL_MARKET_HEALTH_IDENTITY'
  }
  $server = Join-Path $b.dashboard.root 'server.mjs'
  $expected = '"' + $b.node + '" --env-file="' + $b.envFile + '" "' + $server + '"'
  Assert-Bound ($Process.executable -ieq $b.node -and $Process.command.Trim() -ceq $expected) 'DASHBOARD_SOURCE'
  Assert-Bound ($Health.ok -eq $true -and $Health.service -ceq 'tw-chip-dashboard-v1' -and $Health.runtimeCommit -ceq $b.dashboard.commit -and $Health.approvedMainCommit -ceq $b.dashboard.commit -and $Health.runtimeIdentityStatus -ceq 'VERIFIED' -and $Health.syncState -ceq 'SYNCED') 'DASHBOARD_VERSION'
  $producer = $Health.runtimeEvidence.producer
  $refused=@('LIVE_PRODUCER_PATH_MISMATCH','LIVE_PRODUCER_INSTANCE_MISMATCH')
  # A clean worker exit removes its lock. Permit only that proven-dead case;
  # a real mismatched lock/instance or a live PID without a lock still fails.
  if ($MissingProducer -and $null -eq $producer.lock -and $null -ne $producer.worker -and
    $producer.worker.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $producer.worker.pid -gt 0 -and
    $null -eq (Get-BoundProcess ([int]$producer.worker.pid))) { $refused=@('LIVE_PRODUCER_PATH_MISMATCH') }
  if (-not $MissingProducer) { $refused+=@('LIVE_PRODUCER_PROCESS_MISSING','LIVE_PRODUCER_HEARTBEAT_STALE') }
  Assert-Bound (@($producer.reasons | Where-Object { $_ -in $refused }).Count -eq 0) 'DASHBOARD_IDENTITY_REJECTED'
  Assert-Bound ($producer.snapshot.path -ceq (Join-Path $b.projectionRoot 'latest.json') -and $producer.statusFile.path -ceq (Join-Path $b.projectionRoot 'status.json')) 'DASHBOARD_PATHS'
  if (-not $MissingProducer) { Assert-BoundWorker $b $producer.worker $producer.lock (Get-BoundProcess ([int]$producer.pid)) }
  # Market quality/readiness is reported as-is; no predicate or quality threshold is weakened.
}
function Start-BoundNode($b,[string]$Role,[string]$Arguments,[string]$WorkingRoot) {
  $researchPaths=@{}
  if ($Role -eq 'dashboard') { $researchPaths=Get-BoundResearchPaths $b }
  $savedResearch=@{}
  foreach ($key in $researchPaths.Keys) {
    $savedResearch[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
    Assert-Bound (-not $savedResearch[$key]) 'UNEXPECTED_SHELL_ROUTING'
  }
  $id = [guid]::NewGuid().ToString()
  $stem = Join-Path $b.logRoot "$Role-$id"
  Write-BoundStartupStage ('SPAWN_'+$Role.ToUpperInvariant())
  if ($Role -eq 'producer') {
    $env:CRU34_LIVE_WORKER_INSTANCE_ID = $id
    $env:CRU34_LIVE_STDOUT_PATH = "$stem.stdout.log"
    $env:CRU34_LIVE_STDERR_PATH = "$stem.stderr.log"
    $env:CRU34_LIVE_INCIDENT_PATH = "$stem.incident.ndjson"
  }
  try {
    foreach ($key in $researchPaths.Keys) { [Environment]::SetEnvironmentVariable($key,$researchPaths[$key],'Process') }
    $p = Start-Process -FilePath $b.node -ArgumentList $Arguments -WorkingDirectory $WorkingRoot -WindowStyle Hidden -RedirectStandardOutput "$stem.stdout.log" -RedirectStandardError "$stem.stderr.log" -PassThru
  } finally {
    foreach ($key in $savedResearch.Keys) { [Environment]::SetEnvironmentVariable($key,$savedResearch[$key],'Process') }
  }
  $receipt = @{ at=[datetime]::UtcNow.ToString('o'); role=$Role; source=$(if ($Role -eq 'producer') {$b.producer} else {$b.dashboard}); process=(Get-BoundProcess $p.Id); logs=$stem }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$stem.launch.json" -Encoding UTF8
  return $p.Id
}
function Invoke-BoundStart($b,[switch]$NoBrowser) {
  Write-BoundStartupStage 'CHECK_WORKER_IDENTITY'
  # All incumbent checks precede any runtime change. No process is ever stopped here.
  $lock = Read-BoundJson (Join-Path $b.projectionRoot 'worker.lock')
  $status = Read-BoundJson (Join-Path $b.projectionRoot 'status.json')
  $owner = $null
  if ($lock) {
    Assert-Bound ($lock.pid -gt 0 -and $lock.workerInstanceId -cmatch '^[0-9a-f-]{36}$') 'LOCK_UNVERIFIED'
    $owner = Get-BoundProcess ([int]$lock.pid)
    if ($owner) { Assert-BoundWorker $b $status $lock $owner }
  }
  if (-not $owner -and $status) {
    Assert-Bound ($status.schemaVersion -ceq 'cru34-live-worker-status-v1' -and $status.pid -gt 0) 'STATUS_UNVERIFIED'
    Assert-Bound ($null -eq (Get-BoundProcess ([int]$status.pid))) 'LIVE_STATUS_WITHOUT_OWNER_LOCK'
  }
  Write-BoundStartupStage 'CHECK_DASHBOARD'
  $dashboard = Get-BoundListener 8787
  if ($dashboard) { Assert-BoundDashboard $b (Get-BoundDashboardHealth $b) $dashboard -MissingProducer:($null -eq $owner) }
  Write-BoundStartupStage 'CHECK_BRIDGE'
  $bridge = Get-BoundListener 8790
  if ($bridge) {
    Assert-BoundBridge $bridge (Get-BoundHealth 8790 -TimeoutSeconds 3)
  }
  New-Item -ItemType Directory -Path $b.logRoot -Force | Out-Null
  $paths = Get-BoundPaths $b
  foreach ($key in $paths.Keys) { [Environment]::SetEnvironmentVariable($key,$paths[$key],'Process') }
  $env:HOST = '127.0.0.1'; $env:PORT = '8787'
  # Preserve the existing standalone bridge starter; never run broad recovery/research automation.
  if (-not $bridge) {
    & powershell.exe -NoProfile -NonInteractive -File (Join-Path $b.dashboard.root 'scripts\start-shioaji-readonly-hidden.ps1')
    Assert-Bound ($LASTEXITCODE -eq 0) 'BRIDGE_START_FAILED'
    # Exit zero may mean a deliberately withheld broker login, not a started Bridge.
    # Do not add login authorization here or launch dependent runtimes on that basis.
    foreach ($attempt in 1..30) {
      $bridge = Get-BoundListener 8790
      if ($bridge) { break }
      Start-Sleep -Milliseconds 500
    }
    Assert-Bound ($null -ne $bridge) 'BRIDGE_START_UNVERIFIED'
    Assert-BoundBridge $bridge (Get-BoundHealth 8790 -TimeoutSeconds 3) 'BRIDGE_START_UNVERIFIED'
  }
  if (-not $owner) {
    $newPid = Start-BoundNode $b 'producer' ('"' + (Join-Path $b.producer.root 'scripts\run-cru34-live-projection.mjs') + '"') $b.producer.root
    $ready = $false
    foreach ($attempt in 1..60) {
      Start-Sleep -Milliseconds 500
      $lock = Read-BoundJson (Join-Path $b.projectionRoot 'worker.lock')
      if ($lock -and $lock.pid -eq $newPid) {
        try { $owner = Get-BoundProcess $newPid; Assert-BoundWorker $b (Read-BoundJson (Join-Path $b.projectionRoot 'status.json')) $lock $owner; $ready=$true; break } catch { }
      }
    }
    Assert-Bound $ready 'PRODUCER_START_UNVERIFIED'
  }
  if (-not $dashboard) {
    $newPid = Start-BoundNode $b 'dashboard' ('--env-file="' + $b.envFile + '" "' + (Join-Path $b.dashboard.root 'server.mjs') + '"') $b.dashboard.root
    $ready = $false
    foreach ($attempt in 1..12) {
      Start-Sleep -Milliseconds 500
      Write-BoundStartupStage 'CHECK_DASHBOARD'
      $dashboard = Get-BoundListener 8787
      if ($dashboard -and $dashboard.pid -eq $newPid) {
        try { Assert-BoundDashboard $b (Get-BoundDashboardHealth $b) $dashboard; $ready=$true; break } catch { }
      }
    }
    Assert-Bound $ready 'DASHBOARD_START_UNVERIFIED'
  }
  Write-BoundStartupStage 'VERIFY_FINAL_HTTP'
  $health = Get-BoundDashboardHealth $b
  Assert-BoundDashboard $b $health (Get-BoundListener 8787)
  $finalBridge = Get-BoundListener 8790
  Assert-BoundBridge $finalBridge (Get-BoundHealth 8790 -TimeoutSeconds 3) 'BRIDGE_FINAL_UNVERIFIED'
  Assert-Bound ($finalBridge.pid -eq $bridge.pid -and $finalBridge.createdAt -ceq $bridge.createdAt) 'BRIDGE_FINAL_UNVERIFIED'
  $result = @{ at=[datetime]::UtcNow.ToString('o'); result='BOUND_SOURCE_READY'; producer=$owner; dashboard=$dashboard; producerReady=$health.runtimeEvidence.producer.ready; producerReasons=$health.runtimeEvidence.producer.reasons; snapshot=$health.runtimeEvidence.producer.observedFlowIdentity; launcher=$b.launcher; producerSource=$b.producer; dashboardSource=$b.dashboard }
  $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $b.logRoot ("startup-"+[guid]::NewGuid().ToString()+'.json')) -Encoding UTF8
  if (-not $NoBrowser) { Start-Process (Get-BoundDashboardOrigin $b) }
  return $result
}
Export-ModuleMember -Function *-Bound*
