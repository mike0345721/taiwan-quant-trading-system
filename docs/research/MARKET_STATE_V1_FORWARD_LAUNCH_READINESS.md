# Market State V1 Forward Shadow Launch Readiness

> Work package: CRU-20
>
> Status: `READY_FOR_OWNER_LAUNCH_REVIEW` — `NOT_ACTIVE`
>
> Baseline main commit: `83666f12daaedc771d49058ce04f8612e948e8cd`
>
> Boundary: `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`

## Scope and frozen references

This package prepares an isolated Forward Shadow recording contract. It does not launch Forward Shadow, set an official start date, install or enable a scheduler, collect Day 1 evidence, connect Strategy Router, Risk Engine, Paper Trading, broker APIs, orders, or execution.

The frozen source of truth remains:

- `MARKET_STATE_V1_FORWARD_SHADOW_GATE.md`
- `MARKET_STATE_V1_RESEARCH_CLOSEOUT.md`
- Market State evaluator `market-state-v1-premarket-evaluator-v0`
- Outcome Contract `market-state-outcome-contract-v1`
- linkage contract `cru18-single-axis-linkage-v1`

The launch candidate is deterministic and records hashes for these artifacts. `finalMainCommit` and `candidateStartTradeDate` remain `null` until a later Product Owner launch decision.
The byte-stable candidate artifact is `MARKET_STATE_V1_FORWARD_LAUNCH_MANIFEST_CANDIDATE.json` with embedded logical `manifestHash=a65d91e7b559bba38c90de323d8cabfc59543d4969a876defad12de80c7c2eed`.

## Readiness matrix

| Gate | Status | Evidence / boundary |
|---|---|---|
| GitHub baseline | PASS | Built from main `83666f12daaedc771d49058ce04f8612e948e8cd`. |
| Local Windows environment | PASS_FOR_MANUAL_TEST | Node-based preflight uses repository-local paths and a caller-supplied git-ignored output directory. |
| Launch manifest | PASS_CANDIDATE_ONLY | Byte-stable canonical JSON; `launchStatus=NOT_ACTIVE`; no start date. |
| Collector | READY_NOT_ACTIVE | Only `DRY_RUN`, `NOT_ACTIVE`, and `MANUAL_TEST` are accepted. No market collection or official evidence is started by CRU-20. |
| Scheduler dry-run | READY_NOT_ACTIVE | Command template exists in config; no Windows Task Scheduler operation is performed. |
| Append-only state | PASS | Exactly one official state record per `tradeDate`; outcome is a later linked record. |
| Duplicate guard | PASS | Duplicate official state or outcome is a hard failure. |
| State mutation guard | PASS | Record hash covers immutable state payload; mutation invalidates the ledger. |
| Hash chain | PASS | Every record has sequence, `previousHash`, and deterministic `recordHash`. |
| Deterministic replay | PASS | Same frozen inputs and timestamps produce identical JSON and hashes. |
| Temporal guard | PASS | `decisionAt < outcomeObservationStartAt` is mandatory. |
| Future-data guard | PASS | State and all evidence `availableAt` values must be no later than `decisionAt`. |
| Missing / stale / missed | PASS | `MISSED` uses an administrative `SESSION_STATUS` record without fabricated Market State or decision timestamps. `STALE` / `UNAVAILABLE` may use `STATE` only when a legal pre-outcome snapshot exists. Non-clean days cannot count as clean evidence. |
| Unauthorized execution | PASS | Any `executionAuthorized!=false`, `researchOnly!=true`, or `formalWeight!=0` is rejected. |
| T0 / P0 / Frozen isolation | PASS | New module, config, script, test, and this document only; no existing artifact is modified. |

## Record lifecycle

1. Before the outcome observation starts, append one immutable `STATE` record for the scheduled trade date.
2. A truly missed session receives one administrative `SESSION_STATUS` record containing schedule/record time and reason, with no fabricated `decisionAt`, `availableAt`, axis snapshot, evidence lineage, or outcome observation time. `STALE` / `UNAVAILABLE` retain the `STATE` path only if a legal pre-outcome snapshot existed.
3. A `MISSED` session can never accept an outcome, become `CLEAN`, or receive a later same-trade-date state backfill.
4. Once the governed outcome becomes legally available, append one `OUTCOME` record referencing `stateRecordHash`.
5. Never rewrite the state. Corrections require a separately governed append-only correction design; CRU-20 does not authorize one.
6. Audit sequence, hash chain, immutable hashes, temporal alignment, future evidence, duplicate records, and authorization boundaries on every replay.

