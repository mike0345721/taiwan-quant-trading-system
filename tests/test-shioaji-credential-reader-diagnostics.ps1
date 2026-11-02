# Offline only: load function ASTs, never invoke the actual reader top-level.
# Every credential read, decrypt, and Marshal call is replaced by a synthetic fake.
$ErrorActionPreference = 'Stop'
$readerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/read-shioaji-credentials.ps1'
$source = [IO.File]::ReadAllText($readerPath)
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw 'Reader source did not parse.' }
$script:Canary = 'SYNTHETIC_PRIVATE_CANARY_94382'
$script:TestFailures = @()
$script:TestCount = 0

function Assert-True([bool]$Condition, [string]$Name) {
  if (-not $Condition) { throw ('Assertion failed: ' + $Name) }
}

function Test-Case([string]$Name, [scriptblock]$Body) {
  $script:TestCount++
  try {
    & $Body
    Write-Output ('PASS ' + $Name)
  } catch {
    $script:TestFailures += $Name
    Write-Output ('FAIL ' + $Name)
  }
}

$functions = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
Assert-True ($functions.Count -eq 3) 'only expected flow and diagnostic functions loaded'
$unprotect = $functions | Where-Object { $_.Name -eq 'Unprotect-Value' }
$createCall = '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)'
$readCall = '[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)'
$freeCall = '[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)'
foreach ($expected in @($createCall, $readCall, $freeCall)) {
  Assert-True (($unprotect.Extent.Text.Split(@($expected), [StringSplitOptions]::None).Count - 1) -eq 1) 'exact original Marshal call'
}
$unprotectTry = @($unprotect.Body.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })
Assert-True ($unprotectTry.Count -eq 1 -and $unprotectTry[0].Finally.Extent.Text.Contains($freeCall)) 'ZeroFreeBSTR remains in finally'
foreach ($function in $functions) {
  $functionSource = $function.Extent.Text
  if ($function.Name -eq 'Unprotect-Value') {
    $functionSource = $functionSource.Replace($createCall, '(New-FakeBstr -Secure $secure)')
    $functionSource = $functionSource.Replace($readCall, '(Read-FakeBstr -Pointer $pointer)')
    $functionSource = $functionSource.Replace($freeCall, 'Clear-FakeBstr -Pointer $pointer')
    Assert-True (-not $functionSource.Contains('[Runtime.InteropServices.Marshal]')) 'all Marshal calls replaced before execution'
  }
  . ([scriptblock]::Create($functionSource))
}

# The top-level reader itself is never run. Only its catch body is copied into
# a synthetic wrapper, with Console.Error and exit replaced by inert observers.
$topTry = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.TryStatementAst] })
Assert-True ($topTry.Count -eq 1 -and $topTry[0].CatchClauses.Count -eq 1) 'one guarded reader boundary'
$exitNodes = @($topTry[0].CatchClauses[0].Body.FindAll({ param($node) $node -is [System.Management.Automation.Language.ExitStatementAst] }, $true))
Assert-True ($exitNodes.Count -eq 1 -and $exitNodes[0].Pipeline.Extent.Text -eq '1') 'real catch has literal exit 1'
$catchSource = $topTry[0].CatchClauses[0].Body.Extent.Text
$catchSource = $catchSource.Replace('[Console]::Error.WriteLine(', 'Write-TestDiagnostic -Json (')
$catchSource = $catchSource.Replace('exit 1', '$script:ObservedExitCode = 1; return')
Assert-True (-not $catchSource.Contains('[Console]') -and -not $catchSource.Contains('exit 1')) 'catch effects replaced'
. ([scriptblock]::Create('function Invoke-TestCatch([Exception]$Failure) { try { throw $Failure } catch ' + $catchSource + ' }'))

function Reset-Fakes([string]$FailureStage = '') {
  $script:FailureStage = $FailureStage
  $script:CredentialReaderStage = 'UNKNOWN'
  $script:ObservedExitCode = $null
  $script:EmittedDiagnostics = @()
  $script:FreedPointers = @()
  $script:MarshalCalls = @()
  $script:ReadCount = 0
  $script:DecryptCount = 0
  $script:SinkFailure = $false
  $script:FormatterFailure = $false
  $script:ReadContract = $false
}

function Get-Content {
  param([string]$LiteralPath, [switch]$Raw, [string]$Encoding)
  Assert-True ($LiteralPath -ceq '__SYNTHETIC_ONLY__') 'real credential paths are forbidden'
  Assert-True ($Raw.IsPresent -and $Encoding -ceq 'UTF8') 'original read arguments preserved'
  $script:ReadContract = $true
  $script:ReadCount++
  if ($script:FailureStage -eq 'FILE_READ') { throw [System.IO.IOException]::new($script:Canary) }
  return 'SYNTHETIC_SERIALIZED_RECORD'
}

