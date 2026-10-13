param(
  [Parameter(Mandatory=$true)][string]$BindingPath,
  [Parameter(Mandatory=$true)][string]$ReceiptDirectory,
  [ValidateSet('Prepare','Apply')][string]$Mode='Prepare'
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'bound-daily-use.psm1') -Force
$b=Read-BoundPlan $BindingPath (Split-Path $PSScriptRoot -Parent)
$receiptPath=Join-Path $ReceiptDirectory 'consumer-before.json'
function Get-Protected {
  $lock=Read-BoundJson (Join-Path $b.projectionRoot 'worker.lock')
  $status=Read-BoundJson (Join-Path $b.projectionRoot 'status.json')
  $producer=Get-BoundProcess ([int]$lock.pid)
  Assert-BoundWorker $b $status $lock $producer
  $bridge=Get-BoundListener 8790
  Assert-Bound ($null -ne $bridge) 'BRIDGE_MUST_REMAIN_RUNNING'
  @{ producer=$producer; bridge=$bridge; candidate=(Get-BoundListener 18722); workerInstanceId=$lock.workerInstanceId }
}
function Assert-SameProcess($Expected,$Actual) {
  Assert-Bound ($null -ne $Expected -and $null -ne $Actual -and $Expected.pid -eq $Actual.pid -and $Expected.createdAt -ceq $Actual.createdAt -and $Expected.executable -ceq $Actual.executable -and $Expected.command -ceq $Actual.command) 'PROCESS_CHANGED'
}
function Assert-OldDashboard($Process,$Health) {
  Assert-Bound ($null -ne $Process -and $Process.executable -ieq $b.node -and $Process.command.Trim() -ceq ('"'+$b.node+'" launcher.mjs')) 'OLD_DASHBOARD_SOURCE'
  Assert-Bound ($null -ne $Health -and $Health.ok -eq $true -and $Health.service -ceq 'tw-chip-dashboard-v1' -and $Health.runtimeCommit -ceq $b.dashboard.commit -and $Health.approvedMainCommit -ceq $b.dashboard.commit -and $Health.syncState -ceq 'SYNCED') 'OLD_DASHBOARD_VERSION'
  # Refuse a launcher that owns any child: exit must not terminate a collector it spawned.
  $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($Process.pid)")
  Assert-Bound ($children.Count -eq 0) 'DASHBOARD_HAS_CHILDREN'
}
if ($Mode -eq 'Prepare') {
  Assert-Bound (-not (Test-Path -LiteralPath $receiptPath)) 'RECEIPT_ALREADY_EXISTS'
  $dashboard=Get-BoundListener 8787
  $health=Get-BoundHealth 8787
  Assert-OldDashboard $dashboard $health
  $protected=Get-Protected
  New-Item -ItemType Directory -Path $ReceiptDirectory -Force | Out-Null
  @{ at=[datetime]::UtcNow.ToString('o'); bindingHash=(Get-FileHash $BindingPath).Hash; dashboard=$dashboard; health=$health; protected=$protected; dashboardRoot=$b.dashboard.root; note='Dashboard-only cutover. No checkpoint restore; no Producer or Bridge restart.' } | ConvertTo-Json -Depth 35 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  Write-Output 'BOUND_CONSUMER_PREPARED'
  exit 0
}
$before=Read-BoundJson $receiptPath
Assert-Bound ($null -ne $before -and $before.bindingHash -ceq (Get-FileHash $BindingPath).Hash) 'PREPARATION_CHANGED'
$attemptPath=Join-Path $ReceiptDirectory 'consumer-apply-attempt.json'
Assert-Bound (-not (Test-Path -LiteralPath $attemptPath)) 'APPLY_ALREADY_ATTEMPTED'
$mutex=New-Object Threading.Mutex($false,'Global\TwChipBoundDailyUseV1')
$owned=$false
try {
  try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
  Assert-Bound $owned 'STARTUP_IN_PROGRESS'
  $dashboard=Get-BoundListener 8787
  $health=Get-BoundHealth 8787
  Assert-SameProcess $before.dashboard $dashboard
  Assert-OldDashboard $dashboard $health
  Assert-Bound ($before.health.runtimeStartedAt -ceq $health.runtimeStartedAt) 'DASHBOARD_LIFETIME_CHANGED'
  $protected=Get-Protected
  Assert-SameProcess $before.protected.producer $protected.producer
  Assert-SameProcess $before.protected.bridge $protected.bridge
  if ($before.protected.candidate) { Assert-SameProcess $before.protected.candidate $protected.candidate }
  Assert-Bound ($before.protected.workerInstanceId -ceq $protected.workerInstanceId) 'PRODUCER_CHANGED'
  $process=Get-Process -Id $dashboard.pid
  $null=$process.Handle # hold this process object, rather than terminating a later recycled PID
  # CIM rounds FILETIME to microseconds; .NET retains 100ns precision.
  Assert-Bound ([Math]::Abs(($process.StartTime.ToUniversalTime()-[datetime]::Parse($dashboard.createdAt).ToUniversalTime()).TotalMilliseconds) -lt 1) 'DASHBOARD_PID_RECYCLED'
  Assert-SameProcess $dashboard (Get-BoundProcess $dashboard.pid)
  @{ at=[datetime]::UtcNow.ToString('o'); stopping=$dashboard; protected=$protected } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $attemptPath -Encoding UTF8
  Stop-Process -InputObject $process -ErrorAction Stop
  Assert-Bound ($process.WaitForExit(10000)) 'DASHBOARD_STOP_TIMEOUT'
  Assert-Bound ($null -eq (Get-BoundListener 8787)) 'PORT_REOCCUPIED'
  # Use exactly the same normal-start implementation as installed shortcuts.
  $result=Invoke-BoundStart $b -NoBrowser
  $after=Get-Protected
  Assert-SameProcess $protected.producer $after.producer
  Assert-SameProcess $protected.bridge $after.bridge
  if ($protected.candidate) { Assert-SameProcess $protected.candidate $after.candidate }
  @{ at=[datetime]::UtcNow.ToString('o'); result=$result; protected=$after } | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath (Join-Path $ReceiptDirectory 'consumer-after.json') -Encoding UTF8
  Write-Output 'BOUND_CONSUMER_SWITCHED'
} finally {
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
