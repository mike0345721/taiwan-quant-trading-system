# CRU-27 Operational Integrity Stabilization

Captured at: 2026-08-14 Asia/Taipei

This document records the bounded operational repair only. It is not Forward evidence, does not authorize production activation, and does not change any frozen model, prediction, outcome, or acceptance state.

## P0 test mutation incident

- Classification: `TEST_MUTATION_OBSERVED`
- Affected path: `data/paper/p0-forward/daily/2026-01-02.json`
- Current SHA-256: `d9f81339b630a2b2fe81e016cac8c81aede916f1dbde5d23ea8f5a370cf543c8`
- Current last write time: 2026-08-14 21:47:18 Asia/Taipei
- Cause supported by code: the regression supplied a temporary paper ledger, while the observer still derived daily status from the canonical repository root.
- Git status: ignored and untracked runtime artifact.
- Exact previous bytes: `NOT_RECOVERABLE_EXACT`; no exact backup or other governed copy was found.
- Append-only P0 ledger mutation from this incident: not observed.
- Governance treatment: no restore, reconstruction, backfill, or acceptance upgrade. The current file is retained as incident evidence and is not counted as a Forward observation.

The observer now accepts one explicit `--runtime-root`. Both the paper ledger and daily status derive from that root unless individually and explicitly overridden. Production defaults remain unchanged. Regression tests use only temporary roots.

## V3.10 / P0 lifetime observation

Retained 2026-08-14 runtime evidence showed both observers ending around 09:00 with Windows result `0xC000013A`, while Task History was insufficient to attribute a precise cause. The root cause therefore remains `UNKNOWN_INSUFFICIENT_EVIDENCE`.

Repository wrappers now emit separate bounded operational telemetry with wrapper/observer start, child PID, parent PID, expected trade date, heartbeat, lifecycle stage, shutdown request, exit code, signal when known, and wrapper exit. This telemetry is stored outside Forward evidence and cannot change prediction, outcome, or acceptance.

No Scheduled Task was installed, rebound, started, stopped, or modified by CRU-27. Current Task Scheduler definitions could not be re-read from the sandbox identity because Windows denied access; production activation therefore remains pending Owner review.

## Data continuity timeout

The 2026-08-14 21:15 Daily Update evidence separates the stages:

- TAIFEX: `PASS` in 240.3 seconds.
- Official validation: 1167 / 1167 checks passed.
- `market_daily:2026-08-14`: present; official TAIFEX futures source is non-stale and not a cache fallback.
- Quality: `FAIL` (`exit_2`).
- Live-event ledger audit: `FAIL` (`exit_1`).
- Data continuity audit: `TIMEOUT` after 300.1 seconds.
- Overall: `FAILED`, without reclassifying TAIFEX as failed.

The timeout root was the live coverage stage parsing every line of every NDJSON file, including files irrelevant to the completed-day query. The observed directory contained 17 files and 28,302,197,471 bytes; the largest file was 2026-07-31 at 3,162,711,293 bytes.

The bounded implementation now:

1. scans completed trading dates only;
2. uses deterministic windows across each file;
3. stops as soon as both governed presence predicates (`IX0001`, `2330`) are proven;
4. caps each file at 64 MiB;
5. returns `AUDIT_INCOMPLETE` rather than PASS or a fabricated gap when the bound cannot prove coverage;
6. records files, bytes, rows, stage elapsed time, and largest offender.

Read-only validation against the actual canonical data set referenced 14 completed-day files totaling 26,207,367,096 bytes, read 92,667,904 bytes / 76,019 rows, found all 14 days complete, and completed the live coverage stage in approximately 1.0-1.5 seconds. The validation report was written only to the isolated worktree.

## Historical truth and safety

- V3.10 2026-08-14: predictions `12`, outcomes `0`, accepted `false`.
- 2026-08-14 backfill: `NO`.
- Forward binding change: `NO`.
- CRU-26 activation: `NO`.
- `formalWeight=0`.
- `researchOnly=true`.
- `executionAuthorized=false`.
- `orderRoutesEnabled=false`.
