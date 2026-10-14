# CRU-21 bounded startup supervision

Scope: startup diagnostics and failure containment, based on launcher PR84
58aea9251eb46be3492e536ef86dcccff21e659d. Not a target calculation change,
new collector, deployment, Windows configuration edit, or full-product approval.

## Evidence and uncertainty

On 2026-10-14 an installed hidden launcher remained alive for over 30 minutes,
held the global startup mutex, and had no application child. The subsequent entry
returned BOUND_START_ALREADY_RUNNING with exit 0. The exact operation where that
historical process blocked was not captured. A new successful noninteractive start
does NOT prove a prompt caused the old hang. Sleep/wake correlation is not causation.

## Behavior

The existing entry now delegates its original logic to an explicitly noninteractive
Windows PowerShell 5.1 worker. Original bound-plan/source/identity/market predicates
remain in the worker. No prompt is auto-approved. Installed-entry generation also
adds -NonInteractive; no global execution policy is modified.

The supervisor owns the exact Process object it creates, drains stdout/stderr
asynchronously before waiting, and uses a default 90-second finite worker wait.
It saves an intent, exact process creation time, per-stage journal, bounded diagnostic
logs and final result under LOCALAPPDATA/TaiwanStock/bound-startup/<binding-key>/<run>.
Stages include source validation, worker/dashboard/Bridge checks, spawning and final
HTTP verification. Source contents, passwords and session tokens are not logged.
Log output is capped at 128 Ki characters after drainage. This is a trusted fixed
startup worker, not a general-purpose untrusted-output sandbox.

A deadline ends only the worker Process held by the supervisor, never an entire tree,
existing PID, Node group, Bridge, Producer, research job or Remote host. Application
children already created are left untouched. The maximum configured worker wait is
not an operating-system hard real-time guarantee: process creation and OS termination
may take additional time. Exit wait after termination and pipe drainage are bounded.

After timeout or supervisor uncertainty, reconciliation-required.json blocks further
normal starts for this binding. There is no automatic retry or automatic removal of
that guard. Operator reconciliation must inspect the saved last stage, fresh process
identities, worker/status/lock and listening ports; preserve the guard and receipts
as evidence before an explicitly reviewed recovery. Do NOT delete market worker.lock,
rewind checkpoints, or stop unknown processes to clear a startup failure.

Exit semantics: 0 requires a matching terminal worker receipt (BOUND_SOURCE_READY or
PREFLIGHT_PASS); preflight is never application ready. Busy/parallel entry is exit3
BUSY_NOT_READY, not success. Deadline is124. An unresolved prior attempt is125.
Other nonzero worker exits remain failures. Exit0 without a valid terminal receipt
cannot become readiness. The stage journal survives a deadline even when no final
worker receipt exists. Diagnostics after uncertainty are fail-closed.

## Validation boundaries

Tests use disposable PowerShell workers and temporary Git fixture repositories.
They cover prompts, stalls, concurrent pipe output, warnings, terminal receipt
validation, busy semantics and blind-retry refusal. No real market services are
started/stopped by those fixtures. Existing bound-plan/refusal/recovery tests remain
applicable after changes to their shared entry. Real machine reboot, actual sleep/wake,
production deployment and independent engineering review must be reported separately.
The old installed source and shortcuts are NOT updated by editing this worktree.

## Primary references

- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1
- https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.waitforexit?view=netframework-4.8.1
- https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.kill?view=netframework-4.8.1
