import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('daily-use launcher keeps normal startup on the formal local dashboard only', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.match(source, /http:\/\/127\.0\.0\.1:8787/);
  assert.match(source, /launcher\.mjs/);
  assert.match(source, /start-shioaji-readonly-hidden\.ps1/);
  assert.doesNotMatch(source, /8797|8798|cloudflared|trycloudflare/i);
  assert.doesNotMatch(source, /run-daily-update|run-startup-recovery|run-v3-daily-update/i);
});

test('daily-use launcher remains Git read-only and does not enable execution', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.doesNotMatch(source, /git\s+(pull|fetch|reset|checkout|rebase|stash|clean|merge)/i);
  assert.match(source, /executionAuthorized=false/);
  assert.match(source, /orderRoutesEnabled=false/);
  assert.match(source, /market_data_only/);
  assert.match(source, /git -C \$resolvedRoot -c "safe\.directory=\$resolvedRoot" rev-parse HEAD/);
  assert.doesNotMatch(source, /safe\.directory=\*/);
  assert.doesNotMatch(source, /git config --global/i);
});

test('daily-use resolves runtime identity from ProjectRoot even when caller cwd differs', () => {
  const projectRoot = process.cwd().replaceAll("'", "''");
  const probe = `
$ProjectRoot = '${projectRoot}'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'scripts/start-daily-use.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
$functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-CurrentProjectCommit' }, $true)
if ($null -eq $functionAst) { throw 'Get-CurrentProjectCommit not found' }
Invoke-Expression $functionAst.Extent.Text
Push-Location ([System.IO.Path]::GetTempPath())
try { Get-CurrentProjectCommit } finally { Pop-Location }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^[0-9a-f]{40}$/);
});

test('daily-use wires and governs the CRU34 producer before dashboard readiness', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.match(source, /CRU34_LIVE_DATA_ROOT/);
  assert.match(source, /CRU34_LIVE_SNAPSHOT_PATH/);
  assert.match(source, /CRU34_LIVE_STATUS_PATH/);
  assert.match(source, /start-cru34-live-projection-hidden\.ps1/);
  assert.match(source, /-RestartMismatched/);
  assert.match(source, /approvedMainCommit -eq \$ExpectedCommit/);
  assert.match(source, /syncState -eq 'SYNCED'/);
  assert.match(source, /startup\/runtime safety contract did not pass/);
  assert.match(source, /Restart-FormalDashboard/);
  assert.match(source, /TimeoutSec 15/);
});

test('daily-use separates startup safety from lawful market-data readiness states', () => {
  const projectRoot = process.cwd().replaceAll("'", "''");
  const probe = `
$ProjectRoot = '${projectRoot}'
$cru34DataRoot = Join-Path $ProjectRoot 'data'
$cru34ProjectionRoot = Join-Path $cru34DataRoot 'runtime\\cru34-live'
$cru34SnapshotPath = Join-Path $cru34ProjectionRoot 'latest.json'
$cru34StatusPath = Join-Path $cru34ProjectionRoot 'status.json'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'scripts/start-daily-use.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
foreach ($name in @('Test-SamePath','Test-DashboardIdentityAligned','Test-DashboardRuntimeSafetyReady','Test-DashboardMarketDataReady')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $fn) { throw "$name not found" }
  Invoke-Expression $fn.Extent.Text
}
$commit = 'b8e583220fa0add4cbae29ee9fe580e6358d410a'
$worker = [pscustomobject]@{
  schemaVersion='cru34-live-worker-status-v1'; dataRoot=$cru34DataRoot; projectionRoot=$cru34ProjectionRoot
  snapshotPath=$cru34SnapshotPath; statusPath=$cru34StatusPath
  formalWeight=0; researchOnly=$true; executionAuthorized=$false; orderRoutesEnabled=$false
}
$health = [pscustomobject]@{
  runtimeIdentityStatus='VERIFIED'; runtimeCommit=$commit; approvedMainCommit=$commit; syncState='SYNCED'
  runtimeEvidence=[pscustomobject]@{
    producer=[pscustomobject]@{ready=$false; truthState='NO_COMPLETE_SUFFIX'; worker=$worker}
    observedFlow=[pscustomobject]@{ready=$false; sourceState='WARMING_UP'}
    parity=[pscustomobject]@{ready=$false}
  }
}
$cases = [ordered]@{
  lawfulDegradedStartup=(Test-DashboardRuntimeSafetyReady $health $commit $true)
  lawfulDegradedMarket=(Test-DashboardMarketDataReady $health)
}
$health.runtimeEvidence.observedFlow.sourceState='STALE'
$cases.staleStartup=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$health.runtimeEvidence.observedFlow.sourceState='QUALITY_INSUFFICIENT'
$cases.qualityInsufficientStartup=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$health.runtimeEvidence.observedFlow.sourceState='UNAVAILABLE'
$cases.unavailableStartup=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$cases.unverifiedProcess=(Test-DashboardRuntimeSafetyReady $health $commit $false)
$worker.executionAuthorized=$true
$cases.unsafeExecution=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$worker.executionAuthorized=$false
$worker.statusPath=Join-Path $ProjectRoot 'wrong-status.json'
$cases.wrongWiring=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$worker.statusPath=$cru34StatusPath
$health.runtimeEvidence.producer.ready=$true
$health.runtimeEvidence.observedFlow.ready=$true
$health.runtimeEvidence.parity.ready=$true
$cases.activeStartup=(Test-DashboardRuntimeSafetyReady $health $commit $true)
$cases.activeMarket=(Test-DashboardMarketDataReady $health)
[pscustomobject]$cases | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', probe], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    lawfulDegradedStartup: true,
    lawfulDegradedMarket: false,
    staleStartup: true,
    qualityInsufficientStartup: true,
    unavailableStartup: true,
    unverifiedProcess: false,
    unsafeExecution: false,
    wrongWiring: false,
    activeStartup: true,
    activeMarket: true,
  });
});