function ConvertFrom-Json {
  param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    Assert-True ($InputObject -ceq 'SYNTHETIC_SERIALIZED_RECORD') 'only synthetic parse input'
    if ($script:FailureStage -eq 'JSON_PARSE') { throw [System.FormatException]::new($script:Canary) }
    $version = 1
    if ($script:FailureStage -eq 'FORMAT_CHECK') { $version = 99 }
    return [pscustomobject]@{
      version = $version
      protection = 'windows-dpapi-current-user'
      apiKey = 'FAKE_CIPHER_A'
      secretKey = 'FAKE_CIPHER_B'
      production = $false
    }
  }
}

function ConvertTo-SecureString {
  param([Alias('String')][string]$CipherText)
  Assert-True ($CipherText -in @('FAKE_CIPHER_A', 'FAKE_CIPHER_B')) 'only fake ciphertext accepted'
  $script:DecryptCount++
  if ($script:FailureStage -eq 'DPAPI_DECRYPT') {
    throw [System.Security.Cryptography.CryptographicException]::new($script:Canary)
  }
  return 'SYNTHETIC_SECURE_HANDLE'
}

function New-FakeBstr([string]$Secure) {
  Assert-True ($Secure -ceq 'SYNTHETIC_SECURE_HANDLE') 'no real secure string'
  $script:MarshalCalls += 'allocate'
  if ($script:FailureStage -eq 'MARSHAL_ALLOCATE') { throw [System.InvalidOperationException]::new($script:Canary) }
  return 17
}

function Read-FakeBstr([int]$Pointer) {
  Assert-True ($Pointer -eq 17) 'only fake pointer'
  $script:MarshalCalls += 'read'
  if ($script:FailureStage -eq 'MARSHAL_READ') { throw [System.InvalidOperationException]::new($script:Canary) }
  return 'SYNTHETIC_PLAINTEXT_ONLY'
}

function Clear-FakeBstr([int]$Pointer) {
  Assert-True ($Pointer -eq 17) 'only fake pointer cleared'
  $script:MarshalCalls += 'free'
  $script:FreedPointers += $Pointer
}

function ConvertTo-Json {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, [switch]$Compress, [int]$Depth = 2)
  process {
    if ($script:FormatterFailure) { throw [System.InvalidOperationException]::new($script:Canary) }
    if ($script:FailureStage -eq 'SERIALIZE' -and $InputObject.ContainsKey('apiKey')) {
      throw [System.InvalidOperationException]::new($script:Canary)
    }
    Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $InputObject -Compress:$Compress -Depth $Depth
  }
}

function Write-TestDiagnostic([string]$Json) {
  if ($script:SinkFailure) { throw [System.IO.IOException]::new($script:Canary) }
  $script:EmittedDiagnostics += $Json
}

function Invoke-SyntheticReader {
  try {
    Read-ShioajiCredentialJson -CredentialPath '__SYNTHETIC_ONLY__'
    $script:ObservedExitCode = 0
  } catch {
    Invoke-TestCatch -Failure $_.Exception
  }
}

function Convert-TestJson([string]$Json) {
  Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $Json
}

