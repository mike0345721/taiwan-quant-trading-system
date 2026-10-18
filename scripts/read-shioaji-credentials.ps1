param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
$script:CredentialReaderStage = 'UNKNOWN'

function Get-CredentialReaderFailureJson([string]$Stage, [Exception]$Exception) {
  $fallback = '{"schemaVersion":1,"event":"shioaji_credential_reader_failure","stage":"UNKNOWN","exceptions":[{"type":"OTHER_EXCEPTION","hresult":"UNLISTED"}],"exitCode":1}'
  try {
    $allowedStages = @('FILE_READ', 'JSON_PARSE', 'FORMAT_CHECK', 'DPAPI_DECRYPT', 'COMMAND_DISCOVERY', 'DPAPI_CONVERT', 'PARAMETER_BINDING', 'MARSHAL', 'SERIALIZE', 'UNKNOWN')
    $allowedTypes = @(
      [System.IO.IOException],
      [System.IO.FileNotFoundException],
      [System.IO.DirectoryNotFoundException],
      [System.UnauthorizedAccessException],
      [System.Security.Cryptography.CryptographicException],
      [System.ArgumentException],
      [System.InvalidOperationException],
      [System.FormatException],
      [System.Management.Automation.RuntimeException],
      [System.Management.Automation.CmdletInvocationException],
      [System.Management.Automation.ActionPreferenceStopException],
      [System.Management.Automation.PSArgumentException],
      [System.Management.Automation.PSInvalidOperationException],
      [System.Management.Automation.ItemNotFoundException],
      [System.Management.Automation.MethodInvocationException],
      [System.Management.Automation.ParameterBindingException],
      ([System.Management.Automation.ParameterBindingException].Assembly.GetType('System.Management.Automation.ParameterBindingValidationException')),
      ([System.Management.Automation.ParameterBindingException].Assembly.GetType('System.Management.Automation.ParameterBindingArgumentTransformationException')),
      [System.Management.Automation.PSInvalidCastException],
      [System.Management.Automation.CommandNotFoundException],
      [System.Management.Automation.PSSecurityException]
    )
    $allowedHResults = @('0x80070002', '0x80070003', '0x80070005', '0x8007000D', '0x80070057', '0x80090005', '0x8009000B')
    $safeExceptions = @()
    $current = $Exception
    for ($index = 0; $index -lt 3 -and $null -ne $current; $index++) {
      $matchedType = $null
      foreach ($allowedType in $allowedTypes) {
        if ($null -ne $allowedType -and $current.GetType() -eq $allowedType) {
          $matchedType = $allowedType
          break
        }
      }
      if ($null -eq $matchedType) {
        $safeExceptions += @{ type = 'OTHER_EXCEPTION'; hresult = 'UNLISTED' }
        break
      }
      $hresult = '0x{0:X8}' -f $current.HResult
      if ($allowedHResults -cnotcontains $hresult) { $hresult = 'UNLISTED' }
      $safeExceptions += @{ type = $matchedType.FullName; hresult = $hresult }
      # Only exact framework types above may expose their InnerException.
      $current = $current.InnerException
    }
    if ($safeExceptions.Count -eq 0) {
      $safeExceptions = @(@{ type = 'OTHER_EXCEPTION'; hresult = 'UNLISTED' })
    }
    $safeStage = 'UNKNOWN'
    if ($allowedStages -ccontains $Stage) { $safeStage = $Stage }
    if ($safeStage -eq 'DPAPI_CONVERT' -and $Exception -is [System.Management.Automation.ParameterBindingException]) {
      $safeStage = 'PARAMETER_BINDING'
    }
    return (@{
      schemaVersion = 1
      event = 'shioaji_credential_reader_failure'
      stage = $safeStage
      exceptions = @($safeExceptions)
      exitCode = 1
    } | ConvertTo-Json -Compress -Depth 5)
  } catch {
    return $fallback
  }
}

function Unprotect-Value([string]$cipherText) {
  $script:CredentialReaderStage = 'COMMAND_DISCOVERY'
  $null = Get-Command ConvertTo-SecureString -ErrorAction Stop
  # This records an attempted cmdlet call, not proof that DPAPI was entered.
  $script:CredentialReaderStage = 'DPAPI_CONVERT'
  $secure = ConvertTo-SecureString -String $cipherText
  $script:CredentialReaderStage = 'MARSHAL'
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Read-ShioajiCredentialJson([string]$CredentialPath) {
  $script:CredentialReaderStage = 'FILE_READ'
  $serializedRecord = Get-Content -LiteralPath $CredentialPath -Raw -Encoding UTF8
  $script:CredentialReaderStage = 'JSON_PARSE'
  $record = $serializedRecord | ConvertFrom-Json
  $script:CredentialReaderStage = 'FORMAT_CHECK'
  if ($record.version -ne 1 -or $record.protection -ne 'windows-dpapi-current-user') {
    throw 'Unsupported Shioaji credential format.'
  }

  $result = @{
    apiKey = Unprotect-Value $record.apiKey
    secretKey = Unprotect-Value $record.secretKey
    production = [bool]$record.production
  }
  $script:CredentialReaderStage = 'SERIALIZE'
  $result | ConvertTo-Json -Compress
}

try {
  Read-ShioajiCredentialJson -CredentialPath $Path
} catch {
  try {
    [Console]::Error.WriteLine((Get-CredentialReaderFailureJson -Stage $script:CredentialReaderStage -Exception $_.Exception))
  } catch {
    # A failed diagnostic sink must not change the failure exit code.
  }
  exit 1
}
