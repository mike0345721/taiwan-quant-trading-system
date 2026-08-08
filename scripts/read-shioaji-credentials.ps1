param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$record = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($record.version -ne 1 -or $record.protection -ne 'windows-dpapi-current-user') {
  throw 'Unsupported Shioaji credential format.'
}

function Unprotect-Value([string]$cipherText) {
  $secure = ConvertTo-SecureString $cipherText
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$result = @{
  apiKey = Unprotect-Value $record.apiKey
  secretKey = Unprotect-Value $record.secretKey
  production = [bool]$record.production
}
$result | ConvertTo-Json -Compress
