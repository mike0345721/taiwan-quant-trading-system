# Shioaji Core Market-Data Continuity V1

Status: **IMPLEMENTED AS A DEFAULT-OFF ACTIVATION CANDIDATE**

This package protects the existing Shioaji market-data-only bridge. It does not create a second collector, add a data source, authorize orders, rewrite the live ledger, or activate Windows startup behavior.

## Fixed safety boundary

- `formalWeight=0`
- `researchOnly=true`
- `executionAuthorized=false`
- `orderRoutesEnabled=false`
- runtime mode must be `market_data_only`
- raw live-event ledgers remain append-only
- recovery is forward-only; it does not recreate missing ticks or backfill an interruption

## Existing architecture retained

The Python bridge remains the sole quote subscriber and sole live-event writer. The supervisor first owns a loopback-only OS port guard on `127.0.0.1:8791`; its PID lock is secondary operational identity. The bridge's existing Windows mutex and pre-login bind to `127.0.0.1:8790` remain the final duplicate-subscription guard. The continuity supervisor observes health and starts the same bridge executable only when the bridge port is free and no healthy instance can be reused.

Required subscriptions are limited to the already approved core set:

| Product | Existing alias | Quote types |
|---|---|---|
| TX | TXFR1 | Tick, BidAsk |
| MTX | MXFR1 | Tick, BidAsk |
| TMF | TMFR1 | Tick, BidAsk |
| 2330 | 2330 | Tick |
| IX0001 | IX0001 | Quote |

## Recovery contract

An unexpected bridge loss is evaluated in this order:

1. Validate the `/health` safety fields.
2. Reuse an already healthy instance.
3. If port 8790 is occupied by an unhealthy or untrusted service, fail closed and do not spawn.
4. If the port is free, start the existing bridge and wait for health, required subscriptions, and writer readiness.
5. During an official active market session, keep the state non-green until a post-recovery market event is observed. Outside market hours, subscription and writer readiness are sufficient; the supervisor does not wait for a fake tick.

Exact bounded policy proposed for Owner approval:

- maximum attempts per recovery budget: **3**
- delay before attempts 1/2/3: **0 seconds / 5 seconds / 20 seconds**
- bridge startup timeout per attempt: **30 seconds**
- health polling interval: **2 seconds**
- active-session data-resume grace: **120 seconds**
- exhausted-budget cooldown: **15 minutes**
- healthy reset window recorded in the policy: **5 minutes**

There is no infinite retry loop and no unbounded process spawning. A live but unhealthy port is never killed automatically.

The attempt budget resets only after five continuous healthy minutes. A bridge that flaps briefly back to green therefore cannot reset its budget and create a restart storm.

## Observed incident carried into this package

Product Owner runtime evidence reported one `SESSION_TERMINATED` interruption with recovery attempt 1 succeeding, all five required subscriptions restored, and writer status PASS. The observed interruption window was 08:56:21–08:56:38. Because no native sequence exists, the package records the true-loss conclusion as `UNKNOWN`; this incident is rationale evidence, not a claim that every missing Tick was recovered.

## Expected stop

Stopping the supervisor with `SIGINT` or `SIGTERM` is an expected stop and does not restart its child. The bridge controlled `/shutdown` path exits with a distinct code; a supervisor-owned bridge interprets that as an expected stop. A Shioaji session-down exits with a distinct recoverable code and retains `SESSION_TERMINATED` as the reason.

## Writer and data truth

Recovery is not healthy when the writer thread is unavailable, writer errors are non-zero, or disk health fails. `WRITER_UNAVAILABLE` is distinct from bridge/session failure so a bad writer does not trigger a blind restart storm.

The health contract preserves:

- native sequence: `UNAVAILABLE`
- data-loss certainty: `UNKNOWN_NO_NATIVE_SEQUENCE`
- timestamp lineage: `QUALITY_INSUFFICIENT`

Therefore a successful process restart never means `NO_TICK_LOSS`, `ZERO_PACKET_LOSS`, or that missing data was recovered.

## Minimal observability

The bridge health allowlist and git-ignored continuity status expose only:

- state and bounded reason code
- last healthy/failure/recovery timestamps
- recovery attempt/result
- required subscription status
- writer status
- runtime mode and fixed safety flags
- Data Trust and packet-loss uncertainty

`npm run project:status` reads this status file with an allowlist. Dashboard Data Health presents a Chinese-first `Shioaji 即時行情持續性` row and keeps the raw reason code in technical detail.

## Activation boundary

The candidate entrypoint is:

```text
scripts/start-shioaji-continuity-hidden.ps1
```

It is default-off and requires both an explicit `-OwnerApprovedActivation` switch and `SHIOAJI_CONTINUITY_ACTIVATION_APPROVED=true`. This PR does not change the current Desktop shortcut, `launcher.mjs`, Windows Startup, Scheduled Tasks, or the live 8790 process. Production activation is a separate off-hours Owner decision after PR review.
