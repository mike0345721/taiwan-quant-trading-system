$ErrorActionPreference = 'Stop'
$cru50Root = Split-Path $PSScriptRoot -Parent
$cru50Case = Join-Path $cru50Root ('data\cru50-private\windows-lock-engineering-' + [guid]::NewGuid().ToString('N'))
$cru50Fixture = Join-Path $cru50Case 'ENGINEERING.ndjson'
$cru50LedgerModule = ([uri](Join-Path $cru50Root 'src\live-event-ledger.mjs')).AbsoluteUri
$cru50IoModule = ([uri](Join-Path $cru50Root 'src\cvd-offline-io.mjs')).AbsoluteUri
$cru50Generate = @'
import fs from 'node:fs';
import path from 'node:path';
const { buildLiveEventRecord } = await import(process.argv[1]);
const { assertPrivate } = await import(process.argv[3]);
assertPrivate(process.argv[2]);
fs.mkdirSync(path.dirname(process.argv[2]), {recursive:true});
const r = buildLiveEventRecord({kind:'status',code:'ENGINEERING',receivedAt:'2026-09-10T09:00:00+08:00',
formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false,payload:{}});
fs.writeFileSync(process.argv[2],JSON.stringify(r)+'\n',{flag:'wx'});
'@
node --input-type=module -e $cru50Generate $cru50LedgerModule $cru50Fixture $cru50IoModule
if ($LASTEXITCODE -ne 0) { throw 'CVD_FIXTURE_SETUP_FAILED' }
$cru50Before = (Get-FileHash -LiteralPath $cru50Fixture).Hash
$cru50Probe = @'
import assert from 'node:assert/strict';
const {pinCvdPrefix}=await import(process.argv[1]);
if(process.argv[3]==='locked') {
assert.throws(()=>pinCvdPrefix(process.argv[2],1),e=>['EBUSY','EACCES','EPERM'].includes(e.code));
} else { assert.equal(pinCvdPrefix(process.argv[2],1).records.length,1); }
'@
$cru50Lock = [IO.File]::Open($cru50Fixture,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
  node --input-type=module -e $cru50Probe $cru50IoModule $cru50Fixture locked
  if ($LASTEXITCODE -ne 0) { throw 'CVD_LOCK_REJECTION_FAILED' }
} finally { $cru50Lock.Dispose() }
node --input-type=module -e $cru50Probe $cru50IoModule $cru50Fixture unlocked
if ($LASTEXITCODE -ne 0) { throw 'CVD_UNLOCK_READ_FAILED' }
if ((Get-FileHash -LiteralPath $cru50Fixture).Hash -ne $cru50Before) { throw 'CVD_SOURCE_CHANGED' }
$cru50Result = [ordered]@{status='PASS';kind='ENGINEERING_REAL_WINDOWS_FILESHARE_NONE';readDeniedWhileLocked=$true;readRecovered=$true;sourcePreserved=$true;at=[DateTime]::UtcNow.ToString('o');head=(git -C $cru50Root rev-parse HEAD)}
$cru50Result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cru50Case 'evidence.json') -Encoding utf8
$cru50Result | ConvertTo-Json