test('CRU34 governed launcher only reuses an exact safe instance and bounds restart to its PID', () => {
  const source = read('scripts/start-cru34-live-projection-hidden.ps1');
  assert.match(source, /cru34-live-worker-status-v1/);
  assert.match(source, /workerInstanceId/);
  assert.match(source, /snapshotPath/);
  assert.match(source, /statusPath/);
  assert.match(source, /dataRoot/);
  assert.match(source, /projectionRoot/);
  assert.match(source, /executionAuthorized/);
  assert.match(source, /orderRoutesEnabled/);
  assert.match(source, /RestartMismatched/);
  assert.match(source, /Stop-Process -Id \$incumbentPid/);
  assert.doesNotMatch(source, /taskkill|kill all|Stop-Process\s+-Name/i);
});

test('CRU34 exact-instance predicate rejects schema, identity, path, and safety drift', () => {
  const projectRoot = process.cwd().replaceAll("'", "''");
  const probe = `
$root = '${projectRoot}'
$dataRoot = Join-Path $root 'data'
$projectionRoot = Join-Path $dataRoot 'runtime\\cru34-live'
$snapshotPath = Join-Path $projectionRoot 'latest.json'
$statusPath = Join-Path $projectionRoot 'status.json'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/start-cru34-live-projection-hidden.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
foreach ($name in @('Test-SamePath','Test-Cru34ProducerMatch')) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $fn) { throw "$name not found" }
  Invoke-Expression $fn.Extent.Text
}
$now = [datetime]'2026-09-10T15:30:00Z'
$id = '88fa9460-fc7a-4aab-9b8e-3078739db5b0'
$status = [pscustomobject]@{schemaVersion='cru34-live-worker-status-v1';status='AVAILABLE';pid=34668;workerInstanceId=$id;observedAt='2026-09-10T15:29:55Z';dataRoot=$dataRoot;projectionRoot=$projectionRoot;snapshotPath=$snapshotPath;statusPath=$statusPath;formalWeight=0;researchOnly=$true;executionAuthorized=$false;orderRoutesEnabled=$false}
$lock = [pscustomobject]@{pid=34668;workerInstanceId=$id;dataRoot=$dataRoot;projectionRoot=$projectionRoot}
$cases = [ordered]@{exact=(Test-Cru34ProducerMatch $status $lock $now)}
$status.schemaVersion='wrong'; $cases.schema=(Test-Cru34ProducerMatch $status $lock $now); $status.schemaVersion='cru34-live-worker-status-v1'
$lock.workerInstanceId='00000000-0000-0000-0000-000000000000'; $cases.instance=(Test-Cru34ProducerMatch $status $lock $now); $lock.workerInstanceId=$id
$status.snapshotPath=Join-Path $root 'wrong.json'; $cases.path=(Test-Cru34ProducerMatch $status $lock $now); $status.snapshotPath=$snapshotPath
$status.executionAuthorized=$true; $cases.safety=(Test-Cru34ProducerMatch $status $lock $now)
[pscustomobject]$cases | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', probe], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    exact: true, schema: false, instance: false, path: false, safety: false,
  });
});

test('daily-use launcher guards unknown occupied ports and repeated clicks', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.match(source, /daily-use-bootstrap\.lock/);
  assert.match(source, /A normal startup is already running/);
  assert.match(source, /Port 8787 is occupied by a service that does not pass its health check/);
  assert.match(source, /running 8787 service cannot prove which code version it loaded/);
  assert.match(source, /running 8787 service loaded/);
  assert.match(source, /Stop-Process -Id \$listenerPid/);
  assert.doesNotMatch(source, /taskkill|Stop-Process\s+-Name|kill all/i);
});

test('daily-use informational session labels use the canonical 08:45 TX day boundary', () => {
  const probe = `
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/start-daily-use.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
$functionAst = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-MarketSessionLabel' }, $true)
if ($null -eq $functionAst) { throw 'Get-MarketSessionLabel not found' }
Invoke-Expression $functionAst.Extent.Text
$cases = @('08:29','08:30','08:44','08:45','13:44','13:45','14:59','15:00') | ForEach-Object {
  $instant = [DateTimeOffset]::Parse("2026-08-12T$($_):00+08:00")
  [pscustomobject]@{ time = $_; label = Get-MarketSessionLabel -Now $instant }
}
$cases | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', probe], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), [
    { time: '08:29', label: 'Pre-market' },
    { time: '08:30', label: 'Pre-market' },
    { time: '08:44', label: 'Pre-market' },
    { time: '08:45', label: 'Day session' },
    { time: '13:44', label: 'Day session' },
    { time: '13:45', label: 'After market' },
    { time: '14:59', label: 'After market' },
    { time: '15:00', label: 'Night session' },
  ]);
});

test('desktop shortcut installer uses the Desktop known folder and a small local wrapper', () => {
  const source = read('scripts/install-daily-use-shortcut.ps1');
  assert.match(source, /Namespace\(0x10\)/);
  assert.match(source, /FromBase64String/);
  assert.match(source, /data\\launchers/);
  assert.match(source, /START_DAILY_USE\.bat/);
  assert.match(source, /DAILY_USE_BOOTSTRAP_V1/);
  assert.match(source, /recognizedTarget/);
  assert.match(source, /Resolve-Path -LiteralPath \$ProjectRoot/);
  assert.doesNotMatch(source, /C:\\Users\\|OneDrive\\Desktop|Remove-Item/i);
});
