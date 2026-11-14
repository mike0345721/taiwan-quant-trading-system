$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root '.shioaji.env'
$target = Join-Path $root '.shioaji.credentials.json'

if (Test-Path $target) {
  Write-Host 'DPAPI credentials already exist. No migration was needed.'
  exit 0
}
if (-not (Test-Path $source)) {
  throw 'The old .shioaji.env file was not found. Run scripts\setup-shioaji-readonly.ps1.'
}

$values = @{}
foreach ($line in Get-Content -LiteralPath $source -Encoding UTF8) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $values[$matches[1]] = $matches[2]
  }
}
if ([string]::IsNullOrWhiteSpace($values.SJ_API_KEY) -or
    [string]::IsNullOrWhiteSpace($values.SJ_SEC_KEY)) {
  throw 'The existing credential file is incomplete.'
}

$apiSecure = ConvertTo-SecureString $values.SJ_API_KEY -AsPlainText -Force
$secretSecure = ConvertTo-SecureString $values.SJ_SEC_KEY -AsPlainText -Force
$now = [DateTimeOffset]::Now.ToString('o')
$record = [ordered]@{
  version = 1
  protection = 'windows-dpapi-current-user'
  createdAt = $now
  lastRotatedAt = $now
  production = $false
  apiKey = ConvertFrom-SecureString $apiSecure
  secretKey = ConvertFrom-SecureString $secretSecure
}
$record | ConvertTo-Json | Set-Content -LiteralPath $target -Encoding UTF8
icacls $target /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null

$probe = & (Join-Path $PSScriptRoot 'read-shioaji-credentials.ps1') -Path $target |
  ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($probe.apiKey) -or
    [string]::IsNullOrWhiteSpace($probe.secretKey)) {
  Remove-Item -LiteralPath $target -Force
  throw 'DPAPI verification failed; the old file was preserved.'
}

$values.Clear()
$probe = $null
Remove-Item -LiteralPath $source -Force
Write-Host 'Migration completed.'
Write-Host 'The plaintext credential file was removed.'
Write-Host 'Credentials are now encrypted for this Windows account.'
