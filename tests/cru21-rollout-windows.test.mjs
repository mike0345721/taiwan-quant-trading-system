import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/cru21-dashboard-rollout.ps1', import.meta.url));
const q = s => "'" + s.replaceAll("'", "''") + "'";
const windows = { skip: process.platform !== 'win32' };
const childEnv = { ...process.env };
delete childEnv.PSModulePath; // Let Windows PowerShell discover its own modules.

// Execute the complete rollback entry point with isolated dummy files and
// intercepted OS/Git mutations. Neither 8787 nor any real process is touched.
test('rollback B3: non-listening PID stops, while dirty code, corrupt backup and foreign PID fail before mutation', windows, () => {
  const ps = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$rollout=[ScriptBlock]::Create([IO.File]::ReadAllText(${q(script)}))
$parent=Join-Path ${q(path.dirname(script))} '../data/rollout-test'
[IO.Directory]::CreateDirectory($parent)|Out-Null
$root=Join-Path $parent ([Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$primary=Join-Path $root 'primary';$formal=Join-Path $root 'formal'
[IO.Directory]::CreateDirectory((Join-Path $primary 'v2/reports'))|Out-Null
[IO.Directory]::CreateDirectory($formal)|Out-Null
function Put($p,$s){[IO.File]::WriteAllText($p,$s)}
function Sum($p){(Get-FileHash -LiteralPath $p).Hash.ToLowerInvariant()}
$envText='HOST=127.0.0.1'
Put (Join-Path $primary '.env') $envText;Put (Join-Path $formal '.env') $envText
Put (Join-Path $primary 'v2/reports/report.md') 'preserved'
Put (Join-Path $root 'primary-original.env') $envText
Put (Join-Path $root 'formal-original.env') $envText
Put (Join-Path $root 'formal-target.env') $envText
Put (Join-Path $root 'primary-dirty-report.md') 'preserved'
$hash=Sum (Join-Path $root 'formal-original.env')
$plan=@{schema='cru21-rollout-plan-v2';primary=$primary;formal=$formal;base=('a'*40);head=('b'*40);primaryEnvHash=$hash;formalEnvHash=$hash;targetEnvHash=$hash;dirtyReportPath='v2/reports/report.md';dirtyReportHash=(Sum (Join-Path $root 'primary-dirty-report.md'))}
$plan|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'plan.json')
$proc=[pscustomobject]@{ProcessId=43210;ExecutablePath='C:\\Program Files\\nodejs\\node.exe';CommandLine='node --env-file=fixture server.mjs';CreationDate=[datetime]'2026-10-09T00:00:00Z'}
$identity=@{pid=43210;executable=$proc.ExecutablePath;commandLine=$proc.CommandLine;creationDate=$proc.CreationDate.ToUniversalTime().ToString('o')}
@{expectedMain=('b'*40);newPid=43210;newProcess=$identity}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $root 'deployment-state.json')
function git.exe {
 $argsList=@($args);$global:LASTEXITCODE=0
 if($argsList -contains 'rev-parse'){return ('b'*40)}
 if($argsList -contains 'status'){
  if($script:dirty -and $argsList[1] -eq $formal){return ' M server.mjs'}
  if($argsList[1] -eq $primary){return ' M v2/reports/report.md'}
  return ''
 }
 if($argsList -contains 'switch'){$script:actions.Add('switch')|Out-Null;return ''}
 throw 'Unexpected Git operation'
}
function Get-NetTCPConnection {param($LocalPort,$State,$ErrorAction);if($script:foreignListener){[pscustomobject]@{OwningProcess=98765}}}
function Get-CimInstance {param($ClassName,$Filter);if(-not $script:stopped){if($script:reused){$proc.CreationDate.AddSeconds(1)|Out-Null;[pscustomobject]@{ProcessId=43210;ExecutablePath=$proc.ExecutablePath;CommandLine=$proc.CommandLine;CreationDate=$proc.CreationDate.AddSeconds(1)}}else{$proc}}}
function Stop-Process {param($Id);if($Id -ne 43210){throw 'Unknown PID'};$script:actions.Add('stop')|Out-Null;$script:stopped=$true}
function Wait-Process {param($Id,$Timeout,$ErrorAction)}
function Copy-Item {param($LiteralPath,$Destination);$script:actions.Add('copy')|Out-Null}
function Start-Process {
 param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
 if($WindowStyle -ne 'Hidden' -or $ArgumentList.Count -ne 2 -or $ArgumentList[1] -notlike '*server.mjs*' -or ($ArgumentList -join ' ') -match 'launcher|bridge'){throw 'Not dashboard-only'}
 $script:actions.Add('start-direct-server')|Out-Null;return [pscustomobject]@{Id=54321}
}
$results=@()
try{
 foreach($case in @('valid-no-listener','dirty','corrupt-backup','foreign-listener','pid-reuse')){
  $script:actions=[Collections.Generic.List[string]]::new();$script:stopped=$false
  $script:dirty=$case -eq 'dirty';$script:foreignListener=$case -eq 'foreign-listener';$script:reused=$case -eq 'pid-reuse'
  Put (Join-Path $root 'formal-original.env') $(if($case -eq 'corrupt-backup'){'tampered'}else{$envText})
  $failure=$null
  try { & $rollout -Mode Rollback -PlanPath (Join-Path $root 'plan.json') -ExpectedMain ('b'*40) | Out-Null } catch {$failure=$_.Exception.Message}
  $results+=@{case=$case;actions=@($script:actions.ToArray());failure=$failure}
 }
 $results|ConvertTo-Json -Depth 6 -Compress
}finally{
 $actual=[IO.Path]::GetFullPath($root);$allowed=[IO.Path]::GetFullPath($parent)
 if([IO.Path]::GetDirectoryName($actual) -ne $allowed){throw 'Unsafe cleanup'}
 Remove-Item -LiteralPath $actual -Recurse -Force
}
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: childEnv });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const rows = JSON.parse(result.stdout.trim());
  assert.equal(rows[0].failure, null);
  assert.deepEqual(rows[0].actions, ['stop', 'switch', 'switch', 'copy', 'start-direct-server']);
  for (const row of rows.slice(1)) { assert.deepEqual(row.actions, [], row.case); assert.ok(row.failure, row.case); }
});