## Collector and scheduler preparation

- Collector mode: `NOT_ACTIVE`.
- Permitted preparation modes: `DRY_RUN`, `NOT_ACTIVE`, `MANUAL_TEST`.
- Scheduler mode: `NOT_ACTIVE`.
- Formal scheduler enabled: `false`.
- Start trade date: not set.
- The preflight command only writes a candidate manifest and readiness result to a caller-supplied output directory. It does not write the official forward ledger.
- P0 observer and ledger code were used only as a design reference. Market State storage is isolated because sharing P0 runtime paths could risk contaminating T0/P0 evidence.

## Remaining Product Owner launch decisions

1. Approve the final merged main commit as the immutable launch baseline.
2. Set an official forward start trade date.
3. Approve the final local output directory and retention/backup policy.
4. Approve the daily operating time and formal Windows scheduler installation.
5. Confirm the first manual preflight evidence and explicitly authorize launch.

Until all five decisions are complete, launch status remains `NOT_ACTIVE`. This package is ready only for Product Owner launch review.

## Pre-existing full-suite P0 test failure

- Failing test: `forward observer records a missed start once and never accepts a frozen T0 result as input` in `tests/p0-paper-trading.test.mjs`.
- Baseline main `83666f12daaedc771d49058ce04f8612e948e8cd`, using the same Node / Windows environment and valid frozen artifact bytes: `6 PASS / 1 FAIL`; expected two missed-start ledger records but observed one.
- CRU-20 branch result: the same test fails with the same expected-two / actual-one assertion.
- `PRE_EXISTING_BASELINE_FAILURE_CONFIRMED=true`.
- CRU-20 does not modify P0 source, tests, frozen inputs, runtime ledger, or observer behavior. This out-of-scope pre-existing failure is recorded but is not repaired by CRU-20.

## CRU-22 final launch capability revision

CRU-22 preserves the CRU-20 history above and does not rewrite it. The current checkout now passes the full project suite, including the previously failing P0 observer test. This is recorded as `CURRENT_FULL_SUITE_STATUS=PASS`; it is not represented as a P0 repair because CRU-22 changes no P0 source, tests, runtime, or frozen artifact. The difference is treated as environment/runtime-state sensitive unless a separate P0 investigation proves a code cause.

- `PREVIOUS_BASELINE_FAILURE_HISTORY=PRESERVED`
- `CURRENT_FULL_SUITE_STATUS=PASS`

The dormant official research collection mode is named `FORWARD_SHADOW`. It is not broker execution, live trading, Strategy Router, Paper Trading, or order routing. Its permanent safety boundary remains `formalWeight=0`, `researchOnly=true`, and `executionAuthorized=false`.

`FORWARD_SHADOW` cannot start from a boolean flag. It requires all of the following to match exactly:

- a byte-stable `READY_FOR_LAUNCH` manifest and its `manifestHash`;
- the current repository commit and the approved `finalMainCommit`;
- the approved `officialStartTradeDate`;
- the frozen selected axes;
- evaluator, Outcome Contract, linkage, and Frozen Gate hashes;
- an Owner approval artifact whose own hash binds the manifest hash, final commit, start date, scheduler time, decision reference, and approval timestamp;
- `executionAuthorized=false`.

Any mismatch is a hard failure and produces no official evidence. Candidate and manual modes write only `candidate-ledger.ndjson`. The governed official mode writes only `official-ledger.ndjson` plus immutable envelopes under `official-records/`; it never promotes or renames candidate evidence.

The scheduler installer remains unexecuted in CRU-22. Without a valid launch manifest and Owner approval artifact it cannot install anything. After a later explicit Owner Launch Approval, its governed action is prepared to run `FORWARD_SHADOW` at 08:25 Asia/Taipei with `WakeToRun` and `IgnoreNew`. The current formal scheduler state remains disabled/not installed, the official start date remains unset, and no official Forward evidence has been written.

Primary evidence storage remains on D:. A same-volume operational second-copy candidate is `D:\Taiwan stock\forward-shadow-backup\<runId>`. It is explicitly `NOT_CONFIGURED` and `NOT_DISASTER_RESILIENT`; CRU-22 does not create or populate it.
