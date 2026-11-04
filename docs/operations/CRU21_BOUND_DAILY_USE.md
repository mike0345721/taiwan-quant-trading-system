# CRU-21: pinned Producer startup and reader binding

This entry is for the separately authorized Producer persistence / 8787 source-binding package. It does not deploy PR82, change `main`, relax readiness, or activate CVD/TXO/orders/models.

The machine-local JSON binding uses schema `cru21-bound-daily-use-v1` and scope `PIN_EXISTING_PRODUCER_AND_REBIND_READER`. It pins three independent Git roots and full SHAs: `launcher`, `producer`, `dashboard`. `dashboard.allowedDirty` may contain only the existing generated OI audit report; no executable source changes are allowed. `dataRoot` and its `runtime\cru34-live` projection must match the Producer's declared logical paths exactly. The primary Dashboard root, its `.env`, and other data remain unchanged. `node`, `envFile`, and `logRoot` are explicit absolute paths. Local configuration/credentials/receipts are not committed.

`start-bound-daily-use.ps1 -BindingPath <json> [-NoBrowser] [-CheckOnly]` verifies pins and routing before runtime actions. An OS mutex serializes the installed entries. A live Producer is reused only after status/lock, PID/creation time, absolute runner, executable, paths, safety flags and heartbeat agree. Unknown owners or listeners fail closed. No normal-start code stops processes. A missing Producer starts from the pinned absolute runner and current checkpoint; the worker owns stale-lock takeover. New launches and startup results receive separate immutable receipts.

The Dashboard starts with its unchanged source and `.env` through `server.mjs`, plus the Producer's four CRU34 paths. Existing strict readiness checks remain unchanged. A running incorrectly bound consumer is refused. `switch-bound-dashboard.ps1` is a separate, one-use Prepare/Apply cutover: it checks fresh process fingerprints, version and protected services, refuses Dashboard application children, and stops only the verified consumer. Only the OS console host with the exact system path/command and a matching creation interval is permitted, and it must have no children. The operation neither stops the Producer/Bridge nor copies checkpoints.

The existing Bridge starter is invoked only when 8790 has no listener, without overriding Windows execution policy or granting broker-login authorization. A zero exit alone is not readiness: the entry performs up to 30 listener checks with 500 ms between attempts, verifies safe market-data-only health before launching dependent runtimes, and rechecks the same listener PID/creation time and safe health before saving success. Process inspection time is additional to the polling sleep budget. Each Bridge HTTP health request has a 3-second timeout and requires actual boolean safety flags and numeric zero weight. A withheld login, missing listener, unreachable/unsafe health, or changed listener fails closed. The new entry does not invoke broad startup recovery or research backfills. Existing independent research/collection scheduled tasks remain unchanged. Quality warnings and unavailable data remain visible; source-binding success is not full product readiness.

`install-bound-daily-use.ps1` backs up and redirects only the existing normal-use batch file, two existing desktop shortcuts and existing Startup shortcut. All lead to the versioned bound entry. It does not copy individual application modules, install scheduled tasks, update main, or rewrite legacy source scripts. The initial shortcut targets must match the expected existing entries. Both original and planned hashes are saved before replacement, allowing recovery from partial installation.

## Rollback

Keep the pinned worktrees, original source archive, binding, entry backups, consumer preparation/apply receipts and old logs. `install-bound-daily-use.ps1 -Mode Restore` restores those four entry files only if each still matches the original or installed hash. It does not restart services or restore runtime data. Be aware that the restored old shortcuts can choose the old Producer on a later start; restoring them is an explicit rollback, not a healthy steady state.

If the consumer cutover fails, preserve the attempt and logs. Re-read current identities before any further action; never retry using the old PID. The normal bound entry can resume when 8787 is free, reusing the still-running Producer and Bridge. To undo the reader routing, stop only a freshly verified consumer from its new launch receipt and run the original Dashboard SHA/root against the original `.env` and original CRU34 paths. This deliberately reintroduces the previous readiness mismatch and requires a separately reviewed operation. No rollback copies old snapshots/checkpoints into the live directory or removes fault evidence.

## Prepared HTTPS daily entry (not installed)

The existing bound entry can now consume an explicit optional `localMarket`
binding with schema `cru21-bound-local-market-v1`, `readDataRoot`,
`chartCacheRoot`, `tlsBundle`, and `tlsCertSha256`. These are exact approved-plan
identities, not discovery hints. The private chart cache must be under the pinned
Dashboard data root and its source must be clean. All required routing keys must
match; `TRUST_PROXY` may remain absent, empty, `0`, or `false`, as in the V4 rollout
contract. No authentication setting is rewritten.

This mode uses the fixed HTTPS loopback origin for both health and the browser,
with ordinary Windows certificate verification. A TLS error does not retry HTTP.
The old binding retains its old HTTP behavior; it cannot silently activate TLS.
Routing values accept single-line unquoted values with comments, or single/double
quoted values followed by an optional comment. Multiline, backtick, or ambiguous
double-quoted newline escapes fail with `ENV_ROUTING_FORMAT_UNSUPPORTED`; no value
is printed. The full Node dotenv parser remains authoritative at process start.

Deployment still requires a qualified, non-temporary runtime root, approved exact
main/product and compatible Producer pins, reviewed V4 settings/TLS, the existing
rollout prechecks and saved rollback package. Only then may the original bound
installer redirect existing daily entry files. The installer receipt must retain
the original/installed file hashes; Restore only accepts matching identities.
Program preparation, short candidate acceptance, installation and real daily use
are distinct gates. None of this installs an entry, changes a binding, loads local
settings, or authorizes a start/stop. The separate 15-minute mechanism retains its
HOLD and deadline and is not the daily entry.

Daily use is local to the running MSI host; loopback is not a phone/network
endpoint. After approval, opening the existing installed entry can reuse verified
healthy services. Closing a browser is not service shutdown. Shutdown/reboot,
cold start, repeat entry, source outage/recovery and rollback each need their own
real-machine receipts; do not claim persistence or restart behavior from fixtures.

## Required real-machine evidence

Verify installed target/arguments, exact source pins, safe repeat/concurrent entry, unique live Producer identity, advancing complete snapshots, and real 8787 reader identities/readiness. Cold-start fixtures prove control flow and arguments only. A machine reboot, actual collector interruption, actual Producer restart, and actual rollback must each be labelled untested unless performed with the appropriate approval. Time quality, targets, reward/risk, browser/model acceptance and full 勢衡 delivery remain separate.
