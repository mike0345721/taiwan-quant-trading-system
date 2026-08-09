# Market State V1 Forward Shadow Gate

> Work package: CRU-19  
> Status: OWNER-FROZEN 2026-08-09 — NOT ACTIVE  
> Forward collector / scheduler: NOT AUTHORIZED  
> `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`

## Owner-frozen scope

Product Owner approved this Forward Gate on 2026-08-09. The gate is frozen before any new forward outcome is observed.

Forward Shadow axes are independent and limited to:

- `direction`: `BULLISH` versus `BEARISH`.
- `globalAlignment`: `TAILWIND` versus `HEADWIND`.

The following remain paused and are not eligible to determine PASS/FAIL in this run:

- `trend`: `PAUSE_INSUFFICIENT_SAMPLE`.
- `volatility`: `PAUSE_INSUFFICIENT_SAMPLE`.
- `riskResearchContext`: `PAUSE_INSUFFICIENT_SAMPLE`.

No Direction × Global combination, Cartesian state search, composite score, or new factor is authorized.

## Frozen code / contract references

The governed code references below are frozen as the research baseline. The eventual launch manifest must additionally record the final merged repository commit and official forward start trade date.

| Artifact | Version / reference | SHA-256 |
|---|---|---|
| Research code baseline | `9c9bbaeae6260c7b660a4e3bcf18287ef05c0739` | Git commit |
| Market State evaluator | `market-state-v1-premarket-evaluator-v0` / `src/market-state-v1.mjs` | `a7285f53006f49ae0cd1613e2798eaca730d83d03eb980d9f5d1e095d6b512b7` |
| Historical adapter / evidence construction | `src/market-state-historical.mjs` | `b1ecbe423c8660a9eec64baa62edca68478357db4c2a76be647099950b83d9c4` |
| Outcome Contract | `market-state-outcome-contract-v1` / `src/market-state-outcome-contract.mjs` | `b5cf8434636aec5a54fdfeaa63754213495aa563f315d09e39bd1dca34580f96` |
| Single-axis linkage contract | `cru18-single-axis-linkage-v1` / `src/market-state-outcome-linkage.mjs` | `884afd174e6d86d9c525629138c12ae5d67316b3f904013d69e2d813ea66a081` |

A Forward Shadow launch is not authorized until an immutable launch manifest records the final merged main commit, these governed artifact hashes, the official start date, the selected axes, and the frozen gate policy.

## Daily append-only snapshot

Each scheduled trading day must produce exactly one traceable official status record, including missed, rejected, stale, or unavailable days. At minimum preserve:

- `tradeDate`, `sessionId`, `decisionAt`, `availableAt`, `recordedAt`;
- evaluator version/hash and Outcome Contract version/hash;
- independent axis snapshots for `trend`, `direction`, `volatility`, `globalAlignment`, and `riskResearchContext`;
- explicit Forward Shadow participation for `direction` and `globalAlignment` only;
- evidence identifiers, source dates/timestamps/hashes, feature versions, and maximum legal input `availableAt`;
- `qualityStatus`, stale/missing state, unavailable reasons, session/contract state, and any future-data or temporal-alignment violation;
- outcome observation start, outcome availability, actual contract code, source lineage and outcome hash after the observation window completes;
- prior ledger hash, sequence number, record hash, idempotency key, and deterministic replay digest;
- `formalWeight=0`, `researchOnly=true`, `executionAuthorized=false`.

The daily state snapshot must be written before its linked outcome is observable. The later outcome record may reference the immutable state record but must never alter it.

## Time and evidence rules

1. `decisionAt` and every required evidence timestamp must be legal and no later than the state snapshot's `availableAt`.
2. The Market State decision must precede the Outcome Contract's `observationStartAt`.
3. No outcome, partial outcome, future bar, PnL, strategy result, or later-revised source may enter state generation.
4. Missing inputs remain unavailable; they are never zero, neutral, prior-filled, or guessed.
5. Evidence lineage must allow a reviewer to reconstruct every accepted or unavailable state.
6. Canonical risk remains `NORMAL | HIGH_RISK | UNAVAILABLE`; `ELEVATED` is legal only in `riskResearchContext`.

## No peeking and no retroactive backfill

- Operational checkpoints may inspect integrity, scheduler health, source coverage, stale/missing status, hashes, and replay consistency only.
- Statistical outcome-effect review occurs only when an axis reaches its frozen statistical sample gate or when the 180-scheduled-trading-day first-run horizon is reached.
- No partial outcome-effect summary may be used to decide whether to continue, stop, retune, or change the gate.
- A missed forward day cannot be recreated as forward evidence. A later replay must be labeled `RETROSPECTIVE_REPLAY_ONLY` and excluded from the forward statistical sample.
- Corrections are append-only. Existing state, outcome, and hash-chain records are never silently replaced.
- After the Owner-approved forward start, no axis semantics, threshold, evidence block, Outcome formula, observation window, sample rule, or missing-data rule may be changed inside the same run.
- Any necessary semantic change closes the current run and requires `RETURN_TO_RESEARCH`, a new version, and a new Owner-approved start date.

## Deterministic replay

Identical frozen code, specs, inputs, source hashes, and timestamps must reproduce identical state, outcome, alignment, and ledger digests. A replay mismatch is a hard integrity failure. Replay may verify existing evidence but may not manufacture a missed forward observation.

## Owner-frozen sample policy

Two separate gates apply so operational duration is not confused with statistical sample sufficiency.

### Operational floor