test('historical blocked plans cannot execute the revised rollout helper', windows, () => {
  const root = fs.mkdtempSync(path.join(path.dirname(script), '../data/rollback-version-test-'));
  try {
    const plan = path.join(root, 'plan.json'); fs.writeFileSync(plan, JSON.stringify({ schema: 'cru21-rollout-plan-v1' }));
    const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; & ([ScriptBlock]::Create([IO.File]::ReadAllText(${q(script)}))) -PlanPath ${q(plan)}`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: childEnv });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /Fresh v2 plan required/);
  } finally { assert.equal(path.dirname(root), path.resolve(path.dirname(script), '../data')); fs.rmSync(root, { recursive: true, force: true }); }
});

test('original dashboard fingerprint rejects reused PID before cutover', windows, () => {
  const ps = `
$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile(${q(script)},[ref]$null,[ref]$null)
foreach($name in @('Process-Identity','Assert-OldDashboard')) {
 $definition=$ast.Find({param($x) $x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $name},$true)
 Invoke-Expression $definition.Extent.Text
}
$node='C:\\Program Files\\nodejs\\node.exe'
$proc=[pscustomobject]@{ProcessId=43210;ExecutablePath=$node;CommandLine='node launcher.mjs';CreationDate=[datetime]'2026-10-09T00:00:00Z'}
$plan=@{base=('a'*40);formalPid=43210;oldProcess=(Process-Identity $proc)}
function Invoke-RestMethod {param($Uri,$TimeoutSec) [pscustomobject]@{runtimeCommit=('a'*40);runtimeIdentityStatus='VERIFIED'}}
function Get-NetTCPConnection {param($LocalPort,$State) [pscustomobject]@{OwningProcess=43210}}
function Get-CimInstance {param($ClassName,$Filter) $proc}
Assert-OldDashboard|Out-Null
$proc.CreationDate=$proc.CreationDate.AddSeconds(1)
try { Assert-OldDashboard|Out-Null; throw 'Reused PID accepted' } catch { if($_.Exception.Message -ne 'Original process identity mismatch'){throw} }
$plan.oldProcess=$null
try { Assert-OldDashboard|Out-Null; throw 'Missing identity accepted' } catch { if($_.Exception.Message -ne 'Original process identity mismatch'){throw} }
Write-Output 'IDENTITY_GUARDS_PASS'
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding:'utf8', windowsHide:true, env:childEnv, timeout:30_000 });
  assert.equal(r.status,0,r.stderr || r.stdout); assert.match(r.stdout,/IDENTITY_GUARDS_PASS/);
});

test('producer restart refuses a reused foreign PID without stopping or launching', windows, () => {
  const starter = path.join(path.dirname(script),'start-cru34-live-projection-hidden.ps1');
  const root = fs.mkdtempSync(path.join(path.dirname(script),'../data/producer-identity-test-'));
  const projection = path.join(root,'projection'); fs.mkdirSync(projection);
  const status={schemaVersion:'cru34-live-worker-status-v1',pid:43210,workerInstanceId:'00000000-0000-4000-8000-000000000000',workerStartedAt:'2026-10-07T04:40:00.466Z',executionAuthorized:false,orderRoutesEnabled:false};
  fs.writeFileSync(path.join(projection,'worker.lock'),JSON.stringify(status));
  fs.writeFileSync(path.join(projection,'status.json'),JSON.stringify(status));
  const ps=`
$ErrorActionPreference='Stop'
$actions=[Collections.Generic.List[string]]::new()
function Get-Process {param($Id,$ErrorAction) [pscustomobject]@{Id=43210}}
function Get-CimInstance {param($ClassName,$Filter) [pscustomobject]@{ProcessId=43210;ExecutablePath='C:\\Windows\\System32\\conhost.exe';CommandLine='conhost';CreationDate=[datetime]'2026-10-09T12:38:33Z'}}
function Stop-Process {param($Id) $actions.Add('stop')}
function Start-Process { $actions.Add('start') }
try { & ([ScriptBlock]::Create([IO.File]::ReadAllText(${q(starter)}))) -WorkingRoot ${q(root)} -ProjectionRoot ${q(projection)} -RestartMismatched; throw 'Foreign PID accepted' }
catch { if($_.Exception.Message -ne 'CRU34_LIVE_PRODUCER_PROCESS_IDENTITY_UNVERIFIED'){throw} }
if($actions.Count){throw 'Foreign PID mutation'}
Write-Output 'FOREIGN_PROCESS_PRESERVED'
`;
  try {
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',windowsHide:true,env:childEnv,timeout:30_000});
    assert.equal(r.status,0,r.stderr || r.stdout); assert.match(r.stdout,/FOREIGN_PROCESS_PRESERVED/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projection,'worker.lock'),'utf8')),status);
  } finally { assert.equal(path.dirname(root),path.resolve(path.dirname(script),'../data'));fs.rmSync(root,{recursive:true,force:true}); }
});
