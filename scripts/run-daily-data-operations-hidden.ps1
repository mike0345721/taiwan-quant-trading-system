param(
  [Parameter(Mandatory)][string]$DataRoot,
  [Parameter(Mandatory)][string]$OutputRoot,
  [Parameter(Mandatory)][string]$ManifestPath,
  [Parameter(Mandatory)][string]$EvidenceRoot,
  [Parameter(Mandatory)][string]$CalendarPath,
  [Parameter(Mandatory)][ValidateSet('DAY_CHECKPOINT','EOD_CHECKPOINT','FINAL_TRADEDATE_CHECKPOINT')][string]$Checkpoint,
  [Parameter(Mandatory)][ValidateSet('SCHEDULED','CANDIDATE_SCHEDULER_TEST')][string]$RunMode,
  [Parameter(Mandatory)][string]$TriggerIdentity,
  [string]$TradeDate = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-daily-data-operations-acceptance.mjs'
$arguments = @($runner, "--data-root=$DataRoot", "--output-root=$OutputRoot", "--manifest=$ManifestPath",
  "--evidence-root=$EvidenceRoot", "--calendar=$CalendarPath", "--checkpoint=$Checkpoint",
  "--run-mode=$RunMode", "--trigger-identity=$TriggerIdentity")
if ($TradeDate) { $arguments += "--trade-date=$TradeDate" }
& $node @arguments '--validate-only=true' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OPERATIONS_LAUNCH_VALIDATION_FAILED' }
# The JS runner's guarded job history is the canonical receipt. No extra log sink
# is opened before validation, and no task result is interpreted as data PASS.
Push-Location $root
try {
  & $node @arguments
  exit $LASTEXITCODE
} finally { Pop-Location }
