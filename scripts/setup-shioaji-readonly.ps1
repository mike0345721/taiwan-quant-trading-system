$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root ".shioaji.credentials.json"

Write-Host ""
Write-Host "Shioaji read-only market data setup"
Write-Host "Your keys stay on this computer and are never shown in chat."
Write-Host ""

$apiSecure = Read-Host "Paste API Key" -AsSecureString
$secretSecure = Read-Host "Paste Secret Key" -AsSecureString
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

Write-Host ""
Write-Host "Saved with Windows DPAPI encryption for your Windows account."
Write-Host "Simulation mode is ON. No live-order permission is enabled."
