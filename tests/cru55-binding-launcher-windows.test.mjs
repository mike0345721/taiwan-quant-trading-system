import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('launcher binding comparison refuses same-code different routing and handles absent persistent configuration',()=>{
  const file=fileURLToPath(new URL('../scripts/start-daily-use.ps1',import.meta.url)).replaceAll("'","''");
  // Parse the launcher without executing its top-level startup. Only this pure
  // predicate is evaluated; no service, HTTP request or collector is invoked.
  const probe=`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
$fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-Cru55BindingAligned' }, $true)
if ($null -eq $fn) { throw 'binding predicate missing' }
Invoke-Expression $fn.Extent.Text
function Invoke-Case($Plan, $Binding) {
  $script:cru55Plan = $Plan
  return (Test-Cru55BindingAligned ([pscustomobject]@{ cru55Binding = $Binding }))
}
$plan = [pscustomobject]@{ bindingHash = 'expected-hash'; runtimeCommit = 'same-code' }
$bound = [pscustomobject]@{ state = 'BOUND'; bindingHash = 'expected-hash'; runtimeCommit = 'same-code' }
$different = [pscustomobject]@{ state = 'BOUND'; bindingHash = 'different-hash'; runtimeCommit = 'same-code' }
$oldCode = [pscustomobject]@{ state = 'BOUND'; bindingHash = 'expected-hash'; runtimeCommit = 'old-code' }
$unconfigured = [pscustomobject]@{ state = 'UNCONFIGURED'; bindingHash = $null }
$candidate = [pscustomobject]@{ state = 'CANDIDATE_UNBOUND'; bindingHash = $null }
[pscustomobject]@{
  matching = (Invoke-Case $plan $bound)
  sameCodeDifferentHash = (Invoke-Case $plan $different)
  differentCode = (Invoke-Case $plan $oldCode)
  configuredButLegacy = (Invoke-Case $plan $null)
  configuredButUnconfigured = (Invoke-Case $plan $unconfigured)
  noConfigLegacy = (Invoke-Case $null $null)
  noConfigUnconfigured = (Invoke-Case $null $unconfigured)
  noConfigButBound = (Invoke-Case $null $bound)
  noConfigButCandidate = (Invoke-Case $null $candidate)
} | ConvertTo-Json -Compress
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',probe],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()),{
    matching:true,sameCodeDifferentHash:false,differentCode:false,configuredButLegacy:false,configuredButUnconfigured:false,
    noConfigLegacy:true,noConfigUnconfigured:true,noConfigButBound:false,noConfigButCandidate:false,
  });
});
