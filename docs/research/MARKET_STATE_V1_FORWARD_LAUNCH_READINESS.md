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
| Missing / stale / missed | PASS | Vocabulary is `CLEAN`, `UNAVAILABLE`, `STALE`, `MISSED`, `REJECTED`; non-clean days cannot count as clean evidence. |
| Unauthorized execution | PASS | Any `executionAuthorized!=false`, `researchOnly!=true`, or `formalWeight!=0` is rejected. |
| T0 / P0 / Frozen isolation | PASS | New module, config, script, test, and this document only; no existing artifact is modified. |

## Record lifecycle

1. Before the outcome observation starts, append one immutable `STATE` record for the scheduled trade date.
2. Missing, stale, missed, or rejected days still receive an explicit state/status record and never receive zero, neutral, prior-filled, guessed, or retroactively backfilled evidence.
3. Once the governed outcome becomes legally available, append one `OUTCOME` record referencing `stateRecordHash`.
4. Never rewrite the state. Corrections require a separately governed append-only correction design; CRU-20 does not authorize one.
5. Audit sequence, hash chain, immutable hashes, temporal alignment, future evidence, duplicate records, and authorization boundaries on every replay.

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