function Assert-Diagnostic([string]$Json, [string]$Stage) {
  $record = Convert-TestJson $Json
  Assert-True (-not $Json.Contains($script:Canary) -and -not $Json.Contains('FAKE_CIPHER') -and -not $Json.Contains('SYNTHETIC_PLAINTEXT')) 'no private markers emitted'
  $keys = @($record.PSObject.Properties.Name | Sort-Object)
  Assert-True (($keys -join ',') -ceq 'event,exceptions,exitCode,schemaVersion,stage') 'exact top-level keys'
  Assert-True ($record.schemaVersion -eq 1 -and $record.exitCode -eq 1) 'fixed versions and exit'
  Assert-True ($record.event -ceq 'shioaji_credential_reader_failure' -and $record.stage -ceq $Stage) 'fixed event and expected stage'
  Assert-True ($record.exceptions -is [array] -and $record.exceptions.Count -ge 1 -and $record.exceptions.Count -le 3) 'bounded exception array'
  foreach ($safeException in $record.exceptions) {
    Assert-True ((@($safeException.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'hresult,type') 'exact exception keys'
  }
  return $record
}

Test-Case 'PowerShell 5.1 and required wrapper types resolve' {
  Assert-True ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'run in Windows PowerShell 5.1'
  Assert-True ([System.Management.Automation.CmdletInvocationException].FullName -ceq 'System.Management.Automation.CmdletInvocationException') 'cmdlet wrapper type'
  Assert-True ([System.Management.Automation.ActionPreferenceStopException].FullName -ceq 'System.Management.Automation.ActionPreferenceStopException') 'stop wrapper type'
}

foreach ($failureStage in @('FILE_READ', 'JSON_PARSE', 'FORMAT_CHECK', 'DPAPI_DECRYPT', 'MARSHAL_ALLOCATE', 'MARSHAL_READ', 'SERIALIZE')) {
  Test-Case ('failure stage ' + $failureStage) {
    Reset-Fakes $failureStage
    $stdout = @(Invoke-SyntheticReader)
    Assert-True ($stdout.Count -eq 0 -and $script:ObservedExitCode -eq 1) 'failure emits no successful stdout and exits 1'
    Assert-True ($script:EmittedDiagnostics.Count -eq 1) 'one diagnostic'
    $expected = $failureStage
    if ($failureStage -eq 'DPAPI_DECRYPT') { $expected = 'DPAPI_CONVERT' }
    if ($failureStage.StartsWith('MARSHAL_')) { $expected = 'MARSHAL' }
    $null = Assert-Diagnostic $script:EmittedDiagnostics[0] $expected
  }
}

Test-Case 'success retains original result schema and access arguments' {
  Reset-Fakes
  $stdout = @(Invoke-SyntheticReader)
  Assert-True ($stdout.Count -eq 1 -and $script:ObservedExitCode -eq 0) 'one successful JSON result'
  $result = Convert-TestJson $stdout[0]
  Assert-True ((@($result.PSObject.Properties.Name | Sort-Object) -join ',') -ceq 'apiKey,production,secretKey') 'original successful keys'
  Assert-True ($result.apiKey -ceq 'SYNTHETIC_PLAINTEXT_ONLY' -and $result.secretKey -ceq 'SYNTHETIC_PLAINTEXT_ONLY' -and $result.production -eq $false) 'original result semantics'
  Assert-True ($script:EmittedDiagnostics.Count -eq 0 -and $script:ReadContract -and $script:ReadCount -eq 1 -and $script:DecryptCount -eq 2) 'no successful diagnostic or extra reads'
  Assert-True (($script:MarshalCalls -join ',') -ceq 'allocate,read,free,allocate,read,free') 'original Marshal cleanup order'
}

Test-Case 'PtrToStringBSTR failure still runs ZeroFreeBSTR finally' {
  Reset-Fakes 'MARSHAL_READ'
  $null = Invoke-SyntheticReader
  Assert-True (($script:MarshalCalls -join ',') -ceq 'allocate,read,free' -and $script:FreedPointers.Count -eq 1) 'failed read always frees existing pointer'
}

Test-Case 'failed allocation does not free a missing pointer' {
  Reset-Fakes 'MARSHAL_ALLOCATE'
  $null = Invoke-SyntheticReader
  Assert-True (($script:MarshalCalls -join ',') -ceq 'allocate' -and $script:FreedPointers.Count -eq 0) 'allocation failure preserves original behavior'
}

Test-Case 'known cryptographic HRESULT is allowlisted' {
  Reset-Fakes
  $errorValue = [System.Security.Cryptography.CryptographicException]::new(-2146893813)
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'DPAPI_DECRYPT' $errorValue) 'DPAPI_DECRYPT'
  Assert-True ($record.exceptions[0].type -ceq 'System.Security.Cryptography.CryptographicException' -and $record.exceptions[0].hresult -ceq '0x8009000B') 'known exact type and code'
}

Test-Case 'real cmdlet empty string binding is not called DPAPI failure' {
  $bindingFailure = $null
  try { $null = Microsoft.PowerShell.Security\ConvertTo-SecureString -String '' -ErrorAction Stop } catch { $bindingFailure = $_.Exception }
  Assert-True ($bindingFailure -is [System.Management.Automation.ParameterBindingException]) 'real binding failure captured'
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'DPAPI_CONVERT' $bindingFailure) 'PARAMETER_BINDING'
  Assert-True ($record.exceptions[0].type -eq 'System.Management.Automation.ParameterBindingValidationException') 'internal framework type resolved safely'
}

Test-Case 'command discovery error cannot be mistaken for cryptographic failure' {
  $failure = [System.Management.Automation.CommandNotFoundException]::new($script:Canary)
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'COMMAND_DISCOVERY' $failure) 'COMMAND_DISCOVERY'
  Assert-True ($record.exceptions[0].type -eq 'System.Management.Automation.CommandNotFoundException') 'fixed discovery type'
}