- Observe at least **60 scheduled trading days** from the official forward start.
- Every scheduled trading day must have a traceable official record, including `UNAVAILABLE`, missed, stale, or rejected days.
- Missing/stale/unavailable days do not become clean statistical observations and are never silently backfilled.

### Statistical sufficiency

For each promoted axis independently:

- both sides of its predeclared primary comparison must each have at least **30 clean accepted forward observations**.

If a required state remains rare, the axis remains `INSUFFICIENT_SAMPLE`. Do not merge states, retune thresholds, relabel unavailable observations, add axes, backfill missed days, or select favorable periods.

### Maximum first-run horizon

- The first frozen run has a maximum horizon of **180 scheduled trading days**.
- If an axis still lacks 30 clean observations per required side at that horizon, close that axis as `INSUFFICIENT_SAMPLE` for this run.
- The 180-day horizon cannot be extended inside the same run to manufacture sample sufficiency.

## Owner-frozen primary outcome and PASS criteria

Only one primary forward outcome field may determine PASS/FAIL for each promoted axis:

- Outcome family: `LARGE_MOVE_CONTINUOUS`.
- Primary field: `sessionReturnBps`.

All other already-governed Outcome Contract fields remain descriptive-only for this Forward Gate and cannot determine PASS/FAIL.

### Direction

Predeclared comparison: `BULLISH` minus `BEARISH` mean `sessionReturnBps`.

`PASS` requires, after the operational floor and statistical sufficiency requirements are met:

1. mean(`BULLISH.sessionReturnBps`) - mean(`BEARISH.sessionReturnBps`) > 0; and
2. the deterministic 95% bootstrap confidence interval for that mean difference is entirely above 0.

### Global Alignment

Predeclared comparison: `TAILWIND` minus `HEADWIND` mean `sessionReturnBps`.

`PASS` requires, after the operational floor and statistical sufficiency requirements are met:

1. mean(`TAILWIND.sessionReturnBps`) - mean(`HEADWIND.sessionReturnBps`) > 0; and
2. the deterministic 95% bootstrap confidence interval for that mean difference is entirely above 0.

### Practical-effect boundary

There is **no separate bps / economic practical-effect floor in this Market State information-content gate**.

A Forward Shadow `PASS` means only that the frozen Market State axis demonstrated forward information content under the predeclared test. It does not establish trading edge, profitability after costs, formal factor weight, strategy permission, position sizing, Risk Engine authority, Paper eligibility, or execution authority.

Any economic/material-effect threshold must be separately predeclared and Owner-approved in a later Strategy Router or strategy-specific work package.

## Status definitions

### PASS

Use only when:

- the 60-scheduled-day operational floor is met;
- the axis has at least 30 clean accepted observations on each required side;
- all frozen integrity, time, lineage and deterministic replay requirements pass;
- the axis-specific primary `sessionReturnBps` criterion above passes; and
- the Product Owner explicitly approves any later promotion work package.

`PASS` makes the axis eligible only for a separate Strategy Router **design review**. It does not itself authorize integration.

### FAIL

Use when either:

- an axis has a sufficient clean sample but its frozen primary mean-direction / 95% bootstrap CI criterion does not pass; or
- an Owner-frozen run-integrity requirement fails in a way that invalidates the governed run.

Preserve the negative result. Do not retune or rescue it inside the same run.

### INSUFFICIENT_SAMPLE

Use when the run remains governed and operationally valid but an axis does not reach 30 clean observations per required side by the 180-scheduled-day horizon.

Do not inspect partial outcome effects to justify extending the run or changing state definitions.

### RETURN_TO_RESEARCH

Use when the evaluator semantics, source lineage, available-at policy, Outcome Contract, state availability, or data quality is no longer fit for the frozen question, or when a hard integrity failure requires a new governed version.

This status cannot be used to erase an unfavorable sufficient-sample result.

## Hard integrity failures versus session-level UNAVAILABLE

Hard run-integrity failures include:

- any future-data violation;
- any temporal-alignment violation;
- deterministic replay mismatch;
- hash-chain failure;
- duplicate official state record;
- silent correction / mutation of an immutable official record;
- unauthorized execution.

Ordinary source missingness, staleness, or a legally unavailable state is recorded as that session's explicit `UNAVAILABLE` / quality status and excluded from the clean statistical sample. It must never be zero-filled, neutral-filled, prior-filled, guessed, or retroactively converted into forward evidence.

## Eligibility for a later Strategy Router design review

An axis may be brought to a separate Strategy Router design review only after:

1. its Forward Shadow gate receives `PASS` under this frozen contract;
2. all evidence and negative results are preserved;
3. a separate promotion decision defines the permitted product role;
4. formal weight, conflicts, expiry, stale behavior, practical/economic effect and risk veto remain separately governed; and
5. the Product Owner explicitly authorizes a new work package.

This gate does not connect Market State to Strategy Router, Risk Engine, Paper Trading, broker APIs, orders, or execution.

## Launch decisions still required

The gate rules are frozen, but Forward Shadow is **not yet active**. Before launch, a separate implementation/launch review must still define and verify:

- final merged main commit and immutable launch manifest;
- official forward start trade date;
- daily operating time / scheduler behavior;
- late-start and missed-day operational handling consistent with this gate;
- collector/storage implementation and append-only ledger behavior;
- local validation on the D-drive runtime;
- explicit Product Owner launch approval.

Until those launch requirements are completed: `FORWARD_SHADOW_STATUS=NOT_AUTHORIZED`.