Test-Case 'all allowed HRESULT values use exact uppercase wire form' {
  Reset-Fakes
  foreach ($code in @('0x80070002', '0x80070003', '0x80070005', '0x8007000D', '0x80070057', '0x80090005', '0x8009000B')) {
    $unsigned = [Convert]::ToUInt32($code.Substring(2), 16)
    $signed = [BitConverter]::ToInt32([BitConverter]::GetBytes($unsigned), 0)
    $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'DPAPI_DECRYPT' ([System.Security.Cryptography.CryptographicException]::new($signed))) 'DPAPI_DECRYPT'
    Assert-True ($record.exceptions[0].hresult -ceq $code) 'exact HRESULT wire value'
  }
}

Test-Case 'unknown HRESULT is not exposed' {
  Reset-Fakes
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'DPAPI_DECRYPT' ([System.Security.Cryptography.CryptographicException]::new(71927192))) 'DPAPI_DECRYPT'
  Assert-True ($record.exceptions[0].hresult -ceq 'UNLISTED') 'unknown code bounded'
}

Test-Case 'unknown type stops traversal and hides its class name' {
  Reset-Fakes
  $knownInner = [System.IO.IOException]::new($script:Canary)
  $unknownOuter = [System.ApplicationException]::new($script:Canary, $knownInner)
  $serialized = Get-CredentialReaderFailureJson 'FILE_READ' $unknownOuter
  $record = Assert-Diagnostic $serialized 'FILE_READ'
  Assert-True ($record.exceptions.Count -eq 1 -and $record.exceptions[0].type -ceq 'OTHER_EXCEPTION' -and -not $serialized.Contains('ApplicationException')) 'unknown type terminates chain'
}

Test-Case 'known nested chain retains only three safe entries' {
  Reset-Fakes
  $current = [System.Security.Cryptography.CryptographicException]::new(-2146893813)
  for ($index = 0; $index -lt 4; $index++) { $current = [System.InvalidOperationException]::new($script:Canary, $current) }
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'MARSHAL' $current) 'MARSHAL'
  Assert-True ($record.exceptions.Count -eq 3) 'chain bounded at three'
  Assert-True (@($record.exceptions | Where-Object { $_.type -cne 'System.InvalidOperationException' }).Count -eq 0) 'no deeper exception emitted'
}

Test-Case 'known PowerShell wrapper preserves safe inner exception' {
  Reset-Fakes
  $inner = [System.Security.Cryptography.CryptographicException]::new(-2146893813)
  $outer = [System.Management.Automation.CmdletInvocationException]::new($script:Canary, $inner)
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson 'DPAPI_DECRYPT' $outer) 'DPAPI_DECRYPT'
  Assert-True ($record.exceptions.Count -eq 2 -and $record.exceptions[0].type -ceq 'System.Management.Automation.CmdletInvocationException' -and $record.exceptions[1].hresult -ceq '0x8009000B') 'safe inner crypto retained'
}

Test-Case 'unknown stage and null error use bounded values' {
  Reset-Fakes
  $record = Assert-Diagnostic (Get-CredentialReaderFailureJson $script:Canary $null) 'UNKNOWN'
  Assert-True ($record.exceptions[0].type -ceq 'OTHER_EXCEPTION' -and $record.exceptions[0].hresult -ceq 'UNLISTED') 'null error bounded'
}

Test-Case 'formatter failure uses exact fallback schema and still exits 1' {
  Reset-Fakes 'FILE_READ'
  $script:FormatterFailure = $true
  $stdout = @(Invoke-SyntheticReader)
  Assert-True ($stdout.Count -eq 0 -and $script:ObservedExitCode -eq 1 -and $script:EmittedDiagnostics.Count -eq 1) 'formatter failure retains failed exit'
  $record = Assert-Diagnostic $script:EmittedDiagnostics[0] 'UNKNOWN'
  Assert-True ($record.exceptions[0].type -ceq 'OTHER_EXCEPTION' -and $record.exceptions[0].hresult -ceq 'UNLISTED') 'fixed formatter fallback'
}

Test-Case 'diagnostic sink failure still exits 1 without raw error output' {
  Reset-Fakes 'FILE_READ'
  $script:SinkFailure = $true
  $captured = @(Invoke-SyntheticReader 2>&1)
  Assert-True ($captured.Count -eq 0 -and $script:ObservedExitCode -eq 1) 'sink failure swallowed before literal exit'
}

Write-Output ('RESULT tests=' + $script:TestCount + ' failures=' + $script:TestFailures.Count)
if ($script:TestFailures.Count -ne 0) { exit 1 }
exit 0
